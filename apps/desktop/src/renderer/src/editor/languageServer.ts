/**
 * CodeMirror side of the Pyright integration: completion source, hover
 * tooltip and type-checker diagnostics, all via IPC to the main process
 * (../../../main/lsp/pyright.ts).  Document sync happens in Editor.tsx.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { pythonLanguage } from '@codemirror/lang-python'
import type { Diagnostic } from '@codemirror/lint'
import { hoverTooltip, type EditorView, type Tooltip } from '@codemirror/view'
import type { EditorState, Extension } from '@codemirror/state'
import type { CompletionItem, LspDiagnostic } from '@bluepy/protocol'

const COMPLETION_TYPE: Record<CompletionItem['kind'], string> = {
  text: 'text',
  method: 'method',
  function: 'function',
  constructor: 'class',
  field: 'property',
  variable: 'variable',
  class: 'class',
  interface: 'interface',
  module: 'namespace',
  property: 'property',
  enum: 'enum',
  keyword: 'keyword',
  constant: 'constant'
}

function positionOf(state: EditorState, pos: number): { line: number; character: number } {
  const line = state.doc.lineAt(pos)
  return { line: line.number - 1, character: pos - line.from }
}

/** A plain-text rendering of Markdown from Pyright (code fences become <pre>). */
export function renderDoc(markdown: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'cm-lsp-doc'
  const parts = markdown.split(/```(?:python)?\n?/)
  parts.forEach((part, i) => {
    if (!part.trim()) return
    if (i % 2 === 1) {
      const pre = document.createElement('pre')
      pre.textContent = part.replace(/\n+$/, '')
      root.appendChild(pre)
    } else {
      const p = document.createElement('div')
      p.textContent = part.trim().replace(/\\([_*`])/g, '$1')
      root.appendChild(p)
    }
  })
  return root
}

/** Completion source backed by Pyright; registered as Python language data so basicSetup's autocompletion uses it. */
export function pyrightCompletions(file: string): Extension {
  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w.]*/)
    const before = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos)
    if (!context.explicit && !word?.text && before !== '.') return null
    if (word && /^\d/.test(word.text)) return null
    const { line, character } = positionOf(context.state, context.pos)
    const items = await window.bluepy.editor.complete(file, line, character)
    if (context.aborted || items.length === 0) return null
    const from = word && !word.text.endsWith('.') ? context.pos - (word.text.split('.').pop()?.length ?? 0) : context.pos
    const options: Completion[] = items.map((item) => ({
      label: item.label,
      type: COMPLETION_TYPE[item.kind],
      detail: item.detail ?? undefined,
      apply: item.insertText ?? item.label,
      boost: item.sortText?.startsWith('00') ? 1 : 0,
      info: async () => {
        const resolved = item.documentation ? item : await window.bluepy.editor.resolveCompletion(item)
        return resolved.documentation ? renderDoc(resolved.documentation) : null
      }
    }))
    return { from, options, validFor: /^\w*$/ }
  }
  return pythonLanguage.data.of({ autocomplete: source }) // basicSetup's autocompletion() picks language sources up
}

/** Hover tooltip with Pyright's signature / docstring. */
export function pyrightHover(file: string): Extension {
  return hoverTooltip(async (view: EditorView, pos: number): Promise<Tooltip | null> => {
    const { line, character } = positionOf(view.state, pos)
    const info = await window.bluepy.editor.hover(file, line, character)
    if (!info) return null
    let from = pos
    let to = pos
    if (info.range) {
      const startLine = view.state.doc.line(Math.min(view.state.doc.lines, info.range.start.line + 1))
      const endLine = view.state.doc.line(Math.min(view.state.doc.lines, info.range.end.line + 1))
      from = Math.min(startLine.to, startLine.from + info.range.start.character)
      to = Math.min(endLine.to, endLine.from + info.range.end.character)
    }
    return { pos: from, end: to, above: true, create: () => ({ dom: renderDoc(info.contents) }) }
  }, { hoverTime: 400 })
}

/** Translate Pyright diagnostics into CodeMirror lint diagnostics for the current document. */
export function lspDiagnostics(state: EditorState, items: readonly LspDiagnostic[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const d of items) {
    if (d.from.line >= state.doc.lines) continue
    const startLine = state.doc.line(d.from.line + 1)
    const endLine = state.doc.line(Math.min(state.doc.lines, d.to.line + 1))
    const from = Math.min(startLine.to, startLine.from + d.from.character)
    const to = Math.max(from, Math.min(endLine.to, endLine.from + d.to.character))
    out.push({ from, to: to === from ? Math.min(state.doc.length, from + 1) : to, severity: d.severity, message: d.message, source: 'Pyright' })
  }
  return out
}
