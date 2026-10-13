"""Gamification: Abzeichen (Badges) als Dataclass und Schwierigkeit als Enum."""

from dataclasses import dataclass
from enum import Enum


class Schwierigkeit(Enum):
    LEICHT = 10
    MITTEL = 25
    SCHWER = 50

    @property
    def xp(self) -> int:
        """Erfahrungspunkte, die eine Quest dieser Schwierigkeit bringt."""
        return self.value


@dataclass(frozen=True)
class Abzeichen:
    """Ein Abzeichen ist unveränderlich (frozen) und lässt sich deshalb in einem Set sammeln."""

    name: str
    beschreibung: str
    symbol: str = "★"

    def __str__(self) -> str:
        return f"{self.symbol} {self.name}"


ERSTE_QUEST = Abzeichen("Erste Schritte", "Die erste Quest geschafft", "🥾")
LEVEL_3 = Abzeichen("Aufsteiger", "Level 3 erreicht", "⬆")
SCHWER_GELOEST = Abzeichen("Mutig", "Eine schwere Quest gelöst", "🔥")
SERIE_3 = Abzeichen("Serie", "Drei Quests hintereinander richtig", "⚡")
