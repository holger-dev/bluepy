"""Ein kleines Programm, das die Funktionen benutzt. Rechtsklick → Modul ausführen."""

from rechnen import fakultaet, ist_gerade
from texte import ist_palindrom

if __name__ == "__main__":
    name = input("Wie heißt du? ")
    print(f"Hallo {name}! Dein Name hat {len(name)} Buchstaben.")
    if ist_palindrom(name):
        print("Dein Name ist ein Palindrom!")
    for n in range(1, 6):
        art = "gerade" if ist_gerade(n) else "ungerade"
        print(f"{n} ist {art}, {n}! = {fakultaet(n)}")
