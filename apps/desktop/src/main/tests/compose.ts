/**
 * Writing unit-test code the way BlueJ does it: recorded interactions become
 * a test method, the object bench becomes `setUp`, and both are inserted into
 * the test class by indentation (see ../../shared/pythonScopes).  Pure
 * functions over source strings; the Session does the file I/O.
 */
import type { Assertion } from '@bluepy/protocol'
import { computeScopes, type Scope } from '../../shared/pythonScopes'

const INDENT = '    '

// ------------------------------------------------------------ expressions

const TOKEN = /(?:[rRbBuUfF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|#[^\n]*|[A-Za-z_]\w*|[\s\S]/g

/**
 * Prefix every reference to one of `names` with `self.` – outside strings and
 * comments, and not for attribute names (`x.konto1`) or keyword arguments /
 * assignment targets (`konto1=`).
 */
export function rewriteNames(code: string, names: ReadonlySet<string>, prefix = 'self.'): string {
  if (names.size === 0) return code
  let out = ''
  for (const match of code.matchAll(TOKEN)) {
    const token = match[0]
    if (!/^[A-Za-z_]\w*$/.test(token) || !names.has(token)) {
      out += token
      continue
    }
    const before = out.trimEnd()
    const prev = before[before.length - 1]
    const after = code.slice((match.index ?? 0) + token.length).trimStart()
    const isAttribute = prev === '.'
    const isKeywordOrTarget = after.startsWith('=') && !after.startsWith('==')
    out += isAttribute || isKeywordOrTarget ? token : prefix + token
  }
  return out
}

export function assertionStatement(call: string, assertion: Assertion): string {
  const expected = (assertion.expected ?? '').trim()
  switch (assertion.kind) {
    case 'equal':
      return `self.assertEqual(${call}, ${expected})`
    case 'almostEqual':
      return `self.assertAlmostEqual(${call}, ${expected})`
    case 'is':
      return `self.assertIs(${call}, ${expected})`
    case 'true':
      return `self.assertTrue(${call})`
    case 'false':
      return `self.assertFalse(${call})`
    case 'isNone':
      return `self.assertIsNone(${call})`
    case 'isNotNone':
      return `self.assertIsNotNone(${call})`
  }
}

// --------------------------------------------------------------- methods

/** Source of `def <name>(self): …` (no base indentation) from recorded statements. */
export function composeTestMethod(name: string, statements: readonly string[], fixtureNames: readonly string[]): string {
  const names = new Set(fixtureNames)
  const body = statements
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
    .map((s) => rewriteNames(s, names))
  const lines = [`def ${name}(self):`, ...(body.length ? body : ['pass']).map((l) => INDENT + l)]
  return lines.join('\n')
}

/** `setUp` recreating the bench objects in order ("Object Bench to Test Fixture"). */
export function composeSetUp(objects: readonly { name: string; code: string | null | undefined }[]): string {
  const lines = ['def setUp(self):']
  const names = new Set<string>()
  for (const obj of objects) {
    if (obj.code) lines.push(`${INDENT}self.${obj.name} = ${rewriteNames(obj.code, names)}`)
    else lines.push(`${INDENT}self.${obj.name} = None  # TODO: ${obj.name} wurde nicht über die Objektleiste erzeugt`)
    names.add(obj.name)
  }
  if (objects.length === 0) lines.push(`${INDENT}pass`)
  return lines.join('\n')
}

// ------------------------------------------------------------- insertion

export function findClass(lines: readonly string[], className: string): Scope | undefined {
  const header = new RegExp(`^\\s*class\\s+${className}\\b`)
  return computeScopes(lines).find((s) => s.kind === 'class' && header.test(lines[s.start] ?? ''))
}

function findMethod(lines: readonly string[], cls: Scope, methodName: string): Scope | undefined {
  const header = new RegExp(`^\\s*(async\\s+)?def\\s+${methodName}\\s*\\(`)
  return computeScopes(lines).find(
    (s) => s.kind === 'def' && s.start > cls.start && s.end <= cls.end && s.indent === cls.bodyIndent && header.test(lines[s.start] ?? '')
  )
}

function indentBlock(code: string, columns: number): string[] {
  const pad = ' '.repeat(columns)
  return code.split('\n').map((l) => (l.trim() ? pad + l : ''))
}

/** Index of the line after the class docstring (or after the header), where a first method goes. */
function bodyStart(lines: readonly string[], cls: Scope): number {
  let i = cls.headerEnd + 1
  while (i <= cls.end && !(lines[i] ?? '').trim()) i++
  const first = (lines[i] ?? '').trim()
  const quote = first.startsWith('"""') ? '"""' : first.startsWith("'''") ? "'''" : null
  if (!quote) return cls.headerEnd + 1
  if (first.length >= 6 && first.endsWith(quote)) return i + 1
  for (let j = i + 1; j <= cls.end; j++) if ((lines[j] ?? '').includes(quote)) return j + 1
  return cls.headerEnd + 1
}

/** Insert `method` (unindented `def …`) into the class at its start or end. */
export function insertMethod(source: string, className: string, method: string, position: 'start' | 'end'): string {
  const lines = source.split('\n')
  const cls = findClass(lines, className)
  if (!cls) throw new Error(`Klasse ${className} nicht gefunden`)
  const columns = cls.bodyIndent > cls.indent ? cls.bodyIndent : cls.indent + INDENT.length
  const block = indentBlock(method, columns)
  // a body that is only `pass` gets replaced
  const bodyLines = lines.slice(cls.headerEnd + 1, cls.end + 1).filter((l) => l.trim())
  if (bodyLines.length === 1 && bodyLines[0]?.trim() === 'pass') {
    lines.splice(cls.headerEnd + 1, cls.end - cls.headerEnd, ...block)
    return lines.join('\n')
  }
  if (position === 'end') {
    lines.splice(cls.end + 1, 0, '', ...block)
  } else {
    const at = bodyStart(lines, cls)
    const gapBefore = at > cls.headerEnd + 1 && (lines[at - 1] ?? '').trim() !== ''
    const gapAfter = (lines[at] ?? '').trim() !== ''
    lines.splice(at, 0, ...(gapBefore ? [''] : []), ...block, ...(gapAfter ? [''] : []))
  }
  return lines.join('\n')
}

/** Replace an existing method of the class, or insert it (setUp at the start, tests at the end). */
export function replaceOrInsertMethod(source: string, className: string, methodName: string, method: string): string {
  const lines = source.split('\n')
  const cls = findClass(lines, className)
  if (!cls) throw new Error(`Klasse ${className} nicht gefunden`)
  const existing = findMethod(lines, cls, methodName)
  if (!existing) return insertMethod(source, className, method, methodName === 'setUp' ? 'start' : 'end')
  lines.splice(existing.start, existing.end - existing.start + 1, ...indentBlock(method, existing.indent))
  return lines.join('\n')
}

// ------------------------------------------------------------- templates

/** `konto.py` → `test_konto.py`, `pkg/mod.py` → `pkg/test_mod.py`. */
export function testFileFor(file: string): string {
  const slash = file.lastIndexOf('/')
  const dir = slash >= 0 ? file.slice(0, slash + 1) : ''
  const base = file.slice(slash + 1)
  return `${dir}test_${base}`
}

export function testClassNameFor(className: string): string {
  return `${className}Test`
}

export function testClassTemplate(moduleName: string, className: string): string {
  return [
    'import unittest',
    '',
    `from ${moduleName} import ${className}`,
    '',
    '',
    `class ${testClassNameFor(className)}(unittest.TestCase):`,
    `${INDENT}"""Tests für ${className}."""`,
    '',
    `${INDENT}def setUp(self):`,
    `${INDENT}${INDENT}pass`,
    ''
  ].join('\n')
}

/** Append a test class for `className` to an existing test module (adds the import if missing). */
export function addTestClass(source: string, moduleName: string, className: string): string {
  const lines = source.split('\n')
  const importLine = `from ${moduleName} import ${className}`
  if (!lines.some((l) => l.trim() === importLine || new RegExp(`^from\\s+${moduleName}\\s+import\\b.*\\b${className}\\b`).test(l))) {
    let last = -1
    for (let i = 0; i < lines.length; i++) if (/^(import|from)\s/.test(lines[i] ?? '')) last = i
    lines.splice(last + 1, 0, importLine)
  }
  while (lines.length && !(lines[lines.length - 1] ?? '').trim()) lines.pop()
  lines.push(
    '',
    '',
    `class ${testClassNameFor(className)}(unittest.TestCase):`,
    `${INDENT}"""Tests für ${className}."""`,
    '',
    `${INDENT}def setUp(self):`,
    `${INDENT}${INDENT}pass`,
    ''
  )
  return lines.join('\n')
}
