from typing import Any

from knoten import Knoten


class Schlange:
    """Queue – FIFO: wer zuerst kommt, wird zuerst bedient."""

    def __init__(self) -> None:
        self.kopf: Knoten | None = None
        self.ende: Knoten | None = None
        self.anzahl = 0

    def ist_leer(self) -> bool:
        return self.kopf is None

    def enqueue(self, wert: Any) -> None:
        knoten = Knoten(wert)
        if self.ende is None:
            self.kopf = knoten
        else:
            self.ende.naechster = knoten
        self.ende = knoten
        self.anzahl += 1

    def dequeue(self) -> Any:
        if self.kopf is None:
            raise IndexError("dequeue von leerer Schlange")
        knoten = self.kopf
        self.kopf = knoten.naechster
        if self.kopf is None:
            self.ende = None
        self.anzahl -= 1
        return knoten.wert

    def vorne(self) -> Any:
        if self.kopf is None:
            raise IndexError("leere Schlange")
        return self.kopf.wert

    def __repr__(self) -> str:
        werte = []
        knoten = self.kopf
        while knoten is not None:
            werte.append(knoten.wert)
            knoten = knoten.naechster
        return f"Schlange(vorne → {werte})"
