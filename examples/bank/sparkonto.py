from konto import Konto


class Sparkonto(Konto):
    """Ein Konto mit höherem Zinssatz, das nicht ins Minus gehen darf."""

    zinssatz = 0.03

    def zinsen_gutschreiben(self) -> float:
        zinsen = self.stand * self.zinssatz
        self.einzahlen(zinsen)
        return zinsen
