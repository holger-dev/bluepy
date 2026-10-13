/**
 * Project management: the project folder, `package.bluepy`, file access,
 * change watching and the static analysis (run as a stateless Python
 * subprocess so it works while the backend executes user code).
 */
import { execFile } from 'node:child_process'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { ClassLayout, CompileResult, ProjectFile, ProjectInfo, ProjectModel } from '@bluepy/protocol'

export const PACKAGE_FILE = 'package.bluepy'
const IGNORED_DIRS = new Set(['__pycache__', '.git', '.venv', 'venv', 'node_modules', '.bluepy', '.idea', '.vscode'])
const ANALYZE_TIMEOUT_MS = 20_000

interface PackageFile {
  version: number
  name: string
  layout: Record<string, ClassLayout>
}

export function moduleNameFor(rel: string): string {
  const parts = rel.replace(/\\/g, '/').replace(/\.py$/, '').split('/')
  if (parts[parts.length - 1] === '__init__') parts.pop()
  return parts.join('.')
}

export async function listPythonFiles(root: string): Promise<ProjectFile[]> {
  const found: ProjectFile[] = []
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(path.join(dir, entry.name), prefix + entry.name + '/')
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        const rel = prefix + entry.name
        found.push({ path: rel, name: entry.name, module: moduleNameFor(rel) })
      }
    }
  }
  await walk(root, '')
  return found
}

export function isSafeRelativePath(rel: string): boolean {
  if (!rel || path.isAbsolute(rel)) return false
  const normalized = path.posix.normalize(rel.replace(/\\/g, '/'))
  return !normalized.startsWith('../') && normalized !== '..' && !normalized.includes('\0')
}

export interface ProjectEvents {
  changed(project: ProjectInfo): void
  fileChanged(file: string): void
}

export class ProjectManager {
  current: ProjectInfo | null = null
  private watcher: FSWatcher | null = null
  private analyzeTimer: NodeJS.Timeout | null = null
  private analyzing: Promise<void> | null = null
  private analyzeAgain = false

  constructor(
    private readonly events: ProjectEvents,
    private readonly pythonPath: () => string | null,
    private readonly analyzerScript: () => string
  ) {}

  // -------------------------------------------------------------- open/close

  static async isProject(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, PACKAGE_FILE))
      return true
    } catch {
      return false
    }
  }

  async create(dir: string): Promise<ProjectInfo> {
    await fs.mkdir(dir, { recursive: true })
    const pkg: PackageFile = { version: 1, name: path.basename(dir), layout: {} }
    await fs.writeFile(path.join(dir, PACKAGE_FILE), JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
    return this.open(dir)
  }

  async open(dir: string): Promise<ProjectInfo> {
    await this.close()
    const pkg = await this.readPackage(dir)
    if (!pkg) {
      // "Open Non-BlueJ": any folder with Python files becomes a project.
      await fs.writeFile(
        path.join(dir, PACKAGE_FILE),
        JSON.stringify({ version: 1, name: path.basename(dir), layout: {} }, null, 2) + '\n',
        'utf-8'
      )
    }
    const meta = pkg ?? { version: 1, name: path.basename(dir), layout: {} }
    this.current = {
      dir,
      name: meta.name || path.basename(dir),
      files: await listPythonFiles(dir),
      model: null,
      modelError: null,
      layout: meta.layout ?? {},
      compile: {}
    }
    this.startWatching(dir)
    this.events.changed(this.current)
    await this.analyze()
    return this.current
  }

  async close(): Promise<void> {
    this.watcher?.close()
    this.watcher = null
    if (this.analyzeTimer) clearTimeout(this.analyzeTimer)
    this.analyzeTimer = null
    this.current = null
  }

  private async readPackage(dir: string): Promise<PackageFile | null> {
    try {
      const raw = await fs.readFile(path.join(dir, PACKAGE_FILE), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<PackageFile>
      return { version: parsed.version ?? 1, name: parsed.name ?? path.basename(dir), layout: parsed.layout ?? {} }
    } catch {
      return null
    }
  }

  private async writePackage(): Promise<void> {
    if (!this.current) return
    const pkg: PackageFile = { version: 1, name: this.current.name, layout: this.current.layout }
    await fs.writeFile(path.join(this.current.dir, PACKAGE_FILE), JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }

  // ------------------------------------------------------------------ files

  require(): ProjectInfo {
    if (!this.current) throw new Error('no project open')
    return this.current
  }

  resolve(rel: string): string {
    if (!isSafeRelativePath(rel)) throw new Error(`invalid path: ${rel}`)
    return path.join(this.require().dir, rel)
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolve(rel), 'utf-8')
  }

  async writeFile(rel: string, content: string): Promise<void> {
    await fs.writeFile(this.resolve(rel), content, 'utf-8')
    this.scheduleAnalyze()
  }

  async createFile(rel: string, content: string): Promise<ProjectInfo> {
    const abs = this.resolve(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, { encoding: 'utf-8', flag: 'wx' })
    await this.refreshFiles()
    await this.analyze()
    return this.require()
  }

  async refreshFiles(): Promise<void> {
    if (!this.current) return
    this.current.files = await listPythonFiles(this.current.dir)
    this.events.changed(this.current)
  }

  async saveLayout(layout: Record<string, ClassLayout>): Promise<void> {
    if (!this.current) return
    this.current.layout = { ...this.current.layout, ...layout }
    await this.writePackage()
    this.events.changed(this.current)
  }

  setCompileResults(results: CompileResult[]): void {
    if (!this.current) return
    for (const r of results) this.current.compile[r.file] = r
    this.events.changed(this.current)
  }

  clearCompileResults(): void {
    if (!this.current) return
    this.current.compile = {}
    this.events.changed(this.current)
  }

  // --------------------------------------------------------------- watching

  private startWatching(dir: string): void {
    try {
      this.watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        const rel = String(filename).replace(/\\/g, '/')
        if (rel.split('/').some((part) => IGNORED_DIRS.has(part))) return
        if (rel.endsWith('.py')) {
          this.events.fileChanged(rel)
          void this.refreshFiles().then(() => this.scheduleAnalyze())
        }
      })
      this.watcher.on('error', () => {
        this.watcher = null
      })
    } catch {
      this.watcher = null // recursive watching unsupported: analysis still runs on save/compile
    }
  }

  // --------------------------------------------------------------- analysis

  scheduleAnalyze(): void {
    if (this.analyzeTimer) clearTimeout(this.analyzeTimer)
    this.analyzeTimer = setTimeout(() => {
      this.analyzeTimer = null
      void this.analyze()
    }, 300)
  }

  async analyze(): Promise<void> {
    if (!this.current) return
    if (this.analyzing) {
      this.analyzeAgain = true
      return this.analyzing
    }
    this.analyzing = this.runAnalyzer().finally(() => {
      this.analyzing = null
      if (this.analyzeAgain) {
        this.analyzeAgain = false
        void this.analyze()
      }
    })
    return this.analyzing
  }

  private async runAnalyzer(): Promise<void> {
    const project = this.current
    if (!project) return
    const python = this.pythonPath()
    if (!python) {
      project.model = null
      project.modelError = 'no-python'
      this.events.changed(project)
      return
    }
    const result = await new Promise<{ stdout: string; stderr: string; error: Error | null }>((resolve) => {
      execFile(
        python,
        ['-B', '-X', 'utf8', this.analyzerScript(), project.dir],
        { timeout: ANALYZE_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
        (error, stdout, stderr) => resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error })
      )
    })
    if (this.current !== project) return // project closed meanwhile
    if (result.error) {
      project.modelError = result.stderr.trim().split('\n').slice(-1)[0] || result.error.message
      this.events.changed(project)
      return
    }
    try {
      project.model = JSON.parse(result.stdout) as ProjectModel
      project.modelError = null
      // Give new classes a position so they do not pile up at the origin.
      this.placeNewClasses(project)
    } catch (error) {
      project.modelError = `analyzer output unreadable: ${String(error)}`
    }
    this.events.changed(project)
  }

  private placeNewClasses(project: ProjectInfo): void {
    if (!project.model) return
    const placed = project.layout
    let index = Object.keys(placed).length
    let changed = false
    for (const cls of project.model.classes) {
      if (placed[cls.id]) continue
      placed[cls.id] = { x: 40 + (index % 4) * 200, y: 40 + Math.floor(index / 4) * 140 }
      index += 1
      changed = true
    }
    if (changed) void this.writePackage()
  }
}
