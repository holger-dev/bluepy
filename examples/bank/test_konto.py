import unittest

from konto import Konto
from person import Person


class KontoTest(unittest.TestCase):
    def setUp(self):
        self.konto = Konto(Person("Anna"), 10)

    def test_einzahlen(self):
        self.konto.einzahlen(5)
        self.assertEqual(self.konto.kontostand(), 15)

    def test_abheben_zu_viel(self):
        self.assertFalse(self.konto.abheben(50))
