/**
 * Block structure of Python source by indentation: every compound statement
 * (class, def, loop, if/try/with/match clause) with its header, body extent
 * and nesting.  Used by the editor's scope highlighting (renderer) and by the
 * test-method writer (main process).  Pure, no DOM, unit-tested.
 *
 * A tiny lexer tracks strings, comments, brackets and backslash continuations,
 * so colons inside strings, comments at column 0 and multi-line headers do not
 * confuse it.
 */
export type ScopeKind = 'class' | 'def' | 'loop' | 'branch'

export interface Scope {
  kind: ScopeKind
  /** 0-based first line of the header. */
  start: number
  /** 0-based last line of the header (same as `start` unless the header spans lines). */
  headerEnd: number
  /** 0-based last line of the body (inclusive); equals `headerEnd` for an empty block. */
  end: number
  /** Indentation of the header in columns. */
  indent: number
  /** Indentation of the body, or `indent` when there is no body. */
  bodyIndent: number
  /** Number of enclosing scopes. */
  depth: number
  /** Number of enclosing scopes that end on the same line (nested boxes are shortened by this). */
  tailDepth: number
}

const TAB_WIDTH = 4

const HEADER = /^(class|def|async\s+def|for|async\s+for|while|if|elif|else|try|except|finally|with|async\s+with|match|case)\b/

const KINDS: Record<string, ScopeKind> = {
  class: 'class',
  def: 'def',
  for: 'loop',
  while: 'loop'
}

function kindOf(keyword: string): ScopeKind {
  const base = keyword.replace(/^async\s+/, '')
  return KINDS[base] ?? 'branch'
}

interface LineInfo {
  indent: number
  /** Whitespace- or comment-only: never starts or ends a block. */
  blank: boolean
  /** The line begins a new statement (not inside a string, bracket or backslash continuation). */
  startsStatement: boolean
  /** After this line no string, bracket or backslash continuation is open. */
  endsStatement: boolean
  /** Last code character outside strings/comments is ':' at bracket depth 0. */
  endsWithColon: boolean
  kind: ScopeKind | null
}

interface LexState {
  /** Open triple-quote delimiter, if the next line starts inside a string. */
  string: string | null
  brackets: number
  backslash: boolean
}

function indentWidth(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += TAB_WIDTH - (width % TAB_WIDTH)
    else break
  }
  return width
}

/** Lexes one line, updating `state`; returns the last code character seen (outside strings/comments). */
function lexLine(text: string, state: LexState): { lastCode: string; sawCode: boolean } {
  let i = 0
  let lastCode = ''
  let sawCode = false
  state.backslash = false
  while (i < text.length) {
    if (state.string) {
      const close = text.indexOf(state.string, i)
      if (close < 0) return { lastCode, sawCode }
      i = close + state.string.length
      state.string = null
      lastCode = '"'
      sawCode = true
      continue
    }
    const ch = text[i] ?? ''
    if (ch === '#') return { lastCode, sawCode }
    if (ch === '"' || ch === "'") {
      sawCode = true
      const triple = ch.repeat(3)
      if (text.startsWith(triple, i)) {
        state.string = triple
        i += 3
        continue
      }
      // single-line string: skip to the closing quote (escapes respected)
      let j = i + 1
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1
      i = Math.min(text.length, j + 1)
      lastCode = ch
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++
      continue
    }
    if (ch === '\\' && i === text.length - 1) {
      state.backslash = true
      i++
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') state.brackets++
    else if (ch === ')' || ch === ']' || ch === '}') state.brackets = Math.max(0, state.brackets - 1)
    lastCode = ch
    sawCode = true
    i++
  }
  return { lastCode, sawCode }
}

function scanLines(lines: readonly string[]): LineInfo[] {
  const state: LexState = { string: null, brackets: 0, backslash: false }
  const infos: LineInfo[] = []
  for (const text of lines) {
    const startsStatement = !state.string && state.brackets === 0 && !state.backslash
    const stripped = text.trim()
    const { lastCode, sawCode } = lexLine(text, state)
    const endsStatement = !state.string && state.brackets === 0 && !state.backslash
    const blank = startsStatement && !sawCode
    const match = startsStatement && !blank ? HEADER.exec(stripped) : null
    infos.push({
      indent: indentWidth(text),
      blank,
      startsStatement,
      endsStatement,
      endsWithColon: endsStatement && lastCode === ':',
      kind: match ? kindOf(match[1] ?? '') : null
    })
  }
  return infos
}

/** All compound-statement blocks of a Python source, outer blocks first. */
export function computeScopes(lines: readonly string[]): Scope[] {
  const infos = scanLines(lines)
  const scopes: Scope[] = []
  const stack: Scope[] = []
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i]
    if (!info || info.blank || !info.kind) continue
    // the header may span several lines (open brackets / backslash); it must end with ':'
    let k = i
    while (k < infos.length && !infos[k]?.endsStatement) k++
    const last = infos[k]
    if (!last || !last.endsWithColon) continue
    let end = k
    let bodyIndent = Number.POSITIVE_INFINITY
    for (let j = k + 1; j < infos.length; j++) {
      const li = infos[j]
      if (!li || li.blank) continue
      if (!li.startsStatement) {
        end = j // continuation of a statement that began inside the block
        continue
      }
      if (li.indent <= info.indent) break
      end = j
      bodyIndent = Math.min(bodyIndent, li.indent)
    }
    while (stack.length > 0 && (stack[stack.length - 1]?.end ?? -1) < i) stack.pop()
    const scope: Scope = {
      kind: info.kind,
      start: i,
      headerEnd: k,
      end,
      indent: info.indent,
      bodyIndent: Number.isFinite(bodyIndent) ? bodyIndent : info.indent,
      depth: stack.length,
      tailDepth: stack.filter((s) => s.end === end).length
    }
    scopes.push(scope)
    stack.push(scope)
  }
  return scopes
}
