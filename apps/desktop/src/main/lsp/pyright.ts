/**
 * A small Language Server Protocol client for Pyright (completion, hover,
 * diagnostics).  Pyright's language server is JavaScript; it runs in
 * Electron's bundled Node (ELECTRON_RUN_AS_NODE) so learners need nothing but
 * their Python.  Documents are synced with full text on every change
 * (debounced in the renderer).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CompletionItem, HoverInfo, LspDiagnostic } from '@bluepy/protocol'

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface PyrightOptions {
  rootDir: string
  pythonPath: string | null
  /** Path of pyright's langserver.index.js; resolved from node_modules when omitted. */
  serverScript?: string
  /** Executable that runs the script (Electron with ELECTRON_RUN_AS_NODE, or node). */
  nodeExecutable?: string
}

export function resolvePyrightScript(): string {
  const require = createRequire(__filename)
  let script = require.resolve('pyright/langserver.index.js')
  // Packaged app: pyright is unpacked next to the asar (electron-builder asarUnpack).
  if (script.includes('app.asar') && !script.includes('app.asar.unpacked')) script = script.replace('app.asar', 'app.asar.unpacked')
  return script
}

export function fileUri(file: string): string {
  return pathToFileURL(file).href
}

const MAX_COMPLETIONS = 200

/** Emits 'diagnostics' ({file, diagnostics}), 'exit'. */
export class PyrightServer extends EventEmitter {
  private child: ChildProcess | null = null
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly versions = new Map<string, number>()
  private initialized: Promise<void> | null = null
  private stopped = false

  constructor(private readonly options: PyrightOptions) {
    super()
  }

  get rootDir(): string {
    return this.options.rootDir
  }

  // ---------------------------------------------------------------- lifecycle

  start(): Promise<void> {
    if (this.initialized) return this.initialized
    const script = this.options.serverScript ?? resolvePyrightScript()
    const executable = this.options.nodeExecutable ?? process.execPath
    const child = spawn(executable, [script, '--stdio'], {
      cwd: this.options.rootDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk))
    child.stderr?.on('data', () => {
      /* pyright logs to stderr; not interesting */
    })
    child.on('exit', (code) => {
      this.child = null
      for (const p of this.pending.values()) p.reject(new Error('pyright exited'))
      this.pending.clear()
      if (!this.stopped) this.emit('exit', code)
    })
    child.on('error', (error) => {
      this.emit('exit', error.message)
    })
    const rootUri = fileUri(this.options.rootDir)
    this.initialized = this.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.options.rootDir) }],
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'], resolveSupport: { properties: ['documentation', 'detail'] } } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: false },
          synchronization: { didSave: false }
        },
        workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: false } }
      },
      initializationOptions: {}
    }).then(() => {
      this.notify('initialized', {})
      this.notify('workspace/didChangeConfiguration', { settings: this.settings() })
    })
    return this.initialized
  }

  async stop(): Promise<void> {
    this.stopped = true
    const child = this.child
    if (!child) return
    try {
      await Promise.race([this.request('shutdown', null), new Promise((resolve) => setTimeout(resolve, 1500))])
      this.notify('exit', null)
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 1500)
  }

  private settings(): Record<string, unknown> {
    return {
      python: {
        pythonPath: this.options.pythonPath ?? undefined,
        analysis: { typeCheckingMode: 'basic', diagnosticMode: 'openFilesOnly', autoSearchPaths: true, useLibraryCodeForTypes: true }
      }
    }
  }

  // ---------------------------------------------------------------- documents

  async open(file: string, text: string): Promise<void> {
    await this.start()
    const uri = fileUri(file)
    if (this.versions.has(uri)) {
      await this.change(file, text)
      return
    }
    this.versions.set(uri, 1)
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text } })
  }

  async change(file: string, text: string): Promise<void> {
    await this.start()
    const uri = fileUri(file)
    const version = (this.versions.get(uri) ?? 0) + 1
    if (!this.versions.has(uri)) {
      this.versions.set(uri, version)
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version, text } })
      return
    }
    this.versions.set(uri, version)
    this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] })
  }

  close(file: string): void {
    const uri = fileUri(file)
    if (!this.versions.delete(uri) || !this.child) return
    this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  // ----------------------------------------------------------------- features

  async complete(file: string, line: number, character: number): Promise<CompletionItem[]> {
    await this.start()
    const result = (await this.request('textDocument/completion', {
      textDocument: { uri: fileUri(file) },
      position: { line, character }
    })) as { items?: RawCompletion[] } | RawCompletion[] | null
    const items = Array.isArray(result) ? result : (result?.items ?? [])
    return items.slice(0, MAX_COMPLETIONS).map((item) => ({
      label: item.label,
      kind: kindName(item.kind),
      detail: item.detail ?? null,
      documentation: markup(item.documentation),
      insertText: item.insertText ?? (item.textEdit && 'newText' in item.textEdit ? item.textEdit.newText : null),
      sortText: item.sortText ?? null,
      data: item.data ?? null
    }))
  }

  async resolveCompletion(item: CompletionItem): Promise<CompletionItem> {
    if (!item.data || item.documentation) return item
    try {
      const resolved = (await this.request('completionItem/resolve', { label: item.label, data: item.data })) as RawCompletion
      return { ...item, documentation: markup(resolved.documentation) ?? item.documentation, detail: resolved.detail ?? item.detail }
    } catch {
      return item
    }
  }

  async hover(file: string, line: number, character: number): Promise<HoverInfo | null> {
    await this.start()
    const result = (await this.request('textDocument/hover', { textDocument: { uri: fileUri(file) }, position: { line, character } })) as {
      contents: unknown
      range?: { start: { line: number; character: number }; end: { line: number; character: number } }
    } | null
    if (!result) return null
    const text = markup(result.contents)
    if (!text) return null
    return { contents: text, range: result.range ?? null }
  }

  // ---------------------------------------------------------------- transport

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin) {
        reject(new Error('pyright not running'))
        return
      }
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`pyright: ${method} timed out`))
      }, 15_000)
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private respond(id: number | string, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result })
  }

  private send(message: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(message), 'utf-8')
    this.child?.stdin?.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child?.stdin?.write(body)
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const start = headerEnd + 4
      if (this.buffer.length < start + length) return
      const body = this.buffer.subarray(start, start + length).toString('utf-8')
      this.buffer = this.buffer.subarray(start + length)
      try {
        this.onMessage(JSON.parse(body) as LspMessage)
      } catch {
        /* ignore malformed frames */
      }
    }
  }

  private onMessage(message: LspMessage): void {
    if ('id' in message && message.id !== undefined && 'method' in message && message.method) {
      // request from the server
      switch (message.method) {
        case 'workspace/configuration': {
          const items = (message.params as { items?: { section?: string }[] })?.items ?? []
          const settings = this.settings()
          this.respond(message.id, items.map((item) => (item.section === 'python' ? settings.python : item.section === 'python.analysis' ? (settings.python as { analysis: unknown }).analysis : null)))
          return
        }
        case 'workspace/workspaceFolders':
          this.respond(message.id, [{ uri: fileUri(this.options.rootDir), name: path.basename(this.options.rootDir) }])
          return
        case 'client/registerCapability':
        case 'client/unregisterCapability':
        case 'window/workDoneProgress/create':
          this.respond(message.id, null)
          return
        default:
          this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not supported' } })
          return
      }
    }
    if ('id' in message && message.id !== undefined) {
      const pending = this.pending.get(Number(message.id))
      if (!pending) return
      this.pending.delete(Number(message.id))
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as { uri: string; diagnostics: RawDiagnostic[] }
      const diagnostics: LspDiagnostic[] = params.diagnostics
        .filter((d) => d.severity === undefined || d.severity <= 3)
        .map((d) => ({
          from: d.range.start,
          to: d.range.end,
          severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
          message: d.message,
          code: typeof d.code === 'string' ? d.code : d.code === undefined ? null : String(d.code)
        }))
      this.emit('diagnostics', { uri: params.uri, diagnostics })
    }
  }
}

interface LspMessage {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

interface RawCompletion {
  label: string
  kind?: number
  detail?: string
  documentation?: unknown
  insertText?: string
  textEdit?: { newText: string } | { insert: unknown }
  sortText?: string
  data?: unknown
}

interface RawDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
  code?: string | number
}

const KINDS: Record<number, CompletionItem['kind']> = {
  1: 'text',
  2: 'method',
  3: 'function',
  4: 'constructor',
  5: 'field',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'module',
  10: 'property',
  13: 'enum',
  14: 'keyword',
  20: 'constant',
  21: 'constant'
}

function kindName(kind: number | undefined): CompletionItem['kind'] {
  return (kind !== undefined ? KINDS[kind] : undefined) ?? 'text'
}

function markup(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => markup(v) ?? '').filter(Boolean).join('\n\n') || null
  if (typeof value === 'object' && value && 'value' in value) return String((value as { value: unknown }).value)
  return null
}
