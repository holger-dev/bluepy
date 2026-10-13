"""Static project analysis with `ast`: classes, stereotypes, relationships.

Produces the model behind the class diagram.  Runs as a stateless CLI
(`python backend/analyze.py <project-dir>`) so the IDE can analyse while the
backend is busy running user code.  Standard library only.

Relationship rules (see docs/02 "Dein Punkt 5"):
- `class A(B)`                                  -> inheritance A -> B
- `self.x = B(...)` in a method                 -> composition, 1
- `self.x = param` with param annotated `B`     -> aggregation, 1
- `self.x: list[B]` / `self.x = []` + append(B) -> association, *
- `self.x: B | None` / `Optional[B]`            -> association, 0..1
- calls / isinstance / imports without storage  -> uses (dashed)
Only targets that are classes of this project become edges.
"""

from __future__ import annotations

import ast
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any

PY_EXTENSIONS = (".py",)
IGNORED_DIRS = {"__pycache__", ".git", ".venv", "venv", "node_modules", ".bluepy", ".idea", ".vscode"}

ABSTRACT_BASES = {"ABC", "abc.ABC", "ABCMeta"}
PROTOCOL_BASES = {"Protocol", "typing.Protocol"}
ENUM_BASES = {"Enum", "IntEnum", "StrEnum", "Flag", "IntFlag", "enum.Enum", "enum.IntEnum", "enum.StrEnum", "enum.Flag"}
TEST_BASES = {"TestCase", "unittest.TestCase"}
CONTAINER_NAMES = {"list", "List", "set", "Set", "frozenset", "FrozenSet", "tuple", "Tuple", "Sequence", "Iterable", "Collection", "deque"}
MAPPING_NAMES = {"dict", "Dict", "Mapping", "MutableMapping", "defaultdict", "OrderedDict"}
OPTIONAL_NAMES = {"Optional", "typing.Optional"}


# --------------------------------------------------------------------- model


@dataclass
class Param:
    name: str
    annotation: str | None = None
    default: str | None = None
    kind: str = "positional"  # positional | vararg | kwonly | kwarg

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "annotation": self.annotation, "default": self.default, "kind": self.kind}


@dataclass
class Method:
    name: str
    line: int
    params: list[Param]
    returns: str | None
    doc: str | None
    kind: str  # instance | static | classmethod | property
    visibility: str  # public | private | dunder
    is_abstract: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "line": self.line,
            "params": [p.to_dict() for p in self.params],
            "returns": self.returns,
            "doc": self.doc,
            "kind": self.kind,
            "visibility": self.visibility,
            "isAbstract": self.is_abstract,
        }


@dataclass
class Attribute:
    name: str
    line: int
    annotation: str | None
    source: str  # init | method | class
    target: str | None = None  # class id when resolved
    multiplicity: str | None = None  # "1" | "0..1" | "*"
    relation: str | None = None  # composition | aggregation | association

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "line": self.line,
            "annotation": self.annotation,
            "source": self.source,
            "target": self.target,
            "multiplicity": self.multiplicity,
            "relation": self.relation,
        }


@dataclass
class ClassInfo:
    id: str
    name: str
    module: str
    file: str
    line: int
    end_line: int
    bases: list[str]
    stereotype: str
    doc: str | None
    methods: list[Method] = field(default_factory=list)
    attributes: list[Attribute] = field(default_factory=list)
    decorators: list[str] = field(default_factory=list)
    uses: set[str] = field(default_factory=set)  # names referenced (resolved later)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "module": self.module,
            "file": self.file,
            "line": self.line,
            "endLine": self.end_line,
            "bases": self.bases,
            "stereotype": self.stereotype,
            "doc": self.doc,
            "methods": [m.to_dict() for m in self.methods],
            "attributes": [a.to_dict() for a in self.attributes],
            "decorators": self.decorators,
        }


@dataclass
class ModuleInfo:
    id: str
    file: str
    doc: str | None
    functions: list[Method]
    has_main: bool
    imports: list[str]
    error: dict[str, Any] | None = None
    uses: set[str] = field(default_factory=set)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "file": self.file,
            "doc": self.doc,
            "functions": [f.to_dict() for f in self.functions],
            "hasMain": self.has_main,
            "imports": self.imports,
            "error": self.error,
        }


# ------------------------------------------------------------------ helpers


def unparse(node: ast.AST | None) -> str | None:
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:  # noqa: BLE001
        return None


def dotted(node: ast.AST) -> str | None:
    """`a.b.C` -> "a.b.C", `C` -> "C", anything else -> None."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return f"{base}.{node.attr}" if base else None
    return None


def visibility_of(name: str) -> str:
    if name.startswith("__") and name.endswith("__"):
        return "dunder"
    if name.startswith("_"):
        return "private"
    return "public"


def module_name_for(rel_path: str) -> str:
    parts = rel_path.replace("\\", "/")[: -len(".py")].split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts) if parts else ""


def params_of(fn: ast.FunctionDef | ast.AsyncFunctionDef, skip_first: bool) -> list[Param]:
    args = fn.args
    result: list[Param] = []
    positional = list(args.posonlyargs) + list(args.args)
    defaults: list[ast.expr | None] = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
    for a, d in zip(positional, defaults, strict=True):
        result.append(Param(a.arg, unparse(a.annotation), unparse(d)))
    if args.vararg:
        result.append(Param(args.vararg.arg, unparse(args.vararg.annotation), None, "vararg"))
    for a, d in zip(args.kwonlyargs, args.kw_defaults, strict=True):
        result.append(Param(a.arg, unparse(a.annotation), unparse(d), "kwonly"))
    if args.kwarg:
        result.append(Param(args.kwarg.arg, unparse(args.kwarg.annotation), None, "kwarg"))
    if skip_first and result and result[0].kind == "positional":
        result = result[1:]
    return result


def method_of(fn: ast.FunctionDef | ast.AsyncFunctionDef, in_class: bool) -> Method:
    decorators = [dotted(d.func if isinstance(d, ast.Call) else d) or "" for d in fn.decorator_list]
    kind = "instance" if in_class else "function"
    if in_class:
        if "staticmethod" in decorators:
            kind = "static"
        elif "classmethod" in decorators:
            kind = "classmethod"
        elif "property" in decorators or any(d.endswith(".setter") for d in decorators):
            kind = "property"
    is_abstract = any(d in ("abstractmethod", "abc.abstractmethod") for d in decorators)
    skip_first = in_class and kind in ("instance", "classmethod", "property")
    return Method(
        name=fn.name,
        line=fn.lineno,
        params=params_of(fn, skip_first),
        returns=unparse(fn.returns),
        doc=ast.get_docstring(fn),
        kind=kind,
        visibility=visibility_of(fn.name),
        is_abstract=is_abstract,
    )


@dataclass
class TypeRef:
    """Result of reading a type annotation: the named class and its multiplicity."""

    name: str | None
    multiplicity: str  # "1" | "0..1" | "*"


def read_annotation(node: ast.AST | None) -> TypeRef:
    if node is None:
        return TypeRef(None, "1")
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        try:
            return read_annotation(ast.parse(node.value, mode="eval").body)
        except SyntaxError:
            return TypeRef(None, "1")
    name = dotted(node)
    if name is not None:
        return TypeRef(name, "1")
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):  # X | None
        left, right = read_annotation(node.left), read_annotation(node.right)
        parts = [p for p in (left, right) if p.name not in (None, "None")]
        none_in = any(p.name == "None" for p in (left, right)) or isinstance(node.right, ast.Constant) and node.right.value is None
        if len(parts) == 1:
            p = parts[0]
            return TypeRef(p.name, "0..1" if none_in and p.multiplicity == "1" else p.multiplicity)
        return TypeRef(None, "1")
    if isinstance(node, ast.Subscript):
        outer = dotted(node.value) or ""
        base = outer.split(".")[-1]
        inner_nodes: list[ast.AST] = list(node.slice.elts) if isinstance(node.slice, ast.Tuple) else [node.slice]
        if base in OPTIONAL_NAMES or outer in OPTIONAL_NAMES:
            inner = read_annotation(inner_nodes[0])
            return TypeRef(inner.name, "0..1" if inner.multiplicity == "1" else inner.multiplicity)
        if base in CONTAINER_NAMES:
            inner = read_annotation(inner_nodes[0])
            return TypeRef(inner.name, "*")
        if base in MAPPING_NAMES and len(inner_nodes) >= 2:
            inner = read_annotation(inner_nodes[1])
            return TypeRef(inner.name, "*")
        if base in ("Union",):
            parts = [read_annotation(n) for n in inner_nodes]
            named = [p for p in parts if p.name not in (None, "None")]
            if len(named) == 1:
                return TypeRef(named[0].name, "0..1" if len(parts) > len(named) else named[0].multiplicity)
    return TypeRef(None, "1")


def is_empty_container(node: ast.AST) -> bool:
    if isinstance(node, (ast.List, ast.Dict, ast.Set)) and not getattr(node, "elts", None) and not getattr(node, "keys", None):
        return True
    if isinstance(node, ast.Call):
        name = dotted(node.func)
        return name in ("list", "dict", "set", "collections.deque", "deque") and not node.args
    return False


# ---------------------------------------------------------------- analysis


class ClassCollector(ast.NodeVisitor):
    """Collects attributes and used names inside one class body."""

    def __init__(self, cls: ClassInfo, param_types: dict[str, dict[str, str | None]]) -> None:
        self.cls = cls
        self.param_types = param_types  # method name -> {param: annotation}
        self.current_method: str | None = None
        self.attrs: dict[str, Attribute] = {}
        self.locals: dict[str, str] = {}  # local variable -> class name it was constructed from

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        previous, self.current_method = self.current_method, node.name
        previous_locals, self.locals = self.locals, {}
        self.generic_visit(node)
        self.current_method = previous
        self.locals = previous_locals

    def _class_of_name(self, name: str) -> tuple[str | None, str | None, str]:
        """(class name, relation, multiplicity) for a plain name used as a value inside the current method."""
        if name in self.locals:
            return self.locals[name], "composition", "1"
        if self.current_method:
            ann = self.param_types.get(self.current_method, {}).get(name)
            if ann:
                ref = read_annotation(ast.parse(ann, mode="eval").body)
                return ref.name, "aggregation", ref.multiplicity
        return None, None, "1"

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    def _note(self, name: str, line: int, annotation: ast.AST | None, value: ast.AST | None) -> None:
        source = "init" if self.current_method == "__init__" else "method"
        attr = self.attrs.get(name)
        if attr is None:
            attr = Attribute(name=name, line=line, annotation=unparse(annotation), source=source)
            self.attrs[name] = attr
        elif annotation is not None and attr.annotation is None:
            attr.annotation = unparse(annotation)

        if annotation is not None:
            ref = read_annotation(annotation)
            if ref.name:
                attr.target = ref.name
                attr.multiplicity = ref.multiplicity
                attr.relation = attr.relation or "association"

        if value is None:
            return
        if isinstance(value, ast.Call):
            callee = dotted(value.func)
            if callee and not is_empty_container(value):
                attr.target = attr.target or callee
                attr.multiplicity = attr.multiplicity or "1"
                attr.relation = "composition"
                return
        if is_empty_container(value):
            attr.multiplicity = "*"
            attr.relation = attr.relation or "association"
            return
        if isinstance(value, ast.Name) and self.current_method:
            cls_name, relation, multiplicity = self._class_of_name(value.id)
            if cls_name:
                attr.target = attr.target or cls_name
                attr.multiplicity = attr.multiplicity or multiplicity
                attr.relation = relation
            return
        if isinstance(value, ast.Attribute) and isinstance(value.value, ast.Name) and value.value.id[:1].isupper():
            # self.status = Status.OFFEN -> association to the (enum) class Status
            attr.target = attr.target or value.value.id
            attr.multiplicity = attr.multiplicity or "1"
            attr.relation = attr.relation or "association"
            return
        if isinstance(value, ast.Constant) and value.value is None:
            if attr.multiplicity in (None, "1"):
                attr.multiplicity = "0..1"
            return
        if isinstance(value, (ast.List, ast.Set, ast.Tuple)) and value.elts:
            first = value.elts[0]
            if isinstance(first, ast.Call) and dotted(first.func):
                attr.target = attr.target or dotted(first.func)
                attr.multiplicity = "*"
                attr.relation = "composition"

    def visit_Assign(self, node: ast.Assign) -> None:  # noqa: N802
        if (
            self.current_method
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Call)
            and dotted(node.value.func)
        ):
            self.locals[node.targets[0].id] = dotted(node.value.func) or ""
        for target in node.targets:
            if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self":
                self._note(target.attr, node.lineno, None, node.value)
            elif isinstance(target, ast.Tuple):
                for elt in target.elts:
                    if isinstance(elt, ast.Attribute) and isinstance(elt.value, ast.Name) and elt.value.id == "self":
                        self._note(elt.attr, node.lineno, None, None)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:  # noqa: N802
        target = node.target
        if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self":
            self._note(target.attr, node.lineno, node.annotation, node.value)
        elif isinstance(target, ast.Name) and self.current_method is None:
            # class-level annotation (dataclass field or declared attribute)
            attr = self.attrs.get(target.id)
            if attr is None:
                attr = Attribute(name=target.id, line=node.lineno, annotation=unparse(node.annotation), source="class")
                self.attrs[target.id] = attr
            ref = read_annotation(node.annotation)
            if ref.name:
                attr.target, attr.multiplicity, attr.relation = ref.name, ref.multiplicity, "association"
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        callee = dotted(node.func)
        if callee:
            self.cls.uses.add(callee.split(".")[0] if "." in callee and not callee.startswith("self.") else callee)
        # self.items.append(Thing(...)) -> target of the container attribute
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr in ("append", "add", "insert", "extend")
            and isinstance(node.func.value, ast.Attribute)
            and isinstance(node.func.value.value, ast.Name)
            and node.func.value.value.id == "self"
            and node.args
        ):
            attr = self.attrs.get(node.func.value.attr)
            arg = node.args[-1]
            if attr is not None:
                attr.multiplicity = "*"
                if isinstance(arg, ast.Call) and dotted(arg.func):
                    attr.target = attr.target or dotted(arg.func)
                    attr.relation = "composition"
                elif isinstance(arg, ast.Name) and self.current_method:
                    cls_name, relation, _multiplicity = self._class_of_name(arg.id)
                    if cls_name:
                        attr.target = attr.target or cls_name
                        attr.relation = relation if relation == "composition" else (attr.relation or relation)
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:  # noqa: N802
        if isinstance(node.ctx, ast.Load):
            self.cls.uses.add(node.id)


def stereotype_of(node: ast.ClassDef, bases: list[str], methods: list[Method]) -> str:
    decorators = [dotted(d.func if isinstance(d, ast.Call) else d) or "" for d in node.decorator_list]
    if any(b in TEST_BASES for b in bases):
        return "unittest"
    if any(b in ENUM_BASES for b in bases):
        return "enum"
    if any(b in PROTOCOL_BASES for b in bases):
        return "interface"
    if any(d in ("dataclass", "dataclasses.dataclass") for d in decorators):
        return "dataclass"
    if any(b in ABSTRACT_BASES for b in bases) or any(m.is_abstract for m in methods):
        return "abstract"
    if any(b in ("Exception", "BaseException") or b.endswith("Error") or b.endswith("Exception") for b in bases):
        return "exception"
    return "class"


def analyze_module(rel_path: str, source: str) -> tuple[ModuleInfo, list[ClassInfo]]:
    module_id = module_name_for(rel_path)
    try:
        tree = ast.parse(source, filename=rel_path)
    except SyntaxError as exc:
        info = ModuleInfo(module_id, rel_path, None, [], False, [], {"message": exc.msg, "line": exc.lineno, "offset": exc.offset})
        return info, []

    imports: list[str] = []
    functions: list[Method] = []
    classes: list[ClassInfo] = []
    has_main = False
    module_uses: set[str] = set()

    for node in tree.body:
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = ("." * node.level) + (node.module or "")
            imports.append(base)
            for alias in node.names:
                module_uses.add(alias.asname or alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append(method_of(node, in_class=False))
        elif isinstance(node, ast.If):
            test = unparse(node.test) or ""
            if "__name__" in test and "__main__" in test:
                has_main = True
        elif isinstance(node, ast.ClassDef):
            bases = [dotted(b) or (unparse(b) or "?") for b in node.bases]
            methods = [method_of(n, in_class=True) for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
            cls = ClassInfo(
                id=f"{module_id}.{node.name}" if module_id else node.name,
                name=node.name,
                module=module_id,
                file=rel_path,
                line=node.lineno,
                end_line=getattr(node, "end_lineno", node.lineno),
                bases=bases,
                stereotype=stereotype_of(node, bases, methods),
                doc=ast.get_docstring(node),
                methods=methods,
                decorators=[dotted(d.func if isinstance(d, ast.Call) else d) or "" for d in node.decorator_list],
            )
            param_types = {
                m.name: {p.name: p.annotation for p in m.params if p.annotation} for m in methods
            }
            collector = ClassCollector(cls, param_types)
            collector.visit(node)
            cls.attributes = list(collector.attrs.values())
            classes.append(cls)

    # names used at module level (outside classes) count as module uses
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            callee = dotted(node.func)
            if callee:
                module_uses.add(callee.split(".")[0])
    info = ModuleInfo(module_id, rel_path, ast.get_docstring(tree), functions, has_main, imports, uses=module_uses)
    return info, classes


def collect_files(root: str) -> list[str]:
    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if name.endswith(PY_EXTENSIONS):
                found.append(os.path.relpath(os.path.join(dirpath, name), root).replace("\\", "/"))
    return found


def resolve_edges(modules: list[ModuleInfo], classes: list[ClassInfo]) -> list[dict[str, Any]]:
    by_name: dict[str, list[ClassInfo]] = {}
    by_id: dict[str, ClassInfo] = {}
    for c in classes:
        by_name.setdefault(c.name, []).append(c)
        by_id[c.id] = c

    def resolve(name: str | None, from_module: str) -> ClassInfo | None:
        if not name:
            return None
        if name in by_id:
            return by_id[name]
        simple = name.split(".")[-1]
        candidates = by_name.get(simple, [])
        if not candidates:
            return None
        same_module = [c for c in candidates if c.module == from_module]
        return (same_module or candidates)[0]

    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    def add(kind: str, src: str, dst: str, **extra: Any) -> None:
        key = (kind, src, dst) if kind != "association" else (kind, src, dst + ":" + str(extra.get("role")))
        if key in seen or src == dst:
            return
        seen.add(key)
        edges.append({"kind": kind, "from": src, "to": dst, **extra})

    for c in classes:
        for base in c.bases:
            target = resolve(base, c.module)
            if target:
                add("inheritance", c.id, target.id)
        for attr in c.attributes:
            target = resolve(attr.target, c.module)
            if target:
                attr.target = target.id
                add(
                    "association",
                    c.id,
                    target.id,
                    role=attr.name,
                    multiplicity=attr.multiplicity or "1",
                    relation=attr.relation or "association",
                )
            else:
                attr.target = None
                attr.relation = None
    related = {(e["from"], e["to"]) for e in edges}
    for c in classes:
        for used in sorted(c.uses):
            target = resolve(used, c.module)
            if target and (c.id, target.id) not in related:
                add("uses", c.id, target.id)
    classes_per_module = {c.module for c in classes}
    for m in modules:
        if not m.id or m.id in classes_per_module:
            continue  # modules with classes are represented by their classes
        for used in sorted(m.uses):
            target = resolve(used, m.id)
            if target and target.module != m.id:
                add("uses", f"module:{m.id}", target.id)
    return edges


def analyze_project(root: str) -> dict[str, Any]:
    modules: list[ModuleInfo] = []
    classes: list[ClassInfo] = []
    for rel in collect_files(root):
        try:
            with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as f:
                source = f.read()
        except OSError as exc:
            modules.append(ModuleInfo(module_name_for(rel), rel, None, [], False, [], {"message": str(exc), "line": None, "offset": None}))
            continue
        info, found = analyze_module(rel, source)
        modules.append(info)
        classes.extend(found)
    edges = resolve_edges(modules, classes)
    return {
        "root": root,
        "modules": [m.to_dict() for m in modules],
        "classes": [c.to_dict() for c in classes],
        "edges": edges,
    }


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: analyze.py <project-dir>", file=sys.stderr)
        return 2
    model = analyze_project(os.path.abspath(args[0]))
    sys.stdout.write(json.dumps(model, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
