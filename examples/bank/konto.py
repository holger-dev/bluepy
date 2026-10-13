from person import Person


class Konto:
    """Ein einfaches Bankkonto mit Inhaber und Kontostand."""

    zinssatz = 0.01

    def __init__(self, inhaber: Person, stand: float = 0.0):
        self.inhaber = inhaber
        self.stand = stand
        self.buchungen: list[float] = []

    def einzahlen(self, betrag: float) -> None:
        """Zahlt einen positiven Betrag ein."""
        if betrag <= 0:
            raise ValueError("Betrag muss positiv sein")
        self.stand += betrag
        self.buchungen.append(betrag)

    def abheben(self, betrag: float) -> bool:
        """Hebt ab, wenn genug Geld da ist. Gibt True bei Erfolg zurück."""
        if betrag > self.stand:
            return False
        self.stand -= betrag
        self.buchungen.append(-betrag)
        return True

    def kontostand(self) -> float:
        return self.stand

    def __repr__(self) -> str:
        return f"Konto({self.inhaber.name!r}, {self.stand:.2f})"
