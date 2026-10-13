from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bluepy_backend.rpc import HALTED, INVALID_PARAMS, METHOD_NOT_FOUND  # noqa: E402
from tests.harness import BackendClient, RpcFailure  # noqa: E402


class SessionTest(unittest.TestCase):
    client: BackendClient

    def setUp(self) -> None:
        self.client = BackendClient()

    def tearDown(self) -> None:
        self.client.close()

    # -- handshake -------------------------------------------------------

    def test_hello_carries_token_and_python_info(self) -> None:
        params = self.client.hello["params"]
        self.assertEqual(params["token"], self.client.token)
        self.assertEqual(params["pid"], self.client.process.pid)
        self.assertEqual(params["python"]["executable"], sys.executable)
        self.assertEqual(params["protocolVersion"], "0.1")

    def test_ping_and_env_info(self) -> None:
        self.assertEqual(self.client.request("ping"), {"pong": True})
        info = self.client.request("env.info")
        self.assertGreaterEqual(tuple(info["versionInfo"]), (3, 11))
        self.assertIsInstance(info["hasTkinter"], bool)
        self.assertEqual(info["executable"], sys.executable)

    def test_unknown_method_and_invalid_params(self) -> None:
        with self.assertRaises(RpcFailure) as ctx:
            self.client.request("does.not.exist")
        self.assertEqual(ctx.exception.code, METHOD_NOT_FOUND)
        with self.assertRaises(RpcFailure) as ctx:
            self.client.request("codepad.eval", {"code": 42})
        self.assertEqual(ctx.exception.code, INVALID_PARAMS)

    # -- code pad --------------------------------------------------------

    def test_expression_statement_and_persistent_namespace(self) -> None:
        result = self.client.request("codepad.eval", {"code": "1 + 1"})
        self.assertEqual(result["kind"], "expression")
        self.assertEqual(result["value"]["repr"], "2")
        self.assertEqual(result["value"]["type"], "int")
        self.assertFalse(result["value"]["isNone"])

        self.assertEqual(self.client.request("codepad.eval", {"code": "x = 21"}), {"kind": "statement", "bench": []})
        self.assertEqual(self.client.request("codepad.eval", {"code": "x * 2"})["value"]["repr"], "42")
        self.assertEqual(self.client.request("codepad.eval", {"code": "_"})["value"]["repr"], "42")

    def test_multiline_statement(self) -> None:
        code = "def quadrat(n):\n    return n * n\n"
        self.assertEqual(self.client.request("codepad.eval", {"code": code})["kind"], "statement")
        self.assertEqual(self.client.request("codepad.eval", {"code": "quadrat(7)"})["value"]["repr"], "49")

    def test_print_goes_to_terminal_with_invocation_id(self) -> None:
        request_id = self.client.send_request("codepad.eval", {"code": 'print("hallo", "welt")'})
        response = self.client.wait_response(request_id)
        self.assertTrue(response["result"]["value"]["isNone"])
        self.client.wait_notification("invocation.finished")
        outputs = [n for n in self.client.notifications if n["method"] == "output"]
        self.assertTrue(outputs)
        self.assertTrue(all(n["params"]["invocation"] == request_id for n in outputs))
        self.assertEqual("".join(n["params"]["text"] for n in outputs), "hallo welt\n")

    def test_stderr_is_separate(self) -> None:
        self.client.request("codepad.eval", {"code": 'import sys; sys.stderr.write("oops\\n")'})
        self.client.wait_notification("invocation.finished")
        self.assertEqual(self.client.outputs("stderr"), "oops\n")
        self.assertEqual(self.client.outputs("stdout"), "")

    def test_runtime_error_is_a_result_without_backend_frames(self) -> None:
        result = self.client.request("codepad.eval", {"code": "1 / 0"})
        self.assertEqual(result["kind"], "expression")
        self.assertEqual(result["error"]["type"], "ZeroDivisionError")
        self.assertIn("<codepad>", result["error"]["traceback"])
        self.assertNotIn("bluepy_backend", result["error"]["traceback"])

    def test_syntax_error(self) -> None:
        result = self.client.request("codepad.eval", {"code": "def ("})
        self.assertEqual(result["kind"], "error")
        self.assertEqual(result["error"]["type"], "SyntaxError")
        self.assertEqual(result["error"]["line"], 1)

    def test_sys_exit_does_not_kill_the_backend(self) -> None:
        result = self.client.request("codepad.eval", {"code": "import sys; sys.exit(5)"})
        self.assertEqual(result["error"]["type"], "SystemExit")
        self.assertEqual(self.client.request("ping"), {"pong": True})

    # -- stdin -----------------------------------------------------------

    def test_input_round_trip(self) -> None:
        request_id = self.client.send_request("codepad.eval", {"code": 'input("Name? ")'})
        self.client.wait_notification("stdin.request")
        self.assertEqual(self.client.outputs("stdout"), "Name? ")
        self.client.notify("stdin.provide", {"text": "Holger\n"})
        response = self.client.wait_response(request_id)
        self.assertEqual(response["result"]["value"]["repr"], "'Holger'")

    def test_input_eof(self) -> None:
        request_id = self.client.send_request("codepad.eval", {"code": "input()"})
        self.client.wait_notification("stdin.request")
        self.client.notify("stdin.provide", {"text": None})
        response = self.client.wait_response(request_id)
        self.assertEqual(response["result"]["error"]["type"], "EOFError")

    # -- halt ------------------------------------------------------------

    def test_halt_interrupts_a_busy_loop(self) -> None:
        request_id = self.client.send_request("codepad.eval", {"code": "while True:\n    pass"})
        self.client.wait_notification("invocation.started")
        time.sleep(0.2)
        self.assertEqual(self.client.request("halt"), {"halted": True})
        response = self.client.wait_response(request_id)
        self.assertEqual(response["error"]["code"], HALTED)
        finished = self.client.wait_notification("invocation.finished")
        self.assertFalse(finished["params"]["ok"])
        # The session survives and the namespace is intact.
        self.assertEqual(self.client.request("ping"), {"pong": True})
        self.assertEqual(self.client.request("codepad.eval", {"code": "2 ** 10"})["value"]["repr"], "1024")

    def test_halt_cannot_be_swallowed_by_user_code(self) -> None:
        code = "while True:\n    try:\n        pass\n    except Exception:\n        pass"
        request_id = self.client.send_request("codepad.eval", {"code": code})
        self.client.wait_notification("invocation.started")
        time.sleep(0.2)
        self.assertEqual(self.client.request("halt"), {"halted": True})
        self.assertEqual(self.client.wait_response(request_id)["error"]["code"], HALTED)

    def test_halt_interrupts_waiting_for_input(self) -> None:
        request_id = self.client.send_request("codepad.eval", {"code": "input()"})
        self.client.wait_notification("stdin.request")
        self.assertEqual(self.client.request("halt"), {"halted": True})
        self.assertEqual(self.client.wait_response(request_id)["error"]["code"], HALTED)

    def test_halt_when_idle_is_a_noop(self) -> None:
        self.assertEqual(self.client.request("halt"), {"halted": False})
        self.assertEqual(self.client.request("ping"), {"pong": True})

    # -- lifecycle -------------------------------------------------------

    def test_shutdown_exits_cleanly(self) -> None:
        self.assertEqual(self.client.request("shutdown"), {"ok": True})
        self.assertEqual(self.client.close(graceful=False), 0)

    def test_connection_loss_exits(self) -> None:
        # Simulates the IDE dying: both the file wrapper and the socket must go.
        self.client.reader.close()
        self.client.sock.close()
        self.assertEqual(self.client.close(graceful=False), 0)


class ProjectCwdTest(unittest.TestCase):
    def test_cwd_is_on_sys_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "konto.py"), "w", encoding="utf-8") as f:
                f.write("class Konto:\n    def __init__(self):\n        self.stand = 10\n")
            client = BackendClient(cwd=tmp)
            try:
                info = client.request("env.info")
                self.assertEqual(os.path.realpath(info["cwd"]), os.path.realpath(tmp))
                client.request("codepad.eval", {"code": "from konto import Konto"})
                result = client.request("codepad.eval", {"code": "Konto().stand"})
                self.assertEqual(result["value"]["repr"], "10")
            finally:
                client.close()


if __name__ == "__main__":
    unittest.main()
