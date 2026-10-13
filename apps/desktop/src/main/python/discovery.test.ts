import { describe, expect, it } from 'vitest'
import type { PythonInterpreter } from '@bluepy/protocol'
import {
  chooseInterpreter,
  discoverPython,
  isWindowsStoreAlias,
  parsePyListPaths,
  rankInterpreters,
  type Host
} from './discovery'
import { PROBE_MARKER, parseProbeOutput } from './probe'

const probeLine = (version: string, executable: string, extra = ''): string =>
  `${PROBE_MARKER}{"version":"${version}","versionInfo":[${version.split('.').join(',')}],"executable":${JSON.stringify(executable)},"implementation":"CPython","prefix":"/p","isVenv":false,"machine":"arm64","hasTkinter":true,"hasVenv":true,"hasPip":true${extra}}\n`

describe('parsePyListPaths', () => {
  it('reads both launcher formats', () => {
    const out = [
      'Installed Pythons found by py Launcher for Windows',
      ' -V:3.13 *        C:\\Users\\x\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      ' -V:3.11          C:\\Program Files\\Python311\\python.exe',
      ' -3.9-64          C:\\Python39\\python.exe',
      ''
    ].join('\r\n')
    expect(parsePyListPaths(out)).toEqual([
      'C:\\Users\\x\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      'C:\\Program Files\\Python311\\python.exe',
      'C:\\Python39\\python.exe'
    ])
  })
})

describe('isWindowsStoreAlias', () => {
  it('detects the Store stubs', () => {
    expect(isWindowsStoreAlias('C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe')).toBe(true)
    expect(isWindowsStoreAlias('C:\\Python311\\python.exe')).toBe(false)
  })
})

describe('parseProbeOutput', () => {
  it('finds the JSON after noise', () => {
    const info = parseProbeOutput('some banner\n' + probeLine('3.13.2', '/usr/local/bin/python3'))
    expect(info?.versionInfo).toEqual([3, 13, 2])
    expect(info?.hasTkinter).toBe(true)
  })
  it('returns null without marker', () => {
    expect(parseProbeOutput('Python 3.13.2')).toBeNull()
  })
})

describe('ranking and choice', () => {
  const list: PythonInterpreter[] = [
    { path: '/old', source: 'system', ok: false, versionInfo: [3, 9, 1], problem: { key: 'too-old' } },
    { path: '/brew', source: 'homebrew', ok: true, versionInfo: [3, 12, 4] },
    { path: '/org', source: 'python.org', ok: true, versionInfo: [3, 13, 2] },
    { path: '/path', source: 'path', ok: true, versionInfo: [3, 13, 2] }
  ]
  it('prefers the highest usable version, then the source', () => {
    expect(rankInterpreters(list).map((i) => i.path)).toEqual(['/org', '/path', '/brew', '/old'])
    expect(chooseInterpreter(list, null)?.path).toBe('/org')
  })
  it('honours a configured path when it is usable', () => {
    expect(chooseInterpreter(list, '/brew')?.source).toBe('configured')
    expect(chooseInterpreter(list, '/old')?.path).toBe('/org')
  })
})

function fakeHost(platform: NodeJS.Platform, files: Record<string, string>): Host {
  return {
    platform,
    env: { PATH: platform === 'win32' ? 'C:\\Python311;C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps' : '/opt/homebrew/bin:/usr/bin' },
    home: '/Users/x',
    exists: async (p) => p in files,
    readdir: async (dir) =>
      Object.keys(files)
        .filter((f) => f.startsWith(dir + (platform === 'win32' ? '\\' : '/')))
        .map((f) => f.slice(dir.length + 1).split(/[\\/]/)[0] ?? '')
        .filter((n, i, arr) => n && arr.indexOf(n) === i),
    realpath: async (p) => p,
    exec: async (file, args) => {
      if (file === 'py') return { stdout: ' -V:3.11 *  C:\\Python311\\python.exe\n', stderr: '', code: 0, timedOut: false }
      const version = files[file]
      if (!version) return { stdout: '', stderr: 'not found', code: 1, timedOut: false }
      expect(args[0]).toBe('-E')
      return { stdout: probeLine(version, file), stderr: '', code: 0, timedOut: false }
    }
  }
}

describe('discoverPython', () => {
  it('skips the macOS CLT stub and prefers python.org', async () => {
    const host = fakeHost('darwin', {
      '/usr/bin/python3': '3.9.6',
      '/opt/homebrew/bin/python3': '3.12.4',
      '/opt/homebrew/bin/python3.12': '3.12.4',
      '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3': '3.13.2'
    })
    const result = await discoverPython(host, null)
    expect(result.selected?.path).toBe('/Library/Frameworks/Python.framework/Versions/3.13/bin/python3')
    expect(result.interpreters.some((i) => i.path === '/usr/bin/python3')).toBe(false)
    expect(result.minimumVersion).toBe('3.11')
  })

  it('reports an old Python as too old instead of hiding it', async () => {
    const host = fakeHost('linux', { '/usr/bin/python3': '3.8.10' })
    const result = await discoverPython(host, null)
    expect(result.selected).toBeNull()
    expect(result.interpreters[0]?.problem?.key).toBe('too-old')
  })

  it('uses the Windows launcher and ignores Store aliases on PATH', async () => {
    const host = fakeHost('win32', {
      'C:\\Python311\\python.exe': '3.11.9',
      'C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe': '3.12.0'
    })
    const result = await discoverPython(host, null)
    expect(result.selected?.path).toBe('C:\\Python311\\python.exe')
    expect(result.interpreters.every((i) => !isWindowsStoreAlias(i.path))).toBe(true)
  })
})
