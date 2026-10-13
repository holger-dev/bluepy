import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { DebugInspectResult, DebugScope, DebugVariable, DebugVariables } from '@bluepy/protocol'
import { PythonSetupDialog } from '../components/PythonSetupDialog'
import { StatusBar } from '../components/StatusBar'
import { useStore } from '../store'

interface InspectTarget {
  frame: number
  scope: DebugScope
  name: string
  path: (string | number)[]
}

/**
 * BlueJ's debugger window: call sequence, static / instance / local variables
 * and the Halt, Step, Step Into, Step Out, Continue, Terminate buttons.
 * While this window is open, user code is traced so that Halt pauses instead
 * of aborting.
 */
export function DebuggerWindow(): JSX.Element {
  const { t } = useTranslation()
  const bootstrap = useStore((s) => s.bootstrap)
  const setupOpen = useStore((s) => s.setupOpen)
  const debug = useStore((s) => s.debug)
  const status = useStore((s) => s.backendStatus)
  const openWindow = useStore((s) => s.openWindow)
  const debugCommand = useStore((s) => s.debugCommand)
  const debugVariables = useStore((s) => s.debugVariables)
  const [frameIndex, setFrameIndex] = useState(0)
  const [variables, setVariables] = useState<DebugVariables | null>(null)
  const [inspect, setInspect] = useState<InspectTarget | null>(null)
  const running = status === 'running'

  useEffect(() => {
    void bootstrap('debugger')
  }, [bootstrap])

  // Load variables for the selected frame whenever execution pauses.
  useEffect(() => {
    if (!debug.paused) {
      setVariables(null)
      setFrameIndex(0)
      return
    }
    const index = Math.min(frameIndex, Math.max(debug.frames.length - 1, 0))
    let cancelled = false
    debugVariables(index)
      .then((v) => {
        if (!cancelled) setVariables(v)
      })
      .catch(() => {
        if (!cancelled) setVariables(null)
      })
    return () => {
      cancelled = true
    }
  }, [debug, frameIndex, debugVariables])

  const top = debug.frames[0]
  const statusText = debug.paused
    ? t('debugger.pausedAt', { file: top?.file ?? '', line: top?.line ?? '', reason: t(`debugger.reason.${debug.reason ?? 'breakpoint'}`) })
    : running
      ? t('debugger.running')
      : t('debugger.idle')

  const button = (label: string, command: Parameters<typeof debugCommand>[0], enabled: boolean, title?: string): JSX.Element => (
    <button type="button" disabled={!enabled} onClick={() => void debugCommand(command)} title={title}>
      {label}
    </button>
  )

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-group">
          {button(t('toolbar.halt'), 'pause', running && !debug.paused, t('debugger.haltHint'))}
          {button(t('debugger.step'), 'step', debug.paused)}
          {button(t('debugger.stepInto'), 'stepInto', debug.paused)}
          {button(t('debugger.stepOut'), 'stepOut', debug.paused)}
          {button(t('debugger.continue'), 'continue', debug.paused)}
          {button(t('debugger.terminate'), 'terminate', debug.paused)}
        </div>
        <div className="toolbar-spacer" />
        <span className={`chip ${debug.paused ? 'bad' : running ? 'ok' : ''}`}>{statusText}</span>
        <div className="toolbar-spacer" />
        <button type="button" onClick={() => void openWindow('main')} title="⌘⇧E / Ctrl+Shift+E">
          {t('toolbar.editorWindow')}
        </button>
      </header>
      <main className="workspace workspace-debugger">
        <section className="pane">
          <div className="pane-body">
            <div className="pane-title">{t('debugger.threads')}</div>
            <ul className="debug-list">
              <li className={debug.paused ? 'paused' : ''}>
                main {debug.paused ? `(${t('debugger.pausedShort')})` : running ? `(${t('debugger.runningShort')})` : ''}
              </li>
            </ul>
            <div className="pane-title">{t('debugger.callSequence')}</div>
            <ul className="debug-list frames">
              {debug.frames.map((f) => (
                <li key={f.index} className={f.index === frameIndex ? 'active' : ''} onClick={() => setFrameIndex(f.index)}>
                  <span className="frame-fn">
                    {f.className ? `${f.className}.` : ''}
                    {f.function}
                  </span>
                  <span className="muted">
                    {f.file}:{f.line}
                  </span>
                </li>
              ))}
              {!debug.paused && <li className="hint">{t('debugger.notPaused')}</li>}
            </ul>
          </div>
        </section>
        <section className="pane">
          <div className="pane-body variables">
            <VariablePanel title={t('debugger.static')} scope="static" items={variables?.static ?? []} frame={frameIndex} onInspect={setInspect} />
            <VariablePanel title={t('debugger.instance')} scope="instance" items={variables?.instance ?? []} frame={frameIndex} onInspect={setInspect} />
            <VariablePanel title={t('debugger.locals')} scope="locals" items={variables?.locals ?? []} frame={frameIndex} onInspect={setInspect} />
          </div>
        </section>
      </main>
      <StatusBar />
      {inspect && <DebugInspectDialog target={inspect} onClose={() => setInspect(null)} onNavigate={(path) => setInspect({ ...inspect, path })} />}
      {setupOpen && <PythonSetupDialog />}
    </div>
  )
}

function VariablePanel({
  title,
  scope,
  items,
  frame,
  onInspect
}: {
  title: string
  scope: DebugScope
  items: DebugVariable[]
  frame: number
  onInspect(target: InspectTarget): void
}): JSX.Element {
  return (
    <div className="variable-panel">
      <div className="pane-title">{title}</div>
      <table className="fields">
        <tbody>
          {items.map((v) => (
            <tr
              key={v.name}
              className={v.inspectable ? 'inspectable' : ''}
              onDoubleClick={() => v.inspectable && onInspect({ frame, scope, name: v.name, path: [] })}
              title={v.inspectable ? 'Doppelklick: inspizieren' : undefined}
            >
              <td className="field-name">{v.name}</td>
              <td className="field-type muted">{v.value.type}</td>
              <td className="field-value">{v.value.repr}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td className="muted" colSpan={3}>
                –
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function DebugInspectDialog({
  target,
  onClose,
  onNavigate
}: {
  target: InspectTarget
  onClose(): void
  onNavigate(path: (string | number)[]): void
}): JSX.Element {
  const { t } = useTranslation()
  const debugInspect = useStore((s) => s.debugInspect)
  const [data, setData] = useState<DebugInspectResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    debugInspect(target.frame, target.scope, target.name, target.path)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [debugInspect, target])

  const crumbs = [target.name, ...target.path.map(String)]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal inspector" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>
          {t('dialog.inspectTitle')} {data ? <span className="muted">: {data.className}</span> : null}
        </h2>
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && ' › '}
              <button type="button" className="link" onClick={() => onNavigate(target.path.slice(0, i))} disabled={i === crumbs.length - 1}>
                {c}
              </button>
            </span>
          ))}
        </div>
        {error && <pre className="dialog-error">{error}</pre>}
        {data && (
          <>
            <div className="result-value">
              <span className="value">{data.value.repr}</span> <span className="type">({data.className})</span>
            </div>
            <table className="fields">
              <tbody>
                {data.fields.map((f) => (
                  <tr key={f.name}>
                    <td className="field-name">{f.name}</td>
                    <td className="field-type muted">{f.value.type}</td>
                    <td className="field-value">{f.value.repr}</td>
                    <td className="field-actions">
                      {f.inspectable && (
                        <button type="button" className="link" onClick={() => onNavigate([...target.path, f.name])}>
                          {t('dialog.inspect')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {data.fields.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {t('dialog.noFields')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
        <div className="row end">
          <button type="button" className="primary" onClick={onClose}>
            {t('setup.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
