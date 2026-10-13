from gehege import Gehege


class Pfleger:
    """Ein Pfleger ist für ein Gehege zuständig (Assoziation: das Gehege gehört ihm nicht)."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.gehege: Gehege | None = None
        self.fuetterungen = 0

    def zustaendig_fuer(self, gehege: Gehege) -> None:
        self.gehege = gehege

    def rundgang(self) -> list[str]:
        """Füttert alle hungrigen Tiere im eigenen Gehege."""
        if self.gehege is None:
            return []
        meldungen = []
        for tier in self.gehege.hungrige_tiere():
            tier.fressen(5)
            self.fuetterungen += 1
            meldungen.append(f"{self.name} füttert {tier.name}")
        return meldungen

    def __repr__(self) -> str:
        return f"Pfleger({self.name!r})"
