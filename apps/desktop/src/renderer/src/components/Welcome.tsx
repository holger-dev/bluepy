import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

export function Welcome(): JSX.Element {
  const { t } = useTranslation()
  const openProject = useStore((s) => s.openProject)
  const createProject = useStore((s) => s.createProject)
  const openExample = useStore((s) => s.openExample)
  const recent = useStore((s) => s.recentProjects)
  const busy = useStore((s) => s.busy)

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
          <button type="button" disabled={busy !== null} onClick={() => void openExample('bank')}>
            {t('welcome.example')}
          </button>
        </div>
        {recent.length > 0 && (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}
