import { describe, expect, it } from 'vitest'
import { computeScopes, type Scope } from './pythonScopes'

function brief(scopes: Scope[]): Array<[string, number, number, number, number]> {
  return scopes.map((s) => [s.kind, s.start, s.end, s.indent, s.depth])
}

describe('computeScopes', () => {
  it('finds class, methods and nested branches with their extent', () => {
    const src = [
      'class Konto:',
      '    def __init__(self):',
      '        self.stand = 0',
      '',
      '    def einzahlen(self, b):',
      '        if b > 0:',
      '            self.stand += b',
      'konto = Konto()'
    ]
    const scopes = computeScopes(src)
    expect(brief(scopes)).toEqual([
      ['class', 0, 6, 0, 0],
      ['def', 1, 2, 4, 1],
      ['def', 4, 6, 4, 1],
      ['branch', 5, 6, 8, 2]
    ])
    expect(scopes[0]?.bodyIndent).toBe(4)
    expect(scopes[3]?.bodyIndent).toBe(12)
  })

  it('excludes trailing blank lines from a block', () => {
    expect(brief(computeScopes(['def f():', '    pass', '', '', 'x = 1']))).toEqual([['def', 0, 1, 0, 0]])
  })

  it('ignores colons inside strings and comments', () => {
    const src = ['print("if x:")', 'x = 1  # if y:', 'if a:  # comment', '    pass', "s = 'while:'"]
    expect(brief(computeScopes(src))).toEqual([['branch', 2, 3, 0, 0]])
  })

  it('handles headers spanning several lines', () => {
    const src = ['def f(', '    a,', '    b,', '):', '    return a + b', 'print(f(1, 2))']
    const [scope] = computeScopes(src)
    expect(scope).toMatchObject({ kind: 'def', start: 0, headerEnd: 3, end: 4, indent: 0, bodyIndent: 4 })
  })

  it('keeps multi-line strings inside their block even at lower indentation', () => {
    const src = ['def f():', '    """Doc', 'text', '    """', '    return 1', 'y = 2']
    expect(brief(computeScopes(src))).toEqual([['def', 0, 4, 0, 0]])
  })

  it('does not let column-0 comments close a block', () => {
    const src = ['class A:', '    x = 1', '# note', '    y = 2', 'z = 3']
    expect(brief(computeScopes(src))).toEqual([['class', 0, 3, 0, 0]])
  })

  it('classifies keywords and treats each clause as its own box', () => {
    const src = [
      'for i in range(3):',
      '    pass',
      'else:',
      '    pass',
      'while True:',
      '    break',
      'try:',
      '    pass',
      'except ValueError:',
      '    pass',
      'with open("x") as f:',
      '    pass',
      'match = 3',
      'match x:',
      '    case 1:',
      '        pass',
      'async def g():',
      '    async for a in b:',
      '        pass'
    ]
    expect(computeScopes(src).map((s) => [s.kind, s.start])).toEqual([
      ['loop', 0],
      ['branch', 2],
      ['loop', 4],
      ['branch', 6],
      ['branch', 8],
      ['branch', 10],
      ['branch', 13],
      ['branch', 14],
      ['def', 16],
      ['loop', 17]
    ])
  })

  it('counts enclosing scopes that end on the same line', () => {
    const src = ['def f():', '    for i in x:', '        if i:', '            pass']
    expect(computeScopes(src).map((s) => s.tailDepth)).toEqual([0, 1, 2])
  })

  it('yields a header-only scope while the body is still being typed', () => {
    const [scope] = computeScopes(['def f():'])
    expect(scope).toMatchObject({ kind: 'def', start: 0, headerEnd: 0, end: 0, bodyIndent: 0 })
  })

  it('ignores unterminated headers', () => {
    expect(computeScopes(['def f(', '    a,'])).toEqual([])
  })
})
