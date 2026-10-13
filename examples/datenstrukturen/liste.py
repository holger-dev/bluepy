from typing import Any

from knoten import Knoten


class VerketteteListe:
    """Einfach verkettete Liste mit Einfügen, Suchen, Löschen – ohne Python-Listen."""

    def __init__(self) -> None:
        self.anfang: Knoten | None = None

    def anhaengen(self, wert: Any) -> None:
        knoten = Knoten(wert)
        if self.anfang is None:
            self.anfang = knoten
            return
        aktuell = self.anfang
        while aktuell.naechster is not None:
            aktuell = aktuell.naechster
        aktuell.naechster = knoten

    def einfuegen_vorne(self, wert: Any) -> None:
        knoten = Knoten(wert)
        knoten.naechster = self.anfang
        self.anfang = knoten

    def laenge(self) -> int:
        n = 0
        aktuell = self.anfang
        while aktuell is not None:
            n += 1
            aktuell = aktuell.naechster
        return n

    def enthaelt(self, wert: Any) -> bool:
        aktuell = self.anfang
        while aktuell is not None:
            if aktuell.wert == wert:
                return True
            aktuell = aktuell.naechster
        return False

    def entfernen(self, wert: Any) -> bool:
        """Entfernt das erste Vorkommen; True, wenn etwas entfernt wurde."""
        vorher: Knoten | None = None
        aktuell = self.anfang
        while aktuell is not None:
            if aktuell.wert == wert:
                if vorher is None:
                    self.anfang = aktuell.naechster
                else:
                    vorher.naechster = aktuell.naechster
                return True
            vorher, aktuell = aktuell, aktuell.naechster
        return False

    def als_python_liste(self) -> list[Any]:
        werte = []
        aktuell = self.anfang
        while aktuell is not None:
            werte.append(aktuell.wert)
            aktuell = aktuell.naechster
        return werte

    def __repr__(self) -> str:
        return " → ".join(repr(w) for w in self.als_python_liste()) or "(leer)"
