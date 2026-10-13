/** Interpreter discovery results (Electron main -> renderer). */

export const MINIMUM_PYTHON: readonly [number, number] = [3, 11]

export type InterpreterSource =
  | 'configured' // chosen manually in preferences
  | 'py-launcher' // Windows `py --list-paths`
  | 'path' // found on PATH
  | 'python.org' // standard installer locations
  | 'homebrew'
  | 'microsoft-store'
  | 'pyenv'
  | 'system'
  | 'venv'
  | 'unknown'

export interface PythonInterpreter {
  path: string
  source: InterpreterSource
  /** Set when the probe ran successfully. */
  version?: string
  versionInfo?: [number, number, number]
  implementation?: string
  prefix?: string
  isVenv?: boolean
  hasTkinter?: boolean
  hasVenv?: boolean
  hasPip?: boolean
  machine?: string
  /** True when usable for BluePy (probe ok and version >= MINIMUM_PYTHON). */
  ok: boolean
  /** Why the interpreter is not usable (i18n key + optional detail). */
  problem?: { key: 'too-old' | 'probe-failed' | 'not-cpython' | 'timeout'; detail?: string }
}

export interface PythonDiscoveryResult {
  interpreters: PythonInterpreter[]
  /** The interpreter BluePy will use, or null when none is usable. */
  selected: PythonInterpreter | null
  minimumVersion: string
  /** process.platform of the main process – selects the setup instructions. */
  platform: string
}

export function compareVersion(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function meetsMinimum(versionInfo: readonly number[]): boolean {
  return compareVersion(versionInfo, MINIMUM_PYTHON) >= 0
}
