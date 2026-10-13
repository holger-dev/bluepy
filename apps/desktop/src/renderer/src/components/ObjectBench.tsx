import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { BenchObject } from '@bluepy/protocol'
import { useStore } from '../store'

interface Props {
  onObjectMenu(obj: BenchObject, x: number, y: number): void
  onInspect(obj: BenchObject): void
}

export function ObjectBench({ onObjectMenu, onInspect }: Props): JSX.Element {
  const { t } = useTranslation()
  const bench = useStore((s) => s.bench)
  const status = useStore((s) => s.backendStatus)
  return (
    <div className="pane-body bench">
      <div className="bench-strip">
        {bench.length === 0 && (
          <span className="hint">{status === 'running' ? t('bench.empty') : t('bench.noBackend')}</span>
        )}
        {bench.map((obj) => (
          <button
            key={obj.name}
            type="button"
            className="bench-object"
            title={obj.repr}
            onClick={(e) => onObjectMenu(obj, e.clientX, e.clientY)}
            onContextMenu={(e) => {
              e.preventDefault()
              onObjectMenu(obj, e.clientX, e.clientY)
            }}
            onDoubleClick={() => onInspect(obj)}
          >
            <span className="bench-name">{obj.name}</span>
            <span className="bench-type">: {obj.type}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
