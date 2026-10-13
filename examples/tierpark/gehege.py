from tier import Tier


class Gehege:
    """Ein Gehege enthält Tiere (Komposition: die Liste gehört zum Gehege)."""

    def __init__(self, name: str, plaetze: int) -> None:
        self.name = name
        self.plaetze = plaetze
        self.tiere: list[Tier] = []

    def aufnehmen(self, tier: Tier) -> bool:
        """Nimmt ein Tier auf, wenn noch Platz ist."""
        if len(self.tiere) >= self.plaetze:
            return False
        self.tiere.append(tier)
        return True

    def freie_plaetze(self) -> int:
        return self.plaetze - len(self.tiere)

    def fuettern(self, menge: int) -> list[str]:
        """Alle Tiere füttern – egal ob Löwe oder Pinguin (Polymorphie)."""
        meldungen = []
        for tier in self.tiere:
            tier.fressen(menge)
            meldungen.append(f"{tier.name}: {tier.laut()}")
        return meldungen

    def hungrige_tiere(self) -> list[Tier]:
        return [t for t in self.tiere if t.ist_hungrig()]

    def __repr__(self) -> str:
        return f"Gehege({self.name!r}, {len(self.tiere)}/{self.plaetze})"
