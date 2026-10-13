"""Run the unit tests of a project folder in a fresh interpreter and print one JSON summary.

    python -B -X utf8 backend/run_tests.py <project-dir> [--tests-from <dir>] [--timeout 60]

Used by the teacher's review mode ("Tests über alle Abgaben"): every submission
runs isolated in its own process; with --tests-from the teacher's test files
replace the learner's copies (files named test*.py) so edited tests do not count.
Output: {"ok": true, "total": n, "passed": n, "failed": n, "errors": n, "skipped": n,
         "results": [{"id", "className", "method", "status", "message", "line", "file"}]}
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import sys
import tempfile
import threading
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bluepy_backend.testing import build_suite, run_suite  # noqa: E402


def main(argv: list[str]) -> int:
    if not argv:
        print(json.dumps({"ok": False, "error": "project dir missing"}))
        return 2
    project = os.path.abspath(argv[0])
    tests_from = None
    timeout = 120.0
    i = 1
    while i < len(argv):
        if argv[i] == "--tests-from" and i + 1 < len(argv):
            tests_from = os.path.abspath(argv[i + 1])
            i += 2
        elif argv[i] == "--timeout" and i + 1 < len(argv):
            timeout = float(argv[i + 1])
            i += 2
        else:
            i += 1

    work = tempfile.mkdtemp(prefix="bluepy-review-")
    try:
        shutil.copytree(project, work, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", ".*"))
        if tests_from and os.path.isdir(tests_from):
            for name in os.listdir(tests_from):
                if name.startswith("test") and name.endswith(".py"):
                    shutil.copy2(os.path.join(tests_from, name), os.path.join(work, name))
        os.chdir(work)
        sys.path.insert(0, work)
        test_files = sorted(n for n in os.listdir(work) if n.startswith("test") and n.endswith(".py"))
        modules: list[tuple[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for rel in test_files:
            name = rel[:-3]
            try:
                modules.append((rel, importlib.import_module(name)))
            except BaseException as exc:  # noqa: BLE001
                errors.append({"id": rel, "file": rel, "className": name, "method": "import", "status": "error", "message": f"{type(exc).__name__}: {exc}", "line": None})
        suite = build_suite(modules, None, None)
        file_of = {m.__name__: rel for rel, m in modules}

        real_stdout = sys.stdout

        # a watchdog so an endless loop in a submission cannot hang the review
        def abort() -> None:
            real_stdout.write(json.dumps({"ok": False, "error": f"Timeout nach {int(timeout)} s", "total": 0, "passed": 0, "failed": 0, "errors": 1, "skipped": 0, "results": []}) + "\n")
            real_stdout.flush()
            os._exit(3)

        watchdog = threading.Timer(timeout, abort)
        watchdog.daemon = True
        watchdog.start()
        sys.stdout = open(os.devnull, "w", encoding="utf-8")  # user prints must not break the JSON
        try:
            summary = run_suite(suite, lambda _m, _p: None, file_of)
        finally:
            sys.stdout.close()
            sys.stdout = real_stdout
            watchdog.cancel()
        summary["results"] = errors + [
            {k: r.get(k) for k in ("id", "file", "className", "method", "status", "message", "line", "durationMs")} for r in summary["results"]
        ]
        summary["total"] += len(errors)
        summary["errors"] += len(errors)
        summary["ok"] = True
        print(json.dumps(summary, ensure_ascii=False), flush=True)
        return 0
    finally:
        os.chdir(os.path.dirname(work))
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
