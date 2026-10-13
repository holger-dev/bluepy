import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { NewFileDialog } from './NewFileDialog'

export function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const project = useStore((s) => s.project)
  const openFiles = useStore((s) => s.openFiles)
  const activeFile = useStore((s) => s.activeFile)
  const openFile = useStore((s) => s.openFile)
  const [newFileOpen, setNewFileOpen] = useState(false)
  if (!project) return <aside className="sidebar" />

  const classesByFile = new Map<string, string[]>()
  for (const cls of project.model?.classes ?? []) {
    classesByFile.set(cls.file, [...(classesByFile.get(cls.file) ?? []), cls.name])
  }

  return (
    <aside className="sidebar">
      <div className="pane-title">
        {project.name}
        <button type="button" className="link" onClick={() => setNewFileOpen(true)} title={t('sidebar.newFile')}>
          ＋
        </button>
      </div>
      <ul className="file-list">
        {project.files.map((file) => {
          const result = project.compile[file.path]
          const status = result ? (result.ok ? 'ok' : 'error') : 'stale'
          const open = openFiles.find((f) => f.path === file.path)
          const dirty = open ? open.content !== open.savedContent : false
          const classes = classesByFile.get(file.path) ?? []
          return (
            <li
              key={file.path}
              className={`file-item ${file.path === activeFile ? 'active' : ''} status-${status}`}
              onClick={() => void openFile(file.path)}
              title={result && !result.ok ? `${result.error?.type}: ${result.error?.message}` : file.path}
            >
              <span className={`status-dot ${status}`} />
              <span className="file-name">
                {file.path}
                {dirty ? ' •' : ''}
              </span>
              {classes.length > 0 && <span className="file-classes">{classes.join(', ')}</span>}
            </li>
          )
        })}
        {project.files.length === 0 && <li className="hint file-empty">{t('sidebar.empty')}</li>}
      </ul>
      {newFileOpen && <NewFileDialog onClose={() => setNewFileOpen(false)} />}
    </aside>
  )
}
