from typing import Any


class BaumKnoten:
    """Knoten eines binären Suchbaums: links kleiner, rechts größer."""

    def __init__(self, wert: Any) -> None:
        self.wert = wert
        self.links: BaumKnoten | None = None
        self.rechts: BaumKnoten | None = None

    def __repr__(self) -> str:
        return f"BaumKnoten({self.wert!r})"


class Suchbaum:
    """Binärer Suchbaum mit rekursivem Einfügen, Suchen und Traversierung."""

    def __init__(self) -> None:
        self.wurzel: BaumKnoten | None = None

    def einfuegen(self, wert: Any) -> None:
        if self.wurzel is None:
            self.wurzel = BaumKnoten(wert)
        else:
            self._einfuegen(self.wurzel, wert)

    def _einfuegen(self, knoten: BaumKnoten, wert: Any) -> None:
        if wert < knoten.wert:
            if knoten.links is None:
                knoten.links = BaumKnoten(wert)
            else:
                self._einfuegen(knoten.links, wert)
        elif wert > knoten.wert:
            if knoten.rechts is None:
                knoten.rechts = BaumKnoten(wert)
            else:
                self._einfuegen(knoten.rechts, wert)

    def enthaelt(self, wert: Any) -> bool:
        knoten = self.wurzel
        while knoten is not None:
            if wert == knoten.wert:
                return True
            knoten = knoten.links if wert < knoten.wert else knoten.rechts
        return False

    def inorder(self) -> list[Any]:
        """Links – Wurzel – Rechts: liefert die Werte sortiert."""
        werte: list[Any] = []
        self._inorder(self.wurzel, werte)
        return werte

    def _inorder(self, knoten: BaumKnoten | None, werte: list[Any]) -> None:
        if knoten is None:
            return
        self._inorder(knoten.links, werte)
        werte.append(knoten.wert)
        self._inorder(knoten.rechts, werte)

    def hoehe(self) -> int:
        return self._hoehe(self.wurzel)

    def _hoehe(self, knoten: BaumKnoten | None) -> int:
        if knoten is None:
            return 0
        return 1 + max(self._hoehe(knoten.links), self._hoehe(knoten.rechts))
