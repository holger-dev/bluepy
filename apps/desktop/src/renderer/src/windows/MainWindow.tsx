import { useEffect, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { AssignmentPane } from '../components/AssignmentPane'
import { CodePad } from '../components/CodePad'
import { CollapsiblePane, usePaneState } from '../components/Collapsible'
import { Editor } from '../components/Editor'
import { HubDialogs } from '../components/HubDialogs'
import { ObjectBench } from '../components/ObjectBench'
import { useObjectInteraction } from '../components/ObjectInteraction'
import { PythonSetupDialog } from '../components/PythonSetupDialog'
import { RecordingBar } from '../components/RecordingBar'
import { ReviewBar } from '../components/ReviewBar'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { Tabs } from '../components/Tabs'
import { Terminal } from '../components/Terminal'
import { ThemeToggle } from '../components/ThemeToggle'
import { Welcome } from '../components/Welcome'
import { useStore } from '../store'

/**
 * The editor is BluePy's main element: the project's files in tabs, the
 * Code Pad to try things out (with the object bench right below it, so
 * objects created there can be inspected and used) and the Terminal for
 * program output.  The class diagram lives in its own window.
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
  const runAllTests = useStore((s) => s.runAllTests)
  const assignment = useStore((s) => s.assignment)
  const review = useStore((s) => s.review)
  const { collapsed, toggle } = usePaneState()
  const objects = useObjectInteraction()
  const running = status === 'running'
  const dirty = openFiles.some((f) => f.content !== f.savedContent)
  const hasTests = (project?.model?.classes ?? []).some((c) => c.stereotype === 'unittest')
  const layoutClass = [
    'workspace',
    'workspace-main',
    collapsed.sidebar ? 'sidebar-collapsed' : '',
    collapsed.codepad ? 'codepad-collapsed' : '',
    collapsed.terminal ? 'terminal-collapsed' : '',
    collapsed.bench ? 'bench-collapsed' : '',
    assignment && !collapsed.assignment ? 'with-assignment' : ''
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
          {hasTests && (
            <button type="button" onClick={() => void runAllTests()} disabled={busy !== null} title="⌘⇧R / Ctrl+Shift+R">
              {busy === 'tests' ? t('toolbar.testsRunning') : t('toolbar.runTests')}
            </button>
          )}
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
        <div className="toolbar-spacer" />
        <ThemeToggle />
      </header>
      <RecordingBar />
      {review && <ReviewBar />}
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
          {assignment && (
            <section className="pane pane-assignment">
              <CollapsiblePane id="assignment" title={t('hub.assignmentPane')} collapsed={Boolean(collapsed.assignment)} onToggle={() => toggle('assignment')} orientation="vertical">
                <AssignmentPane />
              </CollapsiblePane>
            </section>
          )}
          <section className="pane pane-codepad">
            <CollapsiblePane id="codepad" title={t('codepad.title')} collapsed={Boolean(collapsed.codepad)} onToggle={() => toggle('codepad')} orientation="vertical">
              <div className="codepad-stack">
                <CodePad onInspect={objects.inspect} />
                <CollapsiblePane id="bench" title={t('bench.title')} collapsed={Boolean(collapsed.bench)} onToggle={() => toggle('bench')} orientation="horizontal">
                  <ObjectBench compact onObjectMenu={objects.onObjectMenu} onInspect={(obj) => objects.inspect(obj.name, obj.name)} />
                </CollapsiblePane>
              </div>
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
      {objects.overlay}
      <HubDialogs />
      {setupOpen && <PythonSetupDialog />}
    </div>
  )
}
