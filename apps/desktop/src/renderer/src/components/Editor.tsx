import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { defaultHighlightStyle, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { linter, lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { python } from '@codemirror/lang-python'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import type { CompileResult } from '@bluepy/protocol'
import {
  breakpointGutter,
  breakpointLinesOf,
  currentLineField,
  registerBreakpointProvider,
  setBreakpointLines,
  setCurrentLine
} from '../editor/breakpoints'
import { lspDiagnostics, pyrightCompletions, pyrightHover } from '../editor/languageServer'
import { scopeHighlight, scopeHighlightTheme } from '../editor/scopeHighlight'
import { useStore } from '../store'

/** Editor chrome follows the app's CSS variables, so light and dark mode switch without rebuilding states. */
const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--editor-selection)'
  },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--border)', color: 'var(--muted)' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': { backgroundColor: 'var(--editor-bracket)', outline: '1px solid var(--editor-bracket-outline)' },
  '.cm-searchMatch': { backgroundColor: 'var(--editor-search)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--editor-search-selected)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-selection-match)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-text)' },
  '.cm-panels': { backgroundColor: 'var(--surface-alt)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button, .cm-panel select': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--muted)' },
  '.cm-lineNumbers .cm-gutterElement': { color: 'var(--muted)' }
})

/** Syntax colours: CodeMirror's default style in light mode, One Dark in dark mode. */
const highlightCompartment = new Compartment()
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
function highlightFor(dark: boolean): Extension {
  return syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle)
}

/** Syntax errors from the Lezer parse plus the last Compile result of this file. */
function diagnosticsFor(state: EditorState, file: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.isError) {
        const from = node.from
        const to = Math.max(node.to, Math.min(state.doc.length, from + 1))
        diagnostics.push({ from, to, severity: 'error', message: 'Syntaxfehler' })
      }
    }
  })
  const compile: CompileResult | undefined = useStore.getState().project?.compile[file]
  if (compile && !compile.ok && compile.error) {
    const lineNumber = Math.min(Math.max(compile.error.line ?? 1, 1), state.doc.lines)
    const line = state.doc.line(lineNumber)
    const col = Math.max(0, Math.min((compile.error.offset ?? 1) - 1, line.length))
    diagnostics.push({
      from: line.from + (compile.stage === 'syntax' ? col : 0),
      to: line.to,
      severity: 'error',
      message: `${compile.error.type}: ${compile.error.message}`
    })
  }
  // Pyright only when the parse is clean – otherwise its cascade of errors hides the real one.
  if (diagnostics.length === 0) diagnostics.push(...lspDiagnostics(state, useStore.getState().diagnostics[file] ?? []))
  return diagnostics
}

/** Keep Pyright's view of the document in sync (full text, debounced). */
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleSync(file: string, text: string): void {
  const previous = syncTimers.get(file)
  if (previous) clearTimeout(previous)
  syncTimers.set(
    file,
    setTimeout(() => {
      syncTimers.delete(file)
      void window.bluepy.editor.didChange(file, text)
    }, 300)
  )
}

const states = new Map<string, EditorState>()

function createState(file: string, content: string, onChange: (content: string) => void): EditorState {
  const extensions: Extension[] = [
    breakpointGutter((line) => void useStore.getState().toggleBreakpoint(file, line)),
    basicSetup,
    keymap.of([indentWithTab]),
    indentUnit.of('    '),
    python(),
    highlightCompartment.of(highlightFor(darkQuery.matches)),
    pyrightCompletions(file),
    pyrightHover(file),
    scopeHighlight,
    scopeHighlightTheme,
    editorTheme,
    currentLineField,
    lintGutter(),
    linter((view) => diagnosticsFor(view.state, file), { delay: 400 }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString()
        onChange(text)
        scheduleSync(file, text)
      }
    })
  ]
  void window.bluepy.editor.didOpen(file, content)
  const state = EditorState.create({ doc: content, extensions })
  const lines = useStore.getState().breakpoints[file] ?? []
  return lines.length ? state.update({ effects: setBreakpointLines.of(lines) }).state : state
}

export function Editor(): JSX.Element {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const shownFile = useRef<string | null>(null)
  const openFiles = useStore((s) => s.openFiles)
  const activeFile = useStore((s) => s.activeFile)
  const setFileContent = useStore((s) => s.setFileContent)
  const clearReveal = useStore((s) => s.clearReveal)
  const compileVersion = useStore((s) => s.project?.compile)
  const lspVersion = useStore((s) => s.diagnostics)
  const breakpoints = useStore((s) => s.breakpoints)
  const currentLine = useStore((s) => s.currentLine)
  const file = openFiles.find((f) => f.path === activeFile)
  const fileBreakpoints = file ? breakpoints[file.path] : undefined

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ state: EditorState.create({ doc: '', extensions: [editorTheme, EditorState.readOnly.of(true)] }), parent: host.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Switch the shown file, or reload it when its content changed outside the editor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const previous = shownFile.current
    const empty = (): EditorState => EditorState.create({ doc: '', extensions: [editorTheme, EditorState.readOnly.of(true)] })
    if (!file) {
      if (previous !== null) {
        states.set(previous, view.state)
        shownFile.current = null
        view.setState(empty())
      }
      return
    }
    const fresh = (): EditorState => createState(file.path, file.content, (content) => setFileContent(file.path, content))
    if (previous === file.path) {
      // Same file: only react when the content changed outside this editor (reload from disk).
      if (view.state.doc.toString() !== file.content) {
        const state = fresh()
        states.set(file.path, state)
        view.setState(state)
      }
      return
    }
    if (previous !== null) states.set(previous, view.state)
    let state = states.get(file.path)
    if (!state || state.doc.toString() !== file.content) {
      state = fresh()
      states.set(file.path, state)
    }
    shownFile.current = file.path
    view.setState(state)
    view.dispatch({ effects: highlightCompartment.reconfigure(highlightFor(darkQuery.matches)) })
    view.focus()
  }, [file, setFileContent])

  // Swap the syntax colours when the app switches between light and dark.
  useEffect(() => {
    const onChange = (): void => {
      viewRef.current?.dispatch({ effects: highlightCompartment.reconfigure(highlightFor(darkQuery.matches)) })
    }
    darkQuery.addEventListener('change', onChange)
    return () => darkQuery.removeEventListener('change', onChange)
  }, [])

  // The store is the source of truth for breakpoints; every file state reports its marker lines on save.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !file) return
    const path = file.path
    registerBreakpointProvider(path, () => breakpointLinesOf(shownFile.current === path ? view.state : (states.get(path) ?? view.state)))
    return () => registerBreakpointProvider(path, null)
  }, [file])

  // Mirror the store's breakpoints into the gutter of the shown file.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !file || shownFile.current !== file.path) return
    const lines = fileBreakpoints ?? []
    if (breakpointLinesOf(view.state).join(',') !== lines.join(',')) view.dispatch({ effects: setBreakpointLines.of(lines) })
  }, [file, fileBreakpoints])

  // Highlight the line the debugger is paused at.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !file || shownFile.current !== file.path) return
    const line = currentLine && currentLine.file === file.path ? currentLine.line : null
    const effects = [setCurrentLine.of(line)]
    if (line !== null && line >= 1 && line <= view.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }))
    }
    view.dispatch({ effects })
  }, [file, currentLine])

  // Reveal a line requested by "open in editor".
  useEffect(() => {
    const view = viewRef.current
    if (!view || !file?.revealLine) return
    const lineNumber = Math.min(Math.max(file.revealLine, 1), view.state.doc.lines)
    const line = view.state.doc.line(lineNumber)
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
    clearReveal(file.path)
  }, [file, clearReveal])

  // Refresh diagnostics when compile results or Pyright diagnostics arrive.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !file) return
    view.dispatch(setDiagnostics(view.state, diagnosticsFor(view.state, file.path)))
  }, [compileVersion, lspVersion, file])

  return (
    <div className="pane-body editor">
      <div className="editor-host" ref={host} />
      {!file && <div className="editor-empty hint">{t('editor.empty')}</div>}
    </div>
  )
}
