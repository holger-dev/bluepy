import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExampleInfo } from '@bluepy/protocol'
import { useStore } from '../store'

export function Welcome(): JSX.Element {
  const { t } = useTranslation()
  const openProject = useStore((s) => s.openProject)
  const createProject = useStore((s) => s.createProject)
  const openExample = useStore((s) => s.openExample)
  const setHubDialog = useStore((s) => s.setHubDialog)
  const recent = useStore((s) => s.recentProjects)
  const busy = useStore((s) => s.busy)
  const [examples, setExamples] = useState<ExampleInfo[]>([])

  useEffect(() => {
    void window.bluepy.project.examples().then(setExamples)
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>{t('welcome.title')}</h1>
        <p className="muted">{t('welcome.intro')}</p>
        <div className="welcome-actions">
          <button type="button" className="primary" disabled={busy !== null} onClick={() => void createProject()}>
            {t('welcome.new')}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void openProject(null)}>
            {t('welcome.open')}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => setHubDialog('fetch')}>
            {t('hub.fetchTitle')}…
          </button>
        </div>
        <div className="welcome-columns">
          <section>
            <h3>{t('welcome.examples')}</h3>
            <ul className="example-list">
              {examples.map((ex) => (
                <li key={ex.id}>
                  <button type="button" className="example-card" disabled={busy !== null} onClick={() => void openExample(ex.id)}>
                    <span className="example-head">
                      <b>{ex.name}</b>
                      <span className="chip">{ex.level}</span>
                    </span>
                    <span className="muted">{ex.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {recent.length > 0 && (
            <section>
              <h3>{t('welcome.recent')}</h3>
              <ul className="recent-list">
                {recent.map((dir) => (
                  <li key={dir}>
                    <button type="button" className="link" disabled={busy !== null} onClick={() => void openProject(dir)}>
                      {dir}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
