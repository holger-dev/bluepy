import { describe, expect, it } from 'vitest'
import {
  addTestClass,
  assertionStatement,
  composeSetUp,
  composeTestMethod,
  insertMethod,
  replaceOrInsertMethod,
  rewriteNames,
  testClassTemplate,
  testFileFor
} from './compose'

const names = new Set(['konto1', 'person1'])

describe('rewriteNames', () => {
  it('prefixes fixture objects with self.', () => {
    expect(rewriteNames('konto1.einzahlen(50)', names)).toBe('self.konto1.einzahlen(50)')
    expect(rewriteNames('k = Konto(person1, 100)', names)).toBe('k = Konto(self.person1, 100)')
  })

  it('leaves strings, comments, attributes and keyword arguments alone', () => {
    expect(rewriteNames('x.konto1.f("konto1")  # konto1', names)).toBe('x.konto1.f("konto1")  # konto1')
    expect(rewriteNames('Konto(inhaber=person1, konto1=3)', names)).toBe('Konto(inhaber=self.person1, konto1=3)')
    expect(rewriteNames('konto1 == person1', names)).toBe('self.konto1 == self.person1')
    expect(rewriteNames("f'{konto1}'", names)).toBe("f'{konto1}'")
  })
})

describe('composeTestMethod / composeSetUp', () => {
  it('builds a method from recorded statements', () => {
    const src = composeTestMethod('test_einzahlen', ['# python konto.py', 'konto1.einzahlen(50)', 'self.assertEqual(konto1.kontostand(), 150)'], ['konto1'])
    expect(src).toBe('def test_einzahlen(self):\n    self.konto1.einzahlen(50)\n    self.assertEqual(self.konto1.kontostand(), 150)')
    expect(composeTestMethod('test_leer', [], [])).toBe('def test_leer(self):\n    pass')
  })

  it('builds setUp from the bench in creation order', () => {
    const src = composeSetUp([
      { name: 'person1', code: 'Person("Anna")' },
      { name: 'konto1', code: 'Konto(person1, 100)' },
      { name: 'x', code: null }
    ])
    expect(src.split('\n')).toEqual([
      'def setUp(self):',
      '    self.person1 = Person("Anna")',
      '    self.konto1 = Konto(self.person1, 100)',
      '    self.x = None  # TODO: x wurde nicht über die Objektleiste erzeugt'
    ])
  })

  it('formats assertions', () => {
    expect(assertionStatement('k.kontostand()', { kind: 'equal', expected: '150' })).toBe('self.assertEqual(k.kontostand(), 150)')
    expect(assertionStatement('k.kontostand()', { kind: 'almostEqual', expected: '1.5' })).toBe('self.assertAlmostEqual(k.kontostand(), 1.5)')
    expect(assertionStatement('k.leer()', { kind: 'true' })).toBe('self.assertTrue(k.leer())')
    expect(assertionStatement('k.x()', { kind: 'isNone' })).toBe('self.assertIsNone(k.x())')
  })
})

const FILE = ['import unittest', '', '', 'class KontoTest(unittest.TestCase):', '    """Doc."""', '', '    def setUp(self):', '        self.k = Konto()', '', '    def test_a(self):', '        self.assertTrue(True)', '', '', 'class Other:', '    pass', ''].join('\n')

describe('insertMethod / replaceOrInsertMethod', () => {
  it('appends a test method at the end of the class', () => {
    const out = insertMethod(FILE, 'KontoTest', 'def test_b(self):\n    pass', 'end')
    const lines = out.split('\n')
    expect(lines.slice(9, 15)).toEqual(['    def test_a(self):', '        self.assertTrue(True)', '', '    def test_b(self):', '        pass', ''])
    expect(lines.slice(15, 18)).toEqual(['', 'class Other:', '    pass'])
  })

  it('replaces setUp in place and inserts it after the docstring when missing', () => {
    const replaced = replaceOrInsertMethod(FILE, 'KontoTest', 'setUp', 'def setUp(self):\n    self.k = Konto(1)\n    self.p = Person()')
    expect(replaced.split('\n').slice(6, 10)).toEqual(['    def setUp(self):', '        self.k = Konto(1)', '        self.p = Person()', ''])
    const noSetup = ['class KontoTest(unittest.TestCase):', '    """Doc."""', '', '    def test_a(self):', '        pass', ''].join('\n')
    const inserted = replaceOrInsertMethod(noSetup, 'KontoTest', 'setUp', 'def setUp(self):\n    self.k = Konto()')
    expect(inserted.split('\n').slice(0, 7)).toEqual([
      'class KontoTest(unittest.TestCase):',
      '    """Doc."""',
      '',
      '    def setUp(self):',
      '        self.k = Konto()',
      '',
      '    def test_a(self):'
    ])
  })

  it('replaces a body that is only pass and fails for unknown classes', () => {
    const out = insertMethod('class T(unittest.TestCase):\n    pass\n', 'T', 'def test_x(self):\n    pass', 'end')
    expect(out).toBe('class T(unittest.TestCase):\n    def test_x(self):\n        pass\n')
    expect(() => insertMethod(FILE, 'Nope', 'def f(self):\n    pass', 'end')).toThrow()
  })
})

describe('templates', () => {
  it('names test files and classes', () => {
    expect(testFileFor('konto.py')).toBe('test_konto.py')
    expect(testFileFor('pkg/mod.py')).toBe('pkg/test_mod.py')
    expect(testClassTemplate('konto', 'Konto')).toContain('class KontoTest(unittest.TestCase):')
    expect(testClassTemplate('konto', 'Konto')).toContain('from konto import Konto')
  })

  it('adds a second test class to an existing module with its import', () => {
    const out = addTestClass(testClassTemplate('konto', 'Konto'), 'konto', 'Sparkonto')
    const lines = out.split('\n')
    expect(lines.slice(0, 4)).toEqual(['import unittest', '', 'from konto import Konto', 'from konto import Sparkonto'])
    expect(out).toContain('class SparkontoTest(unittest.TestCase):')
    expect(addTestClass(out, 'konto', 'Sparkonto').match(/from konto import Sparkonto/g)?.length).toBe(1)
  })
})
