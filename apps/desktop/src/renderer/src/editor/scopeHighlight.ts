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
 * Block detection lives in ../../../shared/pythonScopes (shared with the main
 * process); this file is only the CodeMirror `layer()` below the selection.
 */
import type { Text } from '@codemirror/state'
import { EditorView, layer, RectangleMarker } from '@codemirror/view'
import { computeScopes, type Scope, type ScopeKind } from '../../../shared/pythonScopes'

export { computeScopes, type Scope, type ScopeKind }

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
