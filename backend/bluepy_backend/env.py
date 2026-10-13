"""Information about the interpreter the backend is running in."""

from __future__ import annotations

import os
import platform
import sys
from typing import Any


def has_module(name: str) -> bool:
    try:
        __import__(name)
    except Exception:  # noqa: BLE001 - any import failure means "not usable"
        return False
    return True


def env_info() -> dict[str, Any]:
    info = sys.version_info
    return {
        "version": f"{info.major}.{info.minor}.{info.micro}",
        "versionInfo": [info.major, info.minor, info.micro],
        "executable": sys.executable,
        "implementation": platform.python_implementation(),
        "platform": sys.platform,
        "platformDetails": platform.platform(),
        "machine": platform.machine(),
        "prefix": sys.prefix,
        "basePrefix": sys.base_prefix,
        "isVenv": sys.prefix != sys.base_prefix,
        "hasTkinter": has_module("tkinter"),
        "hasVenv": has_module("venv"),
        "hasPip": has_module("pip"),
        "cwd": os.getcwd(),
        "sysPath": list(sys.path),
    }


def python_summary() -> dict[str, Any]:
    info = sys.version_info
    return {
        "version": f"{info.major}.{info.minor}.{info.micro}",
        "executable": sys.executable,
        "implementation": platform.python_implementation(),
        "platform": sys.platform,
    }
