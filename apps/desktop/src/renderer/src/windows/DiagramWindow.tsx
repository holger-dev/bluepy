import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClassInfo } from '@bluepy/protocol'
import { ClassDiagram, type DiagramNode } from '../components/ClassDiagram'
import { CollapsiblePane, usePaneState } from '../components/Collapsible'
import type { MenuEntry } from '../components/ContextMenu'
import { ObjectBench } from '../components/ObjectBench'
import { signature, useObjectInteraction } from '../components/ObjectInteraction'
import { PythonSetupDialog } from '../components/PythonSetupDialog'
import { RecordingBar } from '../components/RecordingBar'
import { StatusBar } from '../components/StatusBar'
import { RecordTestDialog } from '../components/TestDialogs'
import { ThemeToggle } from '../components/ThemeToggle'
import { useStore } from '../store'

/**
 * BlueJ's "project window": the class diagram with the object bench below.
 * Right-click a class to create objects, call static methods or work with
 * its tests; right-click an object to call its methods, inspect or remove it.
 */
export function DiagramWindow(): JSX.Element {
  const { t } = useTranslation()
  const bootstrap = useStore((s) => s.bootstrap)
  const setupOpen = useStore((s) => s.setupOpen)
  const openWindow = useStore((s) => s.openWindow)
  const project = useStore((s) => s.project)
  const status = useStore((s) => s.backendStatus)
  const busy = useStore((s) => s.busy)
  const recording = useStore((s) => s.recording)
  const compile = useStore((s) => s.compile)
  const runModule = useStore((s) => s.runModule)
  const describeClass = useStore((s) => s.describeClass)
  const runTests = useStore((s) => s.runTests)
  const runAllTests = useStore((s) => s.runAllTests)
  const createTestClass = useStore((s) => s.createTestClass)
  const benchToFixture = useStore((s) => s.benchToFixture)
  const fixtureToBench = useStore((s) => s.fixtureToBench)
  const objects = useObjectInteraction()
  const [recordDialog, setRecordDialog] = useState<{ file: string; className: string; existing: string[] } | null>(null)
  const { collapsed, toggle } = usePaneState()
  const running = status === 'running'
  const hasTests = (project?.model?.classes ?? []).some((c) => c.stereotype === 'unittest')

  useEffect(() => {
    void bootstrap('diagram')
  }, [bootstrap])

  // --------------------------------------------------------- class menu

  const testEntries = (cls: ClassInfo, compiled: boolean): MenuEntry[] => {
    const entries: MenuEntry[] = []
    const hint = !running ? t('menu.needsBackend') : !compiled ? t('menu.needsCompile') : undefined
    const testMethods = cls.methods.filter((m) => m.name.startsWith('test'))
    const hasFixture = cls.methods.some((m) => m.name === 'setUp')
    const busyOrRecording = busy !== null || recording !== null
    entries.push({
      label: t('tests.testAll'),
      detail: hint,
      disabled: busyOrRecording,
      onSelect: () => void runTests({ files: [cls.file], className: cls.name, label: cls.name })
    })
    for (const m of testMethods) {
      entries.push({
        label: `${m.name}()`,
        disabled: busyOrRecording,
        onSelect: () => void runTests({ files: [cls.file], className: cls.name, method: m.name, label: `${cls.name}.${m.name}` })
      })
    }
    entries.push({ separator: true, label: '' })
    entries.push({
      label: t('tests.createMethod'),
      detail: hint,
      disabled: !running || !compiled || busyOrRecording,
      onSelect: () => setRecordDialog({ file: cls.file, className: cls.name, existing: cls.methods.map((m) => m.name) })
    })
    entries.push({
      label: t('tests.benchToFixture'),
      detail: hint,
      disabled: !running || busyOrRecording,
      onSelect: () => void benchToFixture(cls.file, cls.name)
    })
    entries.push({
      label: t('tests.fixtureToBench'),
      detail: hint ?? (!hasFixture ? t('tests.noFixture') : undefined),
      disabled: !running || !compiled || busyOrRecording || !hasFixture,
      onSelect: () => void fixtureToBench(cls.file, cls.name)
    })
    entries.push({ separator: true, label: '' })
    return entries
  }

  const onClassMenu = (node: DiagramNode, x: number, y: number): void => {
    const entries: MenuEntry[] = []
    const compiled = project?.compile[node.file]?.ok === true
    const hint = !running ? t('menu.needsBackend') : !compiled ? t('menu.needsCompile') : undefined

    if (node.kind === 'class' && node.cls?.stereotype === 'unittest') {
      entries.push(...testEntries(node.cls, compiled))
    } else if (node.kind === 'class' && node.cls) {
      const cls = node.cls
      const ctor = cls.methods.find((m) => m.name === '__init__')
      const ctorParams = ctor ? ctor.params : []
      entries.push({
        label: `new ${cls.name}(${signature(ctorParams)})`,
        detail: hint,
        disabled: !running || !compiled || cls.stereotype === 'abstract' || cls.stereotype === 'interface',
        onSelect: () => objects.openCreate(cls.module, cls.name)
      })
      const statics = cls.methods.filter((m) => (m.kind === 'static' || m.kind === 'classmethod') && m.visibility === 'public')
      if (statics.length) entries.push({ label: t('menu.staticMethods'), heading: true })
      for (const m of statics) {
        entries.push({
          label: `${cls.name}.${m.name}(${signature(m.params)})`,
          disabled: !running || !compiled,
          onSelect: () => objects.openCall({ module: cls.module, name: cls.name }, m)
        })
      }
      entries.push({ separator: true, label: '' })
    }
    entries.push({ label: t('menu.openEditor'), onSelect: () => void window.bluepy.editor.open(node.file, node.line) })
    entries.push({ label: t('toolbar.compile'), disabled: busy !== null, onSelect: () => void compile() })
    const mod = project?.model?.modules.find((m) => m.file === node.file)
    if (mod?.hasMain) {
      entries.push({
        label: t('menu.runModule', { file: node.file }),
        disabled: !running || !compiled,
        detail: hint,
        onSelect: () => void runModule(node.file)
      })
    }
    if (node.kind === 'class' && node.cls && node.cls.stereotype !== 'unittest') {
      const cls = node.cls
      entries.push({
        label: t('menu.inspectClass'),
        disabled: !running || !compiled,
        onSelect: () => {
          void describeClass(cls.module, cls.name).then((live) => {
            const attrs = live.classAttributes.map((a) => `${a.name} = ${a.value.repr}`).join('\n') || t('dialog.noFields')
            window.alert(`${cls.name}\n\n${attrs}`)
          })
        }
      })
      const hasTestClass = (project?.model?.classes ?? []).some((c) => c.stereotype === 'unittest' && c.name === `${cls.name}Test`)
      if (!hasTestClass && cls.stereotype !== 'exception') {
        entries.push({ label: t('tests.createClass'), disabled: busy !== null, onSelect: () => void createTestClass(cls.id) })
      }
    }
    objects.showMenu(x, y, entries)
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-group">
          <button type="button" className="primary" onClick={() => void compile()} disabled={!project || busy !== null} title="⌘K">
            {busy === 'compile' ? t('toolbar.compiling') : t('toolbar.compile')}
          </button>
          {hasTests && (
            <button type="button" onClick={() => void runAllTests()} disabled={busy !== null || recording !== null} title="⌘⇧R / Ctrl+Shift+R">
              {busy === 'tests' ? t('toolbar.testsRunning') : t('toolbar.runTests')}
            </button>
          )}
        </div>
        <div className="toolbar-spacer" />
        <span className="toolbar-title">{project ? project.name : t('app.title')}</span>
        <div className="toolbar-spacer" />
        <button type="button" onClick={() => void openWindow('main')} title="⌘⇧E / Ctrl+Shift+E">
          {t('toolbar.editorWindow')}
        </button>
        {hasTests && (
          <button type="button" onClick={() => void openWindow('tests')} title="⌘⇧T / Ctrl+Shift+T">
            {t('toolbar.testsWindow')}
          </button>
        )}
        <ThemeToggle />
      </header>
      <RecordingBar />
      <main className={`workspace workspace-diagram ${collapsed.bench ? 'bench-collapsed' : ''}`}>
        <section className="pane pane-diagram">
          <ClassDiagram onClassMenu={onClassMenu} />
        </section>
        <section className="pane pane-bench">
          <CollapsiblePane id="bench" title={t('bench.title')} collapsed={Boolean(collapsed.bench)} onToggle={() => toggle('bench')} orientation="horizontal">
            <ObjectBench onObjectMenu={objects.onObjectMenu} onInspect={(obj) => objects.inspect(obj.name, obj.name)} />
          </CollapsiblePane>
        </section>
      </main>
      <StatusBar />
      {objects.overlay}
      {recordDialog && (
        <RecordTestDialog file={recordDialog.file} className={recordDialog.className} existing={recordDialog.existing} onClose={() => setRecordDialog(null)} />
      )}
      {setupOpen && <PythonSetupDialog />}
    </div>
  )
}
