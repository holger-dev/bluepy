"""HTTP API of the hub (JSON over HTTP, packages base64-encoded in the JSON body).

Teacher endpoints need `Authorization: Bearer <teacher key>`; learner endpoints
need no login – the task code (path) and the personal code (body) are the
secrets.  Runs behind Caddy (HTTPS) in production, see hub/README.md.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .store import HubError, Store

MAX_BODY = 32 * 1024 * 1024
Handler = Callable[["HubHandler", dict[str, str], dict[str, Any]], Any]


class RateLimiter:
    """Slows down guessing of task / personal codes: N failures per window per client."""

    def __init__(self, limit: int = 30, window: float = 600.0) -> None:
        self.limit = limit
        self.window = window
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def blocked(self, client: str) -> bool:
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._failures.get(client, []) if now - t < self.window]
            self._failures[client] = recent
            return len(recent) >= self.limit

    def failure(self, client: str) -> None:
        with self._lock:
            self._failures.setdefault(client, []).append(time.monotonic())


class Hub:
    def __init__(self, data_dir: str, site_dir: str | None = None) -> None:
        self.store = Store(data_dir)
        self.site_dir = site_dir
        self.limiter = RateLimiter()
        self.routes: list[tuple[str, re.Pattern[str], Handler, bool]] = []
        self._register()

    # ----------------------------------------------------------------- routes

    def route(self, method: str, pattern: str, teacher: bool = False) -> Callable[[Handler], Handler]:
        def register(fn: Handler) -> Handler:
            self.routes.append((method, re.compile("^" + pattern + "$"), fn, teacher))
            return fn

        return register

    def _register(self) -> None:
        store = self.store

        @self.route("GET", r"/api/health")
        def health(_h: HubHandler, _p: dict[str, str], _b: dict[str, Any]) -> Any:
            return {"ok": True, "version": __version__, "serverTime": _now()}

        @self.route("GET", r"/api/me", teacher=True)
        def me(h: HubHandler, _p: dict[str, str], _b: dict[str, Any]) -> Any:
            teacher = h.teacher or {}
            return {"name": teacher.get("name"), "classes": len(store.list_classes(int(teacher["id"]))), "tasks": len(store.list_tasks(int(teacher["id"])))}

        # classes ----------------------------------------------------------
        @self.route("GET", r"/api/classes", teacher=True)
        def list_classes(h: HubHandler, _p: dict[str, str], _b: dict[str, Any]) -> Any:
            return {"classes": store.list_classes(h.teacher_id)}

        @self.route("POST", r"/api/classes", teacher=True)
        def add_class(h: HubHandler, _p: dict[str, str], body: dict[str, Any]) -> Any:
            return store.add_class(h.teacher_id, str(body.get("name") or ""), [str(s) for s in body.get("students") or []])

        @self.route("POST", r"/api/classes/(?P<id>\d+)/students", teacher=True)
        def add_students(h: HubHandler, p: dict[str, str], body: dict[str, Any]) -> Any:
            return store.add_students(h.teacher_id, int(p["id"]), [str(s) for s in body.get("students") or []])

        @self.route("DELETE", r"/api/classes/(?P<id>\d+)", teacher=True)
        def remove_class(h: HubHandler, p: dict[str, str], _b: dict[str, Any]) -> Any:
            store.remove_class(h.teacher_id, int(p["id"]))
            return {"ok": True}

        # tasks (teacher) ---------------------------------------------------
        @self.route("GET", r"/api/tasks", teacher=True)
        def list_tasks(h: HubHandler, _p: dict[str, str], _b: dict[str, Any]) -> Any:
            return {"tasks": store.list_tasks(h.teacher_id)}

        @self.route("POST", r"/api/tasks", teacher=True)
        def create_task(h: HubHandler, _p: dict[str, str], body: dict[str, Any]) -> Any:
            return store.create_task(h.teacher_id, body, _package(body, required=True) or b"")

        @self.route("PUT", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)", teacher=True)
        def update_task(h: HubHandler, p: dict[str, str], body: dict[str, Any]) -> Any:
            return store.update_task(h.teacher_id, p["code"], body, _package(body, required=False))

        @self.route("DELETE", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)", teacher=True)
        def remove_task(h: HubHandler, p: dict[str, str], _b: dict[str, Any]) -> Any:
            store.remove_task(h.teacher_id, p["code"])
            return {"ok": True}

        @self.route("GET", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)/submissions", teacher=True)
        def submissions(h: HubHandler, p: dict[str, str], _b: dict[str, Any]) -> Any:
            return store.submissions(h.teacher_id, p["code"])

        @self.route("GET", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)/submissions/(?P<personal>[A-Za-z0-9]+)", teacher=True)
        def submission(h: HubHandler, p: dict[str, str], _b: dict[str, Any]) -> Any:
            meta, package = store.read_submission(h.teacher_id, p["code"], p["personal"])
            return {**meta, "package": base64.b64encode(package).decode("ascii")}

        @self.route("POST", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)/feedback/(?P<personal>[A-Za-z0-9]+)", teacher=True)
        def set_feedback(h: HubHandler, p: dict[str, str], body: dict[str, Any]) -> Any:
            points = body.get("points")
            return store.set_feedback(h.teacher_id, p["code"], p["personal"], str(body.get("notes") or ""), None if points is None else str(points))

        # tasks (learners) --------------------------------------------------
        @self.route("GET", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)/info")
        def task_info(h: HubHandler, p: dict[str, str], _b: dict[str, Any]) -> Any:
            return h.guess_guard(lambda: store.task_info(p["code"]))

        @self.route("GET", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)")
        def fetch_task(h: HubHandler, p: dict[str, str], _b: dict[str, Any]) -> Any:
            def load() -> Any:
                info = store.task_info(p["code"])
                info["package"] = base64.b64encode(store.read_task_package(p["code"])).decode("ascii")
                return info

            return h.guess_guard(load)

        @self.route("POST", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)/submissions")
        def submit(h: HubHandler, p: dict[str, str], body: dict[str, Any]) -> Any:
            package = _package(body, required=True) or b""
            device = str(body.get("device") or "")[:64] or None
            return h.guess_guard(lambda: store.submit(p["code"], str(body.get("personal") or ""), package, device, allow_late=bool(body.get("allowLate"))))

        @self.route("GET", r"/api/tasks/(?P<code>[A-Za-z0-9-]+)/feedback")
        def feedback(h: HubHandler, p: dict[str, str], _b: dict[str, Any]) -> Any:
            personal = (h.query.get("personal") or [""])[0]
            return h.guess_guard(lambda: store.get_feedback(p["code"], personal))

    # ---------------------------------------------------------------- serving

    def serve(self, host: str, port: int) -> ThreadingHTTPServer:
        hub = self

        class BoundHandler(HubHandler):
            app = hub

        server = ThreadingHTTPServer((host, port), BoundHandler)
        server.daemon_threads = True
        return server


def _now() -> str:
    from .store import now_iso

    return now_iso()


def _package(body: dict[str, Any], required: bool) -> bytes | None:
    raw = body.get("package")
    if raw is None:
        if required:
            raise HubError(400, "'package' (base64) fehlt")
        return None
    if not isinstance(raw, str):
        raise HubError(400, "'package' muss base64-Text sein")
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HubError(400, "'package' ist kein gültiges base64") from exc
    if data[:2] != b"PK":
        raise HubError(400, "'package' ist kein ZIP-Archiv")
    return data


class HubHandler(BaseHTTPRequestHandler):
    app: Hub
    server_version = f"BluePyHub/{__version__}"
    protocol_version = "HTTP/1.1"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.teacher: dict[str, Any] | None = None
        self.query: dict[str, list[str]] = {}
        super().__init__(*args, **kwargs)

    @property
    def teacher_id(self) -> int:
        return int((self.teacher or {})["id"])

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - BaseHTTPRequestHandler signature
        if os.environ.get("HUB_QUIET"):
            return
        super().log_message(format, *args)

    def client(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For")
        return (forwarded.split(",")[0].strip() if forwarded else self.client_address[0]) or "?"

    def guess_guard(self, action: Callable[[], Any]) -> Any:
        """Count failed code lookups per client and block after too many."""
        client = self.client()
        if self.app.limiter.blocked(client):
            raise HubError(429, "Zu viele Versuche – bitte später noch einmal", "rate-limit")
        try:
            return action()
        except HubError as exc:
            if exc.reason in ("unknown-task", "unknown-student"):
                self.app.limiter.failure(client)
            raise

    # ---- dispatch ---------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        self.dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self.dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self.dispatch("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self.dispatch("DELETE")

    def dispatch(self, method: str) -> None:
        parts = urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"
        self.query = parse_qs(parts.query)
        if not path.startswith("/api/"):
            if method == "GET":
                self.serve_site(path)
            else:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        for route_method, pattern, handler, needs_teacher in self.app.routes:
            match = pattern.match(path)
            if not match:
                continue
            if route_method != method:
                continue
            try:
                body = self.read_json() if method in ("POST", "PUT") else {}
                if needs_teacher:
                    self.require_teacher()
                result = handler(self, match.groupdict(), body)
                self.send_json(HTTPStatus.OK, result)
            except HubError as exc:
                self.send_json(exc.status, {"error": exc.args[0], "reason": exc.reason})
            except Exception as exc:  # noqa: BLE001
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(exc).__name__}: {exc}", "reason": "internal"})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unbekannter Endpunkt", "reason": "not-found"})

    def require_teacher(self) -> None:
        header = self.headers.get("Authorization") or ""
        if not header.startswith("Bearer "):
            raise HubError(401, "Lehrer-Schlüssel fehlt", "no-key")
        teacher = self.app.store.teacher_by_key(header[7:].strip())
        if not teacher:
            self.app.limiter.failure(self.client())
            raise HubError(401, "Lehrer-Schlüssel ungültig", "bad-key")
        self.teacher = teacher

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise HubError(413, "Anfrage zu groß")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HubError(400, "Body ist kein JSON") from exc
        if not isinstance(data, dict):
            raise HubError(400, "JSON-Objekt erwartet")
        return data

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---- static site --------------------------------------------------------

    def serve_site(self, path: str) -> None:
        site = self.app.site_dir
        if not site:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(site, rel))
        if not full.startswith(os.path.normpath(site) + os.sep) and full != os.path.normpath(site):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        types = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp"}
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", types.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=300")
        self.end_headers()
        self.wfile.write(data)
