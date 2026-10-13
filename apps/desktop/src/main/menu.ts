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
    tests: 'Testergebnisse',
    runTests: 'Alle Tests ausführen',
    tasks: 'Aufgaben',
    fetchTask: 'Aufgabe holen…',
    submitTask: 'Abgeben',
    updateTask: 'Aufgabe aktualisieren',
    feedback: 'Rückmeldung abrufen…',
    publishTask: 'Neue Aufgabe für SuS…',
    collect: 'Abgaben einsammeln…',
    classes: 'Klassen verwalten…',
    hubSettings: 'Hub-Einstellungen…',
    exportPackage: 'Projekt als Paket exportieren…',
    importPackage: 'Paket importieren…',
    theme: 'Farbschema',
    themeSystem: 'System',
    themeLight: 'Hell',
    themeDark: 'Dunkel',
    reload: 'Neu laden',
    devtools: 'Entwicklerwerkzeuge',
    website: 'BluePy-Website',
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
    tests: 'Test results',
    runTests: 'Run all tests',
    tasks: 'Assignments',
    fetchTask: 'Get assignment…',
    submitTask: 'Submit',
    updateTask: 'Update assignment',
    feedback: 'Get feedback…',
    publishTask: 'New assignment for students…',
    collect: 'Collect submissions…',
    classes: 'Manage classes…',
    hubSettings: 'Hub settings…',
    exportPackage: 'Export project as package…',
    importPackage: 'Import package…',
    theme: 'Appearance',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    reload: 'Reload',
    devtools: 'Developer tools',
    website: 'BluePy website',
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
        { label: t.runTests, accelerator: 'CmdOrCtrl+Shift+R', click: () => state.menu('runTests') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: t.quit }])
      ]
    },
    {
      label: t.tasks,
      submenu: [
        { label: t.fetchTask, accelerator: 'CmdOrCtrl+Shift+A', click: () => state.menu('hub.fetch') },
        { label: t.submitTask, enabled: state.assignment !== null, click: () => state.menu('hub.submit') },
        { label: t.updateTask, enabled: state.assignment !== null, click: () => state.menu('hub.update') },
        { label: t.feedback, enabled: state.assignment !== null, click: () => state.menu('hub.feedback') },
        { type: 'separator' },
        ...(state.hub.hasTeacherKey
          ? [
              { label: t.publishTask, enabled: state.project !== null, click: () => state.menu('hub.publish') },
              { label: t.collect, click: () => state.menu('hub.collect') },
              { label: t.classes, click: () => state.menu('hub.classes') },
              { type: 'separator' as const }
            ]
          : []),
        { label: t.exportPackage, enabled: state.project !== null, click: () => state.menu('package.export') },
        { label: t.importPackage, click: () => state.menu('package.import') },
        { type: 'separator' },
        { label: t.hubSettings, click: () => state.menu('hub.settings') }
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
        {
          label: t.theme,
          submenu: (['system', 'light', 'dark'] as const).map((theme) => ({
            label: theme === 'system' ? t.themeSystem : theme === 'light' ? t.themeLight : t.themeDark,
            type: 'radio' as const,
            checked: state.theme === theme,
            click: () => void session.setTheme(theme)
          }))
        },
        { type: 'separator' },
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
        { label: t.tests, accelerator: 'CmdOrCtrl+Shift+T', click: () => void windows.open('tests') },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: t.help,
      submenu: [
        { label: t.repo, click: () => void shell.openExternal('https://github.com/holger-dev/bluepy') },
        { label: t.website, click: () => void shell.openExternal('https://bluepy.heidkamp.dev/') }
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
