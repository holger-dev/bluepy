/**
 * Breakpoint gutter and "current line" highlight for CodeMirror 6.
 *
 * The store owns the breakpoint line numbers (they are sent to the backend);
 * the gutter mirrors them.  While editing, markers move with the text; on
 * save the store asks `currentBreakpointLines()` for their new positions.
 */
import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view'

class BreakpointMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-breakpoint-marker'
    el.title = 'Breakpoint'
    return el
  }
}
const breakpointMarker = new BreakpointMarker()

export const setBreakpointLines = StateEffect.define<number[]>()

export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setBreakpointLines)) {
        const wanted: number[] = effect.value
        const lines = [...new Set(wanted)].filter((l) => l >= 1 && l <= tr.state.doc.lines).sort((a, b) => a - b)
        next = RangeSet.of(
          lines.map((l) => breakpointMarker.range(tr.state.doc.line(l).from)),
          true
        )
      }
    }
    return next
  }
})

export function breakpointLinesOf(state: EditorState): number[] {
  const lines: number[] = []
  const iter = state.field(breakpointField, false)?.iter()
  if (!iter) return lines
  while (iter.value) {
    lines.push(state.doc.lineAt(iter.from).number)
    iter.next()
  }
  return [...new Set(lines)]
}

export function breakpointGutter(onToggle: (line: number) => void): Extension {
  return [
    breakpointField,
    gutter({
      class: 'cm-breakpoint-gutter',
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => breakpointMarker,
      domEventHandlers: {
        mousedown(view, line) {
          onToggle(view.state.doc.lineAt(line.from).number)
          return true
        }
      }
    })
  ]
}

// ------------------------------------------------------------ current line

export const setCurrentLine = StateEffect.define<number | null>()

const currentLineDecoration = Decoration.line({ class: 'cm-debug-line' })

export const currentLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setCurrentLine)) {
        const line: number | null = effect.value
        next =
          line !== null && line >= 1 && line <= tr.state.doc.lines
            ? Decoration.set([currentLineDecoration.range(tr.state.doc.line(line).from)])
            : Decoration.none
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

// ----------------------------------------------------- store ↔ editor link

const lineProviders = new Map<string, () => number[]>()

export function registerBreakpointProvider(file: string, provider: (() => number[]) | null): void {
  if (provider) lineProviders.set(file, provider)
  else lineProviders.delete(file)
}

/** Current breakpoint lines of a file as shown in its editor, or null when the file has no editor state. */
export function currentBreakpointLines(file: string): number[] | null {
  const provider = lineProviders.get(file)
  return provider ? provider() : null
}
