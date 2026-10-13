"""One backend session: dispatch loop, invocation handling, halt support."""

from __future__ import annotations

import ast
import builtins
import ctypes
import os
import queue
import sys
import threading
import time
import traceback
from typing import Any, Callable

from . import PROTOCOL_VERSION, __version__
from .codepad import describe_value, evaluate, format_exception
from .debugger import Debugger
from .env import env_info, python_summary
from .errors import HaltRequested
from .objects import (
    Bench,
    ModuleLoader,
    call_expression,
    describe_class,
    eval_args,
    fields_of,
    is_bench_worthy,
    is_inspectable,
    module_name_for,
    navigate,
    path_expression,
)
from .rpc import (
    HALTED,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    Connection,
    JsonRpcError,
)
from .streams import OutputProxy, StdinProxy
from .testing import build_suite, describe_test_class, fixture_from_class, run_suite


_SHUTDOWN = object()

# Methods answered directly on the reader thread (must not run user code).
IMMEDIATE_METHODS = frozenset(
    {
        "ping",
        "env.info",
        "halt",
        "shutdown",
        "stdin.provide",
        "bench.list",
        "bench.suggestName",
        "bench.clear",
        "tests.describe",
        "debug.setBreakpoints",
        "debug.clearBreakpoints",
        "debug.arm",
        "debug.continue",
        "debug.step",
        "debug.stepInto",
        "debug.stepOut",
        "debug.terminate",
        "debug.pause",
        "debug.frames",
        "debug.variables",
        "debug.inspect",
        "debug.state",
    }
)

Handler = Callable[[dict[str, Any]], Any]


def _target_names(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, (ast.Tuple, ast.List)):
        return [n for elt in node.elts for n in _target_names(elt)]
    if isinstance(node, ast.Starred):
        return _target_names(node.value)
    return []


def assigned_names(code: str) -> tuple[list[str], dict[str, str | None]]:
    """Variables a Code Pad statement (re)binds or deletes at top level, with the
    source of the value expression where there is a simple one."""
    try:
        tree = ast.parse(code.rstrip("\n"), "<codepad>", "exec")
    except SyntaxError:
        return [], {}
    names: list[str] = []
    code_for: dict[str, str | None] = {}

    def add(name: str, source: str | None) -> None:
        if name not in names:
            names.append(name)
        code_for[name] = source

    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            value_src = ast.unparse(stmt.value)
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    add(target.id, value_src)
                elif isinstance(target, (ast.Tuple, ast.List)) and isinstance(stmt.value, (ast.Tuple, ast.List)) and len(target.elts) == len(stmt.value.elts):
                    for elt, val in zip(target.elts, stmt.value.elts):
                        for n in _target_names(elt):
                            add(n, ast.unparse(val) if isinstance(elt, ast.Name) else None)
                else:
                    for n in _target_names(target):
                        add(n, None)
        elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            for n in _target_names(stmt.target):
                add(n, ast.unparse(stmt.value))
        elif isinstance(stmt, ast.AugAssign):
            for n in _target_names(stmt.target):
                add(n, None)
        elif isinstance(stmt, ast.Delete):
            for target in stmt.targets:
                for n in _target_names(target):
                    add(n, None)
        elif isinstance(stmt, (ast.For, ast.With, ast.AsyncFor, ast.AsyncWith)):
            # loop variables / context targets end up in the namespace too
            targets = [stmt.target] if isinstance(stmt, (ast.For, ast.AsyncFor)) else [i.optional_vars for i in stmt.items if i.optional_vars]
            for target in targets:
                for n in _target_names(target):
                    add(n, None)
    return names, code_for


class Session:
    def __init__(self, conn: Connection, token: str, cwd: str | None) -> None:
        self.conn = conn
        self.token = token
        self.cwd = cwd
        self.jobs: queue.Queue[Any] = queue.Queue()
        self.namespace: dict[str, Any] = {"__name__": "__codepad__", "__builtins__": builtins}
        self.current_invocation: Any = None
        self.current_method: str | None = None
        self._main_thread_id = threading.get_ident()
        self._halt_lock = threading.Lock()
        self._running = False
        self._halt_pending = False
        # True while an asynchronous HaltRequested has been set on the main thread
        # and not yet caught.  We never *cancel* a pending async exception with
        # PyThreadState_SetAsyncExc(tid, NULL): on CPython 3.11 that call makes the
        # next traced function call hang forever (sys.settrace never fires).
        self._async_exc_armed = False
        self._shutting_down = False
        self._responded = False
        self.stdout = OutputProxy(self, "stdout")
        self.stderr = OutputProxy(self, "stderr")
        self.stdin = StdinProxy(self)
        self.bench = Bench(self.namespace)
        self.loader = ModuleLoader(cwd or os.getcwd(), self.namespace)
        self.debugger = Debugger(self)
        # Source of the expression that produced `_` (last Code Pad / call result), for bench code tracking.
        self._last_result_code: str | None = None
        # Object results of Code Pad entries, by entry id ("$<id>" in object.inspect/get), newest last.
        self._codepad_values: dict[int, tuple[Any, str]] = {}
        self.handlers: dict[str, Handler] = {
            "ping": self._h_ping,
            "env.info": self._h_env_info,
            "halt": self._h_halt,
            "shutdown": self._h_shutdown,
            "stdin.provide": self._h_stdin_provide,
            "codepad.eval": self._h_codepad_eval,
            "project.open": self._h_project_open,
            "module.load": self._h_module_load,
            "module.run": self._h_module_run,
            "class.describe": self._h_class_describe,
            "object.create": self._h_object_create,
            "object.call": self._h_object_call,
            "object.inspect": self._h_object_inspect,
            "object.get": self._h_object_get,
            "object.remove": self._h_object_remove,
            "bench.list": self._h_bench_list,
            "bench.suggestName": self._h_bench_suggest_name,
            "bench.clear": self._h_bench_clear,
            "tests.describe": self._h_tests_describe,
            "tests.run": self._h_tests_run,
            "tests.fixtureToBench": self._h_tests_fixture_to_bench,
            "debug.setBreakpoints": self._h_debug_set_breakpoints,
            "debug.clearBreakpoints": lambda _p: (self.debugger.clear_breakpoints(), {"ok": True})[1],
            "debug.arm": self._h_debug_arm,
            "debug.continue": lambda _p: {"ok": self.debugger.command("continue")},
            "debug.step": lambda _p: {"ok": self.debugger.command("step")},
            "debug.stepInto": lambda _p: {"ok": self.debugger.command("stepInto")},
            "debug.stepOut": lambda _p: {"ok": self.debugger.command("stepOut")},
            "debug.terminate": lambda _p: {"ok": self.debugger.command("terminate")},
            "debug.pause": lambda _p: {"ok": self.debugger.request_pause()},
            "debug.frames": lambda _p: {"paused": self.debugger.paused_frame is not None, "frames": self.debugger.frames_info()},
            "debug.variables": self._h_debug_variables,
            "debug.inspect": self._h_debug_inspect,
            "debug.state": lambda _p: {
                "paused": self.debugger.paused_frame is not None,
                "armed": self.debugger.armed,
                "active": self.debugger.active(),
            },
        }

    # ------------------------------------------------------------------ run

    def run(self) -> int:
        """Main-thread entry point.  Returns the process exit code."""
        self.conn.notify(
            "hello",
            {
                "token": self.token,
                "pid": os.getpid(),
                "backendVersion": __version__,
                "protocolVersion": PROTOCOL_VERSION,
                "python": python_summary(),
            },
        )
        originals = (sys.stdout, sys.stderr, sys.stdin)
        sys.stdout, sys.stderr, sys.stdin = self.stdout, self.stderr, self.stdin
        reader = threading.Thread(target=self._reader_loop, name="bluepy-rpc-reader", daemon=True)
        reader.start()
        try:
            self._job_loop()
        finally:
            sys.stdout, sys.stderr, sys.stdin = originals
            self.conn.close()
        return 0

    # --------------------------------------------------------- reader thread

    def _reader_loop(self) -> None:
        while True:
            message = self.conn.recv()
            if message is None:
                self._request_shutdown()
                return
            self._dispatch(message)

    def _dispatch(self, message: dict[str, Any]) -> None:
        if message.get("jsonrpc") != "2.0" or "method" not in message:
            if "id" in message and "method" not in message:
                return  # a response to a request we never send in protocol 0.1
            self.conn.respond_error(message.get("id"), INVALID_REQUEST, "Invalid request")
            return
        method = message["method"]
        if not isinstance(method, str):
            self.conn.respond_error(message.get("id"), INVALID_REQUEST, "Invalid request: method must be a string")
            return
        if method in IMMEDIATE_METHODS:
            self._handle(message)
            if method == "shutdown":
                # Only after the response went out, so the IDE sees {ok: true}.
                self._request_shutdown()
        else:
            self.jobs.put(message)

    # ---------------------------------------------------------- main thread

    def _job_loop(self) -> None:
        while True:
            message = self.jobs.get()
            if message is _SHUTDOWN:
                return
            request_id = message.get("id")
            method = message.get("method")
            self.current_invocation = request_id
            self.current_method = method
            self.conn.notify("invocation.started", {"invocation": request_id, "method": method})
            ok = False
            self._responded = False
            with self._halt_lock:
                self._running = True
                self._halt_pending = False
            try:
                ok = self._handle(message)
            except HaltRequested:
                # Delivered after the handler returned but before we got here.
                self._halt_caught()
                ok = False
                if request_id is not None and not self._responded:
                    self._respond_error(request_id, HALTED, "Execution halted")
            finally:
                self._finish_invocation(request_id, method, ok)

    def _finish_invocation(self, request_id: Any, method: Any, ok: bool) -> None:
        # A Halt may be delivered at any bytecode boundary; retry the state
        # change until it went through without being interrupted.
        while True:
            try:
                with self._halt_lock:
                    self._running = False
                    self._halt_pending = False
                    pending = self._async_exc_armed
                break
            except HaltRequested:
                self._halt_caught()
                continue
        if pending:
            self._absorb_async_exception()
        self.conn.notify("invocation.finished", {"invocation": request_id, "method": method, "ok": ok})
        self.current_invocation = None
        self.current_method = None

    def _halt_caught(self) -> None:
        with self._halt_lock:
            self._async_exc_armed = False

    def _absorb_async_exception(self) -> None:
        """A Halt arrived after the handler returned: let CPython deliver it here.

        Delivery happens at the next eval-breaker check (a backward jump
        suffices), so a short busy wait catches it.  If user code swallowed the
        exception with a bare `except`, nothing is pending and the wait simply
        times out.
        """
        deadline = time.monotonic() + 0.05
        try:
            while time.monotonic() < deadline:
                pass
        except HaltRequested:
            pass
        self._halt_caught()

    def _respond(self, request_id: Any, result: Any) -> None:
        self._responded = True
        self.conn.respond(request_id, result)

    def _respond_error(self, request_id: Any, code: int, message: str, data: Any = None) -> None:
        self._responded = True
        self.conn.respond_error(request_id, code, message, data)

    def _handle(self, message: dict[str, Any]) -> bool:
        """Run a handler and send the response.  Returns True on success."""
        request_id = message.get("id")
        method = message["method"]
        params = message.get("params") or {}
        handler = self.handlers.get(method)
        if handler is None:
            if request_id is not None:
                self._respond_error(request_id, METHOD_NOT_FOUND, f"Method not found: {method}")
            return False
        if not isinstance(params, dict):
            if request_id is not None:
                self._respond_error(request_id, INVALID_PARAMS, "Invalid params: expected an object")
            return False
        try:
            result = handler(params)
        except JsonRpcError as exc:
            if request_id is not None:
                self._respond_error(request_id, exc.code, exc.message, exc.data)
            return False
        except HaltRequested:
            self._halt_caught()
            if request_id is not None:
                self._respond_error(request_id, HALTED, "Execution halted")
            return False
        except BaseException as exc:  # noqa: BLE001 - never let user code kill the session
            if request_id is not None:
                self._respond_error(
                    request_id,
                    INTERNAL_ERROR,
                    f"{type(exc).__name__}: {exc}",
                    {"traceback": "".join(traceback.format_exception(exc))},
                )
            return False
        if request_id is not None:
            self._respond(request_id, result)
        return True

    # ------------------------------------------------------------- services

    def emit_output(self, stream: str, text: str) -> None:
        self.conn.notify("output", {"stream": stream, "text": text, "invocation": self.current_invocation})

    def request_stdin(self) -> None:
        self.conn.notify("stdin.request", {"invocation": self.current_invocation})

    def check_halt(self) -> None:
        """Called from polling waits in user-code context (stdin, debugger pause).

        Intentionally a no-op: a Halt is always delivered as the asynchronous
        HaltRequested set by `halt()`, which CPython raises at the next
        bytecode boundary of the polling loop.  Raising here as well would
        leave that async exception pending and surface it in a later job.
        """
        return None

    # ----------------------------------------------------------------- halt

    def halt(self) -> bool:
        with self._halt_lock:
            if not self._running:
                return False
            self._halt_pending = True
            if not self._async_exc_armed:
                self._async_exc_armed = True
                self._raise_async_exception()
            return True

    def _raise_async_exception(self) -> None:
        if threading.get_ident() == self._main_thread_id:
            raise HaltRequested()
        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(self._main_thread_id), ctypes.py_object(HaltRequested))

    def _request_shutdown(self) -> None:
        if self._shutting_down:
            return
        self._shutting_down = True
        self.halt()
        self.stdin.provide(None)
        self.jobs.put(_SHUTDOWN)

    # ------------------------------------------------------------- handlers

    def _h_ping(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"pong": True}

    def _h_env_info(self, _params: dict[str, Any]) -> dict[str, Any]:
        return env_info()

    def _h_halt(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"halted": self.halt()}

    def _h_shutdown(self, _params: dict[str, Any]) -> dict[str, Any]:
        self._request_shutdown()
        return {"ok": True}

    def _h_stdin_provide(self, params: dict[str, Any]) -> None:
        text = params.get("text")
        if text is not None and not isinstance(text, str):
            raise JsonRpcError(INVALID_PARAMS, "stdin.provide: 'text' must be a string or null")
        self.stdin.provide(text)
        return None

    def _h_codepad_eval(self, params: dict[str, Any]) -> dict[str, Any]:
        code = params.get("code")
        if not isinstance(code, str):
            raise JsonRpcError(INVALID_PARAMS, "codepad.eval: 'code' must be a string")
        entry_id = params.get("id")
        assigned, code_for = assigned_names(code)
        with self.debugger.tracing():
            result = evaluate(code, self.namespace)
        if result.get("kind") == "expression" and result.get("value") is not None:
            self._last_result_code = code.strip()
            value = self.namespace.get("_")
            if is_bench_worthy(value):
                result["inspectable"] = True
                if isinstance(entry_id, int):
                    self._codepad_values[entry_id] = (value, code.strip())
                    while len(self._codepad_values) > 200:
                        del self._codepad_values[next(iter(self._codepad_values))]
        if assigned and result.get("error") is None:
            self.bench.sync_names(assigned, code_for)
        result["bench"] = self.bench.list()
        return result

    # ------------------------------------------------- project & modules

    def record(self, code: str) -> None:
        """'Record method calls': tell the IDE which code an interaction corresponds to."""
        self.conn.notify("record", {"code": code, "invocation": self.current_invocation})

    def _h_project_open(self, params: dict[str, Any]) -> dict[str, Any]:
        directory = params.get("dir")
        if not isinstance(directory, str) or not os.path.isdir(directory):
            raise JsonRpcError(INVALID_PARAMS, "project.open: 'dir' must be an existing directory")
        os.chdir(directory)
        if directory in sys.path:
            sys.path.remove(directory)
        sys.path.insert(0, directory)
        self.cwd = directory
        self.loader = ModuleLoader(directory, self.namespace)
        self.bench = Bench(self.namespace)
        self.debugger.set_project_dir(directory)
        return {"ok": True, "cwd": directory}

    def _h_module_load(self, params: dict[str, Any]) -> dict[str, Any]:
        files = params.get("files")
        if not isinstance(files, list) or not all(isinstance(f, str) for f in files):
            raise JsonRpcError(INVALID_PARAMS, "module.load: 'files' must be a list of relative paths")
        results = self.loader.load(files)
        reloaded = {r["module"] for r in results if r["ok"]}
        removed = self.bench.remove_instances_of_modules(reloaded)
        return {"results": results, "removedObjects": removed, "bench": self.bench.list()}

    def _h_module_run(self, params: dict[str, Any]) -> dict[str, Any]:
        rel = params.get("file")
        if not isinstance(rel, str):
            raise JsonRpcError(INVALID_PARAMS, "module.run: 'file' must be a relative path")
        self.record(f"# python {rel}")
        try:
            with self.debugger.tracing():
                self.loader.run_module(rel)
        except HaltRequested:
            raise
        except SystemExit as exc:
            return {"ok": True, "exitCode": exc.code}
        except BaseException as exc:  # noqa: BLE001
            sys.stderr.write("".join(traceback.format_exception(exc)))
            return {"ok": False, "error": format_exception(exc)}
        return {"ok": True, "exitCode": 0}

    # ---------------------------------------------------------- objects

    def _h_class_describe(self, params: dict[str, Any]) -> dict[str, Any]:
        cls = self.loader.get_class(str(params.get("module")), str(params.get("name")))
        return describe_class(cls)

    def _h_object_create(self, params: dict[str, Any]) -> dict[str, Any]:
        cls = self.loader.get_class(str(params.get("module")), str(params.get("name")))
        bench_name = params.get("benchName") or self.bench.suggest_name(cls.__name__)
        args = params.get("args") or []
        if not isinstance(args, list):
            raise JsonRpcError(INVALID_PARAMS, "object.create: 'args' must be a list of expressions")
        if bench_name in self.bench.objects:
            raise JsonRpcError(INVALID_PARAMS, f"Es gibt schon ein Objekt namens '{bench_name}'")
        values = eval_args([str(a) for a in args], self.namespace)
        code = f"{bench_name} = {call_expression(cls.__name__, None, [str(a) for a in args])}"
        self.record(code)
        try:
            with self.debugger.tracing():
                obj = cls(*values)
        except HaltRequested:
            raise
        except BaseException as exc:  # noqa: BLE001
            sys.stderr.write("".join(traceback.format_exception(exc)))
            return {"ok": False, "error": format_exception(exc), "record": code, "bench": self.bench.list()}
        entry = self.bench.add(bench_name, obj, call_expression(cls.__name__, None, [str(a) for a in args]))
        return {"ok": True, "object": entry, "record": code, "bench": self.bench.list()}

    def _h_object_call(self, params: dict[str, Any]) -> dict[str, Any]:
        method = params.get("method")
        args = params.get("args") or []
        if not isinstance(method, str) or not isinstance(args, list):
            raise JsonRpcError(INVALID_PARAMS, "object.call: 'method' and 'args' required")
        target_name = params.get("target")
        if isinstance(target_name, str):
            target: Any = self.bench.get(target_name)
            label = target_name
        else:
            target = self.loader.get_class(str(params.get("module")), str(params.get("name")))
            label = target.__name__
        values = eval_args([str(a) for a in args], self.namespace)
        code = call_expression(label, method, [str(a) for a in args])
        self.record(code)
        try:
            func = getattr(target, method)
            with self.debugger.tracing():
                result = func(*values)
        except HaltRequested:
            raise
        except BaseException as exc:  # noqa: BLE001
            sys.stderr.write("".join(traceback.format_exception(exc)))
            return {"ok": False, "error": format_exception(exc), "record": code, "bench": self.bench.list()}
        self.namespace["_"] = result
        self._last_result_code = code
        value = None if result is None else describe_value(result)
        if value is not None:
            self.conn.notify("result", {"repr": value["repr"], "type": value["type"], "invocation": self.current_invocation})
        return {
            "ok": True,
            "value": value,
            "inspectable": is_inspectable(result),
            "record": code,
            "bench": self.bench.list(),
        }

    def _resolve(self, params: dict[str, Any]) -> tuple[Any, str]:
        """Find the value a params block refers to: a bench object (and path into it) or the last result."""
        path = params.get("path") or []
        if not isinstance(path, list):
            raise JsonRpcError(INVALID_PARAMS, "'path' must be a list")
        name = params.get("name")
        if name == "_":
            root, label = self.namespace.get("_"), "_"
        elif isinstance(name, str) and name.startswith("$"):
            entry = self._codepad_values.get(int(name[1:])) if name[1:].isdigit() else None
            if entry is None:
                raise JsonRpcError(INVALID_PARAMS, "Dieses Code-Pad-Ergebnis ist nicht mehr verfügbar")
            root, label = entry[0], name
        elif isinstance(name, str):
            root, label = self.bench.get(name), name
        else:
            raise JsonRpcError(INVALID_PARAMS, "'name' required")
        try:
            value = navigate(root, path)
        except (AttributeError, KeyError, IndexError, ValueError) as exc:
            raise JsonRpcError(INVALID_PARAMS, f"Pfad nicht auflösbar: {exc}") from exc
        return value, label

    def _h_object_inspect(self, params: dict[str, Any]) -> dict[str, Any]:
        value, _label = self._resolve(params)
        cls = type(value)
        return {
            "value": describe_value(value),
            "className": cls.__name__,
            "module": cls.__module__,
            "mro": [k.__name__ for k in cls.__mro__ if k is not object],
            "fields": fields_of(value),
            "classAttributes": [
                {"name": n, "value": describe_value(v)}
                for n, v in vars(cls).items()
                if not n.startswith("__") and not callable(v) and not isinstance(v, (staticmethod, classmethod, property))
            ]
            if not isinstance(value, (list, dict, tuple, set, frozenset))
            else [],
        }

    def _h_object_get(self, params: dict[str, Any]) -> dict[str, Any]:
        value, label = self._resolve(params)
        new_name = params.get("newName") or self.bench.suggest_name(type(value).__name__)
        if label == "_":
            root, root_code = self.namespace.get("_"), self._last_result_code
        elif label.startswith("$"):
            root, root_code = self._codepad_values[int(label[1:])]
        else:
            root, root_code = self.bench.get(label), label
        code = path_expression(root_code, root, params.get("path") or []) if root_code else None
        record = f"{new_name} = {code}" if code else f"# {new_name}: Objekt von der Objektleiste geholt"
        self.record(record)
        entry = self.bench.add(str(new_name), value, code)
        return {"ok": True, "object": entry, "record": record, "bench": self.bench.list()}

    def _h_object_remove(self, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        if not isinstance(name, str):
            raise JsonRpcError(INVALID_PARAMS, "object.remove: 'name' required")
        self.bench.remove(name)
        return {"ok": True, "bench": self.bench.list()}

    def _h_bench_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"bench": self.bench.list()}

    def _h_bench_suggest_name(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"name": self.bench.suggest_name(str(params.get("className") or "obj"))}

    def _h_bench_clear(self, _params: dict[str, Any]) -> dict[str, Any]:
        self.bench.clear()
        return {"ok": True, "bench": self.bench.list()}

    # ---------------------------------------------------------- unit tests

    def _test_file(self, params: dict[str, Any]) -> tuple[str, str]:
        rel = params.get("file")
        class_name = params.get("className")
        if not isinstance(rel, str) or not isinstance(class_name, str):
            raise JsonRpcError(INVALID_PARAMS, "'file' and 'className' required")
        return rel, class_name

    def _h_tests_describe(self, params: dict[str, Any]) -> dict[str, Any]:
        rel, class_name = self._test_file(params)
        try:
            return describe_test_class(os.path.join(self.loader.project_dir, rel), class_name)
        except (OSError, SyntaxError, LookupError) as exc:
            raise JsonRpcError(INVALID_PARAMS, str(exc)) from exc

    def _h_tests_run(self, params: dict[str, Any]) -> dict[str, Any]:
        files = params.get("files")
        if not isinstance(files, list) or not all(isinstance(f, str) for f in files):
            raise JsonRpcError(INVALID_PARAMS, "tests.run: 'files' must be a list of relative paths")
        class_name = params.get("className")
        method = params.get("method")
        self.record("# " + ("Tests: " + ", ".join(files) if not class_name else f"Test: {class_name}" + (f".{method}" if method else "")))
        load_results = self.loader.load(files)
        reloaded = {r["module"] for r in load_results if r["ok"]}
        self.bench.remove_instances_of_modules(reloaded)
        modules: list[tuple[str, Any]] = []
        failed: list[dict[str, Any]] = []
        file_of_module: dict[str, str] = {}
        for r in load_results:
            if r["ok"]:
                modules.append((r["file"], self.loader.loaded[r["module"]]))
                file_of_module[r["module"]] = r["file"]
            else:
                error = r["error"] or {}
                failed.append(
                    {
                        "id": r["file"],
                        "file": r["file"],
                        "className": r["module"],
                        "method": r["stage"],
                        "status": "error",
                        "message": f"{error.get('type', 'Fehler')}: {error.get('message', '')}",
                        "traceback": error.get("traceback"),
                        "line": error.get("line"),
                        "durationMs": 0,
                    }
                )
        for record in failed:
            self.conn.notify("test.finished", record)
        suite = build_suite(modules, class_name if isinstance(class_name, str) else None, method if isinstance(method, str) else None)
        with self.debugger.tracing():
            summary = run_suite(suite, self.conn.notify, file_of_module)
        summary["results"] = failed + summary["results"]
        summary["total"] += len(failed)
        summary["errors"] += len(failed)
        summary["bench"] = self.bench.list()
        return summary

    def _h_tests_fixture_to_bench(self, params: dict[str, Any]) -> dict[str, Any]:
        rel, class_name = self._test_file(params)
        # Always take the fixture from the file as it is on disk.
        load = self.loader.load([rel])[0]
        if not load["ok"]:
            return {"ok": False, "error": load["error"], "bench": self.bench.list(), "names": []}
        cls = self.loader.get_class(load["module"], class_name)
        self.bench.clear()
        self.record(f"# Fixture von {class_name} auf die Objektleiste")
        with self.debugger.tracing():
            try:
                fixture = fixture_from_class(cls)
            except HaltRequested:
                raise
            except BaseException as exc:  # noqa: BLE001
                sys.stderr.write("".join(traceback.format_exception(exc)))
                return {"ok": False, "error": format_exception(exc), "bench": self.bench.list(), "names": []}
        names = []
        for name, value, code in fixture:
            if name in self.bench.objects:
                continue
            self.bench.add(name, value, code)
            names.append(name)
        return {"ok": True, "bench": self.bench.list(), "names": names}

    # --------------------------------------------------------- debugger

    def _h_debug_set_breakpoints(self, params: dict[str, Any]) -> dict[str, Any]:
        rel = params.get("file")
        lines = params.get("lines")
        if not isinstance(rel, str) or not isinstance(lines, list):
            raise JsonRpcError(INVALID_PARAMS, "debug.setBreakpoints: 'file' and 'lines' required")
        self.debugger.set_breakpoints(rel, [int(line) for line in lines])
        return {"ok": True}

    def _h_debug_arm(self, params: dict[str, Any]) -> dict[str, Any]:
        self.debugger.arm(bool(params.get("enabled", True)))
        return {"ok": True, "armed": self.debugger.armed}

    def _h_debug_variables(self, params: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.debugger.variables(int(params.get("frame", 0)))
        except IndexError as exc:
            raise JsonRpcError(INVALID_PARAMS, "Kein angehaltener Frame") from exc

    def _h_debug_inspect(self, params: dict[str, Any]) -> dict[str, Any]:
        path = params.get("path") or []
        if not isinstance(path, list):
            raise JsonRpcError(INVALID_PARAMS, "'path' must be a list")
        try:
            return self.debugger.inspect(int(params.get("frame", 0)), str(params.get("scope")), str(params.get("name")), path)
        except (IndexError, KeyError, AttributeError, ValueError) as exc:
            raise JsonRpcError(INVALID_PARAMS, f"Nicht auflösbar: {exc}") from exc
