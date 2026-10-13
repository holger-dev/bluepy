import { create } from 'zustand'
import type {
  Assertion,
  AssignmentState,
  BackendEvent,
  BackendStatus,
  BenchObject,
  CodePadResult,
  DebugInspectResult,
  DebugScope,
  DebugState,
  DebugVariables,
  FixtureToBenchResult,
  HubSettings,
  InspectResult,
  LspDiagnostic,
  InvocationResult,
  LiveClassInfo,
  ProjectInfo,
  PythonDiscoveryResult,
  RecordingState,
  ReviewState,
  TerminalEntry,
  TestClassDescription,
  TestRunState,
  ThemeSetting,
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
  tests: TestRunState | null
  recording: RecordingState | null
  theme: ThemeSetting
  assignment: AssignmentState | null
  review: ReviewState | null
  hub: HubSettings
  /** Pyright diagnostics per file. */
  diagnostics: Record<string, LspDiagnostic[]>
  /** Which hub dialog the editor window shows (opened from the Aufgaben menu). */
  hubDialog: 'fetch' | 'submit' | 'publish' | 'collect' | 'classes' | 'settings' | 'feedback' | 'reviewTests' | null

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

  // appearance
  setTheme(theme: ThemeSetting): Promise<void>

  // unit tests
  /** Run all test classes of the project (BlueJ "Run Tests"). */
  runAllTests(): Promise<void>
  runTests(target: { files: string[]; className?: string; method?: string; label: string }): Promise<void>
  createTestClass(classId: string): Promise<void>
  describeTests(file: string, className: string): Promise<TestClassDescription>
  startRecording(file: string, className: string, method: string): Promise<void>
  recordAssertion(code: string, assertion: Assertion): Promise<void>
  endRecording(save: boolean): Promise<void>
  benchToFixture(file: string, className: string): Promise<void>
  fixtureToBench(file: string, className: string): Promise<FixtureToBenchResult>

  // hub / assignments
  setHubDialog(dialog: AppState['hubDialog']): void
  submitAssignment(): Promise<void>
  updateAssignment(): Promise<void>
  reviewRunTests(): Promise<void>
  reviewOpen(index: number): Promise<void>
  reviewNote(index: number, notes: string, points: string): Promise<void>
  reviewClose(): Promise<void>
  exportPackage(): Promise<void>
  importPackage(): Promise<void>
}

/** Files of the project that contain unit-test classes (from the static model). */
export function testFilesOf(project: ProjectInfo | null): string[] {
  if (!project?.model) return []
  return [...new Set(project.model.classes.filter((c) => c.stereotype === 'unittest').map((c) => c.file))]
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
  tests: null,
  recording: null,
  theme: 'system',
  assignment: null,
  review: null,
  hub: { url: '', hasTeacherKey: false, teacherName: null, hasPersonalCode: false },
  diagnostics: {},
  hubDialog: null,

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
      currentLine: snapshot.debug.paused && snapshot.debug.frames[0] ? { file: snapshot.debug.frames[0].file, line: snapshot.debug.frames[0].line } : null,
      tests: snapshot.tests,
      recording: snapshot.recording,
      theme: snapshot.theme,
      assignment: snapshot.assignment,
      review: snapshot.review,
      hub: snapshot.hub,
      diagnostics: snapshot.diagnostics
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
        if (event.action === 'runTests') {
          if (role === 'main') void get().runAllTests()
          break
        }
        if (role !== 'main') break
        if (event.action.startsWith('hub.') || event.action.startsWith('package.')) {
          if (event.action === 'package.export') void get().exportPackage()
          else if (event.action === 'package.import') void get().importPackage()
          else if (event.action === 'hub.update') void get().updateAssignment()
          else set({ hubDialog: event.action.slice(4) as AppState['hubDialog'] })
          break
        }
        if (event.action === 'save' && get().activeFile) void get().saveFile(get().activeFile as string)
        else if (event.action === 'saveAll') {
          const token = event.token
          void get()
            .saveAll()
            .finally(() => {
              if (token !== undefined) void window.bluepy.editor.flushed(token)
            })
        } else if (event.action === 'compile') void get().compile()
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
      case 'tests':
        set({ tests: event.tests })
        break
      case 'recording':
        set({ recording: event.recording })
        break
      case 'theme':
        set({ theme: event.theme })
        break
      case 'assignment':
        set({ assignment: event.assignment })
        break
      case 'review':
        set({ review: event.review })
        break
      case 'hub':
        set({ hub: event.hub })
        break
      case 'diagnostics':
        set((state) => {
          if (event.diagnostics.length === 0) {
            const { [event.file]: _gone, ...rest } = state.diagnostics
            return { diagnostics: rest }
          }
          return { diagnostics: { ...state.diagnostics, [event.file]: event.diagnostics } }
        })
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
      const result = await window.bluepy.codepad.eval(code, id)
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
    void window.bluepy.editor.didClose(path)
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
  },

  // --------------------------------------------------------- appearance

  async setTheme(theme) {
    set({ theme })
    await window.bluepy.app.setTheme(theme)
  },

  // --------------------------------------------------------- unit tests

  async runAllTests() {
    const files = testFilesOf(get().project)
    if (files.length === 0) {
      set({ message: 'Keine Testklassen im Projekt.' })
      return
    }
    await get().runTests({ files, label: 'Alle Tests' })
  },

  async runTests(target) {
    set({ busy: 'tests', message: null })
    try {
      const summary = await window.bluepy.tests.run(target)
      const problems = summary.failed + summary.errors
      set({
        message:
          problems === 0
            ? `✓ ${summary.total} Test(s) bestanden (${target.label})`
            : `✗ ${problems} von ${summary.total} Test(s) fehlgeschlagen (${target.label})`
      })
      if (problems > 0 || summary.total > 1) await window.bluepy.windows.open('tests')
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: null })
    }
  },

  async createTestClass(classId) {
    try {
      const { file } = await window.bluepy.tests.createTestClass(classId)
      set({ message: `Testklasse angelegt: ${file}` })
      await window.bluepy.editor.open(file)
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    }
  },

  async describeTests(file, className) {
    return window.bluepy.tests.describe(file, className)
  },

  async startRecording(file, className, method) {
    try {
      await window.bluepy.tests.startRecording(file, className, method)
      set({ message: `Aufnahme läuft: ${className}.${method}` })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    }
  },

  async recordAssertion(code, assertion) {
    await window.bluepy.tests.recordAssertion(code, assertion)
  },

  async endRecording(save) {
    const recording = get().recording
    try {
      await window.bluepy.tests.endRecording(save)
      if (recording) set({ message: save ? `Testmethode gespeichert: ${recording.className}.${recording.method}` : 'Aufnahme verworfen' })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    }
  },

  async benchToFixture(file, className) {
    try {
      await window.bluepy.tests.benchToFixture(file, className)
      set({ message: `setUp() von ${className} aus der Objektleiste geschrieben` })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    }
  },

  async fixtureToBench(file, className) {
    const result = await window.bluepy.tests.fixtureToBench(file, className)
    set({ message: result.ok ? `Fixture von ${className} auf der Objektleiste (${result.names.length} Objekt(e))` : `setUp() fehlgeschlagen: ${result.error?.message ?? ''}` })
    return result
  },

  // ------------------------------------------------------ hub / assignments

  setHubDialog(dialog) {
    set({ hubDialog: dialog })
  },

  async submitAssignment() {
    if (!get().hub.hasPersonalCode) {
      set({ hubDialog: 'submit' })
      return
    }
    set({ busy: 'submit', message: null })
    try {
      const result = await window.bluepy.hub.submit()
      const time = new Date(result.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      set({ message: result.late ? `Abgabe angenommen (verspätet) – ${result.name}, ${time}` : `✓ Abgabe angenommen – ${result.name}, ${time}` })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: null })
    }
  },

  async updateAssignment() {
    set({ busy: 'open', message: null })
    try {
      const result = await window.bluepy.hub.updateTask()
      if (result.upToDate) set({ message: 'Die Aufgabe ist aktuell.' })
      else {
        const skipped = result.skipped.length ? ` – ${result.skipped.length} von dir geänderte Datei(en) behalten: ${result.skipped.join(', ')}` : ''
        set({ message: `Aufgabe auf Version ${result.version} aktualisiert: ${result.updated.length} Datei(en)${skipped}` })
        for (const file of result.updated) {
          const open = get().openFiles.find((f) => f.path === file)
          if (open) {
            const content = await window.bluepy.project.readFile(file)
            set((state) => ({ openFiles: state.openFiles.map((f) => (f.path === file ? { ...f, content, savedContent: content } : f)) }))
          }
        }
      }
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: null })
    }
  },

  async reviewRunTests() {
    set({ busy: 'tests', message: null })
    try {
      await window.bluepy.hub.reviewRunTests()
      set({ hubDialog: 'reviewTests' })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: null })
    }
  },

  async reviewOpen(index) {
    set({ busy: 'open' })
    try {
      await window.bluepy.hub.reviewOpen(index)
      set({ openFiles: [], activeFile: null, codepad: [] })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: null })
    }
  },

  async reviewNote(index, notes, points) {
    set((state) => ({
      review: state.review ? { ...state.review, students: state.review.students.map((s, i) => (i === index ? { ...s, notes, points } : s)) } : null
    }))
    await window.bluepy.hub.reviewNote(index, notes, points)
  },

  async reviewClose() {
    await window.bluepy.hub.reviewClose()
  },

  async exportPackage() {
    try {
      const file = await window.bluepy.hub.exportPackage()
      if (file) set({ message: `Paket gespeichert: ${file}` })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    }
  },

  async importPackage() {
    set({ busy: 'open' })
    try {
      const project = await window.bluepy.hub.importPackage()
      if (project) set({ openFiles: [], activeFile: null, codepad: [], message: `Importiert: ${project.name}` })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: null })
    }
  }
}))
