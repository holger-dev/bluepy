import unittest

from aufgaben import ist_primzahl, laengstes_wort, summe_bis


class AufgabenTest(unittest.TestCase):
    def test_summe_bis(self):
        self.assertEqual(summe_bis(1), 1)
        self.assertEqual(summe_bis(4), 10)
        self.assertEqual(summe_bis(100), 5050)

    def test_ist_primzahl(self):
        self.assertTrue(ist_primzahl(2))
        self.assertTrue(ist_primzahl(13))
        self.assertFalse(ist_primzahl(1))
        self.assertFalse(ist_primzahl(15))

    def test_laengstes_wort(self):
        self.assertEqual(laengstes_wort("Python macht Spaß"), "Python")
        self.assertEqual(laengstes_wort("ab cd ef"), "ab")
