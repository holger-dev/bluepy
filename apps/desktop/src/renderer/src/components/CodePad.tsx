import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type CodePadEntry } from '../store'

function ResultLine({ entry }: { entry: CodePadEntry }): JSX.Element | null {
  const { t } = useTranslation()
  if (entry.pending) return <div className="codepad-result pending">…</div>
  if (entry.failure) return <div className="codepad-result error">{entry.failure}</div>
  const result = entry.result
  if (!result) return null
  if (result.error) {
    return (
      <pre className="codepad-result error">
        {result.error.traceback.trim() || `${result.error.type}: ${result.error.message}`}
      </pre>
    )
  }
  if (result.kind === 'statement') return <div className="codepad-result muted">{t('result.statement')}</div>
  if (result.value && !result.value.isNone) {
    return (
      <div className="codepad-result">
        <span className="value">{result.value.repr}</span> <span className="type">({result.value.type})</span>
      </div>
    )
  }
  return null
}

export function CodePad(): JSX.Element {
  const { t } = useTranslation()
  const entries = useStore((s) => s.codepad)
  const evalCodePad = useStore((s) => s.evalCodePad)
  const clear = useStore((s) => s.clearCodePad)
  const status = useStore((s) => s.backendStatus)
  const [draft, setDraft] = useState('')
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const running = status === 'running'

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [entries])

  const history = entries.map((e) => e.input)

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const code = draft.trim()
      if (!code || !running) return
      void evalCodePad(draft)
      setDraft('')
      setHistoryIndex(null)
      return
    }
    const singleLine = !draft.includes('\n')
    if (event.key === 'ArrowUp' && singleLine && history.length > 0) {
      event.preventDefault()
      const index = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(index)
      setDraft(history[index] ?? '')
    } else if (event.key === 'ArrowDown' && singleLine && historyIndex !== null) {
      event.preventDefault()
      const index = historyIndex + 1
      if (index >= history.length) {
        setHistoryIndex(null)
        setDraft('')
      } else {
        setHistoryIndex(index)
        setDraft(history[index] ?? '')
      }
    }
  }

  return (
    <div className="pane-body codepad">
      <div className="pane-title">
        {t('codepad.title')}
        <button type="button" className="link" onClick={clear}>
          {t('codepad.clear')}
        </button>
      </div>
      <div className="codepad-list" ref={listRef}>
        {entries.map((entry) => (
          <div key={entry.id} className="codepad-entry">
            <pre className="codepad-input">{entry.input}</pre>
            <ResultLine entry={entry} />
          </div>
        ))}
      </div>
      <textarea
        className="codepad-textarea"
        value={draft}
        rows={Math.min(6, Math.max(1, draft.split('\n').length))}
        placeholder={running ? t('codepad.placeholder') : t('codepad.unavailable')}
        disabled={!running}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
