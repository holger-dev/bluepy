import { useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParamInfo } from '@bluepy/protocol'
import { useStore } from '../store'

interface Props {
  params: ParamInfo[]
  values: string[]
  onChange(values: string[]): void
  onSubmit(): void
}

/**
 * One input per parameter, as in BlueJ's Create Object / Method Call
 * dialogs.  Objects on the bench can be inserted by clicking their chip.
 */
export function ParamInputs({ params, values, onChange, onSubmit }: Props): JSX.Element {
  const { t } = useTranslation()
  const bench = useStore((s) => s.bench)
  const focused = useRef<number>(0)

  const set = (i: number, v: string): void => {
    const next = [...values]
    next[i] = v
    onChange(next)
  }

  const insertBench = (name: string): void => {
    const i = Math.min(focused.current, params.length - 1)
    if (i < 0) return
    set(i, name)
  }

  return (
    <div className="params">
      {params.length === 0 && <p className="muted">{t('dialog.noParams')}</p>}
      {params.map((p, i) => (
        <label key={p.name} className="field">
          <span className="param-label">
            {p.kind === 'vararg' ? '*' : p.kind === 'kwarg' ? '**' : ''}
            {p.name}
            {p.annotation ? <span className="muted">: {p.annotation}</span> : null}
          </span>
          <input
            autoFocus={i === 0}
            value={values[i] ?? ''}
            placeholder={p.default !== null ? `${t('dialog.default')} ${p.default}` : ''}
            spellCheck={false}
            onFocus={() => {
              focused.current = i
            }}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit()
            }}
          />
        </label>
      ))}
      {bench.length > 0 && params.length > 0 && (
        <div className="bench-chips">
          <span className="muted">{t('dialog.fromBench')}</span>
          {bench.map((o) => (
            <button key={o.name} type="button" className="chip" onClick={() => insertBench(o.name)}>
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Turn inputs into argument expressions, dropping trailing empty optionals. */
export function argumentsFrom(params: ParamInfo[], values: string[]): { args: string[]; missing: string | null } {
  const args: string[] = []
  for (let i = 0; i < params.length; i++) {
    const p = params[i] as ParamInfo
    const v = (values[i] ?? '').trim()
    if (v) {
      args.push(p.kind === 'kwonly' ? `${p.name}=${v}` : v)
    } else if (p.default === null && p.kind === 'positional') {
      return { args, missing: p.name }
    } else if (p.default !== null && p.kind === 'positional') {
      // keep positional order: later filled arguments need this one as its default
      const laterFilled = values.slice(i + 1).some((x, j) => (x ?? '').trim() && params[i + 1 + j]?.kind === 'positional')
      if (laterFilled) args.push(p.default)
    }
  }
  return { args, missing: null }
}
