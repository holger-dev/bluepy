"""BluePy's own tracer: breakpoints, stepping and pausing for user code.

Design (docs/02, ADR #5):
- `sys.settrace` on the main thread, installed only around user-code
  invocations and only while the debugger is *armed* (debugger window open)
  or breakpoints exist – otherwise user code runs at full speed.
- Only frames whose file lives inside the project are traced line by line;
  library frames get no local trace function, so they cost one call event.
- When execution pauses, the main thread blocks in `_wait_for_command()`;
  the reader thread answers `debug.frames` / `debug.variables` by reading the
  suspended frame objects, and `debug.continue` & co. put a command into the
  queue.  A Halt while paused aborts the invocation (HaltRequested), exactly
  like a Halt during a busy loop.
"""

from __future__ import annotations

import os
import queue
import sys
import threading
from types import FrameType
from typing import TYPE_CHECKING, Any, Callable

from .codepad import describe_value
from .errors import HaltRequested
from .objects import fields_of, is_inspectable, navigate

if TYPE_CHECKING:  # pragma: no cover
    from .session import Session

TraceFunction = Callable[[FrameType, str, Any], Any]


def normalize(path: str) -> str:
    try:
        return os.path.normcase(os.path.realpath(path))
    except (OSError, ValueError):
        return os.path.normcase(path)


class Debugger:
    POLL_SECONDS = 0.2

    def __init__(self, session: Session) -> None:
        self.session = session
        self.project_dir = normalize(session.cwd or os.getcwd())
        self.lock = threading.Lock()
        self.breakpoints: dict[str, set[int]] = {}  # normalized absolute file -> lines
        self.armed = False
        self.pause_requested = False
        # stepping state (main thread only)
        self.step_mode: str | None = None  # None | "over" | "into" | "out"
        self.step_frame: FrameType | None = None
        self.step_depth = 0
        # paused state
        self.paused_frame: FrameType | None = None
        self.paused_frames: list[FrameType] = []
        self.commands: queue.Queue[str] = queue.Queue()
        self._tracing = False

    # ----------------------------------------------------------- settings

    def set_project_dir(self, directory: str) -> None:
        self.project_dir = normalize(directory)

    def set_breakpoints(self, rel_file: str, lines: list[int]) -> None:
        key = normalize(os.path.join(self.session.cwd or os.getcwd(), rel_file))
        with self.lock:
            if lines:
                self.breakpoints[key] = set(int(line) for line in lines)
            else:
                self.breakpoints.pop(key, None)

    def clear_breakpoints(self) -> None:
        with self.lock:
            self.breakpoints.clear()

    def arm(self, enabled: bool) -> None:
        with self.lock:
            self.armed = enabled

    def active(self) -> bool:
        with self.lock:
            return self.armed or bool(self.breakpoints)

    def request_pause(self) -> bool:
        """Ask the running invocation to pause at its next line (needs active tracing)."""
        with self.lock:
            if not self._tracing:
                return False
            self.pause_requested = True
            return True

    # ------------------------------------------------------------ tracing

    def tracing(self) -> "_TracingContext":
        return _TracingContext(self)

    def _is_user_file(self, filename: str) -> bool:
        if not filename or filename.startswith("<"):
            return False
        return normalize(filename).startswith(self.project_dir + os.sep) or normalize(filename) == self.project_dir

    def _depth(self, frame: FrameType) -> int:
        depth = 0
        f: FrameType | None = frame
        while f is not None:
            depth += 1
            f = f.f_back
        return depth

    def _global_trace(self, frame: FrameType, event: str, _arg: Any) -> TraceFunction | None:
        if event != "call":
            return None
        if not self._is_user_file(frame.f_code.co_filename):
            return None
        # stepping *into* must pause on the first line of the new frame
        return self._local_trace

    def _local_trace(self, frame: FrameType, event: str, arg: Any) -> TraceFunction | None:
        if event == "line":
            if self._should_pause(frame):
                self._pause(frame, self._pause_reason(frame))
        elif event == "return" and self.step_mode == "out" and frame is self.step_frame:
            # stop at the next line of the caller
            self.step_mode = "over"
            self.step_frame = frame.f_back
            self.step_depth = self._depth(frame) - 1
        elif event == "exception" and self.step_mode is None:
            pass
        return self._local_trace

    def _pause_reason(self, frame: FrameType) -> str:
        with self.lock:
            if self.pause_requested:
                return "pause"
        if self.step_mode is not None:
            return "step"
        return "breakpoint"

    def _should_pause(self, frame: FrameType) -> bool:
        with self.lock:
            pause = self.pause_requested
            lines = self.breakpoints.get(normalize(frame.f_code.co_filename))
        if pause:
            return True
        if lines and frame.f_lineno in lines:
            return True
        mode = self.step_mode
        if mode == "into":
            return True
        if mode == "over":
            depth = self._depth(frame)
            return frame is self.step_frame or depth < self.step_depth
        return False

    # ------------------------------------------------------------- pausing

    def _pause(self, frame: FrameType, reason: str) -> None:
        with self.lock:
            self.pause_requested = False
        self.step_mode = None
        self.step_frame = None
        self.paused_frame = frame
        self.paused_frames = self._user_frames(frame)
        self.session.conn.notify(
            "debug.paused",
            {"reason": reason, "frames": self.frames_info(), "invocation": self.session.current_invocation},
        )
        try:
            command = self._wait_for_command()
        finally:
            self.paused_frame = None
            self.paused_frames = []
        self.session.conn.notify("debug.resumed", {"command": command})
        if command == "continue":
            self.step_mode = None
        elif command == "step":
            self.step_mode = "over"
            self.step_frame = frame
            self.step_depth = self._depth(frame)
        elif command == "stepInto":
            self.step_mode = "into"
        elif command == "stepOut":
            self.step_mode = "out"
            self.step_frame = frame
            self.step_depth = self._depth(frame)
        elif command == "terminate":
            raise HaltRequested()

    def _wait_for_command(self) -> str:
        while True:
            try:
                return self.commands.get(timeout=self.POLL_SECONDS)
            except queue.Empty:
                self.session.check_halt()

    def command(self, name: str) -> bool:
        """Called on the reader thread."""
        if self.paused_frame is None:
            return False
        self.commands.put(name)
        return True

    # ------------------------------------------------------------- frames

    def _user_frames(self, frame: FrameType) -> list[FrameType]:
        frames: list[FrameType] = []
        f: FrameType | None = frame
        while f is not None:
            if self._is_user_file(f.f_code.co_filename):
                frames.append(f)
            f = f.f_back
        return frames

    def _rel(self, filename: str) -> str:
        try:
            return os.path.relpath(filename, self.session.cwd or os.getcwd()).replace("\\", "/")
        except ValueError:
            return filename

    def frames_info(self) -> list[dict[str, Any]]:
        result = []
        for index, f in enumerate(self.paused_frames):
            code = f.f_code
            result.append(
                {
                    "index": index,
                    "file": self._rel(code.co_filename),
                    "line": f.f_lineno,
                    "function": code.co_name,
                    "className": type(f.f_locals["self"]).__name__ if "self" in f.f_locals else None,
                }
            )
        return result

    def _frame(self, index: int) -> FrameType:
        if self.paused_frame is None or index < 0 or index >= len(self.paused_frames):
            raise IndexError("no such frame")
        return self.paused_frames[index]

    @staticmethod
    def _entries(items: list[tuple[str, Any]]) -> list[dict[str, Any]]:
        return [{"name": name, "value": describe_value(value), "inspectable": is_inspectable(value)} for name, value in items]

    def variables(self, index: int) -> dict[str, Any]:
        frame = self._frame(index)
        local_items = [(k, v) for k, v in frame.f_locals.items() if k != "self" and not k.startswith("__")]
        instance_items: list[tuple[str, Any]] = []
        static_items: list[tuple[str, Any]] = []
        self_obj = frame.f_locals.get("self")
        if self_obj is not None:
            instance_dict = getattr(self_obj, "__dict__", None)
            if isinstance(instance_dict, dict):
                instance_items = list(instance_dict.items())
            for name, value in vars(type(self_obj)).items():
                if name.startswith("__") or callable(value) or isinstance(value, (staticmethod, classmethod, property)):
                    continue
                static_items.append((name, value))
        else:
            # module-level code: show module globals that are not modules/classes/functions
            for name, value in frame.f_globals.items():
                if name.startswith("__") or callable(value) or type(value).__name__ == "module":
                    continue
                static_items.append((name, value))
        return {
            "frame": index,
            "locals": self._entries(local_items),
            "instance": self._entries(instance_items),
            "static": self._entries(static_items),
        }

    def inspect(self, index: int, scope: str, name: str, path: list[Any]) -> dict[str, Any]:
        frame = self._frame(index)
        if scope == "locals":
            root = frame.f_locals[name]
        elif scope == "instance":
            root = getattr(frame.f_locals["self"], name)
        elif scope == "static":
            self_obj = frame.f_locals.get("self")
            root = vars(type(self_obj))[name] if self_obj is not None else frame.f_globals[name]
        else:
            raise KeyError(scope)
        value = navigate(root, path)
        cls = type(value)
        return {"value": describe_value(value), "className": cls.__name__, "fields": fields_of(value)}


class _TracingContext:
    """`with debugger.tracing():` installs the tracer for one invocation."""

    def __init__(self, debugger: Debugger) -> None:
        self.debugger = debugger
        self.installed = False

    def __enter__(self) -> None:
        if self.debugger.active():
            self.debugger.step_mode = None
            with self.debugger.lock:
                self.debugger._tracing = True
            sys.settrace(self.debugger._global_trace)
            self.installed = True

    def __exit__(self, *_exc: object) -> None:
        if self.installed:
            sys.settrace(None)
        with self.debugger.lock:
            self.debugger._tracing = False
            self.debugger.pause_requested = False
        self.debugger.step_mode = None
        self.debugger.paused_frame = None
        self.debugger.paused_frames = []
