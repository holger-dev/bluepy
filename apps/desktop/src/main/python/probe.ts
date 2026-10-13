/**
 * Script run with `python -E -s -c PROBE_SCRIPT` to identify an interpreter.
 * Deliberately written in Python-2-compatible syntax so that an ancient
 * interpreter still reports its version (and gets a "too old" message instead
 * of a SyntaxError).
 */
export const PROBE_MARKER = 'BLUEPY_PROBE '

export const PROBE_SCRIPT = [
  'import sys, json, platform',
  'def has(name):',
  '    try:',
  '        __import__(name)',
  '        return True',
  '    except Exception:',
  '        return False',
  'info = {',
  '  "version": "%d.%d.%d" % tuple(sys.version_info[:3]),',
  '  "versionInfo": list(sys.version_info[:3]),',
  '  "executable": sys.executable,',
  '  "implementation": platform.python_implementation(),',
  '  "prefix": sys.prefix,',
  '  "isVenv": getattr(sys, "base_prefix", sys.prefix) != sys.prefix or hasattr(sys, "real_prefix"),',
  '  "machine": platform.machine(),',
  '  "hasTkinter": has("tkinter"),',
  '  "hasVenv": has("venv"),',
  '  "hasPip": has("pip"),',
  '}',
  'sys.stdout.write("' + PROBE_MARKER + '" + json.dumps(info) + "\\n")'
].join('\n')

export interface ProbeInfo {
  version: string
  versionInfo: [number, number, number]
  executable: string
  implementation: string
  prefix: string
  isVenv: boolean
  machine: string
  hasTkinter: boolean
  hasVenv: boolean
  hasPip: boolean
}

/** Extract the probe JSON from stdout (which may carry other noise). */
export function parseProbeOutput(stdout: string): ProbeInfo | null {
  const start = stdout.lastIndexOf(PROBE_MARKER)
  if (start < 0) return null
  const rest = stdout.slice(start + PROBE_MARKER.length)
  const end = rest.indexOf('\n')
  const json = end < 0 ? rest : rest.slice(0, end)
  try {
    const parsed = JSON.parse(json) as Partial<ProbeInfo>
    if (!Array.isArray(parsed.versionInfo) || parsed.versionInfo.length < 3) return null
    const [a, b, c] = parsed.versionInfo
    return {
      version: String(parsed.version ?? `${a}.${b}.${c}`),
      versionInfo: [Number(a), Number(b), Number(c)],
      executable: String(parsed.executable ?? ''),
      implementation: String(parsed.implementation ?? 'unknown'),
      prefix: String(parsed.prefix ?? ''),
      isVenv: Boolean(parsed.isVenv),
      machine: String(parsed.machine ?? ''),
      hasTkinter: Boolean(parsed.hasTkinter),
      hasVenv: Boolean(parsed.hasVenv),
      hasPip: Boolean(parsed.hasPip)
    }
  } catch {
    return null
  }
}
