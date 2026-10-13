from typing import Any

from knoten import Knoten


class Stapel:
    """Stack – LIFO: das zuletzt gelegte Element kommt zuerst wieder herunter."""

    def __init__(self) -> None:
        self.oben: Knoten | None = None
        self.anzahl = 0

    def ist_leer(self) -> bool:
        return self.oben is None

    def push(self, wert: Any) -> None:
        knoten = Knoten(wert)
        knoten.naechster = self.oben
        self.oben = knoten
        self.anzahl += 1

    def pop(self) -> Any:
        if self.oben is None:
            raise IndexError("pop von leerem Stapel")
        knoten = self.oben
        self.oben = knoten.naechster
        self.anzahl -= 1
        return knoten.wert

    def top(self) -> Any:
        if self.oben is None:
            raise IndexError("top von leerem Stapel")
        return self.oben.wert

    def __repr__(self) -> str:
        werte = []
        knoten = self.oben
        while knoten is not None:
            werte.append(knoten.wert)
            knoten = knoten.naechster
        return f"Stapel(oben → {werte})"


def klammern_ausgeglichen(text: str) -> bool:
    """Klassische Stapel-Anwendung: sind alle (), [] und {} richtig geschachtelt?"""
    paare = {")": "(", "]": "[", "}": "{"}
    stapel = Stapel()
    for zeichen in text:
        if zeichen in "([{":
            stapel.push(zeichen)
        elif zeichen in paare:
            if stapel.ist_leer() or stapel.pop() != paare[zeichen]:
                return False
    return stapel.ist_leer()
