"""Objektorientierung: eine abstrakte Oberklasse mit gemeinsamen Attributen und Methoden."""

from abc import ABC, abstractmethod


class Tier(ABC):
    """Jedes Tier hat einen Namen, ein Alter und Hunger. Wie es sich meldet, bestimmt die Unterklasse."""

    def __init__(self, name: str, alter: int) -> None:
        self.name = name
        self.alter = alter
        self.hunger = 5  # 0 = satt, 10 = sehr hungrig

    @abstractmethod
    def laut(self) -> str:
        """Der typische Laut des Tiers – jede Unterklasse muss das selbst festlegen."""

    def fressen(self, menge: int) -> None:
        """Verringert den Hunger, aber nie unter 0."""
        self.hunger = max(0, self.hunger - menge)

    def ist_hungrig(self) -> bool:
        return self.hunger >= 7

    def beschreibung(self) -> str:
        """Gemeinsam für alle Tiere – nutzt die Methode laut(), die jede Unterklasse anders füllt."""
        return f"{self.name} ({type(self).__name__}, {self.alter} Jahre) sagt {self.laut()}"

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.name!r}, {self.alter})"
