from abzeichen import Schwierigkeit


class Quest:
    """Eine Aufgabe mit Frage, erwarteter Antwort und Schwierigkeit."""

    def __init__(self, titel: str, frage: str, antwort: str, schwierigkeit: Schwierigkeit) -> None:
        self.titel = titel
        self.frage = frage
        self.antwort = antwort
        self.schwierigkeit = schwierigkeit
        self.versuche = 0

    def pruefen(self, eingabe: str) -> bool:
        """Vergleicht ohne Groß/Klein und Leerzeichen am Rand."""
        self.versuche += 1
        return eingabe.strip().lower() == self.antwort.strip().lower()

    @property
    def xp(self) -> int:
        """Beim ersten Versuch gibt es volle Punkte, danach die Hälfte."""
        volle = self.schwierigkeit.xp
        return volle if self.versuche <= 1 else volle // 2

    def __repr__(self) -> str:
        return f"Quest({self.titel!r}, {self.schwierigkeit.name})"
