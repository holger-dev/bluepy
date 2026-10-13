from abc import ABC, abstractmethod
from enum import Enum

from konto import Konto


class Status(Enum):
    OFFEN = "offen"
    AUSGEFUEHRT = "ausgeführt"
    ABGELEHNT = "abgelehnt"


class Transaktion(ABC):
    """Abstrakte Basisklasse für alle Buchungen."""

    def __init__(self, betrag: float):
        self.betrag = betrag
        self.status = Status.OFFEN

    @abstractmethod
    def ausfuehren(self) -> bool:
        ...


class Ueberweisung(Transaktion):
    def __init__(self, von: Konto, nach: Konto, betrag: float):
        super().__init__(betrag)
        self.von = von
        self.nach = nach

    def ausfuehren(self) -> bool:
        if self.von.abheben(self.betrag):
            self.nach.einzahlen(self.betrag)
            self.status = Status.AUSGEFUEHRT
            return True
        self.status = Status.ABGELEHNT
        return False
