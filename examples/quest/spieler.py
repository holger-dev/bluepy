from abzeichen import ERSTE_QUEST, LEVEL_3, SCHWER_GELOEST, SERIE_3, Abzeichen, Schwierigkeit
from quest import Quest


class Spieler:
    """Sammelt XP, steigt Level auf und bekommt Abzeichen."""

    XP_PRO_LEVEL = 50

    def __init__(self, name: str) -> None:
        self.name = name
        self.xp = 0
        self.abzeichen: set[Abzeichen] = set()
        self.geloeste: list[Quest] = []
        self.serie = 0

    @property
    def level(self) -> int:
        """Level 1 ab 0 XP, Level 2 ab 50 XP, Level 3 ab 100 XP …"""
        return self.xp // self.XP_PRO_LEVEL + 1

    def xp_bis_naechstes_level(self) -> int:
        return self.XP_PRO_LEVEL - self.xp % self.XP_PRO_LEVEL

    def loesen(self, quest: Quest, antwort: str) -> bool:
        """Versucht eine Quest. Richtig → XP, Serie und evtl. Abzeichen; falsch → Serie bricht ab."""
        if not quest.pruefen(antwort):
            self.serie = 0
            return False
        self.xp += quest.xp
        self.serie += 1
        self.geloeste.append(quest)
        self._abzeichen_pruefen(quest)
        return True

    def _abzeichen_pruefen(self, quest: Quest) -> None:
        if len(self.geloeste) == 1:
            self.abzeichen.add(ERSTE_QUEST)
        if self.level >= 3:
            self.abzeichen.add(LEVEL_3)
        if quest.schwierigkeit is Schwierigkeit.SCHWER:
            self.abzeichen.add(SCHWER_GELOEST)
        if self.serie >= 3:
            self.abzeichen.add(SERIE_3)

    def fortschritt(self) -> str:
        balken = "█" * (self.xp % self.XP_PRO_LEVEL * 20 // self.XP_PRO_LEVEL)
        return f"{self.name}: Level {self.level} [{balken:<20}] {self.xp} XP, {len(self.abzeichen)} Abzeichen"

    def __repr__(self) -> str:
        return f"Spieler({self.name!r}, Level {self.level}, {self.xp} XP)"
