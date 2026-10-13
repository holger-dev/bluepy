import unittest

from abzeichen import ERSTE_QUEST, SCHWER_GELOEST, SERIE_3, Schwierigkeit
from quest import Quest
from spieler import Spieler


class QuestTest(unittest.TestCase):
    def test_pruefen_ignoriert_gross_klein(self):
        quest = Quest("Q", "?", "Append", Schwierigkeit.LEICHT)
        self.assertTrue(quest.pruefen("  append "))

    def test_xp_halbiert_nach_fehlversuch(self):
        quest = Quest("Q", "?", "8", Schwierigkeit.MITTEL)
        quest.pruefen("7")
        quest.pruefen("8")
        self.assertEqual(quest.xp, 12)


class SpielerTest(unittest.TestCase):
    def setUp(self):
        self.spieler = Spieler("Mia")

    def test_level(self):
        self.assertEqual(self.spieler.level, 1)
        self.spieler.xp = 100
        self.assertEqual(self.spieler.level, 3)
        self.assertEqual(self.spieler.xp_bis_naechstes_level(), 50)

    def test_abzeichen(self):
        self.assertTrue(self.spieler.loesen(Quest("A", "?", "x", Schwierigkeit.SCHWER), "x"))
        self.assertIn(ERSTE_QUEST, self.spieler.abzeichen)
        self.assertIn(SCHWER_GELOEST, self.spieler.abzeichen)
        self.spieler.loesen(Quest("B", "?", "x", Schwierigkeit.LEICHT), "x")
        self.spieler.loesen(Quest("C", "?", "x", Schwierigkeit.LEICHT), "x")
        self.assertIn(SERIE_3, self.spieler.abzeichen)
        self.assertEqual(self.spieler.xp, 70)

    def test_serie_bricht_ab(self):
        self.spieler.loesen(Quest("A", "?", "x", Schwierigkeit.LEICHT), "x")
        self.assertFalse(self.spieler.loesen(Quest("B", "?", "x", Schwierigkeit.LEICHT), "falsch"))
        self.assertEqual(self.spieler.serie, 0)
