from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bluepy_backend.rpc import HALTED  # noqa: E402
from tests.harness import BackendClient  # noqa: E402

EXAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "examples", "bank")
FILES = ["person.py", "konto.py", "sparkonto.py", "transaktion.py", "bank.py"]

# Line numbers in the example project (see examples/bank/*.py)
KONTO_EINZAHLEN_ADD = 18  # self.stand += betrag
KONTO_EINZAHLEN_APPEND = 19  # self.buchungen.append(betrag)
KONTO_INIT_FIRST = 10  # self.inhaber = inhaber
BANK_KONTO_EROEFFNEN_CALL = 15  # konto = Konto(inhaber, startguthaben)
BANK_KONTO_EROEFFNEN_APPEND = 16  # self.konten.append(konto)


class DebuggerTest(unittest.TestCase):
    client: BackendClient

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="bluepy-dbg-")
        shutil.copytree(EXAMPLE, self.tmp, dirs_exist_ok=True)
        with open(os.path.join(self.tmp, "schleife.py"), "w", encoding="utf-8") as f:
            f.write("def endlos():\n    x = 0\n    while True:\n        x += 1\n")
        self.client = BackendClient(cwd=self.tmp)
        self.client.request("module.load", {"files": FILES + ["schleife.py"]})
        self.client.request("object.create", {"module": "person", "name": "Person", "benchName": "anna", "args": ['"Anna"']})
        self.client.request("object.create", {"module": "konto", "name": "Konto", "benchName": "k", "args": ["anna", "10"]})

    def tearDown(self) -> None:
        self.client.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pause(self) -> dict:
        return self.client.wait_notification("debug.paused")["params"]

    def top(self, paused: dict) -> tuple[str, int, str]:
        f = paused["frames"][0]
        return f["file"], f["line"], f["function"]

    # ------------------------------------------------------------------

    def test_breakpoint_variables_step_continue(self) -> None:
        self.client.request("debug.setBreakpoints", {"file": "konto.py", "lines": [KONTO_EINZAHLEN_ADD]})
        request_id = self.client.send_request("object.call", {"target": "k", "method": "einzahlen", "args": ["5"]})

        paused = self.pause()
        self.assertEqual(paused["reason"], "breakpoint")
        self.assertEqual(self.top(paused), ("konto.py", KONTO_EINZAHLEN_ADD, "einzahlen"))
        self.assertEqual(paused["frames"][0]["className"], "Konto")

        variables = self.client.request("debug.variables", {"frame": 0})
        self.assertEqual({v["name"]: v["value"]["repr"] for v in variables["locals"]}, {"betrag": "5"})
        instance = {v["name"]: v["value"]["repr"] for v in variables["instance"]}
        self.assertEqual(instance["stand"], "10")
        self.assertEqual({v["name"] for v in variables["static"]}, {"zinssatz"})

        inspected = self.client.request("debug.inspect", {"frame": 0, "scope": "instance", "name": "inhaber", "path": []})
        self.assertEqual(inspected["className"], "Person")
        self.assertEqual({f["name"]: f["value"]["repr"] for f in inspected["fields"]}["name"], "'Anna'")

        self.assertEqual(self.client.request("debug.step", {}), {"ok": True})
        self.client.wait_notification("debug.resumed")
        paused = self.pause()
        self.assertEqual(paused["reason"], "step")
        self.assertEqual(self.top(paused), ("konto.py", KONTO_EINZAHLEN_APPEND, "einzahlen"))
        instance = {v["name"]: v["value"]["repr"] for v in self.client.request("debug.variables", {"frame": 0})["instance"]}
        self.assertEqual(instance["stand"], "15")

        self.assertEqual(self.client.request("debug.continue", {}), {"ok": True})
        response = self.client.wait_response(request_id)
        self.assertTrue(response["result"]["ok"])
        self.assertEqual(self.client.request("object.call", {"target": "k", "method": "kontostand", "args": []})["value"]["repr"], "15")

    def test_step_into_and_out_across_files(self) -> None:
        self.client.request("object.create", {"module": "bank", "name": "Bank", "benchName": "b", "args": ['"Sparkasse"']})
        self.client.request("debug.setBreakpoints", {"file": "bank.py", "lines": [BANK_KONTO_EROEFFNEN_CALL]})
        request_id = self.client.send_request("object.call", {"target": "b", "method": "konto_eroeffnen", "args": ["anna", "50"]})

        paused = self.pause()
        self.assertEqual(self.top(paused), ("bank.py", BANK_KONTO_EROEFFNEN_CALL, "konto_eroeffnen"))

        self.client.request("debug.stepInto", {})
        self.client.wait_notification("debug.resumed")
        paused = self.pause()
        self.assertEqual(self.top(paused), ("konto.py", KONTO_INIT_FIRST, "__init__"))
        self.assertEqual([f["function"] for f in paused["frames"]], ["__init__", "konto_eroeffnen"])
        locals_ = {v["name"]: v["value"]["repr"] for v in self.client.request("debug.variables", {"frame": 0})["locals"]}
        self.assertEqual(locals_["stand"], "50")
        caller = {v["name"]: v["value"]["repr"] for v in self.client.request("debug.variables", {"frame": 1})["locals"]}
        self.assertEqual(caller["startguthaben"], "50")

        self.client.request("debug.stepOut", {})
        self.client.wait_notification("debug.resumed")
        paused = self.pause()
        self.assertEqual(self.top(paused), ("bank.py", BANK_KONTO_EROEFFNEN_APPEND, "konto_eroeffnen"))

        self.client.request("debug.continue", {})
        response = self.client.wait_response(request_id)
        self.assertTrue(response["result"]["ok"])
        self.assertEqual(response["result"]["value"]["type"], "Konto")

    def test_step_over_does_not_enter_callee(self) -> None:
        self.client.request("object.create", {"module": "bank", "name": "Bank", "benchName": "b", "args": ['"S"']})
        self.client.request("debug.setBreakpoints", {"file": "bank.py", "lines": [BANK_KONTO_EROEFFNEN_CALL]})
        request_id = self.client.send_request("object.call", {"target": "b", "method": "konto_eroeffnen", "args": ["anna"]})
        self.pause()
        self.client.request("debug.step", {})
        self.client.wait_notification("debug.resumed")
        paused = self.pause()
        self.assertEqual(self.top(paused), ("bank.py", BANK_KONTO_EROEFFNEN_APPEND, "konto_eroeffnen"))
        self.client.request("debug.continue", {})
        self.assertTrue(self.client.wait_response(request_id)["result"]["ok"])

    def test_pause_and_terminate_running_loop(self) -> None:
        self.client.request("debug.arm", {"enabled": True})
        request_id = self.client.send_request("codepad.eval", {"code": "import schleife; schleife.endlos()"})
        self.client.wait_notification("invocation.started")
        time.sleep(0.3)
        self.assertEqual(self.client.request("debug.pause", {}), {"ok": True})
        paused = self.pause()
        self.assertEqual(paused["reason"], "pause")
        self.assertEqual(paused["frames"][0]["file"], "schleife.py")
        x = {v["name"]: v["value"]["repr"] for v in self.client.request("debug.variables", {"frame": 0})["locals"]}
        self.assertGreater(int(x["x"]), 0)
        self.assertEqual(self.client.request("debug.terminate", {}), {"ok": True})
        response = self.client.wait_response(request_id)
        self.assertEqual(response["error"]["code"], HALTED)
        self.assertEqual(self.client.request("ping"), {"pong": True})

    def test_halt_while_paused_aborts(self) -> None:
        self.client.request("debug.setBreakpoints", {"file": "konto.py", "lines": [KONTO_EINZAHLEN_ADD]})
        request_id = self.client.send_request("object.call", {"target": "k", "method": "einzahlen", "args": ["1"]})
        self.pause()
        self.assertEqual(self.client.request("halt"), {"halted": True})
        self.assertEqual(self.client.wait_response(request_id)["error"]["code"], HALTED)
        self.assertEqual(self.client.request("debug.state", {})["paused"], False)

    def test_without_breakpoints_nothing_pauses(self) -> None:
        self.assertEqual(self.client.request("debug.pause", {}), {"ok": False})
        result = self.client.request("object.call", {"target": "k", "method": "einzahlen", "args": ["5"]})
        self.assertTrue(result["ok"])
        self.assertEqual(self.client.request("debug.state", {}), {"paused": False, "armed": False, "active": False})

    def test_breakpoints_can_be_removed(self) -> None:
        self.client.request("debug.setBreakpoints", {"file": "konto.py", "lines": [KONTO_EINZAHLEN_ADD]})
        self.client.request("debug.setBreakpoints", {"file": "konto.py", "lines": []})
        result = self.client.request("object.call", {"target": "k", "method": "einzahlen", "args": ["5"]})
        self.assertTrue(result["ok"])
        self.assertEqual([n for n in self.client.notifications if n["method"] == "debug.paused"], [])

    def test_commands_without_pause_are_rejected(self) -> None:
        self.assertEqual(self.client.request("debug.continue", {}), {"ok": False})
        self.assertEqual(self.client.request("debug.frames", {}), {"paused": False, "frames": []})


if __name__ == "__main__":
    unittest.main()
