from tier import Tier


class Pinguin(Tier):
    """Pinguine können schwimmen – und ihr Laut ist etwas leiser."""

    def __init__(self, name: str, alter: int) -> None:
        super().__init__(name, alter)
        self.gefangene_fische = 0

    def laut(self) -> str:
        return "Quak"

    def schwimmen(self, minuten: int) -> int:
        """Beim Schwimmen fängt ein Pinguin ungefähr einen Fisch pro 5 Minuten."""
        gefangen = minuten // 5
        self.gefangene_fische += gefangen
        self.fressen(gefangen)
        return gefangen
