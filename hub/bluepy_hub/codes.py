"""Codes and keys.  No 0/O/1/I in anything a learner has to type."""
from __future__ import annotations

import hashlib
import re
import secrets

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def random_code(length: int) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def personal_code() -> str:
    return random_code(6)


def task_word(title: str) -> str:
    """First word of the title as an ASCII prefix (KONTO, BANK, …), 3–8 characters."""
    cleaned = title.upper().replace("Ä", "AE").replace("Ö", "OE").replace("Ü", "UE").replace("ß", "SS")
    words = re.findall(r"[A-Z0-9]+", cleaned)
    word = next((w for w in words if len(w) >= 3), words[0] if words else "AUFGABE")
    return word[:8]


def task_code(title: str) -> str:
    return f"{task_word(title)}-{random_code(4)}"


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9-]", "", code.strip().upper())


def teacher_key() -> str:
    return secrets.token_urlsafe(24)


def key_hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()
