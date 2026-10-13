from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bluepy_backend.analyzer import analyze_module, analyze_project, read_annotation  # noqa: E402
from bluepy_backend.rpc import INVALID_PARAMS  # noqa: E402
from tests.harness import BackendClient, RpcFailure  # noqa: E402

import ast  # noqa: E402

EXAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "examples", "bank")
FILES = ["person.py", "konto.py", "sparkonto.py", "transaktion.py", "bank.py", "test_konto.py"]


class AnalyzerTest(unittest.TestCase):
    def test_annotations(self) -> None:
        def ref(text: str):  # noqa: ANN202
            r = read_annotation(ast.parse(text, mode="eval").body)
            return r.name, r.multiplicity

        self.assertEqual(ref("Konto"), ("Konto", "1"))
        self.assertEqual(ref("list[Konto]"), ("Konto", "*"))
        self.assertEqual(ref("List[Konto]"), ("Konto", "*"))
        self.assertEqual(ref("dict[str, Konto]"), ("Konto", "*"))
        self.assertEqual(ref("Konto | None"), ("Konto", "0..1"))
        self.assertEqual(ref("Optional[Konto]"), ("Konto", "0..1"))
        self.assertEqual(ref("'Konto'"), ("Konto", "1"))
        self.assertEqual(ref("int | str"), (None, "1"))

    def test_stereotypes_and_edges(self) -> None:
        model = analyze_project(EXAMPLE)
        classes = {c["id"]: c for c in model["classes"]}
        self.assertEqual(classes["transaktion.Transaktion"]["stereotype"], "abstract")
        self.assertEqual(classes["transaktion.Status"]["stereotype"], "enum")
        self.assertEqual(classes["person.Adresse"]["stereotype"], "dataclass")
        self.assertEqual(classes["test_konto.KontoTest"]["stereotype"], "unittest")
        self.assertEqual(classes["sparkonto.Sparkonto"]["stereotype"], "class")

        edges = {(e["kind"], e["from"], e["to"], e.get("role")): e for e in model["edges"]}
        self.assertIn(("inheritance", "sparkonto.Sparkonto", "konto.Konto", None), edges)
        konten = edges[("association", "bank.Bank", "konto.Konto", "konten")]
        self.assertEqual((konten["multiplicity"], konten["relation"]), ("*", "composition"))
        inhaber = edges[("association", "konto.Konto", "person.Person", "inhaber")]
        self.assertEqual((inhaber["multiplicity"], inhaber["relation"]), ("1", "aggregation"))
        adresse = edges[("association", "person.Person", "person.Adresse", "adresse")]
        self.assertEqual(adresse["multiplicity"], "0..1")
        self.assertIn(("association", "transaktion.Transaktion", "transaktion.Status", "status"), edges)
        self.assertIn(("uses", "bank.Bank", "person.Person", None), edges)
        # no uses edge where an association already exists, and no module edges for modules with classes
        self.assertNotIn(("uses", "bank.Bank", "konto.Konto", None), edges)
        self.assertFalse(any(e["from"].startswith("module:") for e in model["edges"]))

    def test_methods_and_main(self) -> None:
        model = analyze_project(EXAMPLE)
        konto = next(c for c in model["classes"] if c["id"] == "konto.Konto")
        einzahlen = next(m for m in konto["methods"] if m["name"] == "einzahlen")
        self.assertEqual([p["name"] for p in einzahlen["params"]], ["betrag"])
        self.assertEqual(einzahlen["params"][0]["annotation"], "float")
        self.assertEqual(einzahlen["returns"], "None")
        self.assertEqual(einzahlen["doc"], "Zahlt einen positiven Betrag ein.")
        bank = next(m for m in model["modules"] if m["id"] == "bank")
        self.assertTrue(bank["hasMain"])

    def test_syntax_error_is_reported_per_module(self) -> None:
        info, classes = analyze_module("kaputt.py", "class A(\n")
        self.assertEqual(classes, [])
        self.assertEqual(info["error"]["line"] if isinstance(info, dict) else info.error["line"], 1)


class ObjectsTest(unittest.TestCase):
    client: BackendClient

    def setUp(self) -> None:
        self.client = BackendClient(cwd=EXAMPLE)
        result = self.client.request("module.load", {"files": FILES})
        self.assertTrue(all(r["ok"] for r in result["results"]), result["results"])

    def tearDown(self) -> None:
        self.client.close()

    def test_describe_class(self) -> None:
        info = self.client.request("class.describe", {"module": "sparkonto", "name": "Sparkonto"})
        self.assertEqual([p["name"] for p in info["constructor"]["params"]], ["inhaber", "stand"])
        self.assertEqual(info["constructor"]["params"][1]["default"], "0.0")
        names = {m["name"]: m for m in info["methods"]}
        self.assertFalse(names["zinsen_gutschreiben"]["inherited"])
        self.assertTrue(names["einzahlen"]["inherited"])
        self.assertEqual(names["einzahlen"]["definedIn"], "Konto")
        self.assertEqual(names["__repr__"]["visibility"], "dunder")
        abstract = self.client.request("class.describe", {"module": "transaktion", "name": "Transaktion"})
        self.assertTrue(abstract["isAbstract"])

    def test_create_call_inspect_remove(self) -> None:
        created = self.client.request("object.create", {"module": "person", "name": "Person", "args": ['"Anna"']})
        self.assertTrue(created["ok"])
        self.assertEqual(created["object"]["name"], "person1")
        self.assertEqual(created["record"], 'person1 = Person("Anna")')

        konto = self.client.request(
            "object.create", {"module": "konto", "name": "Konto", "benchName": "konto1", "args": ["person1", "10"]}
        )
        self.assertEqual([o["name"] for o in konto["bench"]], ["person1", "konto1"])

        call = self.client.request("object.call", {"target": "konto1", "method": "einzahlen", "args": ["5"]})
        self.assertTrue(call["ok"])
        self.assertIsNone(call["value"])
        self.assertEqual(call["record"], "konto1.einzahlen(5)")

        stand = self.client.request("object.call", {"target": "konto1", "method": "kontostand", "args": []})
        self.assertEqual(stand["value"]["repr"], "15")

        inspected = self.client.request("object.inspect", {"name": "konto1"})
        fields = {f["name"]: f for f in inspected["fields"]}
        self.assertEqual(fields["stand"]["value"]["repr"], "15")
        self.assertTrue(fields["inhaber"]["inspectable"])
        self.assertFalse(fields["stand"]["inspectable"])
        self.assertEqual(inspected["classAttributes"][0]["name"], "zinssatz")

        nested = self.client.request("object.inspect", {"name": "konto1", "path": ["inhaber"]})
        self.assertEqual({f["name"]: f["value"]["repr"] for f in nested["fields"]}["name"], "'Anna'")
        buchungen = self.client.request("object.inspect", {"name": "konto1", "path": ["buchungen"]})
        self.assertEqual([f["name"] for f in buchungen["fields"]], ["[0]"])

        got = self.client.request("object.get", {"name": "konto1", "path": ["inhaber"], "newName": "anna"})
        self.assertIn("anna", [o["name"] for o in got["bench"]])
        self.assertEqual(self.client.request("codepad.eval", {"code": "anna is person1"})["value"]["repr"], "True")

        removed = self.client.request("object.remove", {"name": "person1"})
        self.assertEqual([o["name"] for o in removed["bench"]], ["konto1", "anna"])

    def test_exception_in_call_goes_to_terminal(self) -> None:
        self.client.request("object.create", {"module": "person", "name": "Person", "args": ['"Bo"']})
        self.client.request("object.create", {"module": "konto", "name": "Konto", "benchName": "k", "args": ["person1"]})
        request_id = self.client.send_request("object.call", {"target": "k", "method": "einzahlen", "args": ["-1"]})
        response = self.client.wait_response(request_id)
        self.assertFalse(response["result"]["ok"])
        self.assertEqual(response["result"]["error"]["type"], "ValueError")
        self.client.wait_notification("invocation.finished")
        self.assertIn("ValueError: Betrag muss positiv sein", self.client.outputs("stderr"))

    def test_record_notifications(self) -> None:
        self.client.request("object.create", {"module": "person", "name": "Person", "args": ['"Cy"']})
        record = self.client.wait_notification("record")
        self.assertEqual(record["params"]["code"], 'person1 = Person("Cy")')

    def test_static_call_and_bad_arguments(self) -> None:
        with self.assertRaises(RpcFailure) as ctx:
            self.client.request("object.create", {"module": "person", "name": "Person", "args": ["(("]})
        self.assertEqual(ctx.exception.code, INVALID_PARAMS)
        with self.assertRaises(RpcFailure):
            self.client.request("class.describe", {"module": "nix", "name": "Nix"})
        abstract = self.client.request("object.create", {"module": "transaktion", "name": "Transaktion", "args": ["1"]})
        self.assertFalse(abstract["ok"])
        self.assertEqual(abstract["error"]["type"], "TypeError")

    def test_reload_removes_instances_and_reports_errors(self) -> None:
        self.client.request("object.create", {"module": "person", "name": "Person", "args": ['"Di"']})
        result = self.client.request("module.load", {"files": ["person.py"]})
        self.assertEqual(result["removedObjects"], ["person1"])
        self.assertEqual(result["bench"], [])
        broken = self.client.request("module.load", {"files": ["does_not_exist.py"]})
        self.assertFalse(broken["results"][0]["ok"])
        self.assertEqual(broken["results"][0]["stage"], "read")

    def test_run_module_main(self) -> None:
        request_id = self.client.send_request("module.run", {"file": "bank.py"})
        response = self.client.wait_response(request_id)
        self.assertTrue(response["result"]["ok"])
        self.client.wait_notification("invocation.finished")
        self.assertEqual(self.client.outputs("stdout").strip(), "100")

    def test_classes_are_available_in_codepad(self) -> None:
        result = self.client.request("codepad.eval", {"code": 'Person("Eva").begruessung()'})
        self.assertEqual(result["value"]["repr"], "'Hallo, Eva!'")


class SyntaxErrorLoadTest(unittest.TestCase):
    def test_syntax_error_is_reported_with_line(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "kaputt.py"), "w", encoding="utf-8") as f:
                f.write("def f(:\n    pass\n")
            with open(os.path.join(tmp, "ok.py"), "w", encoding="utf-8") as f:
                f.write("x = 1\n")
            client = BackendClient(cwd=tmp)
            try:
                result = client.request("module.load", {"files": ["kaputt.py", "ok.py"]})
                kaputt, ok = result["results"]
                self.assertFalse(kaputt["ok"])
                self.assertEqual(kaputt["stage"], "syntax")
                self.assertEqual(kaputt["error"]["line"], 1)
                self.assertTrue(ok["ok"])
            finally:
                client.close()


if __name__ == "__main__":
    unittest.main()
