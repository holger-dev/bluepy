/**
 * The typed API exposed to the renderer via contextBridge (`window.bluepy`)
 * and the events the main process broadcasts to every window.
 *
 * Shared state (backend status, terminal log, project, bench …) is owned by
 * the main process; each window loads a snapshot on start and then applies
 * events.
 */
import type { CodePadResult, EnvInfo, FixtureToBenchResult, RpcId, TestCaseResult, TestClassDescription, TestRunSummary, TestStartedParams } from './rpc'
import type { PythonDiscoveryResult } from './python'
import type {
  BenchObject,
  ClassLayout,
  DebugInspectResult,
  DebugScope,
  DebugState,
  DebugVariables,
  InspectResult,
  InvocationResult,
  LiveClassInfo,
  ModuleRunResult,
  ProjectInfo
} from './project'

export type WindowRole = 'main' | 'diagram' | 'debugger' | 'tests'

export type ThemeSetting = 'system' | 'light' | 'dark'

export type BackendStatus =
  | 'unavailable' // no usable Python interpreter
  | 'stopped'
  | 'starting'
  | 'running'
  | 'crashed'

export interface TerminalEntry {
  id: number
  /** 'record' = the Python code of an interactive action ("Record method calls"), 'result' = its return value. */
  stream: 'stdout' | 'stderr' | 'raw' | 'record' | 'result'
  text: string
  invocation: RpcId
}

export type MenuAction =
  | 'save'
  | 'saveAll'
  | 'compile'
  | 'closeProject'
  | 'runTests'
  | 'hub.fetch'
  | 'hub.submit'
  | 'hub.update'
  | 'hub.feedback'
  | 'hub.publish'
  | 'hub.collect'
  | 'hub.classes'
  | 'hub.settings'
  | 'package.export'
  | 'package.import'

// ------------------------------------------------------------- hub / tasks

/** `aufgabe.json` inside a `.bluepy` package and an assignment project. */
export interface TaskMeta {
  format: 1
  code: string
  title: string
  description: string
  teacher?: string | null
  hubUrl?: string | null
  submitFrom: string | null
  submitUntil: string | null
  version: number
  tests: boolean
  /** sha256 of every file as delivered by the hub – "Aufgabe aktualisieren" only replaces unchanged files. */
  originalHashes?: Record<string, string>
}

export type TaskWindow = 'before' | 'open' | 'after'

export interface TaskInfo {
  code: string
  title: string
  description: string
  submitFrom: string | null
  submitUntil: string | null
  version: number
  tests: boolean
  created: string
  updated: string
  serverTime: string
  window: TaskWindow
  /** Teacher view only. */
  classes?: { id: number; name: string }[]
  submissions?: number
  students?: number
}

export interface HubStudent {
  id: number
  name: string
  code: string
}

export interface HubClass {
  id: number
  name: string
  created: string
  students: HubStudent[]
}

export interface SubmissionEntry {
  name: string
  personal: string
  class: string
  submittedAt: string | null
  late: boolean
  size: number
  sharedDevice: boolean
  feedback: { notes: string; points: string | null } | null
}

export interface HubSettings {
  url: string
  hasTeacherKey: boolean
  teacherName: string | null
  hasPersonalCode: boolean
}

/** The open project is an assignment fetched from the hub (or imported). */
export interface AssignmentState {
  meta: TaskMeta
  dir: string
  lastSubmittedAt: string | null
}

export interface ReviewTestSummary {
  ok: boolean
  error?: string
  total: number
  passed: number
  failed: number
  errors: number
  skipped: number
  /** test id → status */
  results: Record<string, 'passed' | 'failed' | 'error' | 'skipped'>
}

export interface ReviewStudent extends SubmissionEntry {
  /** Local folder with the unpacked submission, null when nothing was submitted. */
  folder: string | null
  notes: string
  points: string
  /** Result of "Tests über alle Abgaben", when run. */
  tests?: ReviewTestSummary | null
}

/** Teacher's review mode after collecting the submissions of one task. */
export interface ReviewState {
  code: string
  title: string
  folder: string
  collectedAt: string
  students: ReviewStudent[]
  /** Index of the submission currently open as the project, or -1. */
  index: number
  /** Folder with the teacher's original task package (its test files win when running tests for all). */
  taskFolder: string | null
}

/** A test-method recording in progress (BlueJ's "Create Test Method"). */
export interface RecordingState {
  file: string
  className: string
  method: string
  /** Bench objects present when the recording started – the fixture, referenced as self.<name>. */
  fixtureNames: string[]
  /** Recorded Python statements (assertions already applied). */
  statements: string[]
}

export interface TestRunState {
  running: boolean
  /** What is being run, for the window title ("KontoTest", "alle Tests", …). */
  label: string
  startedAt: number
  /** The test currently executing. */
  active: TestStartedParams | null
  results: TestCaseResult[]
  summary: { total: number; passed: number; failed: number; errors: number; skipped: number; durationMs: number } | null
  error: string | null
}

export type AssertionKind = 'equal' | 'almostEqual' | 'true' | 'false' | 'isNone' | 'isNotNone' | 'is'

export interface Assertion {
  kind: AssertionKind
  /** Expected value as Python source (equal / almostEqual / is). */
  expected?: string
}

export type BackendEvent =
  | { type: 'status'; status: BackendStatus; detail?: string; pid?: number }
  /** A new entry, or the last entry grown by another chunk (same id). */
  | { type: 'terminal'; entry: TerminalEntry }
  | { type: 'terminal.cleared' }
  | { type: 'stdin'; waiting: boolean }
  | { type: 'invocation.started'; invocation: RpcId; method: string }
  | { type: 'invocation.finished'; invocation: RpcId; method: string; ok: boolean }
  | { type: 'project'; project: ProjectInfo | null }
  | { type: 'bench'; bench: BenchObject[] }
  /** A file changed on disk (external edit, or written by another window). */
  | { type: 'file.changed'; file: string }
  /** Asks the editor window to show a file (double-click in the diagram, "Show source" …). */
  | { type: 'editor.open'; file: string; line?: number }
  | { type: 'menu'; action: MenuAction; token?: number }
  | { type: 'debug'; debug: DebugState }
  | { type: 'breakpoints'; breakpoints: Record<string, number[]> }
  | { type: 'tests'; tests: TestRunState | null }
  | { type: 'recording'; recording: RecordingState | null }
  | { type: 'theme'; theme: ThemeSetting }
  | { type: 'assignment'; assignment: AssignmentState | null }
  | { type: 'review'; review: ReviewState | null }
  | { type: 'hub'; hub: HubSettings }
  /** Type-checker diagnostics for a project file (Pyright). */
  | { type: 'diagnostics'; file: string; diagnostics: LspDiagnostic[] }

export interface StateSnapshot {
  discovery: PythonDiscoveryResult | null
  backendStatus: BackendStatus
  backendDetail: string | null
  waitingForStdin: boolean
  terminal: TerminalEntry[]
  project: ProjectInfo | null
  bench: BenchObject[]
  recentProjects: string[]
  debug: DebugState
  breakpoints: Record<string, number[]>
  tests: TestRunState | null
  recording: RecordingState | null
  theme: ThemeSetting
  assignment: AssignmentState | null
  review: ReviewState | null
  hub: HubSettings
  diagnostics: Record<string, LspDiagnostic[]>
}

// ------------------------------------------------------------ language server

export interface CompletionItem {
  label: string
  kind: 'text' | 'method' | 'function' | 'constructor' | 'field' | 'variable' | 'class' | 'interface' | 'module' | 'property' | 'enum' | 'keyword' | 'constant'
  detail: string | null
  /** Markdown (docstring); may be missing until resolved. */
  documentation: string | null
  insertText: string | null
  sortText: string | null
  /** Opaque server data for completionItem/resolve. */
  data: unknown
}

export interface LspPosition {
  line: number
  character: number
}

export interface HoverInfo {
  /** Markdown. */
  contents: string
  range: { start: LspPosition; end: LspPosition } | null
}

export interface LspDiagnostic {
  from: LspPosition
  to: LspPosition
  severity: 'error' | 'warning' | 'info'
  message: string
  code: string | null
}

export interface ExampleInfo {
  id: string
  name: string
  description: string
  level: string
}

export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  locale: string
}

export interface BluePyApi {
  app: {
    info(): Promise<AppInfo>
    /** Light/dark/system – persisted, applied to every window and native UI. */
    setTheme(theme: ThemeSetting): Promise<void>
  }
  windows: {
    /** Open (or focus) the window with this role. */
    open(role: WindowRole): Promise<void>
  }
  state: {
    snapshot(): Promise<StateSnapshot>
  }
  python: {
    discover(): Promise<PythonDiscoveryResult>
    /** Pin an interpreter path (null = back to automatic choice). */
    select(path: string | null): Promise<PythonDiscoveryResult>
  }
  backend: {
    start(): Promise<BackendStatus>
    reset(): Promise<BackendStatus>
    status(): Promise<BackendStatus>
    halt(): Promise<boolean>
    envInfo(): Promise<EnvInfo>
  }
  project: {
    /** Show the folder picker (null) or open this directory. Returns the project or null when cancelled. */
    open(dir: string | null): Promise<ProjectInfo | null>
    /** Show the "new project" dialog; returns the project or null when cancelled. */
    create(): Promise<ProjectInfo | null>
    /** Open the bundled example project (copied to a writable location). */
    openExample(name: string): Promise<ProjectInfo | null>
    /** The bundled example projects (examples/index.json). */
    examples(): Promise<ExampleInfo[]>
    close(): Promise<void>
    readFile(file: string): Promise<string>
    writeFile(file: string, content: string): Promise<void>
    createFile(file: string, content: string): Promise<ProjectInfo | null>
    /** Save all + load every module in the backend ("Compile"). */
    compile(): Promise<ProjectInfo | null>
    saveLayout(layout: Record<string, ClassLayout>): Promise<void>
    runModule(file: string): Promise<ModuleRunResult>
  }
  editor: {
    /** Ask the editor window to open a file (raises the window). */
    open(file: string, line?: number): Promise<void>
    /** The editor window saved everything after a 'saveAll' menu event carrying this token. */
    flushed(token: number): Promise<void>
    /** Language server (Pyright): keep the open document in sync, ask for completions and hover info. */
    didOpen(file: string, text: string): Promise<void>
    didChange(file: string, text: string): Promise<void>
    didClose(file: string): Promise<void>
    complete(file: string, line: number, character: number): Promise<CompletionItem[]>
    resolveCompletion(item: CompletionItem): Promise<CompletionItem>
    hover(file: string, line: number, character: number): Promise<HoverInfo | null>
  }
  objects: {
    describeClass(module: string, name: string): Promise<LiveClassInfo>
    suggestName(className: string): Promise<string>
    create(module: string, name: string, benchName: string, args: string[]): Promise<InvocationResult>
    call(target: { bench: string } | { module: string; name: string }, method: string, args: string[]): Promise<InvocationResult>
    inspect(name: string, path: (string | number)[]): Promise<InspectResult>
    get(name: string, path: (string | number)[], newName: string | null): Promise<InvocationResult>
    remove(name: string): Promise<void>
  }
  debug: {
    setBreakpoints(file: string, lines: number[]): Promise<void>
    continue(): Promise<void>
    step(): Promise<void>
    stepInto(): Promise<void>
    stepOut(): Promise<void>
    terminate(): Promise<void>
    /** Pause at the next line when tracing is active; otherwise aborts like Halt. */
    pause(): Promise<void>
    variables(frame: number): Promise<DebugVariables>
    inspect(frame: number, scope: DebugScope, name: string, path: (string | number)[]): Promise<DebugInspectResult>
  }
  codepad: {
    /** `id` identifies the entry so an object result can be inspected later ("$<id>"). */
    eval(code: string, id: number): Promise<CodePadResult>
  }
  tests: {
    /** Create test_<module>.py with a <Class>Test skeleton next to the class; returns the new file. */
    createTestClass(classId: string): Promise<{ file: string; className: string }>
    run(target: { files: string[]; className?: string; method?: string; label: string }): Promise<TestRunSummary>
    describe(file: string, className: string): Promise<TestClassDescription>
    /** Clears the bench, loads the fixture and starts recording interactions into this method. */
    startRecording(file: string, className: string, method: string): Promise<RecordingState>
    /** Turn the recorded statement `code` (the last call) into an assertion. */
    recordAssertion(code: string, assertion: Assertion): Promise<void>
    /** save=true writes the method into the test class and compiles; false discards. */
    endRecording(save: boolean): Promise<void>
    benchToFixture(file: string, className: string): Promise<void>
    fixtureToBench(file: string, className: string): Promise<FixtureToBenchResult>
  }
  hub: {
    settings(): Promise<HubSettings>
    /** Empty string for a key/code removes it; undefined leaves it unchanged. */
    saveSettings(patch: { url?: string; teacherKey?: string; personalCode?: string }): Promise<HubSettings>
    /** Download the task into Documents/BluePy/Aufgaben and open it as the project. */
    fetchTask(code: string): Promise<AssignmentState>
    /** Submit the open assignment project (needs the personal code in the settings). */
    submit(): Promise<{ at: string; name: string; late: boolean }>
    /** Current state of the open assignment on the hub (window, version). */
    taskStatus(): Promise<TaskInfo | null>
    /** Newer task version from the hub: replaces files the learner did not change. */
    updateTask(): Promise<{ version: number; updated: string[]; skipped: string[]; upToDate: boolean }>
    /** Teacher's feedback for the open assignment, or null when there is none yet. */
    feedback(): Promise<{ notes: string; points: string | null; updated: string } | null>
    classes(): Promise<HubClass[]>
    addClass(name: string, students: string[]): Promise<HubClass>
    addStudents(id: number, students: string[]): Promise<HubClass>
    removeClass(id: number): Promise<void>
    tasks(): Promise<TaskInfo[]>
    /** Publish the open project as a task. */
    publish(meta: { title: string; description: string; code?: string; submitFrom: string | null; submitUntil: string | null; classes: number[]; tests: boolean; exclude: string[] }): Promise<TaskInfo>
    /** Download every submission of a task and enter review mode. */
    collect(code: string): Promise<ReviewState>
    reviewOpen(index: number): Promise<void>
    reviewNote(index: number, notes: string, points: string): Promise<void>
    reviewClose(): Promise<void>
    /** Run every submission's tests in its own interpreter; results land in the review state. */
    reviewRunTests(): Promise<ReviewState>
    /** Save dialog → .bluepy file of the open project; null when cancelled. */
    exportPackage(): Promise<string | null>
    /** Open dialog → unpack into Documents/BluePy/Import and open; null when cancelled. */
    importPackage(): Promise<ProjectInfo | null>
  }
  terminal: {
    provideStdin(text: string | null): Promise<void>
    clear(): Promise<void>
  }
  /** Subscribe to backend events; returns an unsubscribe function. */
  onBackendEvent(listener: (event: BackendEvent) => void): () => void
}

/** IPC channel names – one place, used by main and preload. */
export const IPC = {
  appInfo: 'app:info',
  appSetTheme: 'app:setTheme',
  windowOpen: 'window:open',
  stateSnapshot: 'state:snapshot',
  pythonDiscover: 'python:discover',
  pythonSelect: 'python:select',
  backendStart: 'backend:start',
  backendReset: 'backend:reset',
  backendStatus: 'backend:status',
  backendHalt: 'backend:halt',
  backendEnvInfo: 'backend:envInfo',
  projectOpen: 'project:open',
  projectCreate: 'project:create',
  projectOpenExample: 'project:openExample',
  projectExamples: 'project:examples',
  projectClose: 'project:close',
  projectReadFile: 'project:readFile',
  projectWriteFile: 'project:writeFile',
  projectCreateFile: 'project:createFile',
  projectCompile: 'project:compile',
  projectSaveLayout: 'project:saveLayout',
  projectRunModule: 'project:runModule',
  editorOpen: 'editor:open',
  editorFlushed: 'editor:flushed',
  editorDidOpen: 'editor:didOpen',
  editorDidChange: 'editor:didChange',
  editorDidClose: 'editor:didClose',
  editorComplete: 'editor:complete',
  editorResolve: 'editor:resolve',
  editorHover: 'editor:hover',
  objectsDescribeClass: 'objects:describeClass',
  objectsSuggestName: 'objects:suggestName',
  objectsCreate: 'objects:create',
  objectsCall: 'objects:call',
  objectsInspect: 'objects:inspect',
  objectsGet: 'objects:get',
  objectsRemove: 'objects:remove',
  debugSetBreakpoints: 'debug:setBreakpoints',
  debugCommand: 'debug:command',
  debugVariables: 'debug:variables',
  debugInspect: 'debug:inspect',
  codepadEval: 'codepad:eval',
  testsCreateClass: 'tests:createClass',
  testsRun: 'tests:run',
  testsDescribe: 'tests:describe',
  testsStartRecording: 'tests:startRecording',
  testsRecordAssertion: 'tests:recordAssertion',
  testsEndRecording: 'tests:endRecording',
  testsBenchToFixture: 'tests:benchToFixture',
  testsFixtureToBench: 'tests:fixtureToBench',
  hubSettings: 'hub:settings',
  hubSaveSettings: 'hub:saveSettings',
  hubFetchTask: 'hub:fetchTask',
  hubSubmit: 'hub:submit',
  hubTaskStatus: 'hub:taskStatus',
  hubClasses: 'hub:classes',
  hubAddClass: 'hub:addClass',
  hubAddStudents: 'hub:addStudents',
  hubRemoveClass: 'hub:removeClass',
  hubTasks: 'hub:tasks',
  hubPublish: 'hub:publish',
  hubCollect: 'hub:collect',
  hubReviewOpen: 'hub:reviewOpen',
  hubReviewNote: 'hub:reviewNote',
  hubReviewClose: 'hub:reviewClose',
  hubReviewRunTests: 'hub:reviewRunTests',
  hubUpdateTask: 'hub:updateTask',
  hubFeedback: 'hub:feedback',
  hubExport: 'hub:export',
  hubImport: 'hub:import',
  terminalStdin: 'terminal:stdin',
  terminalClear: 'terminal:clear',
  backendEvent: 'backend:event'
} as const
