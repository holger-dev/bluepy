/**
 * The typed API exposed to the renderer via contextBridge (`window.bluepy`)
 * and the events the main process broadcasts to every window.
 *
 * Shared state (backend status, terminal log, project, bench …) is owned by
 * the main process; each window loads a snapshot on start and then applies
 * events.
 */
import type { CodePadResult, EnvInfo, RpcId } from './rpc'
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

export type WindowRole = 'main' | 'diagram' | 'debugger'

export type BackendStatus =
  | 'unavailable' // no usable Python interpreter
  | 'stopped'
  | 'starting'
  | 'running'
  | 'crashed'

export interface TerminalEntry {
  id: number
  /** 'record' = the Python code of an interactive action ("Record method calls"). */
  stream: 'stdout' | 'stderr' | 'raw' | 'record'
  text: string
  invocation: RpcId
}

export type MenuAction = 'save' | 'saveAll' | 'compile' | 'closeProject'

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
  | { type: 'menu'; action: MenuAction }
  | { type: 'debug'; debug: DebugState }
  | { type: 'breakpoints'; breakpoints: Record<string, number[]> }

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
    eval(code: string): Promise<CodePadResult>
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
  projectClose: 'project:close',
  projectReadFile: 'project:readFile',
  projectWriteFile: 'project:writeFile',
  projectCreateFile: 'project:createFile',
  projectCompile: 'project:compile',
  projectSaveLayout: 'project:saveLayout',
  projectRunModule: 'project:runModule',
  editorOpen: 'editor:open',
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
  terminalStdin: 'terminal:stdin',
  terminalClear: 'terminal:clear',
  backendEvent: 'backend:event'
} as const
