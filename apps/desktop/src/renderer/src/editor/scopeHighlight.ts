/**
 * BlueJ-style scope highlighting for Python: every line is tinted according to
 * its indentation depth, so nested blocks appear as nested coloured bands.
 *
 * M0 keeps it indentation-based (cheap, no parser needed).  M1 switches to the
 * Lezer syntax tree for exact block spans (e.g. multi-line expressions).
 */
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

const MAX_LEVEL = 6
const TAB_WIDTH = 4

function indentWidth(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += TAB_WIDTH - (width % TAB_WIDTH)
    else break
  }
  return width
}

function isBlank(line: string): boolean {
  return line.trim().length === 0
}

/** Indentation level per line of the whole document (blank lines inherit the surrounding block). */
export function computeLevels(lines: readonly string[], indentUnit = 4): number[] {
  const unit = Math.max(1, indentUnit)
  const raw = lines.map((l) => (isBlank(l) ? -1 : Math.min(MAX_LEVEL, Math.floor(indentWidth(l) / unit))))
  const levels = new Array<number>(lines.length).fill(0)
  let nextNonBlank = 0
  for (let i = 0; i < raw.length; i++) {
    const level = raw[i] ?? 0
    if (level >= 0) {
      levels[i] = level
      continue
    }
    // blank: min(previous non-blank, next non-blank) keeps bands closed at block ends
    let j = Math.max(nextNonBlank, i + 1)
    while (j < raw.length && (raw[j] ?? -1) < 0) j++
    nextNonBlank = j
    const prev = i > 0 ? (levels[i - 1] ?? 0) : 0
    const next = j < raw.length ? (raw[j] ?? 0) : 0
    levels[i] = Math.min(prev, next)
  }
  return levels
}

const lineDecorations = Array.from({ length: MAX_LEVEL + 1 }, (_, level) =>
  Decoration.line({ class: `cm-scope cm-scope-${level}` })
)

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const lines: string[] = []
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text)
  const levels = computeLevels(lines)
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    for (let n = first; n <= last; n++) {
      const line = doc.line(n)
      const level = levels[n - 1] ?? 0
      const decoration = lineDecorations[level] ?? lineDecorations[0]
      if (decoration) builder.add(line.from, line.from, decoration)
    }
  }
  return builder.finish()
}

export const scopeHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

export const scopeHighlightTheme = EditorView.baseTheme({
  '.cm-scope-1': { backgroundColor: 'var(--scope-1)' },
  '.cm-scope-2': { backgroundColor: 'var(--scope-2)' },
  '.cm-scope-3': { backgroundColor: 'var(--scope-3)' },
  '.cm-scope-4': { backgroundColor: 'var(--scope-4)' },
  '.cm-scope-5': { backgroundColor: 'var(--scope-5)' },
  '.cm-scope-6': { backgroundColor: 'var(--scope-6)' }
})
