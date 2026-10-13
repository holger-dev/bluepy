import { create } from 'zustand'
import type {
  BackendEvent,
  BackendStatus,
  BenchObject,
  CodePadResult,
  DebugInspectResult,
  DebugScope,
  DebugState,
  DebugVariables,
  InspectResult,
  InvocationResult,
  LiveClassInfo,
  ProjectInfo,
  PythonDiscoveryResult,
  TerminalEntry,
  WindowRole
} from '@bluepy/protocol'
import { currentBreakpointLines } from './editor/breakpoints'

export type DebugCommand = 'continue' | 'step' | 'stepInto' | 'stepOut' | 'terminate' | 'pause'

export interface CodePadEntry {
  id: number
  input: string
  result: CodePadResult | null
  /** Set when the request itself failed (backend gone, halted, …). */
  failure: string | null
  pending: boolean
}

export interface OpenFile {
  path: string
  content: string
  savedContent: string
  /** Line to reveal when the editor shows the file next (from "open in editor"). */
  revealLine: number | null
}

interface AppState {
  role: WindowRole
  ready: boolean
  discovery: PythonDiscoveryResult | null
  discovering: boolean
  backendStatus: BackendStatus
  backendDetail: string | null
  terminal: TerminalEntry[]
  waitingForStdin: boolean
  codepad: CodePadEntry[]
  setupOpen: boolean
  project: ProjectInfo | null
  recentProjects: string[]
  bench: BenchObject[]
  openFiles: OpenFile[]
  activeFile: string | null
  /** Short status-bar message (compile result etc.). */
  message: string | null
  busy: string | null
  /** Live class descriptions from the backend, keyed by "module.Class"; cleared on compile/reset. */
  liveClasses: Record<string, LiveClassInfo>
  debug: DebugState
  breakpoints: Record<string, number[]>
  /** Line the debugger is paused at, shown in the editor. */
  currentLine: { file: string; line: number } | null

  bootstrap(role: WindowRole): Promise<void>
  rediscover(): Promise<void>
  selectPython(path: string | null): Promise<void>
  startBackend(): Promise<void>
  resetBackend(): Promise<void>
  halt(): Promise<void>
  applyEvent(event: BackendEvent): void
  evalCodePad(code: string): Promise<void>
  provideStdin(text: string | null): Promise<void>
  clearTerminal(): Promise<void>
  clearCodePad(): void
  setSetupOpen(open: boolean): void
  openWindow(role: WindowRole): Promise<void>
  setMessage(message: string | null): void

  // project & files
  openProject(dir: string | null): Promise<void>
  createProject(): Promise<void>
  openExample(name: string): Promise<void>
  closeProject(): Promise<void>
  openFile(path: string, line?: number): Promise<void>
  closeFile(path: string): void
  setActiveFile(path: string): void
  setFileContent(path: string, content: string): void
  clearReveal(path: string): void
  saveFile(path: string): Promise<void>
  saveAll(): Promise<void>
  createFile(name: string, content: string): Promise<void>
  compile(): Promise<void>
  runModule(file: string): Promise<void>
  saveLayout(layout: Record<string, { x: number; y: number }>): Promise<void>

  // objects
  describeClass(module: string, name: string): Promise<LiveClassInfo>
  createObject(module: string, name: string, benchName: string, args: string[]): Promise<InvocationResult>
  callMethod(target: { bench: string } | { module: string; name: string }, method: string, args: string[]): Promise<InvocationResult>
  inspect(name: string, path: (string | number)[]): Promise<InspectResult>
  getObject(name: string, path: (string | number)[], newName: string | null): Promise<InvocationResult>
  removeObject(name: string): Promise<void>

  // debugger
  toggleBreakpoint(file: string, line: number): Promise<void>
  setBreakpoints(file: string, lines: number[]): Promise<void>
  debugCommand(command: DebugCommand): Promise<void>
  debugVariables(frame: number): Promise<DebugVariables>
  debugInspect(frame: number, scope: DebugScope, name: string, path: (string | number)[]): Promise<DebugInspectResult>
}

let nextCodePadId = 1

export const useStore = create<AppState>((set, get) => ({
  role: 'main',
  ready: false,
  discovery: null,
  discovering: false,
  backendStatus: 'stopped',
  backendDetail: null,
  terminal: [],
  waitingForStdin: false,
  codepad: [],
  setupOpen: false,
  project: null,
  recentProjects: [],
  bench: [],
  openFiles: [],
  activeFile: null,
  message: null,
  busy: null,
  liveClasses: {},
  debug: { paused: false, reason: null, frames: [], armed: false },
  breakpoints: {},
  currentLine: null,

  async bootstrap(role) {
    set({ role })
    window.bluepy.onBackendEvent((event) => get().applyEvent(event))
    const snapshot = await window.bluepy.state.snapshot()
    set({
      ready: true,
      discovery: snapshot.discovery,
      backendStatus: snapshot.backendStatus,
      backendDetail: snapshot.backendDetail,
      waitingForStdin: snapshot.waitingForStdin,
      terminal: snapshot.terminal,
      project: snapshot.project,
      bench: snapshot.bench,
      recentProjects: snapshot.recentProjects,
      debug: snapshot.debug,
      breakpoints: snapshot.breakpoints,
      currentLine: snapshot.debug.paused && snapshot.debug.frames[0] ? { file: snapshot.debug.frames[0].file, line: snapshot.debug.frames[0].line } : null
    })
    if (!snapshot.discovery) await get().rediscover()
  },

  async rediscover() {
    set({ discovering: true })
    try {
      const discovery = await window.bluepy.python.discover()
      set({ discovery, discovering: false })
      if (!discovery.selected) set({ backendStatus: 'unavailable' })
    } catch (error) {
      set({ discovering: false, backendStatus: 'unavailable', backendDetail: String(error) })
    }
  },

  async selectPython(path) {
    set({ discovering: true })
    const discovery = await window.bluepy.python.select(path)
    set({ discovery, discovering: false })
    if (get().project) await get().startBackend()
  },

  async startBackend() {
    const status = await window.bluepy.backend.start()
    set({ backendStatus: status })
  },

  async resetBackend() {
    set({ liveClasses: {} })
    const status = await window.bluepy.backend.reset()
    set({ backendStatus: status })
  },

  async halt() {
    await window.bluepy.backend.halt()
  },

  applyEvent(event) {
    const { role } = get()
    switch (event.type) {
      case 'status':
        set({ backendStatus: event.status, backendDetail: event.detail ?? null })
        if (event.status !== 'running') set({ liveClasses: {} })
        break
      case 'terminal':
        set((state) => {
          const last = state.terminal[state.terminal.length - 1]
          if (last && last.id === event.entry.id) return { terminal: [...state.terminal.slice(0, -1), event.entry] }
          return { terminal: [...state.terminal, event.entry] }
        })
        break
      case 'terminal.cleared':
        set({ terminal: [] })
        break
      case 'stdin':
        set({ waitingForStdin: event.waiting })
        break
      case 'project': {
        const project = event.project
        set((state) => ({
          project,
          // compile results may have changed: live class descriptions must be fetched again
          liveClasses: {},
          recentProjects: state.recentProjects,
          // drop tabs of files that no longer exist
          openFiles: project ? state.openFiles.filter((f) => project.files.some((p) => p.path === f.path)) : [],
          activeFile:
            project && state.activeFile && project.files.some((p) => p.path === state.activeFile) ? state.activeFile : null
        }))
        if (project && get().recentProjects[0] !== project.dir) {
          set((state) => ({ recentProjects: [project.dir, ...state.recentProjects.filter((p) => p !== project.dir)].slice(0, 10) }))
        }
        break
      }
      case 'bench':
        set({ bench: event.bench })
        break
      case 'file.changed': {
        const open = get().openFiles.find((f) => f.path === event.file)
        if (open && open.content === open.savedContent) {
          void window.bluepy.project.readFile(event.file).then((content) => {
            set((state) => ({
              openFiles: state.openFiles.map((f) =>
                f.path === event.file && f.content === f.savedContent && content !== f.content
                  ? { ...f, content, savedContent: content }
                  : f
              )
            }))
          })
        }
        break
      }
      case 'editor.open':
        if (role === 'main') void get().openFile(event.file, event.line)
        break
      case 'menu':
        if (role !== 'main') break
        if (event.action === 'save' && get().activeFile) void get().saveFile(get().activeFile as string)
        else if (event.action === 'saveAll') void get().saveAll()
        else if (event.action === 'compile') void get().compile()
        break
      case 'debug': {
        const top = event.debug.paused ? event.debug.frames[0] : undefined
        set({ debug: event.debug, currentLine: top ? { file: top.file, line: top.line } : null })
        if (top && role === 'main') void get().openFile(top.file, top.line)
        break
      }
      case 'breakpoints':
        set({ breakpoints: event.breakpoints })
        break
      case 'invocation.started':
      case 'invocation.finished':
        break
    }
  },

  async evalCodePad(code) {
    const id = nextCodePadId++
    set((state) => ({ codepad: [...state.codepad, { id, input: code, result: null, failure: null, pending: true }] }))
    const update = (patch: Partial<CodePadEntry>): void =>
      set((state) => ({ codepad: state.codepad.map((e) => (e.id === id ? { ...e, ...patch, pending: false } : e)) }))
    try {
      const result = await window.bluepy.codepad.eval(code)
      update({ result })
    } catch (error) {
      update({ failure: error instanceof Error ? error.message : String(error) })
    }
  },

  async provideStdin(text) {
    set({ waitingForStdin: false })
    await window.bluepy.terminal.provideStdin(text)
  },

  async clearTerminal() {
    await window.bluepy.terminal.clear()
  },

  clearCodePad() {
    set({ codepad: [] })
  },

  setSetupOpen(open) {
    set({ setupOpen: open })
  },

  async openWindow(role) {
    await window.bluepy.windows.open(role)
  },

  setMessage(message) {
    set({ message })
  },

  // ------------------------------------------------------------ project

  async openProject(dir) {
    set({ busy: 'open' })
    try {
      await window.bluepy.project.open(dir)
    } finally {
      set({ busy: null })
    }
  },

  async createProject() {
    await window.bluepy.project.create()
  },

  async openExample(name) {
    set({ busy: 'open' })
    try {
      await window.bluepy.project.openExample(name)
    } finally {
      set({ busy: null })
    }
  },

  async closeProject() {
    await window.bluepy.project.close()
    set({ openFiles: [], activeFile: null, codepad: [] })
  },

  async openFile(path, line) {
    const existing = get().openFiles.find((f) => f.path === path)
    if (existing) {
      set((state) => ({
        activeFile: path,
        openFiles: state.openFiles.map((f) => (f.path === path ? { ...f, revealLine: line ?? null } : f))
      }))
      return
    }
    const content = await window.bluepy.project.readFile(path)
    set((state) => ({
      openFiles: [...state.openFiles, { path, content, savedContent: content, revealLine: line ?? null }],
      activeFile: path
    }))
  },

  closeFile(path) {
    set((state) => {
      const openFiles = state.openFiles.filter((f) => f.path !== path)
      const activeFile = state.activeFile === path ? (openFiles[openFiles.length - 1]?.path ?? null) : state.activeFile
      return { openFiles, activeFile }
    })
  },

  setActiveFile(path) {
    set({ activeFile: path })
  },

  setFileContent(path, content) {
    set((state) => ({ openFiles: state.openFiles.map((f) => (f.path === path ? { ...f, content } : f)) }))
  },

  clearReveal(path) {
    set((state) => ({ openFiles: state.openFiles.map((f) => (f.path === path ? { ...f, revealLine: null } : f)) }))
  },

  async saveFile(path) {
    const file = get().openFiles.find((f) => f.path === path)
    if (!file || file.content === file.savedContent) return
    await window.bluepy.project.writeFile(path, file.content)
    set((state) => ({
      openFiles: state.openFiles.map((f) => (f.path === path ? { ...f, savedContent: file.content } : f))
    }))
    // Breakpoint markers moved with the text while editing; tell the backend their new lines.
    const lines = currentBreakpointLines(path)
    if (lines && lines.join(',') !== (get().breakpoints[path] ?? []).join(',')) await get().setBreakpoints(path, lines)
  },

  async saveAll() {
    for (const file of get().openFiles) {
      if (file.content !== file.savedContent) await get().saveFile(file.path)
    }
  },

  async createFile(name, content) {
    await window.bluepy.project.createFile(name, content)
    await get().openFile(name)
  },

  async compile() {
    if (!get().project) return
    set({ busy: 'compile', message: null, liveClasses: {} })
    try {
      await get().saveAll()
      const project = await window.bluepy.project.compile()
      const results = project ? Object.values(project.compile) : []
      const failed = results.filter((r) => !r.ok)
      set({
        message: failed.length === 0 ? `✓ ${results.length} Modul(e) geladen` : `✗ ${failed.length} Fehler – ${failed[0]?.file}: ${failed[0]?.error?.message ?? ''}`
      })
      if (failed[0]?.error?.line && failed[0].stage === 'syntax') await get().openFile(failed[0].file, failed[0].error.line)
    } catch (error) {
      set({ message: `Compile fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      set({ busy: null })
    }
  },

  async runModule(file) {
    set({ busy: 'run' })
    try {
      const result = await window.bluepy.project.runModule(file)
      set({ message: result.ok ? `${file} beendet` : `${file}: ${result.error?.type ?? 'Fehler'}` })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: null })
    }
  },

  async saveLayout(layout) {
    await window.bluepy.project.saveLayout(layout)
  },

  // ------------------------------------------------------------ objects

  async describeClass(module, name) {
    const key = `${module}.${name}`
    const cached = get().liveClasses[key]
    if (cached) return cached
    const info = await window.bluepy.objects.describeClass(module, name)
    set((state) => ({ liveClasses: { ...state.liveClasses, [key]: info } }))
    return info
  },

  async createObject(module, name, benchName, args) {
    return window.bluepy.objects.create(module, name, benchName, args)
  },

  async callMethod(target, method, args) {
    return window.bluepy.objects.call(target, method, args)
  },

  async inspect(name, path) {
    return window.bluepy.objects.inspect(name, path)
  },

  async getObject(name, path, newName) {
    return window.bluepy.objects.get(name, path, newName)
  },

  async removeObject(name) {
    await window.bluepy.objects.remove(name)
  },

  // ----------------------------------------------------------- debugger

  async toggleBreakpoint(file, line) {
    const current = get().breakpoints[file] ?? []
    const lines = current.includes(line) ? current.filter((l) => l !== line) : [...current, line].sort((a, b) => a - b)
    await get().setBreakpoints(file, lines)
  },

  async setBreakpoints(file, lines) {
    set((state) => ({ breakpoints: { ...state.breakpoints, [file]: lines } }))
    await window.bluepy.debug.setBreakpoints(file, lines)
  },

  async debugCommand(command) {
    await window.bluepy.debug[command]()
  },

  async debugVariables(frame) {
    return window.bluepy.debug.variables(frame)
  },

  async debugInspect(frame, scope, name, path) {
    return window.bluepy.debug.inspect(frame, scope, name, path)
  }
}))
