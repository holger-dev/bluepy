import { useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssertionKind, InspectResult, InvocationResult, LiveClassInfo, ParamInfo, UserError } from '@bluepy/protocol'
import { useStore } from '../store'
import { ParamInputs, argumentsFrom } from './ParamInputs'

export type DialogState =
  | { kind: 'create'; module: string; name: string; live: LiveClassInfo }
  | {
      kind: 'call'
      target: { bench: string; type: string } | { module: string; name: string }
      method: { name: string; params: ParamInfo[]; doc: string | null; returns: string | null }
    }
  | { kind: 'result'; label: string; result: InvocationResult }
  | { kind: 'inspect'; name: string; title: string; path: (string | number)[] }
  | null

function ErrorBox({ error }: { error: UserError | string | null }): JSX.Element | null {
  if (!error) return null
  if (typeof error === 'string') return <pre className="dialog-error">{error}</pre>
  return <pre className="dialog-error">{error.traceback?.trim() || `${error.type}: ${error.message}`}</pre>
}

function Signature({ name, params, returns }: { name: string; params: ParamInfo[]; returns?: string | null }): JSX.Element {
  const text = params.map((p) => `${p.name}${p.annotation ? ': ' + p.annotation : ''}${p.default !== null ? ' = ' + p.default : ''}`).join(', ')
  return (
    <code className="signature">
      {name}({text}){returns ? ` -> ${returns}` : ''}
    </code>
  )
}

// ------------------------------------------------------------ create object

export function CreateObjectDialog({
  state,
  onClose,
  onResult
}: {
  state: Extract<DialogState, { kind: 'create' }>
  onClose(): void
  onResult(label: string, result: InvocationResult): void
}): JSX.Element {
  const { t } = useTranslation()
  const createObject = useStore((s) => s.createObject)
  const [benchName, setBenchName] = useState('')
  const [values, setValues] = useState<string[]>([])
  const [error, setError] = useState<UserError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const params = state.live.constructor.params

  useEffect(() => {
    void window.bluepy.objects.suggestName(state.name).then(setBenchName)
  }, [state.name])

  const submit = async (): Promise<void> => {
    const { args, missing } = argumentsFrom(params, values)
    if (missing) {
      setError(t('dialog.missing', { name: missing }))
      return
    }
    setBusy(true)
    try {
      const result = await createObject(state.module, state.name, benchName.trim(), args)
      if (!result.ok) {
        setError(result.error ?? 'Fehler')
        return
      }
      onResult(result.record, result)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{t('dialog.createTitle', { name: state.name })}</h2>
        <Signature name={state.name} params={params} />
        {state.live.constructor.doc && <p className="doc">{state.live.constructor.doc}</p>}
        {!state.live.constructor.doc && state.live.doc && <p className="doc">{state.live.doc}</p>}
        {state.live.isAbstract && <p className="problem">{t('dialog.abstract')}</p>}
        <label className="field">
          <span>{t('dialog.benchName')}</span>
          <input value={benchName} spellCheck={false} onChange={(e) => setBenchName(e.target.value)} />
        </label>
        <ParamInputs params={params} values={values} onChange={setValues} onSubmit={() => void submit()} />
        <ErrorBox error={error} />
        <div className="row end">
          <button type="button" onClick={onClose}>
            {t('setup.close')}
          </button>
          <button type="button" className="primary" disabled={busy || state.live.isAbstract || !benchName.trim()} onClick={() => void submit()}>
            {t('dialog.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- method call

export function MethodCallDialog({
  state,
  onClose,
  onResult
}: {
  state: Extract<DialogState, { kind: 'call' }>
  onClose(): void
  onResult(label: string, result: InvocationResult): void
}): JSX.Element {
  const { t } = useTranslation()
  const callMethod = useStore((s) => s.callMethod)
  const [values, setValues] = useState<string[]>([])
  const [error, setError] = useState<UserError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const targetLabel = 'bench' in state.target ? state.target.bench : state.target.name

  const submit = async (): Promise<void> => {
    const { args, missing } = argumentsFrom(state.method.params, values)
    if (missing) {
      setError(t('dialog.missing', { name: missing }))
      return
    }
    setBusy(true)
    try {
      const target = 'bench' in state.target ? { bench: state.target.bench } : { module: state.target.module, name: state.target.name }
      const result = await callMethod(target, state.method.name, args)
      if (!result.ok) {
        setError(result.error ?? 'Fehler')
        return
      }
      onResult(result.record, result)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Parameterless methods run immediately – BlueJ does the same.  The ref
  // guards against React StrictMode running the effect twice in development.
  const ran = useRef(false)
  useEffect(() => {
    if (state.method.params.length === 0 && !ran.current) {
      ran.current = true
      void submit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state.method.params.length === 0 && !error) return <></>

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>
          {targetLabel}.{state.method.name}
        </h2>
        <Signature name={state.method.name} params={state.method.params} returns={state.method.returns} />
        {state.method.doc && <p className="doc">{state.method.doc}</p>}
        <ParamInputs params={state.method.params} values={values} onChange={setValues} onSubmit={() => void submit()} />
        <ErrorBox error={error} />
        <div className="row end">
          <button type="button" onClick={onClose}>
            {t('setup.close')}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            {t('dialog.call')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ result

const ASSERTION_KINDS: AssertionKind[] = ['equal', 'almostEqual', 'true', 'false', 'isNone', 'isNotNone', 'is']

function defaultAssertion(value: { repr: string; type: string; isNone: boolean }): AssertionKind {
  if (value.isNone) return 'isNone'
  if (value.type === 'bool') return value.repr === 'True' ? 'true' : 'false'
  if (value.type === 'float') return 'almostEqual'
  return 'equal'
}

export function ResultDialog({
  state,
  onClose,
  onInspect
}: {
  state: Extract<DialogState, { kind: 'result' }>
  onClose(): void
  onInspect(): void
}): JSX.Element {
  const { t } = useTranslation()
  const getObject = useStore((s) => s.getObject)
  const recording = useStore((s) => s.recording)
  const recordAssertion = useStore((s) => s.recordAssertion)
  const value = state.result.value
  const [error, setError] = useState<string | null>(null)
  const [withAssertion, setWithAssertion] = useState(true)
  const [kind, setKind] = useState<AssertionKind>(() => (value ? defaultAssertion(value) : 'equal'))
  const [expected, setExpected] = useState(value?.repr ?? '')
  const needsExpected = kind === 'equal' || kind === 'almostEqual' || kind === 'is'

  const finish = (): void => {
    if (recording && value && withAssertion) {
      void recordAssertion(state.label, needsExpected ? { kind, expected } : { kind })
    }
    onClose()
  }

  const toBench = async (): Promise<void> => {
    try {
      const r = await getObject('_', [], null)
      if (!r.ok) setError(r.error?.message ?? 'Fehler')
      else finish()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-backdrop" onClick={finish}>
      <div className="modal modal-small" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{t('dialog.resultTitle')}</h2>
        <code className="signature">{state.label}</code>
        {value ? (
          <div className="result-value">
            <span className="value">{value.repr}</span> <span className="type">({value.type})</span>
          </div>
        ) : (
          <p className="muted">{t('dialog.noResult')}</p>
        )}
        {recording && value && (
          <div className="assertion-panel">
            <label className="check">
              <input type="checkbox" checked={withAssertion} onChange={(e) => setWithAssertion(e.target.checked)} />
              <span>{t('tests.assertionAdd', { method: recording.method })}</span>
            </label>
            <div className="row">
              <select value={kind} disabled={!withAssertion} onChange={(e) => setKind(e.target.value as AssertionKind)}>
                {ASSERTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`tests.assertion.${k}`)}
                  </option>
                ))}
              </select>
              {needsExpected && (
                <input className="mono grow" value={expected} disabled={!withAssertion} spellCheck={false} onChange={(e) => setExpected(e.target.value)} title={t('tests.expected')} />
              )}
            </div>
          </div>
        )}
        <ErrorBox error={error} />
        <div className="row end">
          {value && state.result.inspectable && (
            <>
              <button type="button" onClick={() => void toBench()}>
                {t('dialog.toBench')}
              </button>
              <button type="button" onClick={onInspect}>
                {t('dialog.inspect')}
              </button>
            </>
          )}
          <button type="button" className="primary" onClick={finish}>
            {t('setup.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- inspector

export function InspectorDialog({
  state,
  onClose,
  onNavigate
}: {
  state: Extract<DialogState, { kind: 'inspect' }>
  onClose(): void
  onNavigate(path: (string | number)[]): void
}): JSX.Element {
  const { t } = useTranslation()
  const inspect = useStore((s) => s.inspect)
  const getObject = useStore((s) => s.getObject)
  const bench = useStore((s) => s.bench)
  const [data, setData] = useState<InspectResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    inspect(state.name, state.path)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [inspect, state.name, state.path, bench])

  const crumbs = [state.title, ...state.path.map(String)]

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
              <button type="button" className="link" onClick={() => onNavigate(state.path.slice(0, i))} disabled={i === crumbs.length - 1}>
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
              {data.mro.length > 1 && <span className="muted"> – {t('dialog.inherits')} {data.mro.slice(1).join(' › ')}</span>}
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
                        <button type="button" className="link" onClick={() => onNavigate([...state.path, f.name])}>
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
            {data.classAttributes.length > 0 && (
              <>
                <h3>{t('dialog.classAttributes')}</h3>
                <table className="fields">
                  <tbody>
                    {data.classAttributes.map((a) => (
                      <tr key={a.name}>
                        <td className="field-name">{a.name}</td>
                        <td className="field-type muted">{a.value.type}</td>
                        <td className="field-value">{a.value.repr}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
        <div className="row end">
          {state.path.length > 0 && (
            <button type="button" onClick={() => void getObject(state.name, state.path, null).then(onClose)}>
              {t('dialog.toBench')}
            </button>
          )}
          <button type="button" className="primary" onClick={onClose}>
            {t('setup.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
