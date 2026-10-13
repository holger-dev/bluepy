"""Das Quest-Spiel: Fragen beantworten, XP sammeln, Level aufsteigen. Rechtsklick → Modul ausführen."""

from abzeichen import Schwierigkeit
from quest import Quest
from spieler import Spieler


class Spiel:
    """Hält die Quests und einen Spieler, bietet eine Runde nach der anderen an."""

    def __init__(self, spieler: Spieler) -> None:
        self.spieler = spieler
        self.quests: list[Quest] = [
            Quest("Starter", "Was gibt 2 ** 3 in Python?", "8", Schwierigkeit.LEICHT),
            Quest("Listen", "Welche Methode hängt ein Element an eine Liste an?", "append", Schwierigkeit.LEICHT),
            Quest("Schleifen", "Mit welchem Schlüsselwort bricht man eine Schleife ab?", "break", Schwierigkeit.MITTEL),
            Quest("Strings", "Was ist 'abc'[::-1]?", "cba", Schwierigkeit.MITTEL),
            Quest("OOP", "Wie heißt die Methode, die beim Erzeugen eines Objekts läuft?", "__init__", Schwierigkeit.SCHWER),
        ]
        self.offen = list(self.quests)

    def naechste(self) -> Quest | None:
        return self.offen[0] if self.offen else None

    def antworten(self, antwort: str) -> str:
        quest = self.naechste()
        if quest is None:
            return "Alle Quests gelöst!"
        if self.spieler.loesen(quest, antwort):
            self.offen.pop(0)
            return f"Richtig! +{quest.xp} XP → {self.spieler.fortschritt()}"
        return f"Leider falsch ({quest.versuche}. Versuch). Noch mal!"

    def spielen(self) -> None:
        print(f"Willkommen, {self.spieler.name}! {len(self.quests)} Quests warten.")
        while (quest := self.naechste()) is not None:
            print(f"\n[{quest.schwierigkeit.name}] {quest.titel}: {quest.frage}")
            print(self.antworten(input("> ")))
        print("\nDeine Abzeichen:", ", ".join(str(a) for a in self.spieler.abzeichen) or "keine")


if __name__ == "__main__":
    Spiel(Spieler(input("Dein Name: ") or "Gast")).spielen()
