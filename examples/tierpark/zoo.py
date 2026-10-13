from gehege import Gehege
from loewe import Loewe
from pfleger import Pfleger
from pinguin import Pinguin
from tier import Tier


class Zoo:
    """Der Zoo verwaltet Gehege und Pfleger."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.gehege: list[Gehege] = []
        self.pfleger: list[Pfleger] = []

    def neues_gehege(self, name: str, plaetze: int) -> Gehege:
        gehege = Gehege(name, plaetze)
        self.gehege.append(gehege)
        return gehege

    def einstellen(self, pfleger: Pfleger) -> None:
        self.pfleger.append(pfleger)

    def alle_tiere(self) -> list[Tier]:
        return [tier for gehege in self.gehege for tier in gehege.tiere]

    def anzahl_tiere(self) -> int:
        return len(self.alle_tiere())

    def bericht(self) -> str:
        zeilen = [f"Zoo {self.name}: {self.anzahl_tiere()} Tiere in {len(self.gehege)} Gehegen"]
        for tier in self.alle_tiere():
            zeilen.append("  " + tier.beschreibung())
        return "\n".join(zeilen)


if __name__ == "__main__":
    zoo = Zoo("Hagenbeck")
    savanne = zoo.neues_gehege("Savanne", 3)
    eis = zoo.neues_gehege("Eismeer", 10)
    savanne.aufnehmen(Loewe("Simba", 4))
    savanne.aufnehmen(Loewe("Nala", 3, maehne=False))
    eis.aufnehmen(Pinguin("Pingu", 2))
    anna = Pfleger("Anna")
    anna.zustaendig_fuer(savanne)
    zoo.einstellen(anna)
    print(zoo.bericht())
    for tier in zoo.alle_tiere():
        tier.hunger = 9
    print("\n".join(anna.rundgang()))
