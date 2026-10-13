import unittest

from baum import Suchbaum
from liste import VerketteteListe
from schlange import Schlange
from stapel import Stapel, klammern_ausgeglichen


class StapelTest(unittest.TestCase):
    def test_lifo(self):
        s = Stapel()
        s.push(1)
        s.push(2)
        self.assertEqual(s.top(), 2)
        self.assertEqual(s.pop(), 2)
        self.assertEqual(s.pop(), 1)
        self.assertTrue(s.ist_leer())
        with self.assertRaises(IndexError):
            s.pop()

    def test_klammern(self):
        self.assertTrue(klammern_ausgeglichen("f([1, 2], {3})"))
        self.assertFalse(klammern_ausgeglichen("(]"))
        self.assertFalse(klammern_ausgeglichen("(("))


class SchlangeTest(unittest.TestCase):
    def test_fifo(self):
        q = Schlange()
        q.enqueue("a")
        q.enqueue("b")
        self.assertEqual(q.vorne(), "a")
        self.assertEqual(q.dequeue(), "a")
        self.assertEqual(q.dequeue(), "b")
        self.assertTrue(q.ist_leer())
        q.enqueue("c")
        self.assertEqual(q.anzahl, 1)


class ListeTest(unittest.TestCase):
    def test_einfuegen_suchen_entfernen(self):
        liste = VerketteteListe()
        for wert in [3, 5, 7]:
            liste.anhaengen(wert)
        liste.einfuegen_vorne(1)
        self.assertEqual(liste.als_python_liste(), [1, 3, 5, 7])
        self.assertTrue(liste.enthaelt(5))
        self.assertTrue(liste.entfernen(5))
        self.assertFalse(liste.entfernen(42))
        self.assertEqual(liste.laenge(), 3)
        self.assertTrue(liste.entfernen(1))
        self.assertEqual(liste.als_python_liste(), [3, 7])


class SuchbaumTest(unittest.TestCase):
    def test_sortiert_und_hoehe(self):
        baum = Suchbaum()
        for wert in [8, 3, 10, 1, 6, 14, 6]:
            baum.einfuegen(wert)
        self.assertEqual(baum.inorder(), [1, 3, 6, 8, 10, 14])
        self.assertTrue(baum.enthaelt(6))
        self.assertFalse(baum.enthaelt(7))
        self.assertEqual(baum.hoehe(), 3)
