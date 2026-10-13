"""Newline-delimited JSON-RPC 2.0 over a socket."""

from __future__ import annotations

import json
import socket
import threading
from typing import Any

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
HALTED = 1000


class JsonRpcError(Exception):
    """Raised by handlers to produce a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            error["data"] = self.data
        return error


def _json_default(obj: Any) -> str:
    return repr(obj)


class Connection:
    """Thread-safe writer plus a blocking line reader for one socket."""

    def __init__(self, sock: socket.socket) -> None:
        self._sock = sock
        self._reader = sock.makefile("rb")
        self._write_lock = threading.Lock()
        self._closed = False

    # -- sending ---------------------------------------------------------

    def send(self, message: dict[str, Any]) -> None:
        data = json.dumps(
            message, ensure_ascii=False, separators=(",", ":"), default=_json_default
        ).encode("utf-8") + b"\n"
        with self._write_lock:
            if self._closed:
                return
            try:
                self._sock.sendall(data)
            except OSError:
                self._closed = True

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        self.send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def respond(self, request_id: Any, result: Any) -> None:
        self.send({"jsonrpc": "2.0", "id": request_id, "result": result})

    def respond_error(
        self, request_id: Any, code: int, message: str, data: Any = None
    ) -> None:
        self.send({"jsonrpc": "2.0", "id": request_id, "error": JsonRpcError(code, message, data).to_dict()})

    # -- receiving -------------------------------------------------------

    def recv(self) -> dict[str, Any] | None:
        """Return the next message, or None when the peer closed the socket.

        A line that is not valid JSON is reported as a parse error to the peer
        and skipped.
        """
        while True:
            try:
                line = self._reader.readline()
            except OSError:
                return None
            if not line:
                return None
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line.decode("utf-8"))
            except (ValueError, UnicodeDecodeError) as exc:
                self.respond_error(None, PARSE_ERROR, f"Parse error: {exc}")
                continue
            if not isinstance(message, dict):
                self.respond_error(None, INVALID_REQUEST, "Invalid request: expected an object")
                continue
            return message

    def close(self) -> None:
        with self._write_lock:
            self._closed = True
        # Shut the socket down first: that makes a readline() blocked in the
        # reader thread return b"".  Closing the buffered reader object from
        # this thread would instead deadlock on its internal lock.
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self._sock.close()
        except OSError:
            pass
