import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

type Kind = 'class' | 'module' | 'unittest'

function template(kind: Kind, className: string): string {
  switch (kind) {
    case 'class':
      return `class ${className}:\n    """Beschreibe hier, wofür ${className} da ist."""\n\n    def __init__(self):\n        pass\n`
    case 'unittest':
      return `import unittest\n\n\nclass ${className}(unittest.TestCase):\n    def setUp(self):\n        pass\n\n    def test_beispiel(self):\n        self.assertTrue(True)\n`
    case 'module':
      return `def main():\n    print("Hallo")\n\n\nif __name__ == "__main__":\n    main()\n`
  }
}

function fileNameFor(kind: Kind, className: string): string {
  if (kind === 'module') return className.toLowerCase() + '.py'
  const snake = className.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  return (kind === 'unittest' ? snake.replace(/^test_/, 'test_') : snake) + '.py'
}

export function NewFileDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const createFile = useStore((s) => s.createFile)
  const project = useStore((s) => s.project)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('class')
  const [error, setError] = useState<string | null>(null)

  const valid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
  const fileName = valid ? fileNameFor(kind, name) : ''
  const exists = Boolean(project?.files.some((f) => f.path === fileName))

  const submit = async (): Promise<void> => {
    if (!valid || exists) return
    try {
      await createFile(fileName, template(kind, name))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{t('newFile.title')}</h2>
        <label className="field">
          <span>{t('newFile.name')}</span>
          <input
            autoFocus
            value={name}
            spellCheck={false}
            onChange={(e) => setName(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </label>
        <div className="field">
          <span>{t('newFile.kind')}</span>
          <div className="radio-row">
            {(['class', 'unittest', 'module'] as Kind[]).map((k) => (
              <label key={k}>
                <input type="radio" checked={kind === k} onChange={() => setKind(k)} /> {t(`newFile.kinds.${k}`)}
              </label>
            ))}
          </div>
        </div>
        <p className="muted">{valid ? t('newFile.willCreate', { file: fileName }) : t('newFile.hint')}</p>
        {exists && <p className="problem">{t('newFile.exists')}</p>}
        {error && <p className="problem">{error}</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>
            {t('setup.close')}
          </button>
          <button type="button" className="primary" disabled={!valid || exists} onClick={() => void submit()}>
            {t('newFile.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
