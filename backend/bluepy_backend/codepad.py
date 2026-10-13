"""Code Pad evaluation: expressions give a value, statements are executed."""

from __future__ import annotations

import os
import traceback
from typing import Any

from .errors import HaltRequested

MAX_REPR_LENGTH = 10_000
CODEPAD_FILENAME = "<codepad>"
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def safe_repr(value: Any, limit: int = MAX_REPR_LENGTH) -> tuple[str, bool]:
    try:
        text = repr(value)
    except Exception as exc:  # noqa: BLE001 - user __repr__ may do anything
        return f"<repr() failed: {type(exc).__name__}: {exc}>", False
    if len(text) > limit:
        return text[:limit] + "…", True
    return text, False


def describe_value(value: Any) -> dict[str, Any]:
    text, truncated = safe_repr(value)
    cls = type(value)
    return {
        "repr": text,
        "truncated": truncated,
        "type": cls.__name__,
        "typeModule": cls.__module__,
        "isNone": value is None,
        "objectId": id(value),
    }


def _is_backend_frame(filename: str) -> bool:
    try:
        return os.path.abspath(filename).startswith(_BACKEND_DIR)
    except (TypeError, ValueError):
        return False


def format_exception(exc: BaseException) -> dict[str, Any]:
    """Render an exception with backend-internal frames removed."""
    te = traceback.TracebackException.from_exception(exc)
    te.stack = traceback.StackSummary.from_list(
        [frame for frame in te.stack if not _is_backend_frame(frame.filename)]
    )
    result: dict[str, Any] = {
        "type": type(exc).__name__,
        "message": str(exc),
        "traceback": "".join(te.format()),
    }
    if isinstance(exc, SyntaxError):
        result["line"] = exc.lineno
        result["offset"] = exc.offset
        result["message"] = exc.msg or str(exc)
    return result


def evaluate(code: str, namespace: dict[str, Any]) -> dict[str, Any]:
    """Evaluate Code Pad input in `namespace`.

    Returns a result dict (see docs/03-rpc-protokoll.md).  Runtime errors are
    part of the result, not RPC errors; a Halt propagates.
    """
    source = code.rstrip("\n")
    kind = "expression"
    try:
        compiled = compile(source, CODEPAD_FILENAME, "eval")
    except SyntaxError:
        kind = "statement"
        try:
            compiled = compile(source, CODEPAD_FILENAME, "exec")
        except SyntaxError as exc:
            return {"kind": "error", "error": format_exception(exc)}

    try:
        if kind == "expression":
            value = eval(compiled, namespace)  # noqa: S307 - that is the point of a code pad
            namespace["_"] = value
            return {"kind": kind, "value": describe_value(value)}
        exec(compiled, namespace)  # noqa: S102
        return {"kind": kind}
    except HaltRequested:
        raise
    except BaseException as exc:  # noqa: BLE001 - includes SystemExit/KeyboardInterrupt
        return {"kind": kind, "error": format_exception(exc)}
