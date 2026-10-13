/**
 * Application menu.  Besides project/window commands it provides the standard
 * Edit roles – without them Cmd+C/V do not work in text fields on macOS.
 */
import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron'
import { pickNewProjectFolder, pickProjectFolder, session, state } from './ipc'
import { windows } from './windows'

const LABELS = {
  de: {
    project: 'Projekt',
    newProject: 'Neues Projekt…',
    openProject: 'Projekt öffnen…',
    openRecent: 'Zuletzt geöffnet',
    noRecent: '(keine)',
    closeProject: 'Projekt schließen',
    compile: 'Compile',
    save: 'Speichern',
    saveAll: 'Alle speichern',
    edit: 'Bearbeiten',
    view: 'Ansicht',
    window: 'Fenster',
    help: 'Hilfe',
    quit: 'BluePy beenden',
    editor: 'Editor',
    diagram: 'Klassendiagramm',
    debugger: 'Debugger',
    reload: 'Neu laden',
    devtools: 'Entwicklerwerkzeuge',
    bluejSite: 'BlueJ-Website (Vorbild)',
    repo: 'BluePy auf GitHub'
  },
  en: {
    project: 'Project',
    newProject: 'New Project…',
    openProject: 'Open Project…',
    openRecent: 'Open Recent',
    noRecent: '(none)',
    closeProject: 'Close Project',
    compile: 'Compile',
    save: 'Save',
    saveAll: 'Save All',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    help: 'Help',
    quit: 'Quit BluePy',
    editor: 'Editor',
    diagram: 'Class diagram',
    debugger: 'Debugger',
    reload: 'Reload',
    devtools: 'Developer tools',
    bluejSite: 'BlueJ website (the original)',
    repo: 'BluePy on GitHub'
  }
} as const

function labels(): (typeof LABELS)['de'] | (typeof LABELS)['en'] {
  return LABELS[app.getLocale().toLowerCase().startsWith('de') ? 'de' : 'en']
}

export function installMenu(): void {
  const t = labels()
  const isMac = process.platform === 'darwin'
  const recent = state.recentProjects

  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? recent.map((dir) => ({ label: dir, click: () => void session.openProject(dir) }))
    : [{ label: t.noRecent, enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: t.project,
      submenu: [
        { label: t.newProject, accelerator: 'CmdOrCtrl+N', click: () => void newProjectFromMenu() },
        { label: t.openProject, accelerator: 'CmdOrCtrl+O', click: () => void openProjectFromMenu() },
        { label: t.openRecent, submenu: recentItems },
        { label: t.closeProject, click: () => void session.closeProject() },
        { type: 'separator' },
        { label: t.save, accelerator: 'CmdOrCtrl+S', click: () => state.menu('save') },
        { label: t.saveAll, accelerator: 'CmdOrCtrl+Alt+S', click: () => state.menu('saveAll') },
        { label: t.compile, accelerator: 'CmdOrCtrl+K', click: () => state.menu('compile') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: t.quit }])
      ]
    },
    {
      label: t.edit,
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: t.view,
      submenu: [
        { role: 'reload', label: t.reload },
        { role: 'toggleDevTools', label: t.devtools },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: t.window,
      submenu: [
        { label: t.editor, accelerator: 'CmdOrCtrl+Shift+E', click: () => void windows.open('main') },
        { label: t.diagram, accelerator: 'CmdOrCtrl+Shift+D', click: () => void windows.open('diagram') },
        { label: t.debugger, accelerator: 'CmdOrCtrl+Shift+B', click: () => void windows.open('debugger') },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: t.help,
      submenu: [
        { label: t.repo, click: () => void shell.openExternal('https://github.com/holgerheidkamp/bluepy') },
        { label: t.bluejSite, click: () => void shell.openExternal('https://www.bluej.org/') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Rebuild the menu (recent projects changed). */
export function refreshMenu(): void {
  installMenu()
}

async function openProjectFromMenu(): Promise<void> {
  const dir = await pickProjectFolder()
  if (dir) await session.openProject(dir)
}

async function newProjectFromMenu(): Promise<void> {
  const dir = await pickNewProjectFolder()
  if (dir) await session.createProject(dir)
}
