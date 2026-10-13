import unittest

from listen import beste_note, einkaufsliste_summe, notenspiegel, nur_gerade, suche
from rechnen import fakultaet, groesster_gemeinsamer_teiler, ist_gerade, mittelwert, quadrat
from texte import anzahl_vokale, ist_palindrom, umdrehen, woerter_zaehlen


class RechnenTest(unittest.TestCase):
    def test_quadrat(self):
        self.assertEqual(quadrat(7), 49)

    def test_ist_gerade(self):
        self.assertTrue(ist_gerade(10))
        self.assertFalse(ist_gerade(7))

    def test_mittelwert(self):
        self.assertEqual(mittelwert([1, 2, 3, 4]), 2.5)
        self.assertEqual(mittelwert([]), 0.0)

    def test_fakultaet_und_ggt(self):
        self.assertEqual(fakultaet(5), 120)
        self.assertEqual(groesster_gemeinsamer_teiler(48, 18), 6)


class TexteTest(unittest.TestCase):
    def test_vokale_und_palindrom(self):
        self.assertEqual(anzahl_vokale("Informatik"), 4)
        self.assertTrue(ist_palindrom("Reliefpfeiler"))
        self.assertFalse(ist_palindrom("Python"))

    def test_umdrehen_und_zaehlen(self):
        self.assertEqual(umdrehen("abc"), "cba")
        self.assertEqual(woerter_zaehlen("Hallo Welt, hallo!"), {"hallo": 2, "welt": 1})


class ListenTest(unittest.TestCase):
    def test_noten(self):
        self.assertEqual(beste_note([2, 1, 3]), 1)
        self.assertEqual(notenspiegel([2, 1, 3, 2]), {1: 1, 2: 2, 3: 1})

    def test_gerade_summe_suche(self):
        self.assertEqual(nur_gerade([1, 2, 3, 4]), [2, 4])
        self.assertEqual(einkaufsliste_summe({"Brot": 2.5, "Milch": 1.2}), 3.7)
        self.assertEqual(suche([5, 8, 13], 8), 1)
        self.assertEqual(suche([5, 8, 13], 9), -1)
