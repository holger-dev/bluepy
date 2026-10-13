import unittest

from knacker import alle_moeglichkeiten, caesar_knacken
from nachricht import Nachricht
from verfahren import Caesar, Vigenere


class CaesarTest(unittest.TestCase):
    def test_verschieben(self):
        self.assertEqual(Caesar(3).verschluesseln("Hallo Welt!"), "KDOOR ZHOW!")
        self.assertEqual(Caesar(3).entschluesseln("KDOOR ZHOW!"), "HALLO WELT!")
        self.assertEqual(Caesar(29).schluessel, 3)

    def test_umlaute(self):
        self.assertEqual(Caesar(1).verschluesseln("Käse"), "LBFTF")


class VigenereTest(unittest.TestCase):
    def test_hin_und_zurueck(self):
        v = Vigenere("Schule")
        geheim = v.verschluesseln("Informatik macht Spass")
        self.assertNotEqual(geheim, "INFORMATIK MACHT SPASS")
        self.assertEqual(v.entschluesseln(geheim), "INFORMATIK MACHT SPASS")

    def test_leeres_schluesselwort(self):
        with self.assertRaises(ValueError):
            Vigenere("123")


class NachrichtTest(unittest.TestCase):
    def test_zustand(self):
        n = Nachricht("Anna", "Ben", "Hallo")
        n.verschluesseln(Caesar(1))
        self.assertEqual(n.text, "IBMMP")
        with self.assertRaises(ValueError):
            n.verschluesseln(Caesar(1))
        n.entschluesseln(Caesar(1))
        self.assertEqual(n.text, "HALLO")


class KnackerTest(unittest.TestCase):
    def test_knacken(self):
        klartext = "Treffen wir uns heute um drei am Eingang der Schule"
        geheim = Caesar(7).verschluesseln(klartext)
        self.assertEqual(caesar_knacken(geheim), 7)
        self.assertIn(Caesar(0).normalisieren(klartext), alle_moeglichkeiten(geheim))
