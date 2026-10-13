import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HubClass, TaskInfo } from '@bluepy/protocol'
import { useStore } from '../store'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : 'modal-small'}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** datetime-local value (local time, no seconds) ↔ ISO with offset. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0')
  const local = toLocalInput(d.toISOString())
  return `${local}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

export function formatWhen(iso: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// --------------------------------------------------------------- settings

export function HubSettingsDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const hub = useStore((s) => s.hub)
  const [url, setUrl] = useState(hub.url)
  const [teacherKey, setTeacherKey] = useState('')
  const [personalCode, setPersonalCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const patch: { url?: string; teacherKey?: string; personalCode?: string } = { url }
      if (teacherKey.trim()) patch.teacherKey = teacherKey.trim()
      if (personalCode.trim()) patch.personalCode = personalCode.trim()
      const next = await window.bluepy.hub.saveSettings(patch)
      useStore.setState({ hub: next })
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const clear = async (what: 'teacherKey' | 'personalCode'): Promise<void> => {
    const next = await window.bluepy.hub.saveSettings({ [what]: '' })
    useStore.setState({ hub: next })
  }

  return (
    <Modal title={t('hub.settingsTitle')} onClose={onClose}>
      <p className="doc">{t('hub.settingsIntro')}</p>
      <label className="field">
        <span>{t('hub.url')}</span>
        <input value={url} placeholder="https://bluepy.deine-schule.de" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="field">
        <span>
          {t('hub.personalCode')} {hub.hasPersonalCode && <em className="muted">({t('hub.stored')})</em>}
        </span>
        <div className="row">
          <input className="mono grow" value={personalCode} placeholder={hub.hasPersonalCode ? '••••••' : 'M4K2PX'} spellCheck={false} maxLength={12} onChange={(e) => setPersonalCode(e.target.value.toUpperCase())} />
          {hub.hasPersonalCode && (
            <button type="button" className="link" onClick={() => void clear('personalCode')}>
              {t('hub.remove')}
            </button>
          )}
        </div>
      </label>
      <label className="field">
        <span>
          {t('hub.teacherKey')} {hub.hasTeacherKey && <em className="muted">({hub.teacherName ? t('hub.verifiedAs', { name: hub.teacherName }) : t('hub.stored')})</em>}
        </span>
        <div className="row">
          <input className="mono grow" type="password" value={teacherKey} placeholder={hub.hasTeacherKey ? '••••••••••••' : ''} spellCheck={false} onChange={(e) => setTeacherKey(e.target.value)} />
          {hub.hasTeacherKey && (
            <button type="button" className="link" onClick={() => void clear('teacherKey')}>
              {t('hub.remove')}
            </button>
          )}
        </div>
        <small className="muted">{t('hub.teacherKeyHint')}</small>
      </label>
      {error && <pre className="dialog-error">{error}</pre>}
      <div className="row end">
        <button type="button" onClick={onClose}>
          {t('setup.close')}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          {t('hub.save')}
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ fetch

export function FetchTaskDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const hub = useStore((s) => s.hub)
  const setHubDialog = useStore((s) => s.setHubDialog)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const go = async (): Promise<void> => {
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    try {
      const assignment = await window.bluepy.hub.fetchTask(code)
      useStore.setState({ openFiles: [], activeFile: null, codepad: [], message: t('hub.fetched', { title: assignment.meta.title }) })
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('hub.fetchTitle')} onClose={onClose}>
      {!hub.url && (
        <p className="problem">
          {t('hub.noUrl')}{' '}
          <button type="button" className="link" onClick={() => setHubDialog('settings')}>
            {t('hub.openSettings')}
          </button>
        </p>
      )}
      <label className="field">
        <span>{t('hub.taskCode')}</span>
        <input
          ref={input}
          className="mono code-input"
          value={code}
          placeholder="KONTO-7H3K"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go()
          }}
        />
      </label>
      <p className="doc muted">{t('hub.fetchHint')}</p>
      {error && <pre className="dialog-error">{error}</pre>}
      <div className="row end">
        <button type="button" onClick={onClose}>
          {t('setup.close')}
        </button>
        <button type="button" className="primary" disabled={busy || !code.trim() || !hub.url} onClick={() => void go()}>
          {busy ? t('hub.fetching') : t('hub.fetch')}
        </button>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------- submit

export function SubmitDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const hub = useStore((s) => s.hub)
  const assignment = useStore((s) => s.assignment)
  const submitAssignment = useStore((s) => s.submitAssignment)
  const [personal, setPersonal] = useState('')
  const [status, setStatus] = useState<TaskInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.bluepy.hub.taskStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const go = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (!hub.hasPersonalCode) {
        if (!personal.trim()) {
          setError(t('hub.personalMissing'))
          return
        }
        useStore.setState({ hub: await window.bluepy.hub.saveSettings({ personalCode: personal }) })
      }
      await submitAssignment()
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!assignment) {
    return (
      <Modal title={t('hub.submitTitle')} onClose={onClose}>
        <p className="doc">{t('hub.notAssignment')}</p>
        <div className="row end">
          <button type="button" className="primary" onClick={onClose}>
            {t('setup.close')}
          </button>
        </div>
      </Modal>
    )
  }
  const windowState = status?.window ?? null
  return (
    <Modal title={t('hub.submitTitle')} onClose={onClose}>
      <p className="doc">
        <b>{assignment.meta.title}</b> · {assignment.meta.code}
        <br />
        {t('hub.submitUntil')}: {formatWhen(assignment.meta.submitUntil)}
        {windowState === 'after' && <span className="problem"> – {t('hub.windowAfter')}</span>}
        {windowState === 'before' && <span className="problem"> – {t('hub.windowBefore', { when: formatWhen(assignment.meta.submitFrom) })}</span>}
      </p>
      {assignment.lastSubmittedAt && <p className="doc muted">{t('hub.lastSubmitted', { when: formatWhen(assignment.lastSubmittedAt) })}</p>}
      {!hub.hasPersonalCode && (
        <label className="field">
          <span>{t('hub.personalCode')}</span>
          <input className="mono code-input" value={personal} placeholder="M4K2PX" spellCheck={false} maxLength={12} onChange={(e) => setPersonal(e.target.value.toUpperCase())} autoFocus />
          <small className="muted">{t('hub.personalHint')}</small>
        </label>
      )}
      {error && <pre className="dialog-error">{error}</pre>}
      <div className="row end">
        <button type="button" onClick={onClose}>
          {t('setup.close')}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void go()}>
          {busy ? t('hub.submitting') : t('hub.submit')}
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- publish

export function PublishTaskDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const project = useStore((s) => s.project)
  const assignment = useStore((s) => s.assignment)
  const [title, setTitle] = useState(assignment?.meta.title ?? project?.name ?? '')
  const [description, setDescription] = useState(assignment?.meta.description ?? '')
  const [code, setCode] = useState('')
  const [from, setFrom] = useState(toLocalInput(new Date().toISOString()))
  const [until, setUntil] = useState(toLocalInput(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()))
  const [classes, setClasses] = useState<HubClass[] | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [exclude, setExclude] = useState<string[]>([])
  const [tests, setTests] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<TaskInfo | null>(null)

  useEffect(() => {
    window.bluepy.hub
      .classes()
      .then(setClasses)
      .catch((e) => setError(errorText(e)))
  }, [])

  const toggle = (id: number): void => setSelected((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]))
  const toggleExclude = (file: string): void => setExclude((cur) => (cur.includes(file) ? cur.filter((f) => f !== file) : [...cur, file]))

  const go = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const task = await window.bluepy.hub.publish({
        title: title.trim(),
        description,
        code: code.trim() || undefined,
        submitFrom: fromLocalInput(from),
        submitUntil: fromLocalInput(until),
        classes: selected,
        tests,
        exclude
      })
      setDone(task)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal title={t('hub.publishedTitle')} onClose={onClose}>
        <p className="doc">{t('hub.publishedIntro')}</p>
        <div className="task-code-box">
          <code className="task-code">{done.code}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(done.code)}>
            {t('hub.copy')}
          </button>
        </div>
        <p className="doc muted">
          {t('hub.submitFrom')}: {formatWhen(done.submitFrom)} · {t('hub.submitUntil')}: {formatWhen(done.submitUntil)}
        </p>
        <div className="row end">
          <button type="button" className="primary" onClick={onClose}>
            {t('setup.close')}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={t('hub.publishTitle')} onClose={onClose} wide>
      <div className="form-grid">
        <label className="field">
          <span>{t('hub.title')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('hub.taskCodeOptional')}</span>
          <input className="mono" value={code} placeholder={t('hub.codeAuto')} spellCheck={false} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        <label className="field">
          <span>{t('hub.submitFrom')}</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('hub.submitUntil')}</span>
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>{t('hub.description')}</span>
        <textarea className="mono" rows={8} value={description} placeholder={t('hub.descriptionHint')} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="form-grid">
        <div className="field">
          <span>{t('hub.classes')}</span>
          {classes === null && !error && <span className="muted">…</span>}
          {classes && classes.length === 0 && <span className="muted">{t('hub.noClasses')}</span>}
          <div className="check-list">
            {classes?.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                <span>
                  {c.name} <span className="muted">({c.students.length})</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{t('hub.excludeFiles')}</span>
          <div className="check-list">
            {project?.files.map((f) => (
              <label key={f.path} className="check">
                <input type="checkbox" checked={!exclude.includes(f.path)} onChange={() => toggleExclude(f.path)} />
                <span className="mono">{f.path}</span>
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} />
            <span>{t('hub.withTests')}</span>
          </label>
        </div>
      </div>
      {error && <pre className="dialog-error">{error}</pre>}
      <div className="row end">
        <button type="button" onClick={onClose}>
          {t('setup.close')}
        </button>
        <button type="button" className="primary" disabled={busy || !title.trim() || selected.length === 0} onClick={() => void go()}>
          {busy ? t('hub.publishing') : t('hub.publish')}
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- collect

export function CollectDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<TaskInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.bluepy.hub
      .tasks()
      .then(setTasks)
      .catch((e) => setError(errorText(e)))
  }, [])

  const collect = async (code: string): Promise<void> => {
    setBusy(code)
    setError(null)
    try {
      const review = await window.bluepy.hub.collect(code)
      useStore.setState({ message: t('hub.collected', { count: review.students.filter((s) => s.submittedAt).length, total: review.students.length }) })
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title={t('hub.collectTitle')} onClose={onClose} wide>
      {tasks === null && !error && <p className="muted">…</p>}
      {tasks && tasks.length === 0 && <p className="doc">{t('hub.noTasks')}</p>}
      {tasks && tasks.length > 0 && (
        <table className="fields hub-tasks">
          <thead>
            <tr>
              <th>{t('hub.taskCode')}</th>
              <th>{t('hub.title')}</th>
              <th>{t('hub.submitUntil')}</th>
              <th>{t('hub.submissions')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.code}>
                <td className="mono">{task.code}</td>
                <td>{task.title}</td>
                <td>
                  {formatWhen(task.submitUntil)} <span className={`chip ${task.window === 'open' ? 'ok' : ''}`}>{t(`hub.window.${task.window}`)}</span>
                </td>
                <td className="num">
                  {task.submissions ?? 0} / {task.students ?? 0}
                </td>
                <td className="field-actions">
                  <button type="button" className="primary" disabled={busy !== null} onClick={() => void collect(task.code)}>
                    {busy === task.code ? t('hub.collecting') : t('hub.collect')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <pre className="dialog-error">{error}</pre>}
      <div className="row end">
        <button type="button" onClick={onClose}>
          {t('setup.close')}
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- classes

export function ClassesDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const [classes, setClasses] = useState<HubClass[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [names, setNames] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const reload = (): void => {
    window.bluepy.hub
      .classes()
      .then(setClasses)
      .catch((e) => setError(errorText(e)))
  }
  useEffect(reload, [])

  const parsed = names
    .split(/\r?\n|;|,/)
    .map((n) => n.trim())
    .filter(Boolean)

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (open !== null) await window.bluepy.hub.addStudents(open, parsed)
      else {
        const created = await window.bluepy.hub.addClass(name.trim(), parsed)
        setOpen(created.id)
      }
      setName('')
      setNames('')
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number): Promise<void> => {
    if (!window.confirm(t('hub.removeClassConfirm'))) return
    await window.bluepy.hub.removeClass(id)
    if (open === id) setOpen(null)
    reload()
  }

  const copyList = (cls: HubClass): void => {
    void navigator.clipboard?.writeText(cls.students.map((s) => `${s.name}\t${s.code}`).join('\n'))
    useStore.setState({ message: t('hub.listCopied', { name: cls.name }) })
  }

  const current = classes?.find((c) => c.id === open) ?? null
  return (
    <Modal title={t('hub.classesTitle')} onClose={onClose} wide>
      <div className="classes-layout">
        <div className="classes-list">
          {classes === null && !error && <p className="muted">…</p>}
          {classes?.map((c) => (
            <button key={c.id} type="button" className={`class-row ${open === c.id ? 'active' : ''}`} onClick={() => setOpen(c.id)}>
              <span>{c.name}</span>
              <span className="muted">{c.students.length}</span>
            </button>
          ))}
          <button type="button" className={`class-row ${open === null ? 'active' : ''}`} onClick={() => setOpen(null)}>
            ＋ {t('hub.newClass')}
          </button>
        </div>
        <div className="classes-detail">
          {current ? (
            <>
              <div className="row">
                <h3>{current.name}</h3>
                <span className="toolbar-spacer" />
                <button type="button" onClick={() => copyList(current)}>
                  {t('hub.copyList')}
                </button>
                <button type="button" onClick={() => void remove(current.id)}>
                  {t('hub.removeClass')}
                </button>
              </div>
              <table className="fields">
                <tbody>
                  {current.students.map((s) => (
                    <tr key={s.id}>
                      <td className="field-name">{s.name}</td>
                      <td className="mono">{s.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="doc muted">{t('hub.codesHint')}</p>
            </>
          ) : (
            <label className="field">
              <span>{t('hub.className')}</span>
              <input value={name} placeholder="8c" onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>{current ? t('hub.addNames') : t('hub.names')}</span>
            <textarea rows={6} value={names} placeholder={t('hub.namesHint')} onChange={(e) => setNames(e.target.value)} />
          </label>
          {error && <pre className="dialog-error">{error}</pre>}
          <div className="row end">
            <button type="button" onClick={onClose}>
              {t('setup.close')}
            </button>
            <button type="button" className="primary" disabled={busy || (!current && !name.trim()) || parsed.length === 0} onClick={() => void add()}>
              {current ? t('hub.addNames') : t('hub.createClass')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// --------------------------------------------------------------- feedback

export function FeedbackDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const assignment = useStore((s) => s.assignment)
  const [state, setState] = useState<'loading' | 'none' | 'ok' | 'error'>('loading')
  const [feedback, setFeedback] = useState<{ notes: string; points: string | null; updated: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.bluepy.hub
      .feedback()
      .then((fb) => {
        setFeedback(fb)
        setState(fb ? 'ok' : 'none')
      })
      .catch((e) => {
        setError(errorText(e))
        setState('error')
      })
  }, [])

  return (
    <Modal title={t('hub.feedbackTitle')} onClose={onClose}>
      {assignment && (
        <p className="doc">
          <b>{assignment.meta.title}</b> · {assignment.meta.code}
        </p>
      )}
      {state === 'loading' && <p className="muted">…</p>}
      {state === 'none' && <p className="doc">{t('hub.noFeedback')}</p>}
      {state === 'ok' && feedback && (
        <div className="feedback-box">
          {feedback.points && (
            <div className="feedback-points">
              {t('hub.points')}: <b>{feedback.points}</b>
            </div>
          )}
          <div className="feedback-notes">{feedback.notes || t('hub.noNotes')}</div>
          <div className="muted">{t('hub.feedbackUpdated', { when: formatWhen(feedback.updated) })}</div>
        </div>
      )}
      {error && <pre className="dialog-error">{error}</pre>}
      <div className="row end">
        <button type="button" className="primary" onClick={onClose}>
          {t('setup.close')}
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------ review tests

export function ReviewTestsDialog({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation()
  const review = useStore((s) => s.review)
  const reviewOpen = useStore((s) => s.reviewOpen)
  if (!review) return <></>
  const testIds = [...new Set(review.students.flatMap((s) => Object.keys(s.tests?.results ?? {})))].sort()
  const short = (id: string): string => id.split('.').slice(-2).join('.')
  const symbol: Record<string, string> = { passed: '✓', failed: '✗', error: '!', skipped: '–' }

  const copyCsv = (): void => {
    const head = ['Name', 'Klasse', 'Abgabe', 'Bestanden', 'Gesamt', ...testIds.map(short), 'Punkte', 'Notizen'].join(';')
    const rows = review.students.map((s) =>
      [
        s.name,
        s.class,
        s.submittedAt ? formatWhen(s.submittedAt) : '',
        s.tests ? String(s.tests.passed) : '',
        s.tests ? String(s.tests.total) : '',
        ...testIds.map((id) => (s.tests ? (s.tests.results[id] ?? '') : '')),
        s.points,
        s.notes.replace(/[\r\n;]+/g, ' ')
      ].join(';')
    )
    void navigator.clipboard?.writeText([head, ...rows].join('\n'))
    useStore.setState({ message: t('hub.csvCopied') })
  }

  return (
    <Modal title={t('hub.testsTableTitle', { title: review.title })} onClose={onClose} wide>
      <div className="table-scroll">
        <table className="fields review-table">
          <thead>
            <tr>
              <th>{t('hub.student')}</th>
              <th className="num">{t('tests.counts.passed')}</th>
              {testIds.map((id) => (
                <th key={id} className="rot" title={id}>
                  <span>{short(id)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {review.students.map((s, i) => (
              <tr key={s.personal} className={s.folder ? '' : 'muted'}>
                <td className="field-name">
                  {s.folder ? (
                    <button type="button" className="link" onClick={() => void reviewOpen(i).then(onClose)}>
                      {s.name}
                    </button>
                  ) : (
                    s.name
                  )}
                  {s.tests && !s.tests.ok && <span className="chip bad" title={s.tests.error ?? ''}>!</span>}
                </td>
                <td className={`num ${s.tests ? (s.tests.passed === s.tests.total && s.tests.total > 0 ? 'ok' : s.tests.passed === 0 ? 'bad' : '') : ''}`}>
                  {s.tests ? `${s.tests.passed} / ${s.tests.total}` : s.folder ? '…' : '–'}
                </td>
                {testIds.map((id) => {
                  const status = s.tests?.results[id]
                  return (
                    <td key={id} className={`cell-${status ?? 'none'}`} title={status ?? ''}>
                      {status ? symbol[status] : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row end">
        <button type="button" onClick={copyCsv}>
          {t('hub.copyCsv')}
        </button>
        <button type="button" className="primary" onClick={onClose}>
          {t('setup.close')}
        </button>
      </div>
    </Modal>
  )
}

export function HubDialogs(): JSX.Element | null {
  const dialog = useStore((s) => s.hubDialog)
  const setHubDialog = useStore((s) => s.setHubDialog)
  const close = (): void => setHubDialog(null)
  switch (dialog) {
    case 'settings':
      return <HubSettingsDialog onClose={close} />
    case 'fetch':
      return <FetchTaskDialog onClose={close} />
    case 'submit':
      return <SubmitDialog onClose={close} />
    case 'publish':
      return <PublishTaskDialog onClose={close} />
    case 'collect':
      return <CollectDialog onClose={close} />
    case 'classes':
      return <ClassesDialog onClose={close} />
    case 'feedback':
      return <FeedbackDialog onClose={close} />
    case 'reviewTests':
      return <ReviewTestsDialog onClose={close} />
    default:
      return null
  }
}
