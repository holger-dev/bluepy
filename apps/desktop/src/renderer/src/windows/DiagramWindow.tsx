import { useCallback, useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { BenchObject, InvocationResult, LiveMethodInfo } from '@bluepy/protocol'
import { ClassDiagram, type DiagramNode } from '../components/ClassDiagram'
import { ContextMenu, type MenuEntry } from '../components/ContextMenu'
import { ObjectBench } from '../components/ObjectBench'
import { CreateObjectDialog, InspectorDialog, MethodCallDialog, ResultDialog, type DialogState } from '../components/ObjectDialogs'
import { PythonSetupDialog } from '../components/PythonSetupDialog'
import { StatusBar } from '../components/StatusBar'
import { useStore } from '../store'

interface MenuState {
  x: number
  y: number
  entries: MenuEntry[]
}

function signature(params: { name: string; annotation: string | null; default: string | null }[]): string {
  return params.map((p) => (p.default !== null ? `${p.name}=${p.default}` : p.name)).join(', ')
}

/**
 * BlueJ's "project window": the class diagram with the object bench below.
 * Right-click a class to create objects or call static methods, right-click
 * an object to call its methods, inspect or remove it.
 */
export function DiagramWindow(): JSX.Element {
  const { t } = useTranslation()
  const bootstrap = useStore((s) => s.bootstrap)
  const setupOpen = useStore((s) => s.setupOpen)
  const openWindow = useStore((s) => s.openWindow)
  const project = useStore((s) => s.project)
  const status = useStore((s) => s.backendStatus)
  const busy = useStore((s) => s.busy)
  const compile = useStore((s) => s.compile)
  const runModule = useStore((s) => s.runModule)
  const describeClass = useStore((s) => s.describeClass)
  const removeObject = useStore((s) => s.removeObject)
  const setMessage = useStore((s) => s.setMessage)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const running = status === 'running'

  useEffect(() => {
    void bootstrap('diagram')
  }, [bootstrap])

  const closeMenu = useCallback(() => setMenu(null), [])

  const showResult = (label: string, result: InvocationResult): void => {
    if (result.value) setDialog({ kind: 'result', label, result })
    else setMessage(`${label} ✓`)
  }

  // --------------------------------------------------------- class menu

  const onClassMenu = async (node: DiagramNode, x: number, y: number): Promise<void> => {
    const entries: MenuEntry[] = []
    const compiled = project?.compile[node.file]?.ok === true
    const hint = !running ? t('menu.needsBackend') : !compiled ? t('menu.needsCompile') : undefined

    if (node.kind === 'class' && node.cls) {
      const cls = node.cls
      const ctor = cls.methods.find((m) => m.name === '__init__')
      const ctorParams = ctor ? ctor.params : []
      entries.push({
        label: `new ${cls.name}(${signature(ctorParams)})`,
        detail: hint,
        disabled: !running || !compiled || cls.stereotype === 'abstract' || cls.stereotype === 'interface',
        onSelect: () => {
          void describeClass(cls.module, cls.name)
            .then((live) => setDialog({ kind: 'create', module: cls.module, name: cls.name, live }))
            .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
        }
      })
      const statics = cls.methods.filter((m) => (m.kind === 'static' || m.kind === 'classmethod') && m.visibility === 'public')
      if (statics.length) entries.push({ label: t('menu.staticMethods'), heading: true })
      for (const m of statics) {
        entries.push({
          label: `${cls.name}.${m.name}(${signature(m.params)})`,
          disabled: !running || !compiled,
          onSelect: () => setDialog({ kind: 'call', target: { module: cls.module, name: cls.name }, method: m })
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
    if (node.kind === 'class' && node.cls) {
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
    }
    setMenu({ x, y, entries })
  }

  // -------------------------------------------------------- object menu

  const onObjectMenu = async (obj: BenchObject, x: number, y: number): Promise<void> => {
    const entries: MenuEntry[] = []
    try {
      const live = await describeClass(obj.module, obj.type)
      const callable = live.methods.filter((m) => (m.kind === 'instance' || m.kind === 'classmethod') && m.visibility === 'public')
      const own = callable.filter((m) => !m.inherited)
      const inherited = callable.filter((m) => m.inherited)
      const add = (m: LiveMethodInfo): void => {
        entries.push({
          label: `${m.name}(${signature(m.params)})`,
          detail: m.returns ? `→ ${m.returns}` : undefined,
          onSelect: () => setDialog({ kind: 'call', target: { bench: obj.name, type: obj.type }, method: m })
        })
      }
      own.forEach(add)
      const byClass = new Map<string, LiveMethodInfo[]>()
      for (const m of inherited) byClass.set(m.definedIn, [...(byClass.get(m.definedIn) ?? []), m])
      for (const [definedIn, methods] of byClass) {
        entries.push({ label: t('menu.inheritedFrom', { name: definedIn }), heading: true })
        methods.forEach(add)
      }
      if (callable.length === 0) entries.push({ label: t('menu.noMethods'), disabled: true })
    } catch (e) {
      entries.push({ label: e instanceof Error ? e.message : String(e), disabled: true })
    }
    entries.push({ separator: true, label: '' })
    entries.push({ label: t('dialog.inspect'), onSelect: () => setDialog({ kind: 'inspect', name: obj.name, title: obj.name, path: [] }) })
    entries.push({ label: t('menu.remove'), onSelect: () => void removeObject(obj.name) })
    setMenu({ x, y, entries })
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-group">
          <button type="button" className="primary" onClick={() => void compile()} disabled={!project || busy !== null} title="⌘K">
            {busy === 'compile' ? t('toolbar.compiling') : t('toolbar.compile')}
          </button>
        </div>
        <div className="toolbar-spacer" />
        <span className="toolbar-title">{project ? project.name : t('app.title')}</span>
        <div className="toolbar-spacer" />
        <button type="button" onClick={() => void openWindow('main')} title="⌘⇧E / Ctrl+Shift+E">
          {t('toolbar.editorWindow')}
        </button>
      </header>
      <main className="workspace workspace-diagram">
        <section className="pane pane-diagram">
          <ClassDiagram onClassMenu={(node, x, y) => void onClassMenu(node, x, y)} />
        </section>
        <section className="pane pane-bench">
          <ObjectBench
            onObjectMenu={(obj, x, y) => void onObjectMenu(obj, x, y)}
            onInspect={(obj) => setDialog({ kind: 'inspect', name: obj.name, title: obj.name, path: [] })}
          />
        </section>
      </main>
      <StatusBar />
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={closeMenu} />}
      {dialog?.kind === 'create' && <CreateObjectDialog state={dialog} onClose={() => setDialog(null)} onResult={showResult} />}
      {dialog?.kind === 'call' && <MethodCallDialog state={dialog} onClose={() => setDialog(null)} onResult={showResult} />}
      {dialog?.kind === 'result' && (
        <ResultDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onInspect={() => setDialog({ kind: 'inspect', name: '_', title: t('dialog.resultTitle'), path: [] })}
        />
      )}
      {dialog?.kind === 'inspect' && (
        <InspectorDialog state={dialog} onClose={() => setDialog(null)} onNavigate={(path) => setDialog({ ...dialog, path })} />
      )}
      {setupOpen && <PythonSetupDialog />}
    </div>
  )
}
