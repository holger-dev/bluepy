/**
 * Shared application state owned by the main process: backend status,
 * terminal log, stdin state, project and object bench.  Every window gets a
 * snapshot on load and then receives BackendEvents; this module turns
 * low-level ProcessEvents into those renderer-facing events.
 */
import type {
  BackendEvent,
  BackendStatus,
  BenchObject,
  DebugState,
  MenuAction,
  ProjectInfo,
  PythonDiscoveryResult,
  StateSnapshot,
  TerminalEntry
} from '@bluepy/protocol'
import type { ProcessEvent } from './backend/BackendProcess'

const MAX_TERMINAL_ENTRIES = 5000

export class TerminalLog {
  private entries: TerminalEntry[] = []
  private nextId = 1

  /** Append a chunk; consecutive chunks of one stream/invocation are merged into one entry. */
  append(stream: TerminalEntry['stream'], text: string, invocation: TerminalEntry['invocation']): TerminalEntry {
    const last = this.entries[this.entries.length - 1]
    if (last && last.stream === stream && last.invocation === invocation && stream !== 'record' && stream !== 'result') {
      last.text += text
      return last
    }
    const entry: TerminalEntry = { id: this.nextId++, stream, text, invocation }
    this.entries.push(entry)
    if (this.entries.length > MAX_TERMINAL_ENTRIES) this.entries.splice(0, this.entries.length - MAX_TERMINAL_ENTRIES)
    return entry
  }

  clear(): void {
    this.entries = []
  }

  all(): TerminalEntry[] {
    return this.entries.map((e) => ({ ...e }))
  }
}

export class AppState {
  discovery: PythonDiscoveryResult | null = null
  backendStatus: BackendStatus = 'stopped'
  backendDetail: string | null = null
  waitingForStdin = false
  project: ProjectInfo | null = null
  bench: BenchObject[] = []
  recentProjects: string[] = []
  debug: DebugState = { paused: false, reason: null, frames: [], armed: false }
  breakpoints: Record<string, number[]> = {}
  readonly terminal = new TerminalLog()
  /** Called when execution pauses (the IDE opens the debugger window). */
  onDebugPaused: (() => void) | null = null

  constructor(private readonly broadcast: (event: BackendEvent) => void) {}

  snapshot(): StateSnapshot {
    return {
      discovery: this.discovery,
      backendStatus: this.backendStatus,
      backendDetail: this.backendDetail,
      waitingForStdin: this.waitingForStdin,
      terminal: this.terminal.all(),
      project: this.project,
      bench: this.bench,
      recentProjects: this.recentProjects,
      debug: this.debug,
      breakpoints: this.breakpoints
    }
  }

  setDebug(patch: Partial<DebugState>): void {
    this.debug = { ...this.debug, ...patch }
    this.broadcast({ type: 'debug', debug: this.debug })
  }

  setBreakpoints(file: string, lines: number[]): void {
    const sorted = [...new Set(lines)].sort((a, b) => a - b)
    if (sorted.length) this.breakpoints = { ...this.breakpoints, [file]: sorted }
    else {
      const { [file]: _removed, ...rest } = this.breakpoints
      this.breakpoints = rest
    }
    this.broadcast({ type: 'breakpoints', breakpoints: this.breakpoints })
  }

  setStatus(status: BackendStatus, detail?: string, pid?: number): void {
    this.backendStatus = status
    this.backendDetail = detail ?? null
    if (status !== 'running') {
      this.setWaiting(false)
      this.setBench([])
      if (this.debug.paused) this.setDebug({ paused: false, reason: null, frames: [] })
    }
    this.broadcast({ type: 'status', status, detail, pid })
  }

  setWaiting(waiting: boolean): void {
    if (this.waitingForStdin === waiting) return
    this.waitingForStdin = waiting
    this.broadcast({ type: 'stdin', waiting })
  }

  setProject(project: ProjectInfo | null): void {
    this.project = project ? { ...project } : null
    this.broadcast({ type: 'project', project: this.project })
  }

  setBench(bench: BenchObject[]): void {
    this.bench = bench
    this.broadcast({ type: 'bench', bench })
  }

  fileChanged(file: string): void {
    this.broadcast({ type: 'file.changed', file })
  }

  openInEditor(file: string, line?: number): void {
    this.broadcast({ type: 'editor.open', file, line })
  }

  menu(action: MenuAction): void {
    this.broadcast({ type: 'menu', action })
  }

  clearTerminal(): void {
    this.terminal.clear()
    this.broadcast({ type: 'terminal.cleared' })
  }

  /** Translate a low-level backend process event. */
  applyProcessEvent(event: ProcessEvent): void {
    switch (event.type) {
      case 'status':
        this.setStatus(event.status, event.detail, event.pid)
        break
      case 'output':
        this.broadcast({ type: 'terminal', entry: { ...this.terminal.append(event.stream, event.text, event.invocation) } })
        break
      case 'raw':
        this.broadcast({ type: 'terminal', entry: { ...this.terminal.append('raw', event.text, null) } })
        break
      case 'record':
        this.broadcast({ type: 'terminal', entry: { ...this.terminal.append('record', event.code + '\n', event.invocation) } })
        break
      case 'result':
        this.broadcast({
          type: 'terminal',
          entry: { ...this.terminal.append('result', `${event.repr} (${event.valueType})\n`, event.invocation) }
        })
        break
      case 'stdin.request':
        this.setWaiting(true)
        break
      case 'invocation.started':
        this.broadcast({ type: 'invocation.started', invocation: event.invocation, method: event.method })
        break
      case 'invocation.finished':
        this.setWaiting(false)
        if (this.debug.paused) this.setDebug({ paused: false, reason: null, frames: [] })
        this.broadcast({ type: 'invocation.finished', invocation: event.invocation, method: event.method, ok: event.ok })
        break
      case 'debug.paused':
        this.setDebug({ paused: true, reason: event.reason, frames: event.frames })
        this.onDebugPaused?.()
        break
      case 'debug.resumed':
        this.setDebug({ paused: false, reason: null, frames: [] })
        break
    }
  }
}
