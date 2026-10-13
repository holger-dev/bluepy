"""Kryptoanalyse: Caesar ist leicht zu knacken – mit Häufigkeitsanalyse oder einfach allen 26 Schlüsseln."""

from verfahren import ALPHABET, Caesar

HAEUFIGSTE_BUCHSTABEN_DEUTSCH = "ENISRATDHU"


def buchstaben_haeufigkeit(text: str) -> dict[str, int]:
    """Wie oft kommt jeder Buchstabe A–Z vor?"""
    zaehler = {buchstabe: 0 for buchstabe in ALPHABET}
    for zeichen in text.upper():
        if zeichen in zaehler:
            zaehler[zeichen] += 1
    return zaehler


def caesar_knacken(geheimtext: str) -> int:
    """Vermutet: der häufigste Buchstabe im Geheimtext ist ein verschlüsseltes E. Gibt den Schlüssel zurück."""
    haeufigkeit = buchstaben_haeufigkeit(geheimtext)
    haeufigster = max(haeufigkeit, key=lambda b: haeufigkeit[b])
    return (ALPHABET.index(haeufigster) - ALPHABET.index("E")) % 26


def alle_moeglichkeiten(geheimtext: str) -> list[str]:
    """Brute Force: alle 26 Entschlüsselungen – eine davon ergibt Sinn."""
    return [Caesar(schluessel).entschluesseln(geheimtext) for schluessel in range(26)]


if __name__ == "__main__":
    geheim = Caesar(7).verschluesseln("Treffen wir uns heute um drei am Eingang der Schule")
    print("Geheimtext:", geheim)
    schluessel = caesar_knacken(geheim)
    print("Vermuteter Schlüssel:", schluessel)
    print("Klartext:", Caesar(schluessel).entschluesseln(geheim))
