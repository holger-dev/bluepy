"""Python-Grundlagen 2: Strings und Schleifen."""


def anzahl_vokale(text: str) -> int:
    """Zählt a, e, i, o, u – groß oder klein."""
    anzahl = 0
    for zeichen in text.lower():
        if zeichen in "aeiouäöü":
            anzahl += 1
    return anzahl


def ist_palindrom(text: str) -> bool:
    """True, wenn der Text vorwärts und rückwärts gleich ist (ohne Leerzeichen, Groß/Klein egal)."""
    bereinigt = text.replace(" ", "").lower()
    return bereinigt == bereinigt[::-1]


def umdrehen(text: str) -> str:
    """Dreht den Text um – mit einer Schleife statt mit [::-1]."""
    ergebnis = ""
    for zeichen in text:
        ergebnis = zeichen + ergebnis
    return ergebnis


def woerter_zaehlen(text: str) -> dict[str, int]:
    """Wie oft kommt jedes Wort vor? Gibt ein Dictionary zurück."""
    zaehler: dict[str, int] = {}
    for wort in text.lower().split():
        wort = wort.strip(".,!?")
        zaehler[wort] = zaehler.get(wort, 0) + 1
    return zaehler
