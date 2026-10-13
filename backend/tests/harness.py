"""Test harness: plays the Electron side of the protocol.

Opens a TCP server on 127.0.0.1, starts the backend via launcher.py exactly
like the IDE does, and offers request/notification helpers.
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from typing import Any

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAUNCHER = os.path.join(BACKEND_DIR, "launcher.py")


class BackendClient:
    def __init__(self, cwd: str | None = None, python: str | None = None) -> None:
        self.token = secrets.token_hex(8)
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]
        args = [
            python or sys.executable,
            "-B",
            "-X",
            "utf8",
            "-u",
            LAUNCHER,
            "--connect",
            f"127.0.0.1:{self.port}",
            "--token",
            self.token,
        ]
        if cwd:
            args += ["--cwd", cwd]
        self.process = subprocess.Popen(
            args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8"
        )
        self.server.settimeout(10)
        self.sock, _ = self.server.accept()
        self.sock.settimeout(10)
        self.reader = self.sock.makefile("rb")
        self.notifications: list[dict[str, Any]] = []
        self.responses: dict[Any, dict[str, Any]] = {}
        self._next_id = 1
        self._lock = threading.Lock()
        self.hello = self.wait_notification("hello")

    # -- low level -------------------------------------------------------

    def send(self, message: dict[str, Any]) -> None:
        self.sock.sendall(json.dumps(message).encode("utf-8") + b"\n")

    def _read_one(self) -> dict[str, Any]:
        line = self.reader.readline()
        if not line:
            raise ConnectionError("backend closed the connection")
        message = json.loads(line.decode("utf-8"))
        if "method" in message:
            self.notifications.append(message)
        else:
            self.responses[message.get("id")] = message
        return message

    # -- high level ------------------------------------------------------

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        self.send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def send_request(self, method: str, params: dict[str, Any] | None = None) -> int:
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
        self.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
        return request_id

    def wait_response(self, request_id: int, timeout: float = 10) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while request_id not in self.responses:
            if time.monotonic() > deadline:
                raise TimeoutError(f"no response for request {request_id}")
            self._read_one()
        return self.responses.pop(request_id)

    def request(self, method: str, params: dict[str, Any] | None = None, timeout: float = 10) -> Any:
        response = self.wait_response(self.send_request(method, params), timeout)
        if "error" in response:
            raise RpcFailure(response["error"])
        return response["result"]

    def wait_notification(self, method: str, timeout: float = 10) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            for index, message in enumerate(self.notifications):
                if message["method"] == method:
                    return self.notifications.pop(index)
            if time.monotonic() > deadline:
                raise TimeoutError(f"no notification {method}")
            self._read_one()

    def outputs(self, stream: str = "stdout") -> str:
        text = "".join(
            n["params"]["text"]
            for n in self.notifications
            if n["method"] == "output" and n["params"]["stream"] == stream
        )
        self.notifications = [n for n in self.notifications if n["method"] != "output"]
        return text

    def close(self, graceful: bool = True) -> int:
        if graceful and self.process.poll() is None:
            try:
                self.request("shutdown", timeout=5)
            except (RpcFailure, TimeoutError, ConnectionError, OSError):
                pass
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        for stream in (self.process.stdout, self.process.stderr):
            if stream is not None:
                stream.close()
        for closeable in (self.reader, self.sock, self.server):
            try:
                closeable.close()
            except OSError:
                pass
        return self.process.returncode


class RpcFailure(Exception):
    def __init__(self, error: dict[str, Any]) -> None:
        super().__init__(error.get("message"))
        self.code = error.get("code")
        self.data = error.get("data")
