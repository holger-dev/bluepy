/**
 * IPC surface of the main process.  The Session ties together interpreter
 * discovery, the open project, the shared AppState and the backend process
 * (which always runs with the project directory as cwd).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain, nativeTheme } from 'electron'
import { z } from 'zod'
import {
  IPC,
  type AppInfo,
  type BackendStatus,
  type BenchObject,
  type EnvInfo,
  type ExampleInfo,
  type InvocationResult,
  type ProjectInfo,
  type PythonDiscoveryResult,
  type ThemeSetting,
  type WindowRole
} from '@bluepy/protocol'
import { BackendProcess, type ProcessEvent } from './backend/BackendProcess'
import { refreshMenu } from './menu'
import { ProjectManager } from './project'
import { discoverPython, nodeHost } from './python/discovery'
import { loadSettings, saveSettings } from './settings'
import { HubManager } from './hub/manager'
import { PyrightServer, fileUri } from './lsp/pyright'
import { AppState } from './state'
import { TestManager } from './tests/manager'
import { windows } from './windows'

export function backendDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.resolve(app.getAppPath(), '..', '..', 'backend')
}

export function examplesDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'examples') : path.resolve(app.getAppPath(), '..', '..', 'examples')
}

export const state = new AppState((event) => windows.broadcast(event, IPC.backendEvent))

class Session {
  backend: BackendProcess | null = null
  readonly projects: ProjectManager
  readonly tests: TestManager
  readonly hub: HubManager
  private pyright: PyrightServer | null = null
  private discovering: Promise<PythonDiscoveryResult> | null = null

  constructor() {
    this.projects = new ProjectManager(
      {
        changed: (project) => state.setProject(project),
        fileChanged: (file) => state.fileChanged(file)
      },
      () => state.discovery?.selected?.path ?? null,
      () => path.join(backendDir(), 'analyze.py')
    )
    this.tests = new TestManager({
      state,
      projects: this.projects,
      backend: () => this.requireBackend(),
      compile: async () => {
        await this.compile()
      }
    })
    this.hub = new HubManager({
      state,
      openProject: (dir) => this.openProject(dir),
      currentProjectDir: () => this.projects.current?.dir ?? null,
      flushEditors: () => state.requestSaveAll(),
      pythonPath: () => state.discovery?.selected?.path ?? null,
      backendDir: () => backendDir()
    })
  }

  // -------------------------------------------------------------- pyright

  /** The language server for the open project, started on first use; null without a project. */
  lsp(): PyrightServer | null {
    const dir = this.projects.current?.dir
    if (!dir) return null
    if (this.pyright && this.pyright.rootDir === dir) return this.pyright
    void this.pyright?.stop()
    const server = new PyrightServer({ rootDir: dir, pythonPath: state.discovery?.selected?.path ?? null })
    server.on('diagnostics', (payload: { uri: string; diagnostics: import('@bluepy/protocol').LspDiagnostic[] }) => {
      const root = fileUri(dir).replace(/\/$/, '') + '/'
      if (!payload.uri.startsWith(root)) return
      state.setDiagnostics(decodeURIComponent(payload.uri.slice(root.length)), payload.diagnostics)
    })
    server.on('exit', () => {
      if (this.pyright === server) this.pyright = null
    })
    this.pyright = server
    return server
  }

  async stopLsp(): Promise<void> {
    const server = this.pyright
    this.pyright = null
    state.clearDiagnostics()
    await server?.stop()
  }

  // ----------------------------------------------------------------- theme

  async loadTheme(): Promise<void> {
    const settings = await loadSettings()
    state.theme = settings.theme
    nativeTheme.themeSource = settings.theme
  }

  async setTheme(theme: ThemeSetting): Promise<void> {
    const settings = await loadSettings()
    await saveSettings({ ...settings, theme })
    nativeTheme.themeSource = theme
    state.setTheme(theme)
    refreshMenu()
  }

  // ----------------------------------------------------------- interpreter

  async discover(force = false): Promise<PythonDiscoveryResult> {
    if (state.discovery && !force) return state.discovery
    if (!this.discovering) {
      this.discovering = (async () => {
        const settings = await loadSettings()
        const result = await discoverPython(nodeHost(), settings.pythonPath)
        state.discovery = result
        this.discovering = null
        return result
      })()
    }
    return this.discovering
  }

  async select(pythonPath: string | null): Promise<PythonDiscoveryResult> {
    const settings = await loadSettings()
    await saveSettings({ ...settings, pythonPath })
    const result = await this.discover(true)
    if (this.backend) await this.restartBackend()
    if (this.projects.current) await this.projects.analyze()
    return result
  }

  // --------------------------------------------------------------- backend

  status(): BackendStatus {
    if (this.backend) return this.backend.status
    return state.discovery && !state.discovery.selected ? 'unavailable' : 'stopped'
  }

  async startBackend(): Promise<BackendStatus> {
    const discovery = await this.discover()
    if (!discovery.selected) {
      state.setStatus('unavailable')
      return 'unavailable'
    }
    const cwd = this.projects.current?.dir
    if (this.backend && this.backend.status === 'running') return 'running'
    if (!this.backend) {
      this.backend = new BackendProcess({ pythonPath: discovery.selected.path, backendDir: backendDir(), cwd })
      this.backend.on('event', (event: ProcessEvent) => state.applyProcessEvent(event))
    }
    try {
      await this.backend.start()
    } catch {
      // status + detail already broadcast via the process event
    }
    this.projects.clearCompileResults()
    if (this.backend.status === 'running') await this.syncDebugger()
    return this.backend.status
  }

  /** Breakpoints and the armed flag live in the main process; a fresh backend needs them again. */
  async syncDebugger(): Promise<void> {
    const backend = this.backend
    if (!backend || backend.status !== 'running') return
    try {
      await backend.request('debug.arm', { enabled: state.debug.armed })
      for (const [file, lines] of Object.entries(state.breakpoints)) {
        await backend.request('debug.setBreakpoints', { file, lines })
      }
    } catch {
      /* backend went away – status event follows */
    }
  }

  async setArmed(armed: boolean): Promise<void> {
    state.setDebug({ armed })
    if (this.backend?.status === 'running') {
      try {
        await this.backend.request('debug.arm', { enabled: armed })
      } catch {
        /* ignore */
      }
    }
  }

  /** BlueJ's Halt: pause in the debugger when tracing is active, otherwise abort the invocation. */
  async halt(): Promise<boolean> {
    const backend = this.backend
    if (!backend || backend.status !== 'running') return false
    try {
      const paused = await backend.request('debug.pause', {})
      if (paused.ok) return true
    } catch {
      /* fall through to the hard halt */
    }
    return backend.halt()
  }

  async debugCommand(command: 'continue' | 'step' | 'stepInto' | 'stepOut' | 'terminate' | 'pause'): Promise<void> {
    if (command === 'pause') {
      await this.halt()
      return
    }
    const backend = this.requireBackend()
    const method = `debug.${command}` as const
    await backend.request(method, {})
  }

  async restartBackend(): Promise<BackendStatus> {
    await this.stopBackend()
    return this.startBackend()
  }

  async stopBackend(): Promise<void> {
    if (!this.backend) return
    await this.backend.stop()
    this.backend = null
    this.projects.clearCompileResults()
  }

  requireBackend(): BackendProcess {
    if (!this.backend || this.backend.status !== 'running') {
      throw new Error(`backend not running (status: ${this.status()})`)
    }
    return this.backend
  }

  // --------------------------------------------------------------- project

  async openProject(dir: string): Promise<ProjectInfo> {
    const resolved = path.resolve(dir)
    state.setRecording(null)
    state.setTests(null)
    await this.stopLsp()
    const project = await this.projects.open(resolved)
    await this.rememberProject(resolved)
    await this.hub.refreshAssignment(resolved)
    await this.restartBackend() // fresh interpreter with the project as cwd / sys.path[0]
    return project
  }

  async createProject(dir: string): Promise<ProjectInfo> {
    const resolved = path.resolve(dir)
    await this.projects.create(resolved)
    return this.openProject(resolved)
  }

  async closeProject(): Promise<void> {
    state.setRecording(null)
    state.setTests(null)
    state.setAssignment(null)
    await this.stopLsp()
    await this.projects.close()
    state.setProject(null)
    await this.stopBackend()
  }

  async openExample(name: string): Promise<ProjectInfo> {
    const source = path.join(examplesDir(), path.basename(name))
    const target = path.join(app.getPath('documents'), 'BluePy', path.basename(name))
    if (!(await ProjectManager.isProject(target))) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.cp(source, target, { recursive: true, filter: (p) => !p.includes('__pycache__') })
    }
    return this.openProject(target)
  }

  async compile(): Promise<ProjectInfo | null> {
    const project = this.projects.current
    if (!project) return null
    await state.requestSaveAll() // unsaved editor buffers – also when Compile comes from another window
    if (this.status() !== 'running') await this.startBackend()
    const backend = this.requireBackend()
    const files = project.files.map((f) => f.path)
    const result = await backend.request('module.load', { files })
    this.projects.setCompileResults(result.results)
    state.setBench(result.bench)
    return this.projects.current
  }

  private async rememberProject(dir: string): Promise<void> {
    const settings = await loadSettings()
    const recent = [dir, ...settings.recentProjects.filter((p) => p !== dir)].slice(0, 10)
    await saveSettings({ ...settings, recentProjects: recent })
    state.recentProjects = recent
    refreshMenu()
  }

  async loadRecent(): Promise<string[]> {
    const settings = await loadSettings()
    state.recentProjects = settings.recentProjects
    return settings.recentProjects
  }

  async reopenLastProject(): Promise<void> {
    const settings = await loadSettings()
    const last = settings.reopenLastProject ? settings.recentProjects[0] : undefined
    if (!last) return
    if (await ProjectManager.isProject(last)) {
      try {
        await this.openProject(last)
      } catch {
        /* ignore – welcome screen */
      }
    }
  }
}

export const session = new Session()

windows.on('opened', (role: WindowRole) => {
  if (role === 'debugger') void session.setArmed(true)
})
windows.on('closed', (role: WindowRole) => {
  if (role === 'debugger') void session.setArmed(false)
})

state.onDebugPaused = () => {
  void windows.open('debugger')
}
state.editorPresent = () => windows.get('main') !== undefined
state.onMenuChange = () => refreshMenu()

// --------------------------------------------------------------- dialogs

export async function pickProjectFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

export async function pickNewProjectFolder(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: 'Neues Projekt',
    buttonLabel: 'Anlegen',
    nameFieldLabel: 'Projektname',
    defaultPath: path.join(app.getPath('documents'), 'BluePy', 'MeinProjekt'),
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

// ------------------------------------------------------------------- ipc

const PathSchema = z.string().min(1).max(4096).nullable()
const StdinSchema = z.string().max(1_000_000).nullable()
const RoleSchema = z.enum(['main', 'diagram', 'debugger', 'tests'])
const ThemeSchema = z.enum(['system', 'light', 'dark'])
const RelFileSchema = z.string().min(1).max(1024)
const FileWriteSchema = z.object({ file: RelFileSchema, content: z.string().max(10_000_000) })
const LayoutSchema = z.record(z.string(), z.object({ x: z.number(), y: z.number() }))
const EditorOpenSchema = z.object({ file: RelFileSchema, line: z.number().int().positive().optional() })
const ClassRefSchema = z.object({ module: z.string(), name: z.string() })
const ArgsSchema = z.array(z.string().max(100_000)).max(64)
const CreateSchema = z.object({ module: z.string(), name: z.string(), benchName: z.string().max(100), args: ArgsSchema })
const CallSchema = z.object({
  target: z.union([z.object({ bench: z.string() }), ClassRefSchema]),
  method: z.string().max(200),
  args: ArgsSchema
})
const PathStepsSchema = z.array(z.union([z.string(), z.number()])).max(64)
const InspectSchema = z.object({ name: z.string(), path: PathStepsSchema })
const GetSchema = z.object({ name: z.string(), path: PathStepsSchema, newName: z.string().max(100).nullable() })
const BreakpointsSchema = z.object({ file: RelFileSchema, lines: z.array(z.number().int().positive()).max(1000) })
const DebugCommandSchema = z.enum(['continue', 'step', 'stepInto', 'stepOut', 'terminate', 'pause'])
const DebugInspectSchema = z.object({
  frame: z.number().int().min(0),
  scope: z.enum(['locals', 'instance', 'static']),
  name: z.string().max(200),
  path: PathStepsSchema
})
const CodePadSchema = z.object({ code: z.string().max(1_000_000), id: z.number().int() })
const TestClassSchema = z.object({ file: RelFileSchema, className: z.string().max(200) })
const TestRunSchema = z.object({
  files: z.array(RelFileSchema).max(500),
  className: z.string().max(200).optional(),
  method: z.string().max(200).optional(),
  label: z.string().max(300)
})
const RecordingStartSchema = TestClassSchema.extend({ method: z.string().regex(/^[A-Za-z_]\w*$/).max(200) })
const HubSettingsPatchSchema = z.object({
  url: z.string().max(500).optional(),
  teacherKey: z.string().max(200).optional(),
  personalCode: z.string().max(20).optional()
})
const CodeSchema = z.string().min(1).max(40)
const NamesSchema = z.array(z.string().max(120)).max(500)
const PublishSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(100_000),
  code: z.string().max(40).optional(),
  submitFrom: z.string().max(40).nullable(),
  submitUntil: z.string().max(40).nullable(),
  classes: z.array(z.number().int()).max(50),
  tests: z.boolean(),
  exclude: z.array(z.string().max(500)).max(500)
})
const ReviewNoteSchema = z.object({ index: z.number().int().min(0), notes: z.string().max(100_000), points: z.string().max(40) })
const AssertionSchema = z.object({
  code: z.string().max(100_000),
  assertion: z.object({
    kind: z.enum(['equal', 'almostEqual', 'true', 'false', 'isNone', 'isNotNone', 'is']),
    expected: z.string().max(100_000).optional()
  })
})

function withBench<T extends InvocationResult>(result: T): T {
  state.setBench(result.bench)
  return result
}

export function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    chrome: process.versions.chrome ?? '',
    platform: process.platform,
    locale: app.getLocale()
  }))

  ipcMain.handle(IPC.appSetTheme, (_event, raw: unknown) => session.setTheme(ThemeSchema.parse(raw)))
  ipcMain.handle(IPC.windowOpen, async (_event, raw: unknown) => {
    await windows.open(RoleSchema.parse(raw))
  })
  ipcMain.handle(IPC.stateSnapshot, () => state.snapshot())

  ipcMain.handle(IPC.pythonDiscover, () => session.discover(true))
  ipcMain.handle(IPC.pythonSelect, (_event, raw: unknown) => session.select(PathSchema.parse(raw)))

  ipcMain.handle(IPC.backendStart, () => session.startBackend())
  ipcMain.handle(IPC.backendReset, () => session.restartBackend())
  ipcMain.handle(IPC.backendStatus, () => session.status())
  ipcMain.handle(IPC.backendHalt, () => session.halt())
  ipcMain.handle(IPC.backendEnvInfo, (): Promise<EnvInfo> => session.requireBackend().request('env.info', {}))

  // project ----------------------------------------------------------------
  ipcMain.handle(IPC.projectOpen, async (_event, raw: unknown) => {
    const dir = PathSchema.parse(raw) ?? (await pickProjectFolder())
    if (!dir) return null
    return session.openProject(dir)
  })
  ipcMain.handle(IPC.projectCreate, async () => {
    const dir = await pickNewProjectFolder()
    if (!dir) return null
    return session.createProject(dir)
  })
  ipcMain.handle(IPC.projectOpenExample, (_event, raw: unknown) => session.openExample(z.string().max(100).parse(raw)))
  ipcMain.handle(IPC.projectExamples, async (): Promise<ExampleInfo[]> => {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(examplesDir(), 'index.json'), 'utf-8')) as { examples?: ExampleInfo[] }
      return raw.examples ?? []
    } catch {
      return []
    }
  })
  ipcMain.handle(IPC.projectClose, () => session.closeProject())
  ipcMain.handle(IPC.projectReadFile, (_event, raw: unknown) => session.projects.readFile(RelFileSchema.parse(raw)))
  ipcMain.handle(IPC.projectWriteFile, async (_event, raw: unknown) => {
    const { file, content } = FileWriteSchema.parse(raw)
    await session.projects.writeFile(file, content)
  })
  ipcMain.handle(IPC.projectCreateFile, (_event, raw: unknown) => {
    const { file, content } = FileWriteSchema.parse(raw)
    return session.projects.createFile(file, content)
  })
  ipcMain.handle(IPC.projectCompile, () => session.compile())
  ipcMain.handle(IPC.projectSaveLayout, (_event, raw: unknown) => session.projects.saveLayout(LayoutSchema.parse(raw)))
  ipcMain.handle(IPC.projectRunModule, (_event, raw: unknown) =>
    session.requireBackend().request('module.run', { file: RelFileSchema.parse(raw) })
  )

  ipcMain.handle(IPC.editorOpen, async (_event, raw: unknown) => {
    const { file, line } = EditorOpenSchema.parse(raw)
    await windows.open('main')
    state.openInEditor(file, line)
  })
  ipcMain.handle(IPC.editorFlushed, (_event, raw: unknown) => state.flushed(z.number().int().parse(raw)))

  // language server ---------------------------------------------------------
  const DocSchema = z.object({ file: RelFileSchema, text: z.string().max(10_000_000) })
  const PosSchema = z.object({ file: RelFileSchema, line: z.number().int().min(0), character: z.number().int().min(0) })
  const lsp = (): { server: PyrightServer; path: (rel: string) => string } | null => {
    const server = session.lsp()
    return server ? { server, path: (rel) => session.projects.resolve(rel) } : null
  }
  ipcMain.handle(IPC.editorDidOpen, async (_event, raw: unknown) => {
    const { file, text } = DocSchema.parse(raw)
    const l = lsp()
    if (l) await l.server.open(l.path(file), text).catch(() => undefined)
  })
  ipcMain.handle(IPC.editorDidChange, async (_event, raw: unknown) => {
    const { file, text } = DocSchema.parse(raw)
    const l = lsp()
    if (l) await l.server.change(l.path(file), text).catch(() => undefined)
  })
  ipcMain.handle(IPC.editorDidClose, (_event, raw: unknown) => {
    const l = lsp()
    if (l) l.server.close(l.path(RelFileSchema.parse(raw)))
  })
  ipcMain.handle(IPC.editorComplete, async (_event, raw: unknown) => {
    const { file, line, character } = PosSchema.parse(raw)
    const l = lsp()
    if (!l) return []
    return l.server.complete(l.path(file), line, character).catch(() => [])
  })
  ipcMain.handle(IPC.editorResolve, async (_event, raw: unknown) => {
    const item = raw as import('@bluepy/protocol').CompletionItem
    const l = lsp()
    if (!l) return item
    return l.server.resolveCompletion(item).catch(() => item)
  })
  ipcMain.handle(IPC.editorHover, async (_event, raw: unknown) => {
    const { file, line, character } = PosSchema.parse(raw)
    const l = lsp()
    if (!l) return null
    return l.server.hover(l.path(file), line, character).catch(() => null)
  })

  // tests -------------------------------------------------------------------
  ipcMain.handle(IPC.testsCreateClass, (_event, raw: unknown) => session.tests.createTestClass(z.string().max(500).parse(raw)))
  ipcMain.handle(IPC.testsRun, (_event, raw: unknown) => session.tests.run(TestRunSchema.parse(raw)))
  ipcMain.handle(IPC.testsDescribe, (_event, raw: unknown) => {
    const { file, className } = TestClassSchema.parse(raw)
    return session.tests.describe(file, className)
  })
  ipcMain.handle(IPC.testsStartRecording, (_event, raw: unknown) => {
    const { file, className, method } = RecordingStartSchema.parse(raw)
    return session.tests.startRecording(file, className, method)
  })
  ipcMain.handle(IPC.testsRecordAssertion, (_event, raw: unknown) => {
    const { code, assertion } = AssertionSchema.parse(raw)
    session.tests.recordAssertion(code, assertion)
  })
  ipcMain.handle(IPC.testsEndRecording, (_event, raw: unknown) => session.tests.endRecording(z.boolean().parse(raw)))
  ipcMain.handle(IPC.testsBenchToFixture, (_event, raw: unknown) => {
    const { file, className } = TestClassSchema.parse(raw)
    return session.tests.benchToFixture(file, className)
  })
  ipcMain.handle(IPC.testsFixtureToBench, (_event, raw: unknown) => {
    const { file, className } = TestClassSchema.parse(raw)
    return session.tests.fixtureToBench(file, className)
  })

  // hub ---------------------------------------------------------------------
  ipcMain.handle(IPC.hubSettings, () => session.hub.loadSettings())
  ipcMain.handle(IPC.hubSaveSettings, (_event, raw: unknown) => session.hub.saveSettings(HubSettingsPatchSchema.parse(raw)))
  ipcMain.handle(IPC.hubFetchTask, (_event, raw: unknown) => session.hub.fetchTask(CodeSchema.parse(raw)))
  ipcMain.handle(IPC.hubSubmit, () => session.hub.submit())
  ipcMain.handle(IPC.hubTaskStatus, () => session.hub.taskStatus())
  ipcMain.handle(IPC.hubUpdateTask, () => session.hub.updateTask())
  ipcMain.handle(IPC.hubFeedback, () => session.hub.feedback())
  ipcMain.handle(IPC.hubClasses, () => session.hub.classes())
  ipcMain.handle(IPC.hubAddClass, (_event, raw: unknown) => {
    const { name, students } = z.object({ name: z.string().min(1).max(120), students: NamesSchema }).parse(raw)
    return session.hub.addClass(name, students)
  })
  ipcMain.handle(IPC.hubAddStudents, (_event, raw: unknown) => {
    const { id, students } = z.object({ id: z.number().int(), students: NamesSchema }).parse(raw)
    return session.hub.addStudents(id, students)
  })
  ipcMain.handle(IPC.hubRemoveClass, (_event, raw: unknown) => session.hub.removeClass(z.number().int().parse(raw)))
  ipcMain.handle(IPC.hubTasks, () => session.hub.tasks())
  ipcMain.handle(IPC.hubPublish, (_event, raw: unknown) => session.hub.publish(PublishSchema.parse(raw)))
  ipcMain.handle(IPC.hubCollect, (_event, raw: unknown) => session.hub.collect(CodeSchema.parse(raw)))
  ipcMain.handle(IPC.hubReviewOpen, (_event, raw: unknown) => session.hub.reviewOpen(z.number().int().min(0).parse(raw)))
  ipcMain.handle(IPC.hubReviewNote, (_event, raw: unknown) => {
    const { index, notes, points } = ReviewNoteSchema.parse(raw)
    return session.hub.reviewNote(index, notes, points)
  })
  ipcMain.handle(IPC.hubReviewClose, () => session.hub.reviewClose())
  ipcMain.handle(IPC.hubReviewRunTests, () => session.hub.reviewRunTests())
  ipcMain.handle(IPC.hubExport, () => session.hub.exportPackage())
  ipcMain.handle(IPC.hubImport, () => session.hub.importPackage())

  // objects ----------------------------------------------------------------
  ipcMain.handle(IPC.objectsDescribeClass, (_event, raw: unknown) =>
    session.requireBackend().request('class.describe', ClassRefSchema.parse(raw))
  )
  ipcMain.handle(IPC.objectsSuggestName, async (_event, raw: unknown) => {
    const result = await session.requireBackend().request('bench.suggestName', { className: z.string().parse(raw) })
    return result.name
  })
  ipcMain.handle(IPC.objectsCreate, async (_event, raw: unknown) => {
    const params = CreateSchema.parse(raw)
    return withBench(await session.requireBackend().request('object.create', params))
  })
  ipcMain.handle(IPC.objectsCall, async (_event, raw: unknown) => {
    const { target, method, args } = CallSchema.parse(raw)
    const params = 'bench' in target ? { target: target.bench, method, args } : { ...target, method, args }
    return withBench(await session.requireBackend().request('object.call', params))
  })
  ipcMain.handle(IPC.objectsInspect, (_event, raw: unknown) =>
    session.requireBackend().request('object.inspect', InspectSchema.parse(raw))
  )
  ipcMain.handle(IPC.objectsGet, async (_event, raw: unknown) => {
    const { name, path: steps, newName } = GetSchema.parse(raw)
    return withBench(await session.requireBackend().request('object.get', { name, path: steps, newName: newName ?? undefined }))
  })
  ipcMain.handle(IPC.objectsRemove, async (_event, raw: unknown) => {
    const result = await session.requireBackend().request('object.remove', { name: z.string().parse(raw) })
    state.setBench(result.bench as BenchObject[])
  })

  // debugger ---------------------------------------------------------------
  ipcMain.handle(IPC.debugSetBreakpoints, async (_event, raw: unknown) => {
    const { file, lines } = BreakpointsSchema.parse(raw)
    state.setBreakpoints(file, lines)
    if (session.backend?.status === 'running') {
      await session.backend.request('debug.setBreakpoints', { file, lines: state.breakpoints[file] ?? [] })
    }
  })
  ipcMain.handle(IPC.debugCommand, (_event, raw: unknown) => session.debugCommand(DebugCommandSchema.parse(raw)))
  ipcMain.handle(IPC.debugVariables, (_event, raw: unknown) =>
    session.requireBackend().request('debug.variables', { frame: z.number().int().min(0).parse(raw) })
  )
  ipcMain.handle(IPC.debugInspect, (_event, raw: unknown) =>
    session.requireBackend().request('debug.inspect', DebugInspectSchema.parse(raw))
  )

  // code pad / terminal ----------------------------------------------------
  ipcMain.handle(IPC.codepadEval, async (_event, raw: unknown) => {
    const { code, id } = CodePadSchema.parse(raw)
    const result = await session.requireBackend().request('codepad.eval', { code, id })
    if (result.bench) state.setBench(result.bench)
    return result
  })
  ipcMain.handle(IPC.terminalStdin, (_event, raw: unknown) => {
    const text = StdinSchema.parse(raw)
    state.setWaiting(false)
    session.requireBackend().notify('stdin.provide', { text })
  })
  ipcMain.handle(IPC.terminalClear, () => state.clearTerminal())
}
