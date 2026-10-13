import { describe, expect, it } from 'vitest'
import { computeLevels } from './scopeHighlight'

describe('computeLevels', () => {
  it('maps indentation to nesting levels', () => {
    const src = ['class Konto:', '    def __init__(self):', '        self.stand = 0', '', '    def einzahlen(self, b):', '        if b > 0:', '            self.stand += b', 'konto = Konto()']
    expect(computeLevels(src)).toEqual([0, 1, 2, 1, 1, 2, 3, 0])
  })

  it('closes bands on blank lines at block ends', () => {
    expect(computeLevels(['def f():', '    pass', '', '', 'x = 1'])).toEqual([0, 1, 0, 0, 0])
  })

  it('handles tabs and caps the level', () => {
    expect(computeLevels(['\t\tx', '\t' + ' '.repeat(40) + 'y'])).toEqual([2, 6])
  })
})
