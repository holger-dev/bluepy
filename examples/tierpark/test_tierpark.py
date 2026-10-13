import unittest

from gehege import Gehege
from loewe import Loewe
from pfleger import Pfleger
from pinguin import Pinguin
from tier import Tier


class TierTest(unittest.TestCase):
    def test_abstrakt(self):
        with self.assertRaises(TypeError):
            Tier("Niemand", 1)  # type: ignore[abstract]

    def test_polymorphie(self):
        tiere = [Loewe("Simba", 4), Pinguin("Pingu", 2)]
        self.assertEqual([t.laut() for t in tiere], ["Roar!", "Quak"])
        self.assertIn("Simba (Loewe, 4 Jahre)", tiere[0].beschreibung())

    def test_fressen_nie_unter_null(self):
        loewe = Loewe("Simba", 4)
        loewe.fressen(100)
        self.assertEqual(loewe.hunger, 0)
        self.assertFalse(loewe.ist_hungrig())


class GehegeTest(unittest.TestCase):
    def setUp(self):
        self.gehege = Gehege("Savanne", 2)
        self.simba = Loewe("Simba", 4)
        self.gehege.aufnehmen(self.simba)

    def test_kapazitaet(self):
        self.assertTrue(self.gehege.aufnehmen(Loewe("Nala", 3)))
        self.assertFalse(self.gehege.aufnehmen(Loewe("Scar", 9)))
        self.assertEqual(self.gehege.freie_plaetze(), 0)

    def test_rundgang_fuettert_nur_hungrige(self):
        pfleger = Pfleger("Anna")
        pfleger.zustaendig_fuer(self.gehege)
        self.assertEqual(pfleger.rundgang(), [])
        self.simba.hunger = 9
        self.assertEqual(pfleger.rundgang(), ["Anna füttert Simba"])
        self.assertEqual(pfleger.fuetterungen, 1)


class PinguinTest(unittest.TestCase):
    def test_schwimmen(self):
        pingu = Pinguin("Pingu", 2)
        self.assertEqual(pingu.schwimmen(12), 2)
        self.assertEqual(pingu.gefangene_fische, 2)
        self.assertEqual(pingu.hunger, 3)
