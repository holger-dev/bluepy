from verfahren import Verfahren


class Nachricht:
    """Eine Nachricht kennt Absender, Empfänger und ihren (ver- oder entschlüsselten) Text."""

    def __init__(self, von: str, an: str, text: str) -> None:
        self.von = von
        self.an = an
        self.text = text
        self.verschluesselt = False

    def verschluesseln(self, verfahren: Verfahren) -> None:
        if self.verschluesselt:
            raise ValueError("Nachricht ist schon verschlüsselt")
        self.text = verfahren.verschluesseln(self.text)
        self.verschluesselt = True

    def entschluesseln(self, verfahren: Verfahren) -> None:
        if not self.verschluesselt:
            raise ValueError("Nachricht ist nicht verschlüsselt")
        self.text = verfahren.entschluesseln(self.text)
        self.verschluesselt = False

    def __repr__(self) -> str:
        zustand = "🔒" if self.verschluesselt else "🔓"
        return f"{zustand} {self.von} → {self.an}: {self.text}"
