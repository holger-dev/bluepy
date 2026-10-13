/**
 * IPC surface of the main process.  The Session ties together interpreter
 * discovery, the open project, the shared AppState and the backend process
 * (which always runs with the project directory as cwd).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import {
  IPC,
  type AppInfo,
  type BackendStatus,
  type BenchObject,
  type EnvInfo,
  type InvocationResult,
  type ProjectInfo,
  type PythonDiscoveryResult,
  type WindowRole
} from '@bluepy/protocol'
import { BackendProcess, type ProcessEvent } from './backend/BackendProcess'
import { refreshMenu } from './menu'
import { ProjectManager } from './project'
import { discoverPython, nodeHost } from './python/discovery'
import { loadSettings, saveSettings } from './settings'
import { AppState } from './state'
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
    const project = await this.projects.open(resolved)
    await this.rememberProject(resolved)
    await this.restartBackend() // fresh interpreter with the project as cwd / sys.path[0]
    return project
  }

  async createProject(dir: string): Promise<ProjectInfo> {
    const resolved = path.resolve(dir)
    await this.projects.create(resolved)
    return this.openProject(resolved)
  }

  async closeProject(): Promise<void> {
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

const CodeSchema = z.object({ code: z.string().max(1_000_000) })
const PathSchema = z.string().min(1).max(4096).nullable()
const StdinSchema = z.string().max(1_000_000).nullable()
const RoleSchema = z.enum(['main', 'diagram'])
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
  ipcMain.handle(IPC.codepadEval, (_event, raw: unknown) => {
    const { code } = CodeSchema.parse(raw)
    return session.requireBackend().request('codepad.eval', { code })
  })
  ipcMain.handle(IPC.terminalStdin, (_event, raw: unknown) => {
    const text = StdinSchema.parse(raw)
    state.setWaiting(false)
    session.requireBackend().notify('stdin.provide', { text })
  })
  ipcMain.handle(IPC.terminalClear, () => state.clearTerminal())
}
