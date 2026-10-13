from dataclasses import dataclass


@dataclass
class Adresse:
    strasse: str
    ort: str


class Person:
    """Eine Kundin oder ein Kunde der Bank."""

    def __init__(self, name: str, adresse: Adresse | None = None):
        self.name = name
        self.adresse = adresse

    def begruessung(self) -> str:
        return f"Hallo, {self.name}!"
