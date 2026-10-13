import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { formatWhen } from './HubDialogs'

/**
 * Teacher's review mode: the class list with submission status, previous /
 * next, and notes + points for the open submission (saved to korrektur.json
 * and mirrored to the hub).
 */
export function ReviewBar(): JSX.Element | null {
  const { t } = useTranslation()
  const review = useStore((s) => s.review)
  const busy = useStore((s) => s.busy)
  const reviewOpen = useStore((s) => s.reviewOpen)
  const reviewNote = useStore((s) => s.reviewNote)
  const reviewClose = useStore((s) => s.reviewClose)
  const runAllTests = useStore((s) => s.runAllTests)
  const reviewRunTests = useStore((s) => s.reviewRunTests)
  const setHubDialog = useStore((s) => s.setHubDialog)
  const [notes, setNotes] = useState('')
  const [points, setPoints] = useState('')
  const index = review?.index ?? -1
  const current = review && index >= 0 ? review.students[index] : null

  useEffect(() => {
    setNotes(current?.notes ?? '')
    setPoints(current?.points ?? '')
  }, [current?.personal, current?.notes, current?.points])

  if (!review) return null
  const submitted = review.students.map((s, i) => ({ s, i })).filter(({ s }) => s.folder)
  const pos = submitted.findIndex(({ i }) => i === index)
  const prev = pos > 0 ? submitted[pos - 1] : null
  const next = pos >= 0 && pos < submitted.length - 1 ? submitted[pos + 1] : null
  const seen = review.students.filter((s) => s.notes || s.points).length

  const save = (): void => {
    if (index >= 0 && (notes !== current?.notes || points !== current?.points)) void reviewNote(index, notes, points)
  }

  return (
    <div className="review">
      <div className="review-head">
        <b>{t('hub.reviewTitle', { title: review.title })}</b>
        <span className="muted">
          {review.code} · {t('hub.reviewProgress', { seen, submitted: submitted.length, total: review.students.length })}
        </span>
        <span className="toolbar-spacer" />
        <button type="button" onClick={() => void runAllTests()} disabled={busy !== null || index < 0}>
          {t('toolbar.runTests')}
        </button>
        <button type="button" onClick={() => void reviewRunTests()} disabled={busy !== null || submitted.length === 0} title={t('hub.testsAllHint')}>
          {busy === 'tests' ? t('toolbar.testsRunning') : t('hub.testsAll')}
        </button>
        {review.students.some((s) => s.tests) && (
          <button type="button" onClick={() => setHubDialog('reviewTests')}>
            {t('hub.testsTable')}
          </button>
        )}
        <button type="button" onClick={() => void reviewClose()}>
          {t('hub.reviewClose')}
        </button>
      </div>
      <div className="review-body">
        <select
          className="review-select"
          value={index}
          onChange={(e) => {
            const i = Number(e.target.value)
            if (i >= 0 && review.students[i]?.folder) void reviewOpen(i)
          }}
        >
          <option value={-1}>{t('hub.reviewPick')}</option>
          {review.students.map((s, i) => (
            <option key={s.personal} value={i} disabled={!s.folder}>
              {s.folder ? (s.late ? '⏰' : '✓') : '–'} {s.name}
              {s.sharedDevice ? ' ⚠' : ''}
              {s.submittedAt ? ` · ${formatWhen(s.submittedAt)}` : ` · ${t('hub.missing')}`}
              {s.points ? ` · ${s.points}` : ''}
            </option>
          ))}
        </select>
        <button type="button" disabled={!prev || busy !== null} onClick={() => prev && void reviewOpen(prev.i)} title={t('hub.reviewPrev')}>
          ◀
        </button>
        <button type="button" disabled={!next || busy !== null} onClick={() => next && void reviewOpen(next.i)} title={t('hub.reviewNext')}>
          ▶
        </button>
        {current && (
          <>
            <input className="review-points" value={points} placeholder={t('hub.points')} onChange={(e) => setPoints(e.target.value)} onBlur={save} />
            <input className="review-notes grow" value={notes} placeholder={t('hub.notes')} onChange={(e) => setNotes(e.target.value)} onBlur={save} />
            {current.sharedDevice && <span className="chip bad" title={t('hub.sharedDeviceHint')}>⚠ {t('hub.sharedDevice')}</span>}
            {current.late && <span className="chip">{t('hub.late')}</span>}
          </>
        )}
      </div>
    </div>
  )
}
