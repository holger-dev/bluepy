/**
 * Owns one Python backend process: TCP server, child process, JSON-RPC
 * correlation and event fan-out.  See docs/03-rpc-protokoll.md.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import path from 'node:path'
import type {
  BackendStatus,
  DebugFrame,
  HelloParams,
  RpcError,
  RpcId,
  RpcMethodName,
  RpcMethods
} from '@bluepy/protocol'
import {
  DebugPausedParamsSchema,
  DebugResumedParamsSchema,
  HelloParamsSchema,
  InvocationFinishedParamsSchema,
  InvocationStartedParamsSchema,
  OutputParamsSchema,
  RecordParamsSchema,
  ResultParamsSchema,
  RpcIncomingSchema,
  StdinRequestParamsSchema
} from '@bluepy/protocol/schemas'

export interface BackendOptions {
  pythonPath: string
  /** Directory containing launcher.py and bluepy_backend/. */
  backendDir: string
  /** Project directory (cwd + sys.path[0] of the backend). */
  cwd?: string
  helloTimeoutMs?: number
  shutdownTimeoutMs?: number
}

/** Low-level events of one backend process (translated into renderer-facing events by main/state.ts). */
export type ProcessEvent =
  | { type: 'status'; status: BackendStatus; detail?: string; pid?: number }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string; invocation: RpcId }
  | { type: 'stdin.request'; invocation: RpcId }
  | { type: 'record'; code: string; invocation: RpcId }
  | { type: 'result'; repr: string; valueType: string; invocation: RpcId }
  | { type: 'debug.paused'; reason: 'breakpoint' | 'step' | 'pause'; frames: DebugFrame[]; invocation: RpcId }
  | { type: 'debug.resumed'; command: string }
  | { type: 'invocation.started'; invocation: RpcId; method: string }
  | { type: 'invocation.finished'; invocation: RpcId; method: string; ok: boolean }
  /** Raw process stdout/stderr (crash output, C-level writes) – a fallback channel. */
  | { type: 'raw'; stream: 'stdout' | 'stderr'; text: string }

export class RpcRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly rpcError: RpcError
  ) {
    super(`${method}: ${rpcError.message}`)
    this.name = 'RpcRequestError'
  }
}

interface Pending {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export class BackendProcess extends EventEmitter {
  status: BackendStatus = 'stopped'
  hello: HelloParams | null = null

  private server: net.Server | null = null
  private socket: net.Socket | null = null
  private child: ChildProcess | null = null
  private readonly token = randomBytes(16).toString('hex')
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private lineBuffer = ''
  private stopping = false

  constructor(private readonly options: BackendOptions) {
    super()
  }

  // ------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') return
    this.stopping = false
    this.setStatus('starting')
    const port = await this.listen()
    const launcher = path.join(this.options.backendDir, 'launcher.py')
    const args = ['-B', '-X', 'utf8', '-u', launcher, '--connect', `127.0.0.1:${port}`, '--token', this.token]
    if (this.options.cwd) args.push('--cwd', this.options.cwd)

    const child = spawn(this.options.pythonPath, args, {
      cwd: this.options.cwd ?? this.options.backendDir,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    child.stdout?.setEncoding('utf-8')
    child.stderr?.setEncoding('utf-8')
    child.stdout?.on('data', (text: string) => this.emitEvent({ type: 'raw', stream: 'stdout', text }))
    child.stderr?.on('data', (text: string) => this.emitEvent({ type: 'raw', stream: 'stderr', text }))
    child.on('exit', (code, signal) => this.onChildExit(code, signal))
    child.on('error', (error) => this.fail(`spawn failed: ${error.message}`))

    await this.waitForHello()
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.cleanup()
      this.setStatus('stopped')
      return
    }
    this.stopping = true
    const child = this.child
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once('exit', () => resolve())
    })
    try {
      if (this.socket) await this.request('shutdown', {})
    } catch {
      // backend may already be gone
    }
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), this.options.shutdownTimeoutMs ?? 3000)
    )
    if ((await Promise.race([exited, timeout])) === 'timeout') child.kill('SIGKILL')
    await exited
    this.cleanup()
    this.setStatus('stopped')
  }

  async reset(): Promise<void> {
    await this.stop()
    await this.start()
  }

  // -------------------------------------------------------------- requests

  request<M extends RpcMethodName>(method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.status !== 'running') {
        reject(new Error(`backend not running (status: ${this.status})`))
        return
      }
      const id = this.nextId++
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (!this.socket) return
    this.write({ jsonrpc: '2.0', method, params })
  }

  async halt(): Promise<boolean> {
    if (this.status !== 'running') return false
    const result = await this.request('halt', {})
    return result.halted
  }

  // -------------------------------------------------------------- internals

  private listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.onConnection(socket))
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('could not determine server port'))
          return
        }
        this.server = server
        resolve(address.port)
      })
    })
  }

  private onConnection(socket: net.Socket): void {
    if (this.socket) {
      socket.destroy() // only one backend per BackendProcess
      return
    }
    this.socket = socket
    socket.setNoDelay(true)
    socket.setEncoding('utf-8')
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('close', () => {
      this.socket = null
      if (!this.stopping && this.status === 'running') this.fail('connection closed')
    })
    socket.on('error', () => {
      /* handled via close */
    })
  }

  private onData(chunk: string): void {
    this.lineBuffer += chunk
    let newline: number
    while ((newline = this.lineBuffer.indexOf('\n')) >= 0) {
      const line = this.lineBuffer.slice(0, newline).trim()
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      if (line) this.onLine(line)
    }
  }

  private onLine(line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      this.emitEvent({ type: 'raw', stream: 'stderr', text: `[bluepy] unparsable message from backend: ${line}\n` })
      return
    }
    const parsed = RpcIncomingSchema.safeParse(raw)
    if (!parsed.success) {
      this.emitEvent({ type: 'raw', stream: 'stderr', text: `[bluepy] invalid message from backend: ${line}\n` })
      return
    }
    const message = parsed.data
    if ('method' in message) {
      this.onNotification(message.method, message.params ?? {})
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) pending.reject(new RpcRequestError(pending.method, message.error))
    else pending.resolve(message.result)
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'hello': {
        const hello = HelloParamsSchema.safeParse(params)
        if (!hello.success || hello.data.token !== this.token) {
          this.fail('backend handshake failed (bad token)')
          this.child?.kill('SIGKILL')
          return
        }
        this.hello = hello.data
        this.setStatus('running', undefined, hello.data.pid)
        this.emit('hello', hello.data)
        return
      }
      case 'output': {
        const p = OutputParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'output', ...p.data })
        return
      }
      case 'stdin.request': {
        const p = StdinRequestParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'stdin.request', ...p.data })
        return
      }
      case 'record': {
        const p = RecordParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'record', ...p.data })
        return
      }
      case 'result': {
        const p = ResultParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'result', repr: p.data.repr, valueType: p.data.type, invocation: p.data.invocation })
        return
      }
      case 'debug.paused': {
        const p = DebugPausedParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'debug.paused', ...p.data })
        return
      }
      case 'debug.resumed': {
        const p = DebugResumedParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'debug.resumed', ...p.data })
        return
      }
      case 'invocation.started': {
        const p = InvocationStartedParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'invocation.started', ...p.data })
        return
      }
      case 'invocation.finished': {
        const p = InvocationFinishedParamsSchema.safeParse(params)
        if (p.success) this.emitEvent({ type: 'invocation.finished', ...p.data })
        return
      }
      default:
        this.emitEvent({ type: 'raw', stream: 'stderr', text: `[bluepy] unknown notification ${method}\n` })
    }
  }

  private waitForHello(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('hello', onHello)
        this.off('failed', onFailed)
        this.fail('backend did not say hello in time')
        reject(new Error('backend start timed out'))
      }, this.options.helloTimeoutMs ?? 20_000)
      const onHello = (): void => {
        clearTimeout(timer)
        this.off('failed', onFailed)
        resolve()
      }
      const onFailed = (detail: string): void => {
        clearTimeout(timer)
        this.off('hello', onHello)
        reject(new Error(detail))
      }
      this.once('hello', onHello)
      this.once('failed', onFailed)
    })
  }

  private write(message: Record<string, unknown>): void {
    this.socket?.write(JSON.stringify(message) + '\n')
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null
    if (this.stopping) return
    const detail = code === 3 ? 'python-too-old' : `exited with ${signal ?? code}`
    this.fail(detail)
  }

  private fail(detail: string): void {
    this.rejectPending(new Error(detail))
    this.cleanup()
    this.setStatus('crashed', detail)
    this.emit('failed', detail)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private cleanup(): void {
    this.rejectPending(new Error('backend stopped'))
    this.socket?.destroy()
    this.socket = null
    this.server?.close()
    this.server = null
    this.lineBuffer = ''
    this.hello = null
    if (this.child && this.child.exitCode === null) this.child.kill('SIGKILL')
    this.child = null
  }

  private setStatus(status: BackendStatus, detail?: string, pid?: number): void {
    this.status = status
    this.emitEvent({ type: 'status', status, detail, pid })
  }

  private emitEvent(event: ProcessEvent): void {
    this.emit('event', event)
  }
}
