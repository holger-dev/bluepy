"""Runtime side of the class diagram: loading modules, describing classes,
creating objects on the bench, calling methods and inspecting values."""

from __future__ import annotations

import importlib
import inspect
import keyword
import os
import runpy
import sys
import traceback
from types import ModuleType
from typing import Any

from .codepad import describe_value, format_exception
from .rpc import INVALID_PARAMS, JsonRpcError

PRIMITIVES = (int, float, complex, str, bytes, bool, type(None))
MAX_CONTAINER_ITEMS = 500


def module_name_for(rel_path: str) -> str:
    parts = rel_path.replace("\\", "/")[: -len(".py")].split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def format_params(sig: inspect.Signature, skip_first: bool = False) -> list[dict[str, Any]]:
    params = list(sig.parameters.values())
    if skip_first and params and params[0].kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
        params = params[1:]
    result = []
    for p in params:
        kind = {
            inspect.Parameter.VAR_POSITIONAL: "vararg",
            inspect.Parameter.KEYWORD_ONLY: "kwonly",
            inspect.Parameter.VAR_KEYWORD: "kwarg",
        }.get(p.kind, "positional")
        result.append(
            {
                "name": p.name,
                "annotation": None if p.annotation is inspect.Parameter.empty else inspect.formatannotation(p.annotation),
                "default": None if p.default is inspect.Parameter.empty else repr(p.default),
                "kind": kind,
            }
        )
    return result


def visibility_of(name: str) -> str:
    if name.startswith("__") and name.endswith("__"):
        return "dunder"
    if name.startswith("_"):
        return "private"
    return "public"


def describe_class(cls: type) -> dict[str, Any]:
    """Constructor and methods of a live class, including inherited ones."""
    try:
        init_sig = inspect.signature(cls.__init__)
        ctor_params = format_params(init_sig, skip_first=True)
    except (TypeError, ValueError):
        ctor_params = []
    constructor = {
        "params": ctor_params,
        "doc": inspect.getdoc(cls.__init__) if cls.__init__ is not object.__init__ else None,
    }

    methods: list[dict[str, Any]] = []
    seen: set[str] = set()
    for klass in cls.__mro__:
        if klass is object:
            continue
        for name, member in vars(klass).items():
            if name in seen:
                continue
            kind: str
            func: Any
            if isinstance(member, staticmethod):
                kind, func = "static", member.__func__
            elif isinstance(member, classmethod):
                kind, func = "classmethod", member.__func__
            elif isinstance(member, property):
                kind, func = "property", member.fget
            elif inspect.isfunction(member):
                kind, func = "instance", member
            else:
                continue
            seen.add(name)
            if func is None:
                continue
            try:
                sig = inspect.signature(func)
                params = format_params(sig, skip_first=kind in ("instance", "classmethod", "property"))
                returns = None if sig.return_annotation is inspect.Signature.empty else inspect.formatannotation(sig.return_annotation)
            except (TypeError, ValueError):
                params, returns = [], None
            methods.append(
                {
                    "name": name,
                    "kind": kind,
                    "params": params,
                    "returns": returns,
                    "doc": inspect.getdoc(func),
                    "definedIn": klass.__name__,
                    "inherited": klass is not cls,
                    "visibility": visibility_of(name),
                    "isAbstract": bool(getattr(func, "__isabstractmethod__", False)),
                }
            )

    class_attributes = []
    for name, value in vars(cls).items():
        if name.startswith("__") or callable(value) or isinstance(value, (staticmethod, classmethod, property)):
            continue
        class_attributes.append({"name": name, "value": describe_value(value)})

    return {
        "name": cls.__name__,
        "module": cls.__module__,
        "doc": inspect.getdoc(cls),
        "isAbstract": inspect.isabstract(cls),
        "bases": [b.__name__ for b in cls.__bases__ if b is not object],
        "constructor": constructor,
        "methods": methods,
        "classAttributes": class_attributes,
    }


def is_inspectable(value: Any) -> bool:
    return not isinstance(value, PRIMITIVES)


def fields_of(value: Any) -> list[dict[str, Any]]:
    """Fields shown in the inspector for one value."""
    fields: list[dict[str, Any]] = []

    def add(name: str, item: Any, kind: str) -> None:
        fields.append({"name": name, "kind": kind, "value": describe_value(item), "inspectable": is_inspectable(item)})

    if isinstance(value, dict):
        for i, (k, v) in enumerate(value.items()):
            if i >= MAX_CONTAINER_ITEMS:
                break
            add(repr(k), v, "item")
        return fields
    if isinstance(value, (list, tuple, set, frozenset)):
        for i, item in enumerate(value):
            if i >= MAX_CONTAINER_ITEMS:
                break
            add(f"[{i}]", item, "item")
        return fields
    slots = getattr(type(value), "__slots__", None)
    if slots:
        for name in slots if not isinstance(slots, str) else (slots,):
            if hasattr(value, name):
                add(name, getattr(value, name), "field")
    instance_dict = getattr(value, "__dict__", None)
    if isinstance(instance_dict, dict):
        for name, item in instance_dict.items():
            add(name, item, "field")
    return fields


def navigate(value: Any, path: list[Any]) -> Any:
    for step in path:
        if isinstance(value, dict):
            matches = [k for k in value if repr(k) == step]
            if not matches:
                raise KeyError(step)
            value = value[matches[0]]
        elif isinstance(value, (list, tuple)):
            index = int(str(step).strip("[]"))
            value = value[index]
        elif isinstance(value, (set, frozenset)):
            index = int(str(step).strip("[]"))
            value = list(value)[index]
        else:
            value = getattr(value, str(step))
    return value


class Bench:
    """Objects the learner has created, by name.  Names are also globals of
    the Code Pad namespace so `konto1.einzahlen(5)` works there."""

    def __init__(self, namespace: dict[str, Any]) -> None:
        self.namespace = namespace
        self.objects: dict[str, Any] = {}

    def entry(self, name: str) -> dict[str, Any]:
        obj = self.objects[name]
        cls = type(obj)
        return {"name": name, "type": cls.__name__, "module": cls.__module__, "repr": describe_value(obj)["repr"]}

    def list(self) -> list[dict[str, Any]]:
        return [self.entry(n) for n in self.objects]

    def add(self, name: str, obj: Any) -> dict[str, Any]:
        if not name.isidentifier() or keyword.iskeyword(name):
            raise JsonRpcError(INVALID_PARAMS, f"'{name}' ist kein gültiger Name")
        self.objects[name] = obj
        self.namespace[name] = obj
        return self.entry(name)

    def remove(self, name: str) -> None:
        self.objects.pop(name, None)
        if self.namespace.get(name) is not None:
            self.namespace.pop(name, None)

    def get(self, name: str) -> Any:
        if name not in self.objects:
            raise JsonRpcError(INVALID_PARAMS, f"Kein Objekt namens '{name}' auf der Objektleiste")
        return self.objects[name]

    def suggest_name(self, cls_name: str) -> str:
        base = cls_name[:1].lower() + cls_name[1:] if cls_name else "obj"
        if keyword.iskeyword(base):
            base += "_"
        n = 1
        while f"{base}{n}" in self.objects or f"{base}{n}" in self.namespace:
            n += 1
        return f"{base}{n}"

    def remove_instances_of_modules(self, modules: set[str]) -> list[str]:
        removed = [n for n, o in self.objects.items() if type(o).__module__ in modules]
        for n in removed:
            self.remove(n)
        return removed


class ModuleLoader:
    """Compile check + (re)import of project modules – BluePy's "Compile"."""

    def __init__(self, project_dir: str, namespace: dict[str, Any]) -> None:
        self.project_dir = project_dir
        self.namespace = namespace
        self.loaded: dict[str, ModuleType] = {}

    def load(self, files: list[str]) -> list[dict[str, Any]]:
        results: dict[str, dict[str, Any]] = {}
        names: list[tuple[str, str]] = []
        for rel in files:
            path = os.path.join(self.project_dir, rel)
            name = module_name_for(rel)
            try:
                with open(path, encoding="utf-8") as f:
                    source = f.read()
                compile(source, path, "exec")
            except SyntaxError as exc:
                results[rel] = {"file": rel, "module": name, "ok": False, "stage": "syntax", "error": format_exception(exc)}
                continue
            except OSError as exc:
                results[rel] = {"file": rel, "module": name, "ok": False, "stage": "read", "error": {"type": "OSError", "message": str(exc), "traceback": ""}}
                continue
            names.append((rel, name))

        # Drop every module we are about to (re)load so imports between them are fresh.
        for _rel, name in names:
            for loaded in list(sys.modules):
                if loaded == name or loaded.startswith(name + "."):
                    del sys.modules[loaded]
        importlib.invalidate_caches()

        for rel, name in names:
            try:
                module = importlib.import_module(name)
            except BaseException as exc:  # noqa: BLE001 - user code may raise anything at import time
                if isinstance(exc, KeyboardInterrupt):
                    raise
                sys.stderr.write("".join(traceback.format_exception(exc)))
                results[rel] = {"file": rel, "module": name, "ok": False, "stage": "import", "error": format_exception(exc)}
                sys.modules.pop(name, None)
                continue
            self.loaded[name] = module
            self.namespace[name.split(".")[-1]] = module
            for attr, value in vars(module).items():
                if isinstance(value, type) and value.__module__ == name:
                    self.namespace[attr] = value
            results[rel] = {"file": rel, "module": name, "ok": True, "stage": "loaded", "error": None}
        return [results[rel] for rel in files]

    def get_class(self, module: str, name: str) -> type:
        mod = self.loaded.get(module) or sys.modules.get(module)
        if mod is None:
            raise JsonRpcError(INVALID_PARAMS, f"Modul '{module}' ist nicht geladen – erst Compile ausführen")
        cls = getattr(mod, name, None)
        if not isinstance(cls, type):
            raise JsonRpcError(INVALID_PARAMS, f"Klasse '{name}' nicht in Modul '{module}' gefunden")
        return cls

    def run_module(self, rel: str) -> None:
        path = os.path.join(self.project_dir, rel)
        runpy.run_path(path, run_name="__main__")


def eval_args(args: list[str], namespace: dict[str, Any]) -> list[Any]:
    values = []
    for i, text in enumerate(args):
        source = text.strip()
        if not source:
            raise JsonRpcError(INVALID_PARAMS, f"Parameter {i + 1} ist leer")
        try:
            values.append(eval(compile(source, f"<parameter {i + 1}>", "eval"), namespace))  # noqa: S307
        except SyntaxError as exc:
            raise JsonRpcError(INVALID_PARAMS, f"Parameter {i + 1}: {exc.msg}") from exc
    return values


def call_expression(target: str, method: str | None, args: list[str]) -> str:
    """Python source of an interactive call, for 'Record method calls'."""
    joined = ", ".join(a.strip() for a in args)
    return f"{target}.{method}({joined})" if method else f"{target}({joined})"
