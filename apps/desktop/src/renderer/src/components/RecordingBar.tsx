import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

/** BlueJ's recording indicator: shown while a test method is being recorded, with End / Cancel. */
export function RecordingBar(): JSX.Element | null {
  const { t } = useTranslation()
  const recording = useStore((s) => s.recording)
  const endRecording = useStore((s) => s.endRecording)
  if (!recording) return null
  return (
    <div className="recording-bar" role="status">
      <span className="recording-dot" aria-hidden="true" />
      <span className="recording-label">
        {t('tests.recording', { name: `${recording.className}.${recording.method}` })}
        <span className="muted"> · {t('tests.recordedCount', { count: recording.statements.length })}</span>
      </span>
      <button type="button" className="primary" onClick={() => void endRecording(true)}>
        {t('tests.endRecording')}
      </button>
      <button type="button" onClick={() => void endRecording(false)}>
        {t('tests.cancelRecording')}
      </button>
    </div>
  )
}
