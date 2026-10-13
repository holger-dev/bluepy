/**
 * BlueJ-style scope highlighting for Python.
 *
 * Every compound statement (class, def, loop, if/try/with/match clause) is
 * drawn as a rounded box *behind* the text: a coloured frame that starts at
 * the header's indentation, plus a lighter inner area for the body.  Nested
 * blocks are inset on the right and bottom, so the structure of a file is
 * visible at a glance – class (green) > method (yellow) > loop (blue) /
 * branch (lilac).  Colours are CSS variables (`--scope-*` in styles.css).
 *
 * Block detection follows Python's own rule (indentation) with a tiny lexer
 * for strings, comments and brackets, so colons inside strings, comments at
 * column 0 and multi-line headers do not confuse it.  `computeScopes` is pure
 * and unit-tested; the CodeMirror part is a `layer()` below the selection.
 */
import type { Text } from '@codemirror/state'
import { EditorView, layer, RectangleMarker } from '@codemirror/view'

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

// ----------------------------------------------------------------- rendering

const PAD_LEFT = 3 // px between box edge and the first character
const GAP_RIGHT = 2 // px between the outermost box and the content edge
const STEP_RIGHT = 8 // px each nesting level is inset on the right
const INNER_INSET_RIGHT = 6 // px the light body area stays inside the frame
const STEP_BOTTOM = 2 // px each nested box ending on the same line is shortened
const INNER_INSET_BOTTOM = 1

const cache = new WeakMap<Text, Scope[]>()

function scopesOf(doc: Text): Scope[] {
  let scopes = cache.get(doc)
  if (!scopes) {
    const lines: string[] = []
    for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text)
    scopes = computeScopes(lines)
    cache.set(doc, scopes)
  }
  return scopes
}

function buildMarkers(view: EditorView): readonly RectangleMarker[] {
  const doc = view.state.doc
  const scopes = scopesOf(doc)
  if (scopes.length === 0) return []

  // Same coordinate base as RectangleMarker.forRange: scroller origin minus scroll offset.
  const scroll = view.scrollDOM.getBoundingClientRect()
  const baseLeft = scroll.left - view.scrollDOM.scrollLeft * view.scaleX
  const baseTop = scroll.top - view.scrollDOM.scrollTop * view.scaleY
  const content = view.contentDOM.getBoundingClientRect()
  const lineEl = view.contentDOM.querySelector('.cm-line')
  const style = lineEl ? window.getComputedStyle(lineEl) : null
  const textLeft = content.left + (style ? parseInt(style.paddingLeft, 10) || 0 : 0) - baseLeft
  const contentRight = content.right - (style ? parseInt(style.paddingRight, 10) || 0 : 0) - baseLeft
  const charWidth = view.defaultCharacterWidth
  const docTop = view.documentTop - baseTop

  const firstVisible = doc.lineAt(view.viewport.from).number - 1
  const lastVisible = doc.lineAt(view.viewport.to).number - 1
  const lineTop = (line: number): number => docTop + view.lineBlockAt(doc.line(line + 1).from).top
  const lineBottom = (line: number): number => docTop + view.lineBlockAt(doc.line(line + 1).from).bottom

  const markers: RectangleMarker[] = []
  for (const scope of scopes) {
    if (scope.end < firstVisible || scope.start > lastVisible) continue
    const top = lineTop(scope.start)
    const bottom = lineBottom(scope.end) - scope.tailDepth * STEP_BOTTOM
    const left = textLeft + scope.indent * charWidth - PAD_LEFT
    const right = contentRight - GAP_RIGHT - scope.depth * STEP_RIGHT
    if (right - left < charWidth || bottom <= top) continue
    markers.push(new RectangleMarker(`cm-scope-box cm-scope-${scope.kind}`, left, top, right - left, bottom - top))
    if (scope.end > scope.headerEnd) {
      const innerTop = lineTop(scope.headerEnd + 1)
      const innerLeft = textLeft + scope.bodyIndent * charWidth - PAD_LEFT
      const innerRight = right - INNER_INSET_RIGHT
      const innerBottom = bottom - INNER_INSET_BOTTOM
      if (innerRight > innerLeft && innerBottom > innerTop) {
        markers.push(
          new RectangleMarker(
            `cm-scope-inner cm-scope-${scope.kind}`,
            innerLeft,
            innerTop,
            innerRight - innerLeft,
            innerBottom - innerTop
          )
        )
      }
    }
  }
  return markers
}

/** Draws the scope boxes in a layer below the selection (registered after basicSetup → lower z-index). */
export const scopeHighlight = layer({
  above: false,
  class: 'cm-scope-layer',
  update: (update) => update.docChanged || update.viewportChanged,
  markers: (view) => buildMarkers(view)
})

const themeSpec: Record<string, Record<string, string>> = {
  '.cm-scope-box': { borderRadius: '4px', boxSizing: 'border-box', border: '1px solid transparent' },
  '.cm-scope-inner': { borderRadius: '3px' }
}
for (const kind of ['class', 'def', 'loop', 'branch'] as const) {
  themeSpec[`.cm-scope-box.cm-scope-${kind}`] = {
    backgroundColor: `var(--scope-${kind})`,
    borderColor: `var(--scope-${kind}-border)`
  }
  themeSpec[`.cm-scope-inner.cm-scope-${kind}`] = { backgroundColor: `var(--scope-${kind}-inner)` }
}

export const scopeHighlightTheme = EditorView.baseTheme(themeSpec)
