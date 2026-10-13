/**
 * Window manager: one window per role.  The editor window is the main
 * window (closing it quits BluePy); the class-diagram window can be opened
 * and closed freely.  Bounds are remembered per role.
 */
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { BrowserWindow, app, screen, shell, type Rectangle } from 'electron'
import type { BackendEvent, WindowRole } from '@bluepy/protocol'
import { loadSettings, saveSettings } from './settings'

const DEFAULT_BOUNDS: Record<WindowRole, { width: number; height: number }> = {
  main: { width: 1200, height: 820 },
  diagram: { width: 760, height: 640 },
  debugger: { width: 760, height: 560 },
  tests: { width: 640, height: 520 }
}

const TITLES: Record<WindowRole, string> = {
  main: 'BluePy',
  diagram: 'BluePy – Klassendiagramm',
  debugger: 'BluePy – Debugger',
  tests: 'BluePy – Testergebnisse'
}

function boundsOnScreen(bounds: Rectangle | undefined): Rectangle | undefined {
  if (!bounds) return undefined
  const fits = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return bounds.x >= a.x - 50 && bounds.y >= a.y - 50 && bounds.x < a.x + a.width - 100 && bounds.y < a.y + a.height - 100
  })
  return fits ? bounds : undefined
}

/** Emits 'opened' and 'closed' with the window role. */
export class WindowManager extends EventEmitter {
  private readonly windows = new Map<WindowRole, BrowserWindow>()

  get(role: WindowRole): BrowserWindow | undefined {
    const win = this.windows.get(role)
    return win && !win.isDestroyed() ? win : undefined
  }

  async open(role: WindowRole): Promise<BrowserWindow> {
    const existing = this.get(role)
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return existing
    }
    const settings = await loadSettings()
    const remembered = boundsOnScreen(settings.windowBounds?.[role])
    const win = new BrowserWindow({
      ...DEFAULT_BOUNDS[role],
      ...(remembered ?? {}),
      minWidth: role === 'main' ? 900 : 480,
      minHeight: role === 'main' ? 600 : 400,
      title: TITLES[role],
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.windows.set(role, win)

    win.once('ready-to-show', () => win.show())
    win.on('page-title-updated', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const persist = (): void => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
      void this.saveBounds(role, win.getBounds())
    }
    win.on('resize', persist)
    win.on('move', persist)
    win.on('closed', () => {
      this.windows.delete(role)
      this.emit('closed', role)
      if (role === 'main') {
        for (const other of this.windows.values()) if (!other.isDestroyed()) other.close()
        app.quit()
      }
    })
    this.emit('opened', role)

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?window=${role}`)
      if (role === 'main' && process.env.BLUEPY_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { window: role } })
    }
    return win
  }

  broadcast(event: BackendEvent, channel: string): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, event)
    }
  }

  private saveTimer: NodeJS.Timeout | null = null
  private pendingBounds: Partial<Record<WindowRole, Rectangle>> = {}

  private async saveBounds(role: WindowRole, bounds: Rectangle): Promise<void> {
    this.pendingBounds[role] = bounds
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void (async () => {
        const settings = await loadSettings()
        await saveSettings({ ...settings, windowBounds: { ...(settings.windowBounds ?? {}), ...this.pendingBounds } })
      })()
    }, 400)
  }
}

export const windows = new WindowManager()
