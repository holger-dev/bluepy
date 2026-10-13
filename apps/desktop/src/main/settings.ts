/** Tiny JSON settings store in Electron's userData directory. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, type Rectangle } from 'electron'
import type { ThemeSetting, WindowRole } from '@bluepy/protocol'

export interface Settings {
  /** Manually chosen interpreter; null = automatic. */
  pythonPath: string | null
  language: 'de' | 'en' | null
  windowBounds?: Partial<Record<WindowRole, Rectangle>>
  recentProjects: string[]
  reopenLastProject: boolean
  theme: ThemeSetting
  /** BluePy-Hub (docs/04): URL, teacher key and personal code (encrypted with safeStorage when available). */
  hubUrl?: string | null
  hubTeacherKey?: string | null
  hubTeacherName?: string | null
  hubPersonalCode?: string | null
  /** Anonymous device id sent with submissions (same device, two codes → flagged for the teacher). */
  deviceId?: string | null
  /** Last accepted submission per task code. */
  lastSubmissions?: Record<string, string>
}

const DEFAULTS: Settings = { pythonPath: null, language: null, recentProjects: [], reopenLastProject: true, theme: 'system' }

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
}
