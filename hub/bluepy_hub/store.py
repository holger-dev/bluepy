"""Persistence: SQLite for teachers, classes, students, tasks and submission
metadata; the packages themselves are files under the data directory."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from .codes import key_hash, normalize_code, personal_code, task_code, teacher_key

SCHEMA = """
CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    name TEXT NOT NULL, created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL, code TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS tasks (
    code TEXT PRIMARY KEY, teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', submit_from TEXT, submit_until TEXT,
    version INTEGER NOT NULL DEFAULT 1, tests INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_classes (
    task_code TEXT NOT NULL REFERENCES tasks(code) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    PRIMARY KEY (task_code, class_id)
);
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY, task_code TEXT NOT NULL REFERENCES tasks(code) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    at TEXT NOT NULL, size INTEGER NOT NULL, device TEXT, file TEXT NOT NULL, late INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS feedback (
    task_code TEXT NOT NULL REFERENCES tasks(code) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    notes TEXT NOT NULL DEFAULT '', points TEXT, updated TEXT NOT NULL,
    PRIMARY KEY (task_code, student_id)
);
"""

MAX_PACKAGE_BYTES = 20 * 1024 * 1024


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(text: str | None) -> datetime | None:
    if not text:
        return None
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


class HubError(Exception):
    def __init__(self, status: int, message: str, reason: str = "error") -> None:
        super().__init__(message)
        self.status = status
        self.reason = reason


class Store:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = data_dir
        os.makedirs(os.path.join(data_dir, "tasks"), exist_ok=True)
        os.makedirs(os.path.join(data_dir, "submissions"), exist_ok=True)
        self._lock = threading.RLock()
        self.db = sqlite3.connect(os.path.join(data_dir, "hub.sqlite"), check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)

    def close(self) -> None:
        self.db.close()

    # --------------------------------------------------------------- teachers

    def add_teacher(self, name: str) -> tuple[int, str]:
        key = teacher_key()
        with self._lock:
            cur = self.db.execute("INSERT INTO teachers (name, key_hash, created) VALUES (?, ?, ?)", (name, key_hash(key), now_iso()))
        return int(cur.lastrowid or 0), key

    def list_teachers(self) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT id, name, created FROM teachers ORDER BY id").fetchall()
        return [dict(r) for r in rows]

    def remove_teacher(self, teacher_id: int) -> bool:
        with self._lock:
            cur = self.db.execute("DELETE FROM teachers WHERE id = ?", (teacher_id,))
        return cur.rowcount > 0

    def teacher_by_key(self, key: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT id, name FROM teachers WHERE key_hash = ?", (key_hash(key),)).fetchone()
        return dict(row) if row else None

    # ---------------------------------------------------------------- classes

    def add_class(self, teacher_id: int, name: str, students: list[str]) -> dict[str, Any]:
        name = name.strip()
        if not name:
            raise HubError(400, "Klassenname fehlt")
        with self._lock:
            cur = self.db.execute("INSERT INTO classes (teacher_id, name, created) VALUES (?, ?, ?)", (teacher_id, name, now_iso()))
            class_id = int(cur.lastrowid or 0)
            self._add_students(class_id, students)
        return self.get_class(teacher_id, class_id)

    def _add_students(self, class_id: int, names: list[str]) -> list[dict[str, Any]]:
        added = []
        for raw in names:
            student = raw.strip()
            if not student:
                continue
            for _attempt in range(20):
                code = personal_code()
                try:
                    self.db.execute("INSERT INTO students (class_id, name, code) VALUES (?, ?, ?)", (class_id, student, code))
                    added.append({"name": student, "code": code})
                    break
                except sqlite3.IntegrityError:
                    continue
        return added

    def add_students(self, teacher_id: int, class_id: int, names: list[str]) -> dict[str, Any]:
        self._require_class(teacher_id, class_id)
        with self._lock:
            self._add_students(class_id, names)
        return self.get_class(teacher_id, class_id)

    def _require_class(self, teacher_id: int, class_id: int) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM classes WHERE id = ? AND teacher_id = ?", (class_id, teacher_id)).fetchone()
        if not row:
            raise HubError(404, "Klasse nicht gefunden")
        return row

    def get_class(self, teacher_id: int, class_id: int) -> dict[str, Any]:
        row = self._require_class(teacher_id, class_id)
        students = self.db.execute("SELECT id, name, code FROM students WHERE class_id = ? ORDER BY name COLLATE NOCASE", (class_id,)).fetchall()
        return {"id": row["id"], "name": row["name"], "created": row["created"], "students": [dict(s) for s in students]}

    def list_classes(self, teacher_id: int) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT id FROM classes WHERE teacher_id = ? ORDER BY name COLLATE NOCASE", (teacher_id,)).fetchall()
        return [self.get_class(teacher_id, r["id"]) for r in rows]

    def remove_class(self, teacher_id: int, class_id: int) -> None:
        self._require_class(teacher_id, class_id)
        with self._lock:
            self.db.execute("DELETE FROM classes WHERE id = ?", (class_id,))

    # ------------------------------------------------------------------ tasks

    def create_task(self, teacher_id: int, meta: dict[str, Any], package: bytes) -> dict[str, Any]:
        title = str(meta.get("title") or "").strip()
        if not title:
            raise HubError(400, "Titel fehlt")
        if len(package) > MAX_PACKAGE_BYTES:
            raise HubError(413, "Paket ist zu groß (max. 20 MB)")
        classes = [int(c) for c in meta.get("classes") or []]
        for class_id in classes:
            self._require_class(teacher_id, class_id)
        wanted = normalize_code(str(meta.get("code") or ""))
        with self._lock:
            code = wanted or task_code(title)
            for _attempt in range(20):
                if not self.db.execute("SELECT 1 FROM tasks WHERE code = ?", (code,)).fetchone():
                    break
                if wanted:
                    raise HubError(409, f"Aufgabencode {code} ist schon vergeben")
                code = task_code(title)
            stamp = now_iso()
            self.db.execute(
                "INSERT INTO tasks (code, teacher_id, title, description, submit_from, submit_until, version, tests, created, updated)"
                " VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
                (code, teacher_id, title, str(meta.get("description") or ""), meta.get("submitFrom"), meta.get("submitUntil"), 1 if meta.get("tests", True) else 0, stamp, stamp),
            )
            for class_id in classes:
                self.db.execute("INSERT OR IGNORE INTO task_classes (task_code, class_id) VALUES (?, ?)", (code, class_id))
            self._write_package(code, 1, package)
        return self.task_info(code, teacher_id)

    def update_task(self, teacher_id: int, code: str, meta: dict[str, Any], package: bytes | None) -> dict[str, Any]:
        task = self._require_task(code, teacher_id)
        if package is not None and len(package) > MAX_PACKAGE_BYTES:
            raise HubError(413, "Paket ist zu groß (max. 20 MB)")
        with self._lock:
            version = task["version"] + (1 if package is not None else 0)
            self.db.execute(
                "UPDATE tasks SET title = ?, description = ?, submit_from = ?, submit_until = ?, version = ?, tests = ?, updated = ? WHERE code = ?",
                (
                    str(meta.get("title") or task["title"]).strip() or task["title"],
                    str(meta.get("description", task["description"])),
                    meta.get("submitFrom", task["submit_from"]),
                    meta.get("submitUntil", task["submit_until"]),
                    version,
                    1 if meta.get("tests", bool(task["tests"])) else 0,
                    now_iso(),
                    task["code"],
                ),
            )
            if "classes" in meta:
                self.db.execute("DELETE FROM task_classes WHERE task_code = ?", (task["code"],))
                for class_id in [int(c) for c in meta.get("classes") or []]:
                    self._require_class(teacher_id, class_id)
                    self.db.execute("INSERT OR IGNORE INTO task_classes (task_code, class_id) VALUES (?, ?)", (task["code"], class_id))
            if package is not None:
                self._write_package(task["code"], version, package)
        return self.task_info(task["code"], teacher_id)

    def _write_package(self, code: str, version: int, package: bytes) -> None:
        folder = os.path.join(self.data_dir, "tasks", code)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, f"v{version}.bluepy"), "wb") as f:
            f.write(package)

    def read_task_package(self, code: str) -> bytes:
        task = self._require_task(code)
        with open(os.path.join(self.data_dir, "tasks", task["code"], f"v{task['version']}.bluepy"), "rb") as f:
            return f.read()

    def _require_task(self, code: str, teacher_id: int | None = None) -> sqlite3.Row:
        code = normalize_code(code)
        row = self.db.execute("SELECT * FROM tasks WHERE code = ?", (code,)).fetchone()
        if not row or (teacher_id is not None and row["teacher_id"] != teacher_id):
            raise HubError(404, "Aufgabe nicht gefunden", "unknown-task")
        return row

    def task_info(self, code: str, teacher_id: int | None = None) -> dict[str, Any]:
        task = self._require_task(code, teacher_id)
        classes = self.db.execute(
            "SELECT c.id, c.name FROM task_classes tc JOIN classes c ON c.id = tc.class_id WHERE tc.task_code = ? ORDER BY c.name", (task["code"],)
        ).fetchall()
        info = {
            "code": task["code"],
            "title": task["title"],
            "description": task["description"],
            "submitFrom": task["submit_from"],
            "submitUntil": task["submit_until"],
            "version": task["version"],
            "tests": bool(task["tests"]),
            "created": task["created"],
            "updated": task["updated"],
            "serverTime": now_iso(),
            "window": self.window_state(task),
        }
        if teacher_id is not None:
            info["classes"] = [dict(c) for c in classes]
            info["submissions"] = self.db.execute(
                "SELECT COUNT(DISTINCT student_id) FROM submissions WHERE task_code = ?", (task["code"],)
            ).fetchone()[0]
            info["students"] = self.db.execute(
                "SELECT COUNT(*) FROM students WHERE class_id IN (SELECT class_id FROM task_classes WHERE task_code = ?)", (task["code"],)
            ).fetchone()[0]
        return info

    def window_state(self, task: sqlite3.Row) -> str:
        now = datetime.now(timezone.utc)
        start = parse_iso(task["submit_from"])
        end = parse_iso(task["submit_until"])
        if start and now < start:
            return "before"
        if end and now > end:
            return "after"
        return "open"

    def list_tasks(self, teacher_id: int) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT code FROM tasks WHERE teacher_id = ? ORDER BY created DESC", (teacher_id,)).fetchall()
        return [self.task_info(r["code"], teacher_id) for r in rows]

    def remove_task(self, teacher_id: int, code: str) -> None:
        task = self._require_task(code, teacher_id)
        with self._lock:
            self.db.execute("DELETE FROM tasks WHERE code = ?", (task["code"],))

    # ------------------------------------------------------------ submissions

    def _student_for_task(self, task: sqlite3.Row, personal: str) -> sqlite3.Row:
        personal = normalize_code(personal)
        row = self.db.execute(
            "SELECT s.id, s.name, s.code, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id"
            " WHERE s.code = ? AND s.class_id IN (SELECT class_id FROM task_classes WHERE task_code = ?)",
            (personal, task["code"]),
        ).fetchone()
        if not row:
            raise HubError(403, "Persönlicher Code passt nicht zu dieser Aufgabe", "unknown-student")
        return row

    def submit(self, code: str, personal: str, package: bytes, device: str | None, allow_late: bool = False) -> dict[str, Any]:
        task = self._require_task(code)
        student = self._student_for_task(task, personal)
        if len(package) > MAX_PACKAGE_BYTES:
            raise HubError(413, "Paket ist zu groß (max. 20 MB)")
        state = self.window_state(task)
        if state == "before":
            raise HubError(403, f"Abgabe erst ab {task['submit_from']}", "window-before")
        late = state == "after"
        if late and not allow_late:
            raise HubError(403, f"Abgabefrist war {task['submit_until']}", "window-after")
        stamp = now_iso()
        folder = os.path.join(self.data_dir, "submissions", task["code"], student["code"])
        os.makedirs(folder, exist_ok=True)
        file_name = stamp.replace(":", "-") + ".bluepy"
        with open(os.path.join(folder, file_name), "wb") as f:
            f.write(package)
        with self._lock:
            self.db.execute(
                "INSERT INTO submissions (task_code, student_id, at, size, device, file, late) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (task["code"], student["id"], stamp, len(package), device, os.path.join(task["code"], student["code"], file_name), 1 if late else 0),
            )
        return {"ok": True, "at": stamp, "name": student["name"], "late": late}

    def submissions(self, teacher_id: int, code: str) -> dict[str, Any]:
        task = self._require_task(code, teacher_id)
        students = self.db.execute(
            "SELECT s.id, s.name, s.code AS personal, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id"
            " WHERE s.class_id IN (SELECT class_id FROM task_classes WHERE task_code = ?) ORDER BY c.name, s.name COLLATE NOCASE",
            (task["code"],),
        ).fetchall()
        latest = {
            r["student_id"]: r
            for r in self.db.execute(
                "SELECT * FROM submissions WHERE task_code = ? ORDER BY at", (task["code"],)
            ).fetchall()
        }
        devices: dict[str, set[int]] = {}
        for r in latest.values():
            if r["device"]:
                devices.setdefault(r["device"], set()).add(r["student_id"])
        feedback = {r["student_id"]: dict(r) for r in self.db.execute("SELECT * FROM feedback WHERE task_code = ?", (task["code"],)).fetchall()}
        result = []
        for s in students:
            sub = latest.get(s["id"])
            entry: dict[str, Any] = {
                "name": s["name"],
                "personal": s["personal"],
                "class": s["class_name"],
                "submittedAt": sub["at"] if sub else None,
                "late": bool(sub["late"]) if sub else False,
                "size": sub["size"] if sub else 0,
                "sharedDevice": bool(sub and sub["device"] and len(devices.get(sub["device"], set())) > 1),
                "feedback": {"notes": feedback[s["id"]]["notes"], "points": feedback[s["id"]]["points"]} if s["id"] in feedback else None,
            }
            result.append(entry)
        return {"task": self.task_info(task["code"], teacher_id), "students": result}

    def read_submission(self, teacher_id: int, code: str, personal: str) -> tuple[dict[str, Any], bytes]:
        task = self._require_task(code, teacher_id)
        student = self._student_for_task(task, personal)
        row = self.db.execute(
            "SELECT * FROM submissions WHERE task_code = ? AND student_id = ? ORDER BY at DESC LIMIT 1", (task["code"], student["id"])
        ).fetchone()
        if not row:
            raise HubError(404, "Keine Abgabe", "no-submission")
        with open(os.path.join(self.data_dir, "submissions", row["file"]), "rb") as f:
            package = f.read()
        return {"name": student["name"], "personal": student["code"], "at": row["at"], "late": bool(row["late"]), "size": row["size"]}, package

    # --------------------------------------------------------------- feedback

    def set_feedback(self, teacher_id: int, code: str, personal: str, notes: str, points: str | None) -> dict[str, Any]:
        task = self._require_task(code, teacher_id)
        student = self._student_for_task(task, personal)
        with self._lock:
            self.db.execute(
                "INSERT INTO feedback (task_code, student_id, notes, points, updated) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT(task_code, student_id) DO UPDATE SET notes = excluded.notes, points = excluded.points, updated = excluded.updated",
                (task["code"], student["id"], notes, points, now_iso()),
            )
        return {"ok": True}

    def get_feedback(self, code: str, personal: str) -> dict[str, Any]:
        task = self._require_task(code)
        student = self._student_for_task(task, personal)
        row = self.db.execute("SELECT notes, points, updated FROM feedback WHERE task_code = ? AND student_id = ?", (task["code"], student["id"])).fetchone()
        if not row:
            raise HubError(404, "Noch keine Rückmeldung", "no-feedback")
        return dict(row)

    # ------------------------------------------------------------------ stats

    def stats(self) -> dict[str, Any]:
        q = lambda sql: self.db.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "teachers": q("SELECT COUNT(*) FROM teachers"),
            "classes": q("SELECT COUNT(*) FROM classes"),
            "students": q("SELECT COUNT(*) FROM students"),
            "tasks": q("SELECT COUNT(*) FROM tasks"),
            "submissions": q("SELECT COUNT(*) FROM submissions"),
        }


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
