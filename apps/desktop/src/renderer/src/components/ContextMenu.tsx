import { useEffect, useRef, type JSX } from 'react'

export interface MenuEntry {
  label: string
  /** Secondary text (signature, hint). */
  detail?: string
  disabled?: boolean
  /** Non-clickable group heading. */
  heading?: boolean
  separator?: boolean
  onSelect?: () => void
}

interface Props {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}

/** A lightweight popup menu (class / object context menus). */
export function ContextMenu({ x, y, entries, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // keep the menu inside the window
  const maxX = Math.max(0, window.innerWidth - 320)
  const maxY = Math.max(0, window.innerHeight - Math.min(entries.length * 28 + 16, window.innerHeight - 20))

  return (
    <div className="context-menu" ref={ref} style={{ left: Math.min(x, maxX), top: Math.min(y, maxY) }} role="menu">
      {entries.map((entry, i) => {
        if (entry.separator) return <div key={i} className="menu-separator" />
        if (entry.heading) {
          return (
            <div key={i} className="menu-heading">
              {entry.label}
            </div>
          )
        }
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect?.()
              onClose()
            }}
          >
            <span className="menu-label">{entry.label}</span>
            {entry.detail && <span className="menu-detail">{entry.detail}</span>}
          </button>
        )
      })}
    </div>
  )
}
