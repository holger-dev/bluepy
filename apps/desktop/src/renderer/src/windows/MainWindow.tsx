import { useEffect, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { CodePad } from '../components/CodePad'
import { CollapsiblePane, usePaneState } from '../components/Collapsible'
import { Editor } from '../components/Editor'
import { PythonSetupDialog } from '../components/PythonSetupDialog'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { Tabs } from '../components/Tabs'
import { Terminal } from '../components/Terminal'
import { Welcome } from '../components/Welcome'
import { useStore } from '../store'

/**
 * The editor is BluePy's main element: the project's files in tabs, the
 * Code Pad to try things out and the Terminal for program output.  The class
 * diagram (with the object bench) lives in its own window.
 */
export function MainWindow(): JSX.Element {
  const { t } = useTranslation()
  const bootstrap = useStore((s) => s.bootstrap)
  const ready = useStore((s) => s.ready)
  const setupOpen = useStore((s) => s.setupOpen)
  const status = useStore((s) => s.backendStatus)
  const project = useStore((s) => s.project)
  const busy = useStore((s) => s.busy)
  const halt = useStore((s) => s.halt)
  const resetBackend = useStore((s) => s.resetBackend)
  const openWindow = useStore((s) => s.openWindow)
  const compile = useStore((s) => s.compile)
  const saveAll = useStore((s) => s.saveAll)
  const openFiles = useStore((s) => s.openFiles)
  const { collapsed, toggle } = usePaneState()
  const running = status === 'running'
  const dirty = openFiles.some((f) => f.content !== f.savedContent)
  const layoutClass = [
    'workspace',
    'workspace-main',
    collapsed.sidebar ? 'sidebar-collapsed' : '',
    collapsed.codepad ? 'codepad-collapsed' : '',
    collapsed.terminal ? 'terminal-collapsed' : ''
  ].join(' ')

  useEffect(() => {
    void bootstrap('main')
  }, [bootstrap])

  const onReset = (): void => {
    if (window.confirm(t('toolbar.resetPythonConfirm'))) void resetBackend()
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-group">
          <button type="button" onClick={() => void openWindow('diagram')} title="⌘⇧D / Ctrl+Shift+D" disabled={!project}>
            {t('toolbar.diagramWindow')}
          </button>
          <button type="button" onClick={() => void openWindow('debugger')} title="⌘⇧B / Ctrl+Shift+B" disabled={!project}>
            {t('toolbar.debuggerWindow')}
          </button>
          <button type="button" onClick={() => void saveAll()} disabled={!dirty} title="⌘S">
            {t('toolbar.save')}
          </button>
          <button type="button" className="primary" onClick={() => void compile()} disabled={!project || busy !== null} title="⌘K">
            {busy === 'compile' ? t('toolbar.compiling') : t('toolbar.compile')}
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={() => void halt()} disabled={!running}>
            {t('toolbar.halt')}
          </button>
          <button type="button" onClick={onReset} disabled={!project || status === 'unavailable' || status === 'starting'}>
            {t('toolbar.resetPython')}
          </button>
        </div>
        <div className="toolbar-spacer" />
        <span className="toolbar-title">
          {project ? project.name : t('app.title')} <small>{t('app.milestone')}</small>
        </span>
      </header>
      {!ready ? (
        <div className="welcome" />
      ) : !project ? (
        <Welcome />
      ) : (
        <main className={layoutClass}>
          <section className="pane pane-sidebar">
            <CollapsiblePane id="sidebar" title={project.name} collapsed={Boolean(collapsed.sidebar)} onToggle={() => toggle('sidebar')} orientation="vertical">
              <Sidebar />
            </CollapsiblePane>
          </section>
          <section className="pane pane-editor">
            <Tabs />
            <Editor />
          </section>
          <section className="pane pane-codepad">
            <CollapsiblePane id="codepad" title={t('codepad.title')} collapsed={Boolean(collapsed.codepad)} onToggle={() => toggle('codepad')} orientation="vertical">
              <CodePad />
            </CollapsiblePane>
          </section>
          <section className="pane pane-terminal">
            <CollapsiblePane id="terminal" title={t('terminal.title')} collapsed={Boolean(collapsed.terminal)} onToggle={() => toggle('terminal')} orientation="horizontal">
              <Terminal />
            </CollapsiblePane>
          </section>
        </main>
      )}
      <StatusBar />
      {setupOpen && <PythonSetupDialog />}
    </div>
  )
}
