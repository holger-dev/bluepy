/**
 * Assignments without accounts (docs/04-aufgaben-hub.md), main-process side:
 * settings (hub URL, teacher key in the OS keychain, personal code), fetching
 * and submitting tasks, publishing, collecting submissions into review mode,
 * and plain .bluepy export/import.
 */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, safeStorage } from 'electron'
import type { AssignmentState, HubClass, HubSettings, ProjectInfo, ReviewState, ReviewStudent, ReviewTestSummary, TaskInfo, TaskMeta } from '@bluepy/protocol'
import { loadSettings, saveSettings, type Settings } from '../settings'
import type { AppState } from '../state'
import { HubClient, HubRequestError } from './client'
import { folderNameFor, packProject, readTaskMeta, unpackProject, writeTaskMeta } from './package'
import { readZip } from './zip'

export interface HubHost {
  state: AppState
  openProject(dir: string): Promise<ProjectInfo>
  currentProjectDir(): string | null
  /** Save unsaved editor buffers before packing. */
  flushEditors(): Promise<void>
  pythonPath(): string | null
  backendDir(): string
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hashesOf(archive: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readZip(archive)) out[entry.name] = sha256(entry.data)
  return out
}

const REVIEW_FILE = 'korrektur.json'

function documents(sub: string): string {
  return path.join(app.getPath('documents'), 'BluePy', sub)
}

function encrypt(value: string): string {
  return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(value).toString('base64') : 'plain:' + value
}

function decrypt(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    } catch {
      return null
    }
  }
  if (stored.startsWith('plain:')) return stored.slice(6)
  return stored
}

export class HubManager {
  constructor(private readonly host: HubHost) {}

  private get state(): AppState {
    return this.host.state
  }

  // --------------------------------------------------------------- settings

  async loadSettings(): Promise<HubSettings> {
    const settings = await loadSettings()
    const hub: HubSettings = {
      url: settings.hubUrl ?? '',
      hasTeacherKey: Boolean(decrypt(settings.hubTeacherKey)),
      teacherName: settings.hubTeacherName ?? null,
      hasPersonalCode: Boolean(decrypt(settings.hubPersonalCode))
    }
    this.state.setHub(hub)
    return hub
  }

  async saveSettings(patch: { url?: string; teacherKey?: string; personalCode?: string }): Promise<HubSettings> {
    const settings = await loadSettings()
    const next: Settings = { ...settings }
    if (patch.url !== undefined) next.hubUrl = patch.url.trim().replace(/\/+$/, '')
    if (patch.teacherKey !== undefined) {
      next.hubTeacherKey = patch.teacherKey.trim() ? encrypt(patch.teacherKey.trim()) : null
      next.hubTeacherName = null
    }
    if (patch.personalCode !== undefined) next.hubPersonalCode = patch.personalCode.trim() ? encrypt(patch.personalCode.trim().toUpperCase()) : null
    if (!next.deviceId) next.deviceId = randomUUID()
    await saveSettings(next)
    // verify the key once so the UI can show the teacher's name
    const key = decrypt(next.hubTeacherKey)
    if (key && next.hubUrl) {
      try {
        const me = await new HubClient({ url: next.hubUrl, teacherKey: key }).me()
        await saveSettings({ ...next, hubTeacherName: me.name })
      } catch {
        /* shown as "unverified" – name stays empty */
      }
    }
    return this.loadSettings()
  }

  private async client(teacher = false): Promise<HubClient> {
    const settings = await loadSettings()
    const key = teacher ? decrypt(settings.hubTeacherKey) : null
    if (!settings.hubUrl) throw new Error('Keine Hub-URL eingestellt (Aufgaben ▸ Hub-Einstellungen…)')
    if (teacher && !key) throw new Error('Kein Lehrer-Schlüssel eingestellt (Aufgaben ▸ Hub-Einstellungen…)')
    return new HubClient({ url: settings.hubUrl, teacherKey: key })
  }

  private async deviceId(): Promise<string> {
    const settings = await loadSettings()
    if (settings.deviceId) return settings.deviceId
    const id = randomUUID()
    await saveSettings({ ...settings, deviceId: id })
    return id
  }

  // -------------------------------------------------------------- assignment

  /** Called whenever a project opens: is it an assignment? */
  async refreshAssignment(dir: string | null): Promise<void> {
    if (!dir) {
      this.state.setAssignment(null)
      return
    }
    const meta = await readTaskMeta(dir)
    if (!meta) {
      this.state.setAssignment(null)
      return
    }
    const settings = await loadSettings()
    this.state.setAssignment({ meta, dir, lastSubmittedAt: settings.lastSubmissions?.[meta.code] ?? null })
  }

  async fetchTask(rawCode: string): Promise<AssignmentState> {
    const code = rawCode.trim().toUpperCase()
    if (!code) throw new Error('Aufgabencode fehlt')
    const client = await this.client(false)
    const task = await client.fetchTask(code)
    const dir = path.join(documents('Aufgaben'), folderNameFor(task.code, task.title))
    const archive = Buffer.from(task.package, 'base64')
    await unpackProject(archive, dir)
    const meta: TaskMeta = {
      format: 1,
      code: task.code,
      title: task.title,
      description: task.description,
      hubUrl: client.base,
      submitFrom: task.submitFrom,
      submitUntil: task.submitUntil,
      version: task.version,
      tests: task.tests,
      originalHashes: hashesOf(archive)
    }
    await writeTaskMeta(dir, meta)
    await this.ensurePackageFile(dir, task.title)
    await this.host.openProject(dir)
    await this.refreshAssignment(dir)
    return this.state.assignment as AssignmentState
  }

  /** Newer version on the hub: replace files the learner left untouched, keep the rest. */
  async updateTask(): Promise<{ version: number; updated: string[]; skipped: string[]; upToDate: boolean }> {
    const assignment = this.state.assignment
    if (!assignment) throw new Error('Das offene Projekt ist keine Aufgabe vom Hub.')
    const settings = await loadSettings()
    const url = assignment.meta.hubUrl || settings.hubUrl
    if (!url) throw new Error('Keine Hub-URL bekannt')
    const client = new HubClient({ url })
    const info = await client.taskInfo(assignment.meta.code)
    if (info.version <= assignment.meta.version) return { version: info.version, updated: [], skipped: [], upToDate: true }
    await this.host.flushEditors()
    const task = await client.fetchTask(assignment.meta.code)
    const archive = Buffer.from(task.package, 'base64')
    const original = assignment.meta.originalHashes ?? {}
    const updated: string[] = []
    const skipped: string[] = []
    for (const entry of readZip(archive)) {
      if (entry.name === 'package.bluepy') continue // layout is the learner's
      const target = path.join(assignment.dir, ...entry.name.split('/'))
      let current: Buffer | null = null
      try {
        current = await fs.readFile(target)
      } catch {
        current = null
      }
      const unchanged = current === null || (original[entry.name] !== undefined && sha256(current) === original[entry.name])
      if (!unchanged && current !== null && sha256(current) === sha256(entry.data)) continue // already identical
      if (unchanged) {
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, entry.data)
        updated.push(entry.name)
      } else skipped.push(entry.name)
    }
    const meta: TaskMeta = {
      ...assignment.meta,
      title: task.title,
      description: task.description,
      submitFrom: task.submitFrom,
      submitUntil: task.submitUntil,
      version: task.version,
      tests: task.tests,
      originalHashes: hashesOf(archive)
    }
    await writeTaskMeta(assignment.dir, meta)
    await this.refreshAssignment(assignment.dir)
    return { version: task.version, updated, skipped, upToDate: false }
  }

  async feedback(): Promise<{ notes: string; points: string | null; updated: string } | null> {
    const assignment = this.state.assignment
    if (!assignment) throw new Error('Das offene Projekt ist keine Aufgabe vom Hub.')
    const settings = await loadSettings()
    const personal = decrypt(settings.hubPersonalCode)
    if (!personal) throw new Error('Persönlicher Code fehlt (Aufgaben ▸ Hub-Einstellungen…)')
    const url = assignment.meta.hubUrl || settings.hubUrl
    if (!url) throw new Error('Keine Hub-URL bekannt')
    try {
      return await new HubClient({ url }).feedback(assignment.meta.code, personal)
    } catch (error) {
      if (error instanceof HubRequestError && error.reason === 'no-feedback') return null
      throw error
    }
  }

  private async ensurePackageFile(dir: string, name: string): Promise<void> {
    const file = path.join(dir, 'package.bluepy')
    try {
      await fs.access(file)
    } catch {
      await fs.writeFile(file, JSON.stringify({ version: 1, name, layout: {} }, null, 2) + '\n', 'utf-8')
    }
  }

  async taskStatus(): Promise<TaskInfo | null> {
    const assignment = this.state.assignment
    if (!assignment) return null
    const settings = await loadSettings()
    const url = assignment.meta.hubUrl || settings.hubUrl
    if (!url) return null
    return new HubClient({ url }).taskInfo(assignment.meta.code)
  }

  async submit(): Promise<{ at: string; name: string; late: boolean }> {
    const assignment = this.state.assignment
    if (!assignment) throw new Error('Das offene Projekt ist keine Aufgabe vom Hub.')
    const settings = await loadSettings()
    const personal = decrypt(settings.hubPersonalCode)
    if (!personal) throw new Error('Persönlicher Code fehlt (Aufgaben ▸ Hub-Einstellungen…)')
    const url = assignment.meta.hubUrl || settings.hubUrl
    if (!url) throw new Error('Keine Hub-URL bekannt')
    await this.host.flushEditors()
    const archive = await packProject(assignment.dir)
    const client = new HubClient({ url })
    const result = await client.submit(assignment.meta.code, personal, archive.toString('base64'), await this.deviceId())
    const fresh = await loadSettings()
    await saveSettings({ ...fresh, lastSubmissions: { ...(fresh.lastSubmissions ?? {}), [assignment.meta.code]: result.at } })
    this.state.setAssignment({ ...assignment, lastSubmittedAt: result.at })
    return { at: result.at, name: result.name, late: result.late }
  }

  // ------------------------------------------------------------------ teacher

  async classes(): Promise<HubClass[]> {
    return (await this.client(true)).classes()
  }

  async addClass(name: string, students: string[]): Promise<HubClass> {
    return (await this.client(true)).addClass(name, students)
  }

  async addStudents(id: number, students: string[]): Promise<HubClass> {
    return (await this.client(true)).addStudents(id, students)
  }

  async removeClass(id: number): Promise<void> {
    await (await this.client(true)).removeClass(id)
  }

  async tasks(): Promise<TaskInfo[]> {
    return (await this.client(true)).tasks()
  }

  async publish(meta: { title: string; description: string; code?: string; submitFrom: string | null; submitUntil: string | null; classes: number[]; tests: boolean; exclude: string[] }): Promise<TaskInfo> {
    const dir = this.host.currentProjectDir()
    if (!dir) throw new Error('Kein Projekt geöffnet')
    const client = await this.client(true)
    await this.host.flushEditors()
    const settings = await loadSettings()
    const draft: TaskMeta = {
      format: 1,
      code: meta.code?.trim().toUpperCase() || '',
      title: meta.title,
      description: meta.description,
      teacher: settings.hubTeacherName ?? null,
      hubUrl: client.base,
      submitFrom: meta.submitFrom,
      submitUntil: meta.submitUntil,
      version: 1,
      tests: meta.tests
    }
    const archive = await packProject(dir, { exclude: meta.exclude, meta: draft, description: meta.description })
    const task = await client.createTask({
      title: meta.title,
      description: meta.description,
      code: draft.code || undefined,
      submitFrom: meta.submitFrom,
      submitUntil: meta.submitUntil,
      classes: meta.classes,
      tests: meta.tests,
      package: archive.toString('base64')
    })
    return task
  }

  // ------------------------------------------------------------------ review

  async collect(code: string): Promise<ReviewState> {
    const client = await this.client(true)
    const overview = await client.submissions(code)
    const folder = path.join(documents('Abgaben'), folderNameFor(overview.task.code, overview.task.title))
    await fs.mkdir(folder, { recursive: true })
    const notes = await this.readNotes(folder)
    // the teacher's own task package: its test files win when running tests over all submissions
    let taskFolder: string | null = null
    try {
      const task = await client.fetchTask(overview.task.code)
      taskFolder = path.join(folder, '_aufgabe')
      await fs.rm(taskFolder, { recursive: true, force: true })
      await unpackProject(Buffer.from(task.package, 'base64'), taskFolder)
    } catch {
      taskFolder = null
    }
    const students: ReviewStudent[] = []
    for (const entry of overview.students) {
      let studentFolder: string | null = null
      if (entry.submittedAt) {
        studentFolder = path.join(folder, folderNameFor(entry.personal, entry.name))
        const stampFile = path.join(studentFolder, '.abgabe')
        let have: string | null = null
        try {
          have = (await fs.readFile(stampFile, 'utf-8')).trim()
        } catch {
          have = null
        }
        if (have !== entry.submittedAt) {
          const submission = await client.submission(overview.task.code, entry.personal)
          await fs.rm(studentFolder, { recursive: true, force: true })
          await unpackProject(Buffer.from(submission.package, 'base64'), studentFolder)
          await this.ensurePackageFile(studentFolder, `${overview.task.title} – ${entry.name}`)
          await fs.writeFile(stampFile, submission.at + '\n', 'utf-8')
        }
      }
      const saved = notes[entry.personal] ?? { notes: '', points: '' }
      students.push({ ...entry, folder: studentFolder, notes: saved.notes, points: saved.points })
    }
    const previous = this.state.review
    for (const student of students) {
      const before = previous?.code === overview.task.code ? previous.students.find((s) => s.personal === student.personal) : undefined
      if (before?.tests && before.submittedAt === student.submittedAt) student.tests = before.tests
    }
    const review: ReviewState = { code: overview.task.code, title: overview.task.title, folder, collectedAt: new Date().toISOString(), students, index: -1, taskFolder }
    await this.writeNotes(review)
    this.state.setReview(review)
    return review
  }

  private async readNotes(folder: string): Promise<Record<string, { notes: string; points: string }>> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(folder, REVIEW_FILE), 'utf-8')) as { students?: Record<string, { notes?: string; points?: string }> }
      const out: Record<string, { notes: string; points: string }> = {}
      for (const [personal, value] of Object.entries(raw.students ?? {})) out[personal] = { notes: value.notes ?? '', points: value.points ?? '' }
      return out
    } catch {
      return {}
    }
  }

  private async writeNotes(review: ReviewState): Promise<void> {
    const students: Record<string, { name: string; notes: string; points: string; submittedAt: string | null }> = {}
    for (const s of review.students) students[s.personal] = { name: s.name, notes: s.notes, points: s.points, submittedAt: s.submittedAt }
    const payload = { code: review.code, title: review.title, collectedAt: review.collectedAt, students }
    await fs.writeFile(path.join(review.folder, REVIEW_FILE), JSON.stringify(payload, null, 2) + '\n', 'utf-8')
  }

  async reviewOpen(index: number): Promise<void> {
    const review = this.state.review
    if (!review) throw new Error('Kein Korrekturmodus aktiv')
    const student = review.students[index]
    if (!student?.folder) throw new Error('Keine Abgabe vorhanden')
    this.state.setReview({ ...review, index })
    await this.host.openProject(student.folder)
  }

  async reviewNote(index: number, notes: string, points: string): Promise<void> {
    const review = this.state.review
    if (!review) return
    const students = review.students.map((s, i) => (i === index ? { ...s, notes, points } : s))
    const next = { ...review, students }
    this.state.setReview(next)
    await this.writeNotes(next)
    // mirror to the hub so feedback can reach learners later (best effort)
    const student = students[index]
    if (student) {
      try {
        await (await this.client(true)).setFeedback(review.code, student.personal, notes, points || null)
      } catch {
        /* offline – the local file is the source of truth */
      }
    }
  }

  reviewClose(): void {
    this.state.setReview(null)
  }

  /** Run every submission's tests in a separate interpreter (backend/run_tests.py), teacher's test files first. */
  async reviewRunTests(): Promise<ReviewState> {
    const review = this.state.review
    if (!review) throw new Error('Kein Korrekturmodus aktiv')
    const python = this.host.pythonPath()
    if (!python) throw new Error('Kein Python-Interpreter gefunden')
    const script = path.join(this.host.backendDir(), 'run_tests.py')
    const students = [...review.students]
    for (let i = 0; i < students.length; i++) {
      const student = students[i]
      if (!student?.folder) continue
      students[i] = { ...student, tests: await this.runTestsIn(python, script, student.folder, review.taskFolder) }
      this.state.setReview({ ...review, students: [...students] })
    }
    const next = { ...review, students }
    this.state.setReview(next)
    await this.writeNotes(next)
    return next
  }

  private runTestsIn(python: string, script: string, folder: string, testsFrom: string | null): Promise<ReviewTestSummary> {
    const args = ['-B', '-X', 'utf8', '-I', script, folder, '--timeout', '60']
    if (testsFrom) args.push('--tests-from', testsFrom)
    return new Promise((resolve) => {
      execFile(python, args, { timeout: 90_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        const line = String(stdout).trim().split('\n').pop() ?? ''
        try {
          const raw = JSON.parse(line) as { ok: boolean; error?: string; total: number; passed: number; failed: number; errors: number; skipped: number; results: { id: string; status: ReviewTestSummary['results'][string] }[] }
          const results: ReviewTestSummary['results'] = {}
          for (const r of raw.results ?? []) results[r.id] = r.status
          resolve({ ok: raw.ok, error: raw.error, total: raw.total, passed: raw.passed, failed: raw.failed, errors: raw.errors, skipped: raw.skipped, results })
        } catch {
          resolve({ ok: false, error: error ? error.message : 'Keine Antwort vom Testlauf', total: 0, passed: 0, failed: 0, errors: 1, skipped: 0, results: {} })
        }
      })
    })
  }

  // ------------------------------------------------------------- export/import

  async exportPackage(): Promise<string | null> {
    const dir = this.host.currentProjectDir()
    if (!dir) throw new Error('Kein Projekt geöffnet')
    const result = await dialog.showSaveDialog({
      title: 'Projekt als Paket exportieren',
      defaultPath: path.join(app.getPath('documents'), `${path.basename(dir)}.bluepy`),
      filters: [{ name: 'BluePy-Paket', extensions: ['bluepy'] }]
    })
    if (result.canceled || !result.filePath) return null
    await this.host.flushEditors()
    const meta = (await readTaskMeta(dir)) ?? undefined
    const archive = await packProject(dir, { meta: meta ?? null })
    await fs.writeFile(result.filePath, archive)
    return result.filePath
  }

  async importPackage(): Promise<ProjectInfo | null> {
    const result = await dialog.showOpenDialog({
      title: 'BluePy-Paket importieren',
      properties: ['openFile'],
      filters: [{ name: 'BluePy-Paket', extensions: ['bluepy', 'zip'] }]
    })
    const file = result.filePaths[0]
    if (result.canceled || !file) return null
    const archive = await fs.readFile(file)
    const base = path.basename(file).replace(/\.(bluepy|zip)$/i, '')
    let dir = path.join(documents('Import'), base)
    for (let n = 2; ; n++) {
      try {
        await fs.access(dir)
        dir = path.join(documents('Import'), `${base} (${n})`)
      } catch {
        break
      }
    }
    const { meta } = await unpackProject(archive, dir)
    await this.ensurePackageFile(dir, meta?.title ?? base)
    const project = await this.host.openProject(dir)
    await this.refreshAssignment(dir)
    return project
  }
}
