from tier import Tier


class Loewe(Tier):
    """Ein Löwe erbt alles von Tier und bringt eine eigene Methode mit."""

    def __init__(self, name: str, alter: int, maehne: bool = True) -> None:
        super().__init__(name, alter)
        self.maehne = maehne

    def laut(self) -> str:
        return "Roar!"

    def bruellen(self) -> str:
        """Löwen brüllen lauter, wenn sie hungrig sind."""
        return "ROAAAR!!!" if self.ist_hungrig() else "roar"
