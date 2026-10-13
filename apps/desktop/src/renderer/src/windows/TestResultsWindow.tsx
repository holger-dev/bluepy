import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { TestCaseResult } from '@bluepy/protocol'
import { PythonSetupDialog } from '../components/PythonSetupDialog'
import { StatusBar } from '../components/StatusBar'
import { ThemeToggle } from '../components/ThemeToggle'
import { useStore } from '../store'

const ICON: Record<TestCaseResult['status'], string> = { passed: '✓', failed: '✗', error: '!', skipped: '–' }

/**
 * BlueJ's "Test Results" window: one line per test with a green/red bar,
 * counts, and the failure message + filtered traceback of the selected test.
 */
export function TestResultsWindow(): JSX.Element {
  const { t } = useTranslation()
  const bootstrap = useStore((s) => s.bootstrap)
  const setupOpen = useStore((s) => s.setupOpen)
  const tests = useStore((s) => s.tests)
  const project = useStore((s) => s.project)
  const busy = useStore((s) => s.busy)
  const runAllTests = useStore((s) => s.runAllTests)
  const runTests = useStore((s) => s.runTests)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void bootstrap('tests')
  }, [bootstrap])

  // keep the selection on the first problem while results stream in
  useEffect(() => {
    if (!tests) return
    if (selectedId && tests.results.some((r) => r.id === selectedId)) return
    const firstProblem = tests.results.find((r) => r.status === 'failed' || r.status === 'error')
    setSelectedId(firstProblem?.id ?? null)
  }, [tests, selectedId])

  const results = tests?.results ?? []
  const counts = {
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    errors: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length
  }
  const problems = counts.failed + counts.errors
  const selected = results.find((r) => r.id === selectedId) ?? null
  const barClass = tests?.running ? 'running' : problems > 0 ? 'bad' : results.length > 0 ? 'ok' : ''

  const rerun = (): void => {
    if (!tests) return
    const files = [...new Set(results.map((r) => r.file).filter((f): f is string => Boolean(f)))]
    if (files.length === 0) void runAllTests()
    else void runTests({ files, label: tests.label })
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-group">
          <button type="button" className="primary" onClick={() => void runAllTests()} disabled={!project || busy !== null}>
            {busy === 'tests' ? t('toolbar.testsRunning') : t('toolbar.runTests')}
          </button>
          <button type="button" onClick={rerun} disabled={!tests || busy !== null}>
            {t('tests.rerun')}
          </button>
        </div>
        <div className="toolbar-spacer" />
        <span className="toolbar-title">{tests ? tests.label : t('tests.windowTitle')}</span>
        <div className="toolbar-spacer" />
        <ThemeToggle />
      </header>
      <main className="workspace workspace-tests">
        <div className={`test-bar ${barClass}`} aria-hidden="true" />
        <div className="test-counts">
          <span>
            {t('tests.counts.tests')}: <b>{results.length}</b>
          </span>
          <span className="ok">
            {t('tests.counts.passed')}: <b>{counts.passed}</b>
          </span>
          <span className={counts.failed ? 'bad' : ''}>
            {t('tests.counts.failed')}: <b>{counts.failed}</b>
          </span>
          <span className={counts.errors ? 'bad' : ''}>
            {t('tests.counts.errors')}: <b>{counts.errors}</b>
          </span>
          {counts.skipped > 0 && (
            <span className="muted">
              {t('tests.counts.skipped')}: <b>{counts.skipped}</b>
            </span>
          )}
          {tests?.summary && <span className="muted">{t('tests.duration', { ms: tests.summary.durationMs })}</span>}
          {tests?.running && tests.active && (
            <span className="muted working">
              {t('tests.runningTest', { name: `${tests.active.className}.${tests.active.method}` })}
            </span>
          )}
          {tests?.error && <span className="bad">{tests.error}</span>}
        </div>
        <ul className="test-list" role="listbox">
          {results.map((r) => (
            <li
              key={r.id}
              role="option"
              aria-selected={r.id === selectedId}
              className={`test-item status-${r.status} ${r.id === selectedId ? 'selected' : ''}`}
              onClick={() => setSelectedId(r.id)}
              onDoubleClick={() => {
                if (r.file) void window.bluepy.editor.open(r.file, r.line ?? undefined)
              }}
            >
              <span className={`test-icon ${r.status}`}>{ICON[r.status]}</span>
              <span className="test-name">
                {r.className}.{r.method}
              </span>
              <span className="muted test-time">{r.durationMs} ms</span>
            </li>
          ))}
          {results.length === 0 && !tests?.running && <li className="hint">{tests ? t('tests.noTests') : t('tests.empty')}</li>}
        </ul>
        <div className="test-detail">
          {selected ? (
            <>
              <div className="test-detail-head">
                <b>
                  {selected.className}.{selected.method}
                </b>
                <span className={`chip ${selected.status === 'passed' ? 'ok' : selected.status === 'skipped' ? '' : 'bad'}`}>{t(`tests.status.${selected.status}`)}</span>
                {selected.file && (
                  <button type="button" className="link" onClick={() => void window.bluepy.editor.open(selected.file as string, selected.line ?? undefined)}>
                    {t('tests.showSource')}
                    {selected.line ? ` (${selected.file}:${selected.line})` : ''}
                  </button>
                )}
              </div>
              {selected.message && <div className="test-message">{selected.message}</div>}
              {selected.traceback && <pre className="test-traceback">{selected.traceback}</pre>}
            </>
          ) : (
            <div className="hint">{results.length > 0 ? t('tests.selectHint') : ''}</div>
          )}
        </div>
      </main>
      <StatusBar />
      {setupOpen && <PythonSetupDialog />}
    </div>
  )
}
