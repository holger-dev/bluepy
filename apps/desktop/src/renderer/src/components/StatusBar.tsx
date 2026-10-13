import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppInfo } from '@bluepy/protocol'
import { useStore } from '../store'

export function StatusBar(): JSX.Element {
  const { t } = useTranslation()
  const discovery = useStore((s) => s.discovery)
  const discovering = useStore((s) => s.discovering)
  const status = useStore((s) => s.backendStatus)
  const detail = useStore((s) => s.backendDetail)
  const message = useStore((s) => s.message)
  const busy = useStore((s) => s.busy)
  const recording = useStore((s) => s.recording)
  const setSetupOpen = useStore((s) => s.setSetupOpen)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.bluepy.app.info().then(setInfo)
  }, [])

  const selected = discovery?.selected ?? null
  const pythonClass = discovering ? 'chip' : selected ? 'chip ok' : 'chip bad'
  const pythonLabel = discovering
    ? t('status.pythonSearching')
    : selected
      ? `${t('status.python')} ${selected.version ?? ''}`
      : t('status.pythonMissing')

  const detailLabel = detail ? (t(`status.backendDetail.${detail}`, { defaultValue: detail }) as string) : null

  return (
    <footer className="statusbar">
      <button type="button" className={pythonClass} onClick={() => setSetupOpen(true)} title={selected?.path ?? ''}>
        {pythonLabel}
      </button>
      <span className={`chip ${status === 'running' ? 'ok' : status === 'crashed' || status === 'unavailable' ? 'bad' : ''}`}>
        Backend: {t(`status.backend.${status}`)}
        {status === 'crashed' && detailLabel ? ` – ${detailLabel}` : ''}
      </span>
      {busy && <span className="chip working">{t(`status.busy.${busy}`)}</span>}
      {recording && <span className="chip recording">● {recording.className}.{recording.method}</span>}
      {message && <span className="status-message">{message}</span>}
      <span className="statusbar-spacer" />
      {info && (
        <span className="muted">
          BluePy {info.version} · Electron {info.electron} · {info.platform}
        </span>
      )}
    </footer>
  )
}
