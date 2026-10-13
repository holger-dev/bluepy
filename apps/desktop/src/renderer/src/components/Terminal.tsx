import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

export function Terminal(): JSX.Element {
  const { t } = useTranslation()
  const entries = useStore((s) => s.terminal)
  const waiting = useStore((s) => s.waitingForStdin)
  const provideStdin = useStore((s) => s.provideStdin)
  const clear = useStore((s) => s.clearTerminal)
  const [draft, setDraft] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [entries])

  useEffect(() => {
    if (waiting) inputRef.current?.focus()
  }, [waiting])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && waiting) {
      event.preventDefault()
      void provideStdin(draft + '\n')
      setDraft('')
    } else if (event.key === 'd' && event.ctrlKey && waiting) {
      event.preventDefault()
      void provideStdin(null)
      setDraft('')
    }
  }

  let lastInvocation: unknown = undefined
  return (
    <div className="pane-body terminal">
      <div className="pane-actions">
        <button type="button" className="link" onClick={() => void clear()}>
          {t('terminal.clear')}
        </button>
      </div>
      <div className="terminal-output" ref={outputRef}>
        {entries.length === 0 && <span className="hint">{t('terminal.empty')}</span>}
        {entries.map((entry) => {
          const newSection = entry.invocation !== lastInvocation && entry.invocation !== null
          lastInvocation = entry.invocation
          return (
            <pre key={entry.id} className={`terminal-line ${entry.stream}${newSection ? ' section-start' : ''}`}>
              {entry.text}
            </pre>
          )
        })}
      </div>
      <input
        ref={inputRef}
        className={`terminal-input${waiting ? ' waiting' : ''}`}
        value={draft}
        placeholder={waiting ? t('terminal.stdinPlaceholder') : t('terminal.stdinIdle')}
        disabled={!waiting}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
