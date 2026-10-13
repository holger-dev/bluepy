"""Python-Grundlagen 1: Funktionen, Variablen und Rückgabewerte.

Öffne das Code Pad und probiere aus:
    quadrat(7)
    ist_gerade(10)
    mittelwert([1, 2, 3, 4])
"""


def quadrat(zahl: float) -> float:
    """Gibt das Quadrat einer Zahl zurück."""
    return zahl * zahl


def ist_gerade(zahl: int) -> bool:
    """True, wenn die Zahl ohne Rest durch 2 teilbar ist."""
    return zahl % 2 == 0


def mittelwert(zahlen: list[float]) -> float:
    """Durchschnitt einer Liste von Zahlen. Eine leere Liste hat den Mittelwert 0."""
    if not zahlen:
        return 0.0
    return sum(zahlen) / len(zahlen)


def fakultaet(n: int) -> int:
    """n! = 1 * 2 * ... * n, berechnet mit einer Schleife."""
    ergebnis = 1
    for i in range(2, n + 1):
        ergebnis *= i
    return ergebnis


def groesster_gemeinsamer_teiler(a: int, b: int) -> int:
    """Euklidischer Algorithmus: solange teilen, bis der Rest 0 ist."""
    while b != 0:
        a, b = b, a % b
    return a
