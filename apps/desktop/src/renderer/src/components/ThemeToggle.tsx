import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThemeSetting } from '@bluepy/protocol'
import { useStore } from '../store'

const ORDER: ThemeSetting[] = ['system', 'light', 'dark']
const ICON: Record<ThemeSetting, string> = { system: '◐', light: '☀', dark: '☾' }

/** Quick switch light → dark → system (also in the View menu). */
export function ThemeToggle(): JSX.Element {
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system'
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={() => void setTheme(next)}
      title={`${t('theme.label')}: ${t(`theme.${theme}`)} – ${t('theme.switchTo', { next: t(`theme.${next}`) })}`}
      aria-label={t('theme.label')}
    >
      {ICON[theme]}
    </button>
  )
}
