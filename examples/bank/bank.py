from konto import Konto
from person import Person
from transaktion import Ueberweisung


class Bank:
    """Verwaltet Konten und führt Überweisungen aus."""

    def __init__(self, name: str):
        self.name = name
        self.konten: list[Konto] = []
        self.protokoll = []

    def konto_eroeffnen(self, inhaber: Person, startguthaben: float = 0.0) -> Konto:
        konto = Konto(inhaber, startguthaben)
        self.konten.append(konto)
        return konto

    def ueberweisen(self, von: Konto, nach: Konto, betrag: float) -> bool:
        transaktion = Ueberweisung(von, nach, betrag)
        ok = transaktion.ausfuehren()
        self.protokoll.append(transaktion)
        return ok

    def gesamtvermoegen(self) -> float:
        return sum(k.kontostand() for k in self.konten)


if __name__ == "__main__":
    bank = Bank("Sparkasse Kasseburg")
    anna = bank.konto_eroeffnen(Person("Anna"), 100)
    print(bank.gesamtvermoegen())
