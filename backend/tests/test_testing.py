"""Unit-test support: tests.describe / tests.run / tests.fixtureToBench and bench code tracking."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import textwrap
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bluepy_backend.testing import describe_test_class  # noqa: E402
from tests.harness import BackendClient, RpcFailure  # noqa: E402

EXAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "examples", "bank")
FILES = ["person.py", "konto.py", "sparkonto.py", "transaktion.py", "bank.py", "test_konto.py"]

EXTRA_TESTS = '''
import unittest

from konto import Konto
from person import Person


class ExtraTest(unittest.TestCase):
    def setUp(self):
        self.person = Person("Bob")
        self.konto = Konto(self.person, 100)
        self.konto.einzahlen(1)

    def test_bestanden(self):
        self.assertEqual(self.konto.kontostand(), 101)

    def test_fehlschlag(self):
        self.assertEqual(self.konto.kontostand(), 5)

    def test_fehler(self):
        self.konto.gibt_es_nicht()

    @unittest.skip("noch nicht")
    def test_uebersprungen(self):
        pass
'''

BROKEN_TESTS = "import unittest\n\nclass Kaputt(unittest.TestCase)\n    pass\n"

ENDLESS_TESTS = '''
import unittest


class EndlosTest(unittest.TestCase):
    def test_endlos(self):
        while True:
            pass
'''


class DescribeTest(unittest.TestCase):
    def test_describe_static(self) -> None:
        info = describe_test_class(os.path.join(EXAMPLE, "test_konto.py"), "KontoTest")
        self.assertEqual([t["name"] for t in info["tests"]], ["test_einzahlen", "test_abheben_zu_viel"])
        self.assertTrue(info["hasFixture"])
        self.assertEqual(info["fixtureNames"], ["konto"])
        self.assertEqual(info["fixtureCode"], {"konto": "Konto(Person('Anna'), 10)"})  # ast.unparse normalises quotes
        with self.assertRaises(LookupError):
            describe_test_class(os.path.join(EXAMPLE, "test_konto.py"), "Nope")


class TestingRpcTest(unittest.TestCase):
    client: BackendClient
    project: str

    def setUp(self) -> None:
        self.project = tempfile.mkdtemp(prefix="bluepy-tests-")
        shutil.copytree(EXAMPLE, self.project, dirs_exist_ok=True)
        with open(os.path.join(self.project, "test_extra.py"), "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(EXTRA_TESTS))
        self.client = BackendClient(cwd=self.project)
        result = self.client.request("module.load", {"files": FILES})
        self.assertTrue(all(r["ok"] for r in result["results"]), result["results"])

    def tearDown(self) -> None:
        self.client.close()
        shutil.rmtree(self.project, ignore_errors=True)

    def _finished(self) -> dict[str, dict]:
        records = [n["params"] for n in self.client.notifications if n["method"] == "test.finished"]
        return {r["id"]: r for r in records}

    def test_describe_rpc(self) -> None:
        info = self.client.request("tests.describe", {"file": "test_extra.py", "className": "ExtraTest"})
        self.assertEqual(len(info["tests"]), 4)
        self.assertEqual(info["fixtureNames"], ["person", "konto"])
        with self.assertRaises(RpcFailure):
            self.client.request("tests.describe", {"file": "test_extra.py", "className": "Nope"})

    def test_run_files_streams_results(self) -> None:
        summary = self.client.request("tests.run", {"files": ["test_konto.py", "test_extra.py"]}, timeout=30)
        self.assertEqual((summary["total"], summary["passed"], summary["failed"], summary["errors"], summary["skipped"]), (6, 3, 1, 1, 1))
        self.assertIsInstance(summary["durationMs"], int)
        started = [n["params"] for n in self.client.notifications if n["method"] == "test.started"]
        self.assertEqual(len(started), 6)
        self.assertEqual(started[0]["file"], "test_konto.py")  # files run in the given order
        finished = self._finished()
        failure = finished["test_extra.ExtraTest.test_fehlschlag"]
        self.assertEqual(failure["status"], "failed")
        self.assertIn("101 != 5", failure["message"])
        self.assertEqual(failure["line"], 18)
        self.assertIn("test_fehlschlag", failure["traceback"])
        self.assertNotIn("unittest/case.py", failure["traceback"])
        error = finished["test_extra.ExtraTest.test_fehler"]
        self.assertEqual(error["status"], "error")
        self.assertTrue(error["message"].startswith("AttributeError"))
        self.assertEqual(error["line"], 21)
        skipped = finished["test_extra.ExtraTest.test_uebersprungen"]
        self.assertEqual((skipped["status"], skipped["message"]), ("skipped", "noch nicht"))
        self.assertEqual(finished["test_konto.KontoTest.test_einzahlen"]["status"], "passed")
        # the run is recorded like any other interaction
        records = [n["params"]["code"] for n in self.client.notifications if n["method"] == "record"]
        self.assertIn("# Tests: test_konto.py, test_extra.py", records)

    def test_run_single_class_and_method(self) -> None:
        summary = self.client.request("tests.run", {"files": ["test_extra.py"], "className": "ExtraTest"}, timeout=30)
        self.assertEqual(summary["total"], 4)
        summary = self.client.request(
            "tests.run", {"files": ["test_extra.py"], "className": "ExtraTest", "method": "test_bestanden"}, timeout=30
        )
        self.assertEqual((summary["total"], summary["passed"]), (1, 1))
        self.assertEqual(summary["results"][0]["method"], "test_bestanden")

    def test_run_reports_broken_module(self) -> None:
        with open(os.path.join(self.project, "test_kaputt.py"), "w", encoding="utf-8") as f:
            f.write(BROKEN_TESTS)
        summary = self.client.request("tests.run", {"files": ["test_kaputt.py", "test_konto.py"]}, timeout=30)
        self.assertEqual((summary["total"], summary["errors"], summary["passed"]), (3, 1, 2))
        broken = summary["results"][0]
        self.assertEqual((broken["file"], broken["status"], broken["method"]), ("test_kaputt.py", "error", "syntax"))
        self.assertEqual(broken["line"], 3)

    def test_halt_stops_a_running_test(self) -> None:
        with open(os.path.join(self.project, "test_endlos.py"), "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(ENDLESS_TESTS))
        request_id = self.client.send_request("tests.run", {"files": ["test_endlos.py"]})
        self.client.wait_notification("test.started", timeout=10)
        time.sleep(0.2)
        self.assertTrue(self.client.request("halt")["halted"])
        response = self.client.wait_response(request_id, timeout=10)
        self.assertEqual(response["error"]["code"], 1000)
        # the backend is still usable afterwards
        self.assertEqual(self.client.request("ping"), {"pong": True})

    def test_fixture_to_bench_and_code_tracking(self) -> None:
        self.client.request("object.create", {"module": "person", "name": "Person", "args": ['"Zoe"']})
        result = self.client.request("tests.fixtureToBench", {"file": "test_extra.py", "className": "ExtraTest"})
        self.assertTrue(result["ok"])
        self.assertEqual(result["names"], ["person", "konto"])
        bench = {o["name"]: o for o in result["bench"]}
        self.assertEqual(set(bench), {"person", "konto"})  # the previous bench object is gone
        self.assertEqual(bench["person"]["code"], "Person('Bob')")
        self.assertEqual(bench["konto"]["code"], "Konto(person, 100)")
        # setUp really ran: einzahlen(1) happened
        called = self.client.request("object.call", {"target": "konto", "method": "kontostand", "args": []})
        self.assertEqual(called["value"]["repr"], "101")

        # objects created or fetched interactively carry their expression too
        created = self.client.request("object.create", {"module": "konto", "name": "Konto", "benchName": "k2", "args": ["person", "5"]})
        self.assertEqual(created["object"]["code"], "Konto(person, 5)")
        got = self.client.request("object.get", {"name": "k2", "path": ["inhaber"], "newName": "p2"})
        self.assertEqual(got["object"]["code"], "k2.inhaber")
        self.assertEqual(got["record"], "p2 = k2.inhaber")
        # a Code Pad result put on the bench keeps the expression that produced it
        self.client.request("codepad.eval", {"code": "Person('Ida')"})
        got = self.client.request("object.get", {"name": "_", "path": [], "newName": "ida"})
        self.assertEqual(got["object"]["code"], "Person('Ida')")

        cleared = self.client.request("bench.clear")
        self.assertEqual(cleared["bench"], [])
        with self.assertRaises(RpcFailure):
            self.client.request("tests.fixtureToBench", {"file": "test_extra.py", "className": "Nope"})


class CodePadBenchTest(unittest.TestCase):
    """Code Pad variables bound to objects show up on the bench (BlueJ's object icons)."""

    client: BackendClient

    def setUp(self) -> None:
        self.client = BackendClient(cwd=EXAMPLE)
        self.client.request("module.load", {"files": FILES})
        self.client.request("object.create", {"module": "person", "name": "Person", "benchName": "p", "args": ['"Mia"']})

    def tearDown(self) -> None:
        self.client.close()

    def names(self, result: dict) -> dict[str, dict]:
        return {o["name"]: o for o in result["bench"]}

    def test_assignments_join_and_leave_the_bench(self) -> None:
        r = self.client.request("codepad.eval", {"code": "k = Konto(p, 5)", "id": 1})
        self.assertEqual(r["kind"], "statement")
        self.assertEqual(self.names(r)["k"]["code"], "Konto(p, 5)")
        self.assertEqual(self.names(r)["k"]["type"], "Konto")
        r = self.client.request("codepad.eval", {"code": "x = 5\nlst = [k, p]", "id": 2})
        bench = self.names(r)
        self.assertNotIn("x", bench)
        self.assertEqual(bench["lst"]["type"], "list")
        self.assertEqual(bench["lst"]["code"], "[k, p]")
        r = self.client.request("codepad.eval", {"code": "k = 7", "id": 3})
        self.assertNotIn("k", self.names(r))
        self.assertEqual(self.client.request("codepad.eval", {"code": "k", "id": 4})["value"]["repr"], "7")
        r = self.client.request("codepad.eval", {"code": "del lst", "id": 5})
        self.assertNotIn("lst", self.names(r))
        # classes, modules and functions never land on the bench
        r = self.client.request("codepad.eval", {"code": "K = Konto\nimport math\nf = print", "id": 6})
        self.assertEqual(set(self.names(r)), {"p"})

    def test_expression_results_can_be_inspected_and_benched_later(self) -> None:
        r = self.client.request("codepad.eval", {"code": "Konto(p, 7)", "id": 10})
        self.assertTrue(r["inspectable"])
        self.assertEqual(set(self.names(r)), {"p"})
        self.client.request("codepad.eval", {"code": "Konto(p, 8)", "id": 11})
        info = self.client.request("object.inspect", {"name": "$10", "path": []})
        self.assertEqual(info["className"], "Konto")
        self.assertEqual({f["name"]: f["value"]["repr"] for f in info["fields"]}["stand"], "7")
        got = self.client.request("object.get", {"name": "$10", "path": [], "newName": "k7"})
        self.assertEqual(got["object"]["code"], "Konto(p, 7)")
        self.assertEqual(got["record"], "k7 = Konto(p, 7)")
        self.assertEqual(self.client.request("codepad.eval", {"code": "k7.stand", "id": 12})["value"]["repr"], "7")
        with self.assertRaises(RpcFailure):
            self.client.request("object.inspect", {"name": "$99", "path": []})
        plain = self.client.request("codepad.eval", {"code": "1 + 1", "id": 13})
        self.assertNotIn("inspectable", plain)


if __name__ == "__main__":
    unittest.main()
