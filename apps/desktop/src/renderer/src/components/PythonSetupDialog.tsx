import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { PythonInterpreter } from '@bluepy/protocol'
import { useStore } from '../store'

function InterpreterRow({ item, selectedPath }: { item: PythonInterpreter; selectedPath: string | null }): JSX.Element {
  const { t } = useTranslation()
  const selectPython = useStore((s) => s.selectPython)
  const inUse = item.path === selectedPath
  return (
    <li className={`interpreter${item.ok ? '' : ' unusable'}`}>
      <div className="interpreter-main">
        <span className="interpreter-version">
          {item.version ? `Python ${item.version}` : '–'}
          {item.problem && (
            <span className="problem"> · {t(`setup.problem.${item.problem.key}`, { detail: item.problem.detail ?? '' })}</span>
          )}
          {item.ok && item.hasTkinter === false && <span className="problem"> · {t('setup.noTkinter')}</span>}
        </span>
        <span className="interpreter-path">{item.path}</span>
        <span className="interpreter-source">{item.source}</span>
      </div>
      {item.ok &&
        (inUse ? (
          <span className="chip ok">{t('setup.inUse')}</span>
        ) : (
          <button type="button" onClick={() => void selectPython(item.path)}>
            {t('setup.use')}
          </button>
        ))}
    </li>
  )
}

export function PythonSetupDialog(): JSX.Element {
  const { t } = useTranslation()
  const discovery = useStore((s) => s.discovery)
  const discovering = useStore((s) => s.discovering)
  const rediscover = useStore((s) => s.rediscover)
  const selectPython = useStore((s) => s.selectPython)
  const setSetupOpen = useStore((s) => s.setSetupOpen)

  const platform = discovery?.platform ?? 'linux'
  const installKey = platform === 'win32' || platform === 'darwin' ? platform : 'linux'
  const selectedPath = discovery?.selected?.path ?? null
  const configured = discovery?.selected?.source === 'configured'

  return (
    <div className="modal-backdrop" onClick={() => setSetupOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{t('setup.title')}</h2>
        <p>{t('setup.intro', { minimum: discovery?.minimumVersion ?? '3.11' })}</p>

        <h3>{t('setup.found')}</h3>
        {discovering && <p className="muted">{t('status.pythonSearching')}</p>}
        {!discovering && discovery && discovery.interpreters.length === 0 && <p>{t('setup.none')}</p>}
        <ul className="interpreter-list">
          {discovery?.interpreters.map((item) => (
            <InterpreterRow key={item.path} item={item} selectedPath={selectedPath} />
          ))}
        </ul>
        <div className="row">
          <button type="button" disabled={!configured} onClick={() => void selectPython(null)}>
            {t('setup.automatic')}
          </button>
          <span className="muted">{t('setup.automaticHint')}</span>
        </div>

        {(!discovery || !discovery.selected) && (
          <div className="install-box">
            <h3>{t('setup.install.title')}</h3>
            <p>{t(`setup.install.${installKey}`)}</p>
            <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">
              {t('setup.install.link')}
            </a>
          </div>
        )}

        <div className="row end">
          <button type="button" onClick={() => void rediscover()} disabled={discovering}>
            {t('setup.rescan')}
          </button>
          <button type="button" className="primary" onClick={() => setSetupOpen(false)}>
            {t('setup.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
