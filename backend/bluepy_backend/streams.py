"""Replacements for sys.stdout / sys.stderr / sys.stdin inside the backend.

Output is forwarded to the IDE as `output` notifications tagged with the
current invocation id (so the terminal can show one section per call).
Input is requested from the IDE with `stdin.request` and delivered with
`stdin.provide`.
"""

from __future__ import annotations

import io
import queue
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from .session import Session


class OutputProxy(io.TextIOBase):
    def __init__(self, session: Session, stream: str) -> None:
        super().__init__()
        self._session = session
        self._stream = stream

    # TextIOBase API -----------------------------------------------------

    @property
    def encoding(self) -> str:  # type: ignore[override]
        return "utf-8"

    @property
    def errors(self) -> str:  # type: ignore[override]
        return "strict"

    def writable(self) -> bool:
        return True

    def readable(self) -> bool:
        return False

    def isatty(self) -> bool:
        return False

    def write(self, text: str) -> int:  # type: ignore[override]
        if not isinstance(text, str):
            text = str(text)
        if text:
            self._session.emit_output(self._stream, text)
        return len(text)

    def flush(self) -> None:
        pass


class StdinProxy(io.TextIOBase):
    """Blocking stdin that asks the IDE for input.

    `readline()` blocks until the IDE delivers text via `stdin.provide`.  The
    wait polls with a timeout so that a Halt (asynchronous exception in the
    main thread) can interrupt it.
    """

    POLL_SECONDS = 0.2

    def __init__(self, session: Session) -> None:
        super().__init__()
        self._session = session
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._buffer = ""
        self._eof = False

    def readable(self) -> bool:
        return True

    def writable(self) -> bool:
        return False

    def isatty(self) -> bool:
        return False

    @property
    def encoding(self) -> str:  # type: ignore[override]
        return "utf-8"

    # IDE side -----------------------------------------------------------

    def provide(self, text: str | None) -> None:
        """Deliver input.  `None` signals EOF (Ctrl-D)."""
        self._queue.put(text)

    def reset(self) -> None:
        self._buffer = ""
        self._eof = False
        while True:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break

    # user-code side -----------------------------------------------------

    def _fill(self) -> None:
        if self._buffer or self._eof:
            return
        self._session.request_stdin()
        while True:
            try:
                chunk = self._queue.get(timeout=self.POLL_SECONDS)
                break
            except queue.Empty:
                self._session.check_halt()
        if chunk is None:
            self._eof = True
            return
        if not chunk.endswith("\n"):
            chunk += "\n"
        self._buffer += chunk

    def readline(self, size: int = -1) -> str:  # type: ignore[override]
        self._fill()
        if not self._buffer:
            return ""
        newline = self._buffer.find("\n")
        end = len(self._buffer) if newline < 0 else newline + 1
        if size is not None and size >= 0:
            end = min(end, size)
        line, self._buffer = self._buffer[:end], self._buffer[end:]
        return line

    def read(self, size: int = -1) -> str:  # type: ignore[override]
        if size is None or size < 0:
            parts: list[str] = []
            while True:
                self._fill()
                if not self._buffer:
                    return "".join(parts)
                parts.append(self._buffer)
                self._buffer = ""
        self._fill()
        chunk, self._buffer = self._buffer[:size], self._buffer[size:]
        return chunk
