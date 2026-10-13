import type { JSX } from 'react'
import { useStore } from '../store'

export function Tabs(): JSX.Element {
  const openFiles = useStore((s) => s.openFiles)
  const activeFile = useStore((s) => s.activeFile)
  const setActiveFile = useStore((s) => s.setActiveFile)
  const closeFile = useStore((s) => s.closeFile)
  const compile = useStore((s) => s.project?.compile ?? {})

  return (
    <div className="tabs" role="tablist">
      {openFiles.map((file) => {
        const dirty = file.content !== file.savedContent
        const result = compile[file.path]
        const status = result ? (result.ok ? 'ok' : 'error') : 'stale'
        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={file.path === activeFile}
            className={`tab-item ${file.path === activeFile ? 'active' : ''} status-${status}`}
            onClick={() => setActiveFile(file.path)}
            onAuxClick={(e) => {
              if (e.button === 1) closeFile(file.path)
            }}
            title={file.path}
          >
            <span className="tab-name">
              {file.path.split('/').pop()}
              {dirty ? ' •' : ''}
            </span>
            <button
              type="button"
              className="tab-close"
              aria-label="close"
              onClick={(e) => {
                e.stopPropagation()
                if (!dirty || window.confirm(`${file.path} hat ungespeicherte Änderungen. Trotzdem schließen?`)) closeFile(file.path)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
