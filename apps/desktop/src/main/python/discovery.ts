/**
 * Finds Python interpreters on this machine and picks the one BluePy uses.
 *
 * Pure helpers (parsing, ranking) are exported for unit tests; everything that
 * touches the file system or spawns processes goes through the `Host`
 * interface so tests can fake it.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import nodePath from 'node:path'
import {
  MINIMUM_PYTHON,
  meetsMinimum,
  type InterpreterSource,
  type PythonDiscoveryResult,
  type PythonInterpreter
} from '@bluepy/protocol'
import { PROBE_SCRIPT, parseProbeOutput } from './probe'

export interface Candidate {
  path: string
  source: InterpreterSource
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
}

export interface Host {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  exists(p: string): Promise<boolean>
  readdir(dir: string): Promise<string[]>
  realpath(p: string): Promise<string>
  exec(file: string, args: string[], timeoutMs: number): Promise<ExecResult>
}

export const PROBE_TIMEOUT_MS = 15_000

/** Path flavour of the *target* platform, so tests can simulate Windows on Linux. */
function pathFor(host: Host): typeof nodePath.posix {
  return host.platform === 'win32' ? nodePath.win32 : nodePath.posix
}

// ------------------------------------------------------------------ host

export function nodeHost(): Host {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    async exists(p) {
      try {
        await fs.access(p)
        return true
      } catch {
        return false
      }
    },
    async readdir(dir) {
      try {
        return await fs.readdir(dir)
      } catch {
        return []
      }
    },
    async realpath(p) {
      try {
        return await fs.realpath(p)
      } catch {
        return p
      }
    },
    exec(file, args, timeoutMs) {
      return new Promise((resolve) => {
        execFile(
          file,
          args,
          {
            timeout: timeoutMs,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
          },
          (error, stdout, stderr) => {
            const err = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
            resolve({
              stdout: String(stdout ?? ''),
              stderr: String(stderr ?? ''),
              code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
              timedOut: Boolean(err?.killed)
            })
          }
        )
      })
    }
  }
}

// -------------------------------------------------------------- parsing

/**
 * Parse the output of the Windows launcher `py -0p` / `py --list-paths`.
 * Formats seen in the wild:
 *   ` -V:3.13 *        C:\Users\x\AppData\Local\Programs\Python\Python313\python.exe`
 *   ` -3.11-64         C:\Python311\python.exe`
 */
export function parsePyListPaths(output: string): string[] {
  const paths: string[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('-')) continue
    const match = /([A-Za-z]:\\.*?\.exe)\s*$/i.exec(line)
    if (match?.[1]) paths.push(match[1])
  }
  return paths
}

/** Microsoft Store aliases: zero-byte stubs that open the Store when executed. */
export function isWindowsStoreAlias(p: string): boolean {
  return /\\Microsoft\\WindowsApps\\python\w*\.exe$/i.test(p)
}

/** The Xcode Command Line Tools stub at /usr/bin/python3 pops up an install dialog. */
export async function macSystemPythonIsStub(host: Host): Promise<boolean> {
  if (host.platform !== 'darwin') return false
  return !(await host.exists('/Library/Developer/CommandLineTools/usr/bin/python3'))
}

// ----------------------------------------------------------- candidates

async function pathCandidates(host: Host, names: string[]): Promise<Candidate[]> {
  const path = pathFor(host)
  const entries = (host.env.PATH ?? host.env.Path ?? '').split(path.delimiter).filter(Boolean)
  const found: Candidate[] = []
  for (const dir of entries) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (host.platform === 'win32' && isWindowsStoreAlias(candidate)) continue
      if (await host.exists(candidate)) found.push({ path: candidate, source: 'path' })
    }
  }
  return found
}

async function globChildren(host: Host, parent: string, prefix: string, suffix: string): Promise<string[]> {
  const path = pathFor(host)
  const names = await host.readdir(parent)
  return names
    .filter((n) => n.startsWith(prefix))
    .sort()
    .reverse()
    .map((n) => path.join(parent, n, suffix))
}

export async function listCandidates(host: Host): Promise<Candidate[]> {
  const path = pathFor(host)
  const candidates: Candidate[] = []
  const push = (p: string, source: InterpreterSource): void => {
    candidates.push({ path: p, source })
  }

  if (host.platform === 'win32') {
    const launcher = await host.exec('py', ['-0p'], 10_000)
    if (launcher.code === 0) {
      for (const p of parsePyListPaths(launcher.stdout)) {
        push(p, isWindowsStoreAlias(p) ? 'microsoft-store' : 'py-launcher')
      }
    }
    candidates.push(...(await pathCandidates(host, ['python.exe', 'python3.exe'])))
    const roots = [
      host.env.LOCALAPPDATA ? path.join(host.env.LOCALAPPDATA, 'Programs', 'Python') : '',
      host.env.ProgramFiles ?? 'C:\\Program Files',
      host.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'C:\\'
    ].filter(Boolean)
    for (const root of roots) {
      for (const p of await globChildren(host, root, 'Python3', 'python.exe')) push(p, 'python.org')
    }
  } else if (host.platform === 'darwin') {
    const stub = await macSystemPythonIsStub(host)
    for (const c of await pathCandidates(host, ['python3', 'python'])) {
      if (stub && c.path.startsWith('/usr/bin/python')) continue
      candidates.push(c)
    }
    const frameworks = '/Library/Frameworks/Python.framework/Versions'
    for (const p of await globChildren(host, frameworks, '3.', path.join('bin', 'python3'))) push(p, 'python.org')
    for (const brew of ['/opt/homebrew/bin', '/usr/local/bin']) {
      for (const name of (await host.readdir(brew)).filter((n) => /^python3(\.\d+)?$/.test(n))) {
        push(path.join(brew, name), 'homebrew')
      }
    }
    for (const p of await globChildren(host, path.join(host.home, '.pyenv', 'versions'), '3.', path.join('bin', 'python3'))) {
      push(p, 'pyenv')
    }
    if (!stub) push('/usr/bin/python3', 'system')
  } else {
    candidates.push(...(await pathCandidates(host, ['python3', 'python'])))
    for (const name of (await host.readdir('/usr/bin')).filter((n) => /^python3\.\d+$/.test(n))) {
      push(path.join('/usr/bin', name), 'system')
    }
    for (const p of await globChildren(host, path.join(host.home, '.pyenv', 'versions'), '3.', path.join('bin', 'python3'))) {
      push(p, 'pyenv')
    }
  }
  return candidates
}

// ---------------------------------------------------------------- probe

export async function probeInterpreter(host: Host, candidate: Candidate): Promise<PythonInterpreter> {
  const result = await host.exec(candidate.path, ['-E', '-s', '-c', PROBE_SCRIPT], PROBE_TIMEOUT_MS)
  const base: PythonInterpreter = { path: candidate.path, source: candidate.source, ok: false }
  if (result.timedOut) return { ...base, problem: { key: 'timeout' } }
  const info = parseProbeOutput(result.stdout)
  if (!info) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-1)[0] ?? ''
    return { ...base, problem: { key: 'probe-failed', detail } }
  }
  const probed: PythonInterpreter = {
    ...base,
    version: info.version,
    versionInfo: info.versionInfo,
    implementation: info.implementation,
    prefix: info.prefix,
    isVenv: info.isVenv,
    hasTkinter: info.hasTkinter,
    hasVenv: info.hasVenv,
    hasPip: info.hasPip,
    machine: info.machine
  }
  if (info.implementation !== 'CPython') return { ...probed, problem: { key: 'not-cpython', detail: info.implementation } }
  if (!meetsMinimum(info.versionInfo)) return { ...probed, problem: { key: 'too-old', detail: info.version } }
  return { ...probed, ok: true }
}

// -------------------------------------------------------------- ranking

const SOURCE_PRIORITY: InterpreterSource[] = [
  'configured',
  'venv',
  'python.org',
  'homebrew',
  'py-launcher',
  'microsoft-store',
  'path',
  'pyenv',
  'system',
  'unknown'
]

export function rankInterpreters(list: PythonInterpreter[]): PythonInterpreter[] {
  return [...list].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1
    const va = a.versionInfo ?? [0, 0, 0]
    const vb = b.versionInfo ?? [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      if (va[i] !== vb[i]) return (vb[i] ?? 0) - (va[i] ?? 0)
    }
    return SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source)
  })
}

export function chooseInterpreter(
  list: PythonInterpreter[],
  configuredPath: string | null
): PythonInterpreter | null {
  if (configuredPath) {
    const configured = list.find((i) => i.path === configuredPath && i.ok)
    if (configured) return { ...configured, source: 'configured' }
  }
  return rankInterpreters(list).find((i) => i.ok) ?? null
}

// ----------------------------------------------------------- discovery

async function dedupe(host: Host, candidates: Candidate[]): Promise<Candidate[]> {
  const seen = new Set<string>()
  const unique: Candidate[] = []
  for (const c of candidates) {
    const key = (await host.realpath(c.path)).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }
  return unique
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

export async function discoverPython(host: Host, configuredPath: string | null): Promise<PythonDiscoveryResult> {
  const candidates = await listCandidates(host)
  if (configuredPath) candidates.unshift({ path: configuredPath, source: 'configured' })
  const unique = await dedupe(host, candidates)
  const interpreters = await mapLimit(unique, 4, (c) => probeInterpreter(host, c))
  return {
    interpreters: rankInterpreters(interpreters),
    selected: chooseInterpreter(interpreters, configuredPath),
    minimumVersion: `${MINIMUM_PYTHON[0]}.${MINIMUM_PYTHON[1]}`,
    platform: host.platform
  }
}
