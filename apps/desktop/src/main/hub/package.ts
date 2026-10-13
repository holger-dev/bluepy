/**
 * `.bluepy` packages: a project folder as a ZIP with `aufgabe.json` (task
 * metadata) and `AUFGABE.md` (the description shown to learners).  Used for
 * the hub and for plain export/import.
 */
import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import type { TaskMeta } from '@bluepy/protocol'
import { createZip, readZip, type ZipEntry } from './zip'

export const TASK_META_FILE = 'aufgabe.json'
export const TASK_TEXT_FILE = 'AUFGABE.md'
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024

const SKIP_DIRS = new Set(['__pycache__', '.git', '.venv', 'venv', 'node_modules', '.idea', '.vscode', '.bluepy', '.pytest_cache', '.mypy_cache'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'korrektur.json'])

export interface PackOptions {
  /** Relative paths (forward slashes) to leave out, e.g. a sample solution. */
  exclude?: readonly string[]
  meta?: TaskMeta | null
  /** Markdown shown to learners; written as AUFGABE.md. */
  description?: string | null
}

export async function collectFiles(root: string): Promise<{ rel: string; abs: string; size: number }[]> {
  const out: { rel: string; abs: string; size: number }[] = []
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(path.join(dir, entry.name), prefix + entry.name + '/')
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name) || entry.name.endsWith('.pyc')) continue
        const abs = path.join(dir, entry.name)
        const stat = await fs.stat(abs)
        if (stat.size > MAX_FILE_BYTES) continue
        out.push({ rel: prefix + entry.name, abs, size: stat.size })
      }
    }
  }
  await walk(root, '')
  return out
}

/** Pack a project folder; metadata and description replace any copies inside the folder. */
export async function packProject(root: string, options: PackOptions = {}): Promise<Buffer> {
  const exclude = new Set((options.exclude ?? []).map((p) => p.replace(/\\/g, '/')))
  const entries: ZipEntry[] = []
  let total = 0
  for (const file of await collectFiles(root)) {
    if (exclude.has(file.rel)) continue
    if (file.rel === TASK_META_FILE && options.meta) continue
    if (file.rel === TASK_TEXT_FILE && options.description != null) continue
    const data = await fs.readFile(file.abs)
    total += data.length
    if (total > MAX_PACKAGE_BYTES) throw new Error('Das Projekt ist größer als 20 MB – bitte große Dateien entfernen.')
    entries.push({ name: file.rel, data })
  }
  if (options.meta) entries.push({ name: TASK_META_FILE, data: Buffer.from(JSON.stringify(options.meta, null, 2) + '\n', 'utf-8') })
  if (options.description != null) entries.push({ name: TASK_TEXT_FILE, data: Buffer.from(options.description.replace(/\r\n/g, '\n'), 'utf-8') })
  return createZip(entries)
}

function safeRelative(name: string): string | null {
  const normalized = path.posix.normalize(name.replace(/\\/g, '/'))
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('../') || normalized === '..' || normalized.includes('\0')) return null
  if (normalized.split('/').some((part) => part === '..' || part === '')) return null
  return normalized
}

/** Unpack into `root` (created if needed). Existing files are overwritten; returns the metadata if present. */
export async function unpackProject(archive: Buffer, root: string): Promise<{ meta: TaskMeta | null; files: string[] }> {
  const entries = readZip(archive)
  await fs.mkdir(root, { recursive: true })
  const files: string[] = []
  let meta: TaskMeta | null = null
  for (const entry of entries) {
    const rel = safeRelative(entry.name)
    if (!rel) continue
    const target = path.join(root, ...rel.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, entry.data)
    files.push(rel)
    if (rel === TASK_META_FILE) {
      try {
        meta = JSON.parse(entry.data.toString('utf-8')) as TaskMeta
      } catch {
        meta = null
      }
    }
  }
  return { meta, files }
}

export async function readTaskMeta(root: string): Promise<TaskMeta | null> {
  try {
    const raw = await fs.readFile(path.join(root, TASK_META_FILE), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<TaskMeta>
    if (typeof parsed.code !== 'string' || typeof parsed.title !== 'string') return null
    return {
      format: 1,
      code: parsed.code,
      title: parsed.title,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      teacher: typeof parsed.teacher === 'string' ? parsed.teacher : null,
      hubUrl: typeof parsed.hubUrl === 'string' ? parsed.hubUrl : null,
      submitFrom: typeof parsed.submitFrom === 'string' ? parsed.submitFrom : null,
      submitUntil: typeof parsed.submitUntil === 'string' ? parsed.submitUntil : null,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      tests: parsed.tests !== false
    }
  } catch {
    return null
  }
}

export async function writeTaskMeta(root: string, meta: TaskMeta): Promise<void> {
  await fs.writeFile(path.join(root, TASK_META_FILE), JSON.stringify(meta, null, 2) + '\n', 'utf-8')
}

/** A folder name that is safe on every OS: "KONTO-7H3K Konto und Sparkonto". */
export function folderNameFor(code: string, title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  return cleaned ? `${code} ${cleaned}` : code
}
