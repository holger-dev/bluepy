"""Python-Grundlagen 3: Listen und Dictionaries.

Probiere im Code Pad:
    noten = [2, 1, 3, 2, 4]
    beste_note(noten)
    notenspiegel(noten)
"""


def beste_note(noten: list[int]) -> int:
    """Die beste (kleinste) Note."""
    return min(noten)


def notenspiegel(noten: list[int]) -> dict[int, int]:
    """Wie oft wurde welche Note vergeben? {1: 1, 2: 2, ...}"""
    spiegel: dict[int, int] = {}
    for note in noten:
        spiegel[note] = spiegel.get(note, 0) + 1
    return dict(sorted(spiegel.items()))


def nur_gerade(zahlen: list[int]) -> list[int]:
    """Alle geraden Zahlen – als List Comprehension."""
    return [z for z in zahlen if z % 2 == 0]


def einkaufsliste_summe(preise: dict[str, float]) -> float:
    """Summe aller Preise, z. B. {"Brot": 2.5, "Milch": 1.2}."""
    summe = 0.0
    for preis in preise.values():
        summe += preis
    return round(summe, 2)


def suche(zahlen: list[int], gesucht: int) -> int:
    """Lineare Suche: Index der Zahl oder -1, wenn sie nicht vorkommt."""
    for index, zahl in enumerate(zahlen):
        if zahl == gesucht:
            return index
    return -1
