"""Unit-test support (BlueJ's "Testing" tools on top of `unittest`).

* `describe_test_class` – static view of a test class: test methods, fixture
  attributes assigned in `setUp` (no import needed, pure `ast`).
* `run_suite` – runs a suite with a `TestResult` that streams one notification
  per test to the IDE, including the failing line inside the test file.
* `fixture_from_class` – instantiates the test class, runs `setUp()` and
  returns the attributes it created together with the source expression of
  each one, so they can go back onto the object bench ("Test Fixture to
  Object Bench").
"""
from __future__ import annotations

import ast
import inspect
import os
import textwrap
import time
import unittest
from types import TracebackType
from typing import Any, Callable

from .errors import HaltRequested


def _is_self_attr(node: ast.AST) -> str | None:
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "self":
        return node.attr
    return None


class _StripSelf(ast.NodeTransformer):
    """`self.konto1` -> `konto1` (fixture code back into bench vocabulary)."""

    def visit_Attribute(self, node: ast.Attribute) -> ast.AST:  # noqa: N802
        name = _is_self_attr(node)
        if name is not None:
            return ast.copy_location(ast.Name(id=name, ctx=node.ctx), node)
        return self.generic_visit(node)


def fixture_assignments(setup: ast.FunctionDef) -> dict[str, str]:
    """`self.x = <expr>` statements of a setUp body, as name -> source of <expr> (self. stripped)."""
    result: dict[str, str] = {}
    for stmt in setup.body:
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            name = _is_self_attr(stmt.targets[0])
            if name is not None:
                result[name] = ast.unparse(_StripSelf().visit(stmt.value))
    return result


def describe_test_class(path: str, class_name: str) -> dict[str, Any]:
    """Test methods and fixture of a class, from the source file (no import)."""
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), path)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            tests: list[dict[str, Any]] = []
            setup: ast.FunctionDef | None = None
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if item.name.startswith("test"):
                        tests.append({"name": item.name, "line": item.lineno})
                    elif item.name == "setUp" and isinstance(item, ast.FunctionDef):
                        setup = item
            fixture = fixture_assignments(setup) if setup else {}
            return {
                "className": class_name,
                "line": node.lineno,
                "tests": tests,
                "hasFixture": setup is not None,
                "fixtureNames": list(fixture),
                "fixtureCode": fixture,
            }
    raise LookupError(f"Klasse '{class_name}' nicht in {os.path.basename(path)} gefunden")


# ------------------------------------------------------------------ running


def _line_in_file(tb: TracebackType | None, path: str) -> int | None:
    """Line of the innermost frame that belongs to `path`."""
    line = None
    normalized = os.path.normcase(os.path.abspath(path))
    while tb is not None:
        if os.path.normcase(os.path.abspath(tb.tb_frame.f_code.co_filename)) == normalized:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def test_identity(test: unittest.TestCase) -> tuple[str, str, str]:
    """(id, className, method) – also for the loader's synthetic failure tests."""
    cls = type(test)
    method = getattr(test, "_testMethodName", None) or str(test)
    return test.id(), cls.__name__, str(method)


class StreamingResult(unittest.TestResult):
    """Reports every test to the IDE as it finishes; keeps the summary for the response."""

    def __init__(self, notify: Callable[[str, dict[str, Any]], None], file_of: Callable[[unittest.TestCase], str | None]) -> None:
        super().__init__()
        self.notify = notify
        self.file_of = file_of
        self.records: list[dict[str, Any]] = []
        self._started: dict[str, float] = {}
        self._reported: set[str] = set()

    def startTest(self, test: unittest.TestCase) -> None:  # noqa: N802
        super().startTest(test)
        test_id, class_name, method = test_identity(test)
        self._started[test_id] = time.perf_counter()
        self.notify("test.started", {"id": test_id, "file": self.file_of(test), "className": class_name, "method": method})

    def _finish(self, test: unittest.TestCase, status: str, err: Any = None, message: str | None = None) -> None:
        test_id, class_name, method = test_identity(test)
        if test_id in self._reported:
            return  # e.g. a failed subTest followed by the test's own result
        self._reported.add(test_id)
        duration_ms = int((time.perf_counter() - self._started.get(test_id, time.perf_counter())) * 1000)
        file = self.file_of(test)
        record: dict[str, Any] = {
            "id": test_id,
            "file": file,
            "className": class_name,
            "method": method,
            "status": status,
            "message": message,
            "traceback": None,
            "line": None,
            "durationMs": duration_ms,
        }
        if err is not None:
            exc_type, exc_value, tb = err
            if message is None:
                if exc_type is not None and issubclass(exc_type, AssertionError):
                    message = str(exc_value) or "AssertionError"
                elif exc_type is not None:
                    message = f"{exc_type.__name__}: {exc_value}"
                else:
                    message = str(exc_value)
            record["message"] = message
            record["traceback"] = self._exc_info_to_string(err, test)
            record["line"] = _line_in_file(tb, file) if file else None
        self.records.append(record)
        self.notify("test.finished", record)

    def addSuccess(self, test: unittest.TestCase) -> None:  # noqa: N802
        super().addSuccess(test)
        self._finish(test, "passed")

    def addFailure(self, test: unittest.TestCase, err: Any) -> None:  # noqa: N802
        super().addFailure(test, err)
        self._finish(test, "failed", err)

    def addError(self, test: unittest.TestCase, err: Any) -> None:  # noqa: N802
        if isinstance(err[0], type) and issubclass(err[0], HaltRequested):
            raise HaltRequested()  # Halt must stop the whole run, not count as one error
        super().addError(test, err)
        self._finish(test, "error", err)

    def addSkip(self, test: unittest.TestCase, reason: str) -> None:  # noqa: N802
        super().addSkip(test, reason)
        self._finish(test, "skipped", message=reason)

    def addExpectedFailure(self, test: unittest.TestCase, err: Any) -> None:  # noqa: N802
        super().addExpectedFailure(test, err)
        self._finish(test, "passed", message="erwarteter Fehlschlag")

    def addUnexpectedSuccess(self, test: unittest.TestCase) -> None:  # noqa: N802
        super().addUnexpectedSuccess(test)
        self._finish(test, "failed", message="unerwartet bestanden")

    def addSubTest(self, test: unittest.TestCase, subtest: Any, err: Any) -> None:  # noqa: N802
        super().addSubTest(test, subtest, err)
        if err is not None:
            status = "failed" if issubclass(err[0], AssertionError) else "error"
            self._finish(test, status, err, message=f"{subtest._subDescription()}: {err[1]}")  # noqa: SLF001

    def summary(self) -> dict[str, Any]:
        counts = {"passed": 0, "failed": 0, "error": 0, "skipped": 0}
        for r in self.records:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        return {
            "total": len(self.records),
            "passed": counts["passed"],
            "failed": counts["failed"],
            "errors": counts["error"],
            "skipped": counts["skipped"],
            "results": self.records,
        }


def build_suite(modules: list[tuple[str, Any]], class_name: str | None, method: str | None) -> unittest.TestSuite:
    """Suite over whole modules, one class or one method; `modules` = [(file, module)]."""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for _file, module in modules:
        if class_name:
            cls = getattr(module, class_name, None)
            if not (isinstance(cls, type) and issubclass(cls, unittest.TestCase)):
                continue
            if method:
                suite.addTest(cls(method))
            else:
                suite.addTests(loader.loadTestsFromTestCase(cls))
        else:
            suite.addTests(loader.loadTestsFromModule(module))
    return suite


def run_suite(suite: unittest.TestSuite, notify: Callable[[str, dict[str, Any]], None], file_of_module: dict[str, str]) -> dict[str, Any]:
    def file_of(test: unittest.TestCase) -> str | None:
        return file_of_module.get(type(test).__module__)

    result = StreamingResult(notify, file_of)
    started = time.perf_counter()
    suite.run(result)
    summary = result.summary()
    summary["durationMs"] = int((time.perf_counter() - started) * 1000)
    return summary


# ------------------------------------------------------------------ fixture


def fixture_from_class(cls: type) -> list[tuple[str, Any, str | None]]:
    """Run setUp() of a fresh instance; returns [(name, value, source expression)] of the attributes it created."""
    instance = cls()
    before = set(vars(instance))
    setup = getattr(instance, "setUp", None)
    if callable(setup):
        setup()
    code: dict[str, str] = {}
    try:
        source = textwrap.dedent(inspect.getsource(cls.setUp))
        tree = ast.parse(source)
        func = tree.body[0]
        if isinstance(func, ast.FunctionDef):
            code = fixture_assignments(func)
    except (OSError, TypeError, SyntaxError, AttributeError, IndexError):
        pass
    return [(name, value, code.get(name)) for name, value in vars(instance).items() if name not in before and not name.startswith("_")]

