"""End-to-end tests of the hub API over a real HTTP server on a random port."""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from http.client import HTTPConnection
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["HUB_QUIET"] = "1"

from bluepy_hub.codes import normalize_code, task_code, task_word  # noqa: E402
from bluepy_hub.server import Hub  # noqa: E402


def package(files: dict[str, str]) -> str:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def iso(delta_minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).replace(microsecond=0).isoformat()


class Client:
    def __init__(self, port: int, key: str | None = None) -> None:
        self.port = port
        self.key = key

    def call(self, method: str, path: str, body: dict[str, Any] | None = None, key: str | None = "default") -> tuple[int, dict[str, Any]]:
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        use_key = self.key if key == "default" else key
        if use_key:
            headers["Authorization"] = f"Bearer {use_key}"
        conn.request(method, path, body=json.dumps(body).encode("utf-8") if body is not None else None, headers=headers)
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8") or "{}")
        conn.close()
        return response.status, data


class CodesTest(unittest.TestCase):
    def test_task_codes(self) -> None:
        self.assertEqual(task_word("Konto und Sparkonto"), "KONTO")
        self.assertEqual(task_word("Übung 3: Listen"), "UEBUNG")
        self.assertEqual(task_word("A B"), "A")
        code = task_code("Konto")
        self.assertRegex(code, r"^KONTO-[A-Z2-9]{4}$")
        self.assertNotIn("O", code[6:])
        self.assertEqual(normalize_code(" konto-7h3k "), "KONTO-7H3K")


class HubTest(unittest.TestCase):
    data: str
    server: Any
    port: int
    hub: Hub

    @classmethod
    def setUpClass(cls) -> None:
        cls.data = tempfile.mkdtemp(prefix="bluepy-hub-")
        site = os.path.join(cls.data, "site")
        os.makedirs(site)
        with open(os.path.join(site, "index.html"), "w", encoding="utf-8") as f:
            f.write("<h1>BluePy</h1>")
        cls.hub = Hub(os.path.join(cls.data, "data"), site)
        cls.server = cls.hub.serve("127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        _tid, cls.key = cls.hub.store.add_teacher("Heidkamp")
        _tid2, cls.other_key = cls.hub.store.add_teacher("Kollegin")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.hub.store.close()
        shutil.rmtree(cls.data, ignore_errors=True)

    def setUp(self) -> None:
        self.teacher = Client(self.port, self.key)
        self.student = Client(self.port, None)
        self.hub.limiter._failures.clear()  # noqa: SLF001 - every test starts unthrottled

    def make_class(self, name: str = "8c", students: tuple[str, ...] = ("Anna", "Ben")) -> dict[str, Any]:
        status, cls = self.teacher.call("POST", "/api/classes", {"name": name, "students": list(students)})
        self.assertEqual(status, 200, cls)
        return cls

    def make_task(self, cls_id: int, **extra: Any) -> dict[str, Any]:
        body = {"title": "Konto", "description": "# Aufgabe\nBaue ein Konto.", "classes": [cls_id], "package": package({"konto.py": "class Konto: pass\n", "package.bluepy": "{}"})}
        body.update(extra)
        status, task = self.teacher.call("POST", "/api/tasks", body)
        self.assertEqual(status, 200, task)
        return task

    # ---------------------------------------------------------------- basics

    def test_health_site_and_auth(self) -> None:
        status, data = self.student.call("GET", "/api/health")
        self.assertEqual((status, data["ok"]), (200, True))
        conn = HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/")
        r = conn.getresponse()
        self.assertEqual((r.status, r.read()), (200, b"<h1>BluePy</h1>"))
        conn.request("GET", "/../etc/passwd")
        self.assertEqual(conn.getresponse().status, 404)
        conn.close()
        self.assertEqual(self.student.call("GET", "/api/classes")[0], 401)
        self.assertEqual(self.student.call("GET", "/api/classes", key="wrong")[0], 401)
        self.assertEqual(self.teacher.call("GET", "/api/nope")[0], 404)
        status, me = self.teacher.call("GET", "/api/me")
        self.assertEqual((status, me["name"]), (200, "Heidkamp"))

    def test_classes(self) -> None:
        cls = self.make_class("7a", ("Mia", "Tom", ""))
        self.assertEqual([s["name"] for s in cls["students"]], ["Mia", "Tom"])
        for s in cls["students"]:
            self.assertRegex(s["code"], r"^[A-Z2-9]{6}$")
        status, more = self.teacher.call("POST", f"/api/classes/{cls['id']}/students", {"students": ["Zoe"]})
        self.assertEqual((status, len(more["students"])), (200, 3))
        status, listing = self.teacher.call("GET", "/api/classes")
        self.assertIn("7a", [c["name"] for c in listing["classes"]])
        # another teacher cannot see or touch it
        other = Client(self.port, self.other_key)
        self.assertNotIn("7a", [c["name"] for c in other.call("GET", "/api/classes")[1]["classes"]])
        self.assertEqual(other.call("DELETE", f"/api/classes/{cls['id']}")[0], 404)
        self.assertEqual(self.teacher.call("DELETE", f"/api/classes/{cls['id']}")[0], 200)
        self.assertEqual(self.teacher.call("POST", "/api/classes", {"name": " ", "students": []})[0], 400)

    # ------------------------------------------------------------------ flow

    def test_full_assignment_flow(self) -> None:
        cls = self.make_class()
        anna, ben = cls["students"]
        task = self.make_task(cls["id"], submitFrom=iso(-10), submitUntil=iso(60))
        self.assertRegex(task["code"], r"^KONTO-[A-Z2-9]{4}$")
        self.assertEqual((task["students"], task["submissions"], task["window"]), (2, 0, "open"))

        # learner fetches the task (no auth), code is case-insensitive
        status, fetched = self.student.call("GET", f"/api/tasks/{task['code'].lower()}")
        self.assertEqual(status, 200, fetched)
        self.assertEqual(fetched["title"], "Konto")
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(fetched["package"]))) as z:
            self.assertIn("konto.py", z.namelist())
        self.assertNotIn("classes", fetched)  # no teacher data for learners
        status, info = self.student.call("GET", f"/api/tasks/{task['code']}/info")
        self.assertEqual((status, "package" in info), (200, False))

        # submit twice, the last one counts; wrong personal code is refused
        sub = package({"konto.py": "class Konto:\n    pass\n"})
        status, r = self.student.call("POST", f"/api/tasks/{task['code']}/submissions", {"personal": anna["code"], "package": sub, "device": "dev-anna"})
        self.assertEqual((status, r["ok"], r["name"], r["late"]), (200, True, "Anna", False))
        status, r2 = self.student.call("POST", f"/api/tasks/{task['code']}/submissions", {"personal": anna["code"].lower(), "package": package({"konto.py": "# v2\n"}), "device": "dev-anna"})
        self.assertEqual(status, 200)
        status, bad = self.student.call("POST", f"/api/tasks/{task['code']}/submissions", {"personal": "ZZZZZZ", "package": sub})
        self.assertEqual((status, bad["reason"]), (403, "unknown-student"))
        self.assertEqual(self.student.call("POST", f"/api/tasks/{task['code']}/submissions", {"personal": ben["code"], "package": "not base64!"})[0], 400)
        self.assertEqual(self.student.call("POST", f"/api/tasks/{task['code']}/submissions", {"personal": ben["code"]})[0], 400)

        # teacher overview
        status, overview = self.teacher.call("GET", f"/api/tasks/{task['code']}/submissions")
        self.assertEqual(status, 200)
        by_name = {s["name"]: s for s in overview["students"]}
        self.assertEqual(by_name["Anna"]["submittedAt"], r2["at"])
        self.assertIsNone(by_name["Ben"]["submittedAt"])
        self.assertFalse(by_name["Anna"]["sharedDevice"])
        self.assertEqual(overview["task"]["submissions"], 1)
        status, latest = self.teacher.call("GET", f"/api/tasks/{task['code']}/submissions/{anna['code']}")
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(latest["package"]))) as z:
            self.assertEqual(z.read("konto.py"), b"# v2\n")
        self.assertEqual(self.teacher.call("GET", f"/api/tasks/{task['code']}/submissions/{ben['code']}")[0], 404)

        # Ben submits from Anna's device → flagged
        self.student.call("POST", f"/api/tasks/{task['code']}/submissions", {"personal": ben["code"], "package": sub, "device": "dev-anna"})
        overview = self.teacher.call("GET", f"/api/tasks/{task['code']}/submissions")[1]
        self.assertTrue(all(s["sharedDevice"] for s in overview["students"]))

        # feedback round trip
        self.assertEqual(self.teacher.call("POST", f"/api/tasks/{task['code']}/feedback/{anna['code']}", {"notes": "Gut!", "points": "9/10"})[0], 200)
        status, fb = self.student.call("GET", f"/api/tasks/{task['code']}/feedback?personal={anna['code']}")
        self.assertEqual((status, fb["notes"], fb["points"]), (200, "Gut!", "9/10"))
        self.assertEqual(self.student.call("GET", f"/api/tasks/{task['code']}/feedback?personal={ben['code']}")[0], 404)

        # update: new package → version 2, learners see it
        status, updated = self.teacher.call("PUT", f"/api/tasks/{task['code']}", {"description": "neu", "package": package({"konto.py": "# v2 task\n"})})
        self.assertEqual((status, updated["version"], updated["description"]), (200, 2, "neu"))
        self.assertEqual(self.student.call("GET", f"/api/tasks/{task['code']}/info")[1]["version"], 2)

        # other teacher sees nothing; delete removes everything
        other = Client(self.port, self.other_key)
        self.assertEqual(other.call("GET", f"/api/tasks/{task['code']}/submissions")[0], 404)
        self.assertEqual(self.teacher.call("DELETE", f"/api/tasks/{task['code']}")[0], 200)
        self.assertEqual(self.student.call("GET", f"/api/tasks/{task['code']}/info")[0], 404)

    def test_window_and_custom_code(self) -> None:
        cls = self.make_class("9b", ("Lea",))
        lea = cls["students"][0]
        sub = package({"a.py": ""})
        early = self.make_task(cls["id"], code="konto-test1", submitFrom=iso(30), submitUntil=iso(60))
        self.assertEqual((early["code"], early["window"]), ("KONTO-TEST1", "before"))
        status, r = self.student.call("POST", "/api/tasks/KONTO-TEST1/submissions", {"personal": lea["code"], "package": sub})
        self.assertEqual((status, r["reason"]), (403, "window-before"))
        self.assertEqual(self.teacher.call("POST", "/api/tasks", {"title": "x", "code": "KONTO-TEST1", "package": sub})[0], 409)
        late = self.make_task(cls["id"], submitFrom=iso(-60), submitUntil=iso(-1))
        status, r = self.student.call("POST", f"/api/tasks/{late['code']}/submissions", {"personal": lea["code"], "package": sub})
        self.assertEqual((status, r["reason"]), (403, "window-after"))
        status, r = self.student.call("POST", f"/api/tasks/{late['code']}/submissions", {"personal": lea["code"], "package": sub, "allowLate": True})
        self.assertEqual((status, r["late"]), (200, True))
        overview = self.teacher.call("GET", f"/api/tasks/{late['code']}/submissions")[1]
        self.assertTrue(overview["students"][0]["late"])
        no_window = self.make_task(cls["id"])
        self.assertEqual(no_window["window"], "open")

    def test_rate_limit_on_guessing(self) -> None:
        for _ in range(30):
            self.assertEqual(self.student.call("GET", "/api/tasks/NOPE-XXXX/info")[0], 404)
        status, data = self.student.call("GET", "/api/tasks/NOPE-XXXX/info")
        self.assertEqual((status, data["reason"]), (429, "rate-limit"))


if __name__ == "__main__":
    unittest.main()
