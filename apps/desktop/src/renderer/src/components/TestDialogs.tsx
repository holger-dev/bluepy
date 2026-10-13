import { useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

interface Props {
  file: string
  className: string
  existing: string[]
  onClose(): void
}

/** "Create Test Method…": asks for the method name, then starts recording. */
export function RecordTestDialog({ file, className, existing, onClose }: Props): JSX.Element {
  const { t } = useTranslation()
  const startRecording = useStore((s) => s.startRecording)
  const bench = useStore((s) => s.bench)
  const [name, setName] = useState('test_')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.setSelectionRange(5, 5)
  }, [])

  const trimmed = name.trim()
  const valid = /^[A-Za-z_]\w*$/.test(trimmed)
  const isTest = trimmed.startsWith('test')
  const clash = existing.includes(trimmed)
  const problem = !valid ? t('tests.nameInvalid') : !isTest ? t('tests.nameNotTest') : clash ? t('tests.nameExists') : null

  const submit = (): void => {
    if (problem) return
    void startRecording(file, className, trimmed)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{t('tests.recordTitle', { name: className })}</h2>
        <p className="doc">{t('tests.recordIntro')}</p>
        {bench.length > 0 && <p className="doc muted">{t('tests.recordBenchHint')}</p>}
        <label className="field">
          <span>{t('tests.methodName')}</span>
          <input
            ref={input}
            value={name}
            spellCheck={false}
            className="mono"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </label>
        {problem && <p className="problem">{problem}</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>
            {t('setup.close')}
          </button>
          <button type="button" className="primary" disabled={problem !== null} onClick={submit}>
            {t('tests.startRecording')}
          </button>
        </div>
      </div>
    </div>
  )
}
