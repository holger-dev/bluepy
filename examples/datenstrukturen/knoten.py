"""Datenstrukturen (Abitur-Stoff): Knoten als Baustein für Listen, Stapel, Schlangen und Bäume."""

from typing import Any


class Knoten:
    """Ein Knoten speichert einen Wert und kennt seinen Nachfolger."""

    def __init__(self, wert: Any) -> None:
        self.wert = wert
        self.naechster: Knoten | None = None

    def __repr__(self) -> str:
        return f"Knoten({self.wert!r})"
