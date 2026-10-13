import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'

export type PaneId = 'sidebar' | 'codepad' | 'terminal' | 'bench' | 'assignment'

/** Per window role: both windows share one origin (and localStorage), but their panes are independent. */
const storageKey = (): string => `bluepy.panes.${document.body.dataset.window ?? 'main'}`

function readCollapsed(): Partial<Record<PaneId, boolean>> {
  try {
    const raw = window.localStorage.getItem(storageKey())
    return raw ? (JSON.parse(raw) as Partial<Record<PaneId, boolean>>) : {}
  } catch {
    return {}
  }
}

function writeCollapsed(value: Partial<Record<PaneId, boolean>>): void {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(value))
  } catch {
    /* storage unavailable – collapse state is a per-window convenience only */
  }
}

/** Collapsed/expanded state of the layout panes, remembered per window in localStorage. */
export function usePaneState(): { collapsed: Partial<Record<PaneId, boolean>>; toggle(id: PaneId): void } {
  const [collapsed, setCollapsed] = useState<Partial<Record<PaneId, boolean>>>(() => readCollapsed())
  useEffect(() => writeCollapsed(collapsed), [collapsed])
  const toggle = useCallback((id: PaneId) => setCollapsed((c) => ({ ...c, [id]: !c[id] })), [])
  return { collapsed, toggle }
}

interface Props {
  id: PaneId
  title: string
  collapsed: boolean
  onToggle(): void
  /** Collapsed panes become a thin strip; 'vertical' strips show the title rotated. */
  orientation: 'vertical' | 'horizontal'
  /** Extra controls shown in the title bar while expanded. */
  actions?: ReactNode
  children: ReactNode
}

export function CollapsiblePane({ id, title, collapsed, onToggle, orientation, actions, children }: Props): JSX.Element {
  if (collapsed) {
    return (
      <button
        type="button"
        className={`pane-strip pane-strip-${orientation}`}
        data-pane={id}
        onClick={onToggle}
        title={`${title} einblenden`}
        aria-expanded={false}
      >
        <span className="pane-strip-label">{title}</span>
        <span className="pane-strip-chevron">{orientation === 'vertical' ? '▸' : '▴'}</span>
      </button>
    )
  }
  return (
    <div className="pane-body" data-pane={id}>
      <div className="pane-title">
        <button type="button" className="pane-collapse" onClick={onToggle} title={`${title} ausblenden`} aria-expanded={true}>
          ▾
        </button>
        {title}
        {actions}
      </div>
      <div className="pane-content">{children}</div>
    </div>
  )
}
