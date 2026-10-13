"""Verschlüsselung: ein gemeinsames Interface, mehrere Verfahren (Strategie-Muster)."""

from abc import ABC, abstractmethod

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


class Verfahren(ABC):
    """Jedes Verfahren kann verschlüsseln und entschlüsseln."""

    @abstractmethod
    def verschluesseln(self, klartext: str) -> str: ...

    @abstractmethod
    def entschluesseln(self, geheimtext: str) -> str: ...

    @staticmethod
    def normalisieren(text: str) -> str:
        """Nur Großbuchstaben A–Z, Umlaute aufgelöst, alles andere bleibt stehen."""
        text = text.upper().replace("Ä", "AE").replace("Ö", "OE").replace("Ü", "UE").replace("ß", "SS")
        return text


class Caesar(Verfahren):
    """Jeder Buchstabe wird um `schluessel` Stellen im Alphabet verschoben."""

    def __init__(self, schluessel: int) -> None:
        self.schluessel = schluessel % 26

    def _verschieben(self, text: str, um: int) -> str:
        ergebnis = ""
        for zeichen in self.normalisieren(text):
            if zeichen in ALPHABET:
                index = (ALPHABET.index(zeichen) + um) % 26
                ergebnis += ALPHABET[index]
            else:
                ergebnis += zeichen
        return ergebnis

    def verschluesseln(self, klartext: str) -> str:
        return self._verschieben(klartext, self.schluessel)

    def entschluesseln(self, geheimtext: str) -> str:
        return self._verschieben(geheimtext, -self.schluessel)

    def __repr__(self) -> str:
        return f"Caesar({self.schluessel})"


class Vigenere(Verfahren):
    """Wie Caesar, aber die Verschiebung wechselt mit jedem Buchstaben des Schlüsselworts."""

    def __init__(self, schluesselwort: str) -> None:
        wort = "".join(z for z in self.normalisieren(schluesselwort) if z in ALPHABET)
        if not wort:
            raise ValueError("Schlüsselwort braucht mindestens einen Buchstaben")
        self.schluesselwort = wort

    def _codieren(self, text: str, richtung: int) -> str:
        ergebnis = ""
        position = 0
        for zeichen in self.normalisieren(text):
            if zeichen in ALPHABET:
                verschiebung = ALPHABET.index(self.schluesselwort[position % len(self.schluesselwort)])
                index = (ALPHABET.index(zeichen) + richtung * verschiebung) % 26
                ergebnis += ALPHABET[index]
                position += 1
            else:
                ergebnis += zeichen
        return ergebnis

    def verschluesseln(self, klartext: str) -> str:
        return self._codieren(klartext, +1)

    def entschluesseln(self, geheimtext: str) -> str:
        return self._codieren(geheimtext, -1)

    def __repr__(self) -> str:
        return f"Vigenere({self.schluesselwort!r})"
