import { useCallback, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { BenchObject, InvocationResult, LiveMethodInfo, ParamInfo } from '@bluepy/protocol'
import { useStore } from '../store'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { CreateObjectDialog, InspectorDialog, MethodCallDialog, ResultDialog, type DialogState } from './ObjectDialogs'

interface MenuState {
  x: number
  y: number
  entries: MenuEntry[]
}

export function signature(params: { name: string; annotation: string | null; default: string | null }[]): string {
  return params.map((p) => (p.default !== null ? `${p.name}=${p.default}` : p.name)).join(', ')
}

export interface ObjectInteraction {
  /** Right-click / click on a bench object: its methods (own + inherited), inspect, remove. */
  onObjectMenu(obj: BenchObject, x: number, y: number): void
  /** Open the inspector for a bench object, `_` (last result) or `$<id>` (Code Pad entry). */
  inspect(name: string, title: string): void
  openCreate(module: string, name: string): void
  openCall(target: { bench: string; type: string } | { module: string; name: string }, method: { name: string; params: ParamInfo[]; doc: string | null; returns: string | null }): void
  showResult(label: string, result: InvocationResult): void
  showMenu(x: number, y: number, entries: MenuEntry[]): void
  /** The popup menu and dialogs – render once per window. */
  overlay: JSX.Element
}

/**
 * Everything a window needs to let the learner interact with objects: the
 * object context menu, create/call dialogs, result dialog (with assertion
 * panel while a test is being recorded) and the inspector.  Shared by the
 * diagram window and the editor window (bench below the Code Pad).
 */
export function useObjectInteraction(): ObjectInteraction {
  const { t } = useTranslation()
  const describeClass = useStore((s) => s.describeClass)
  const removeObject = useStore((s) => s.removeObject)
  const setMessage = useStore((s) => s.setMessage)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const showResult = (label: string, result: InvocationResult): void => {
    if (result.value) setDialog({ kind: 'result', label, result })
    else setMessage(`${label} ✓`)
  }

  const inspect = (name: string, title: string): void => setDialog({ kind: 'inspect', name, title, path: [] })

  const openCreate = (module: string, name: string): void => {
    void describeClass(module, name)
      .then((live) => setDialog({ kind: 'create', module, name, live }))
      .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
  }

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
    entries.push({ label: t('dialog.inspect'), onSelect: () => inspect(obj.name, obj.name) })
    entries.push({ label: t('menu.remove'), onSelect: () => void removeObject(obj.name) })
    setMenu({ x, y, entries })
  }

  const overlay = (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={closeMenu} />}
      {dialog?.kind === 'create' && <CreateObjectDialog state={dialog} onClose={() => setDialog(null)} onResult={showResult} />}
      {dialog?.kind === 'call' && <MethodCallDialog state={dialog} onClose={() => setDialog(null)} onResult={showResult} />}
      {dialog?.kind === 'result' && (
        <ResultDialog state={dialog} onClose={() => setDialog(null)} onInspect={() => inspect('_', t('dialog.resultTitle'))} />
      )}
      {dialog?.kind === 'inspect' && (
        <InspectorDialog state={dialog} onClose={() => setDialog(null)} onNavigate={(path) => setDialog({ ...dialog, path })} />
      )}
    </>
  )

  return {
    onObjectMenu: (obj, x, y) => void onObjectMenu(obj, x, y),
    inspect,
    openCreate,
    openCall: (target, method) => setDialog({ kind: 'call', target, method }),
    showResult,
    showMenu: (x, y, entries) => setMenu({ x, y, entries }),
    overlay
  }
}
