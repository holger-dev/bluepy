/** HTTP client for the BluePy-Hub API (hub/README.md).  Node's fetch, JSON bodies, base64 packages. */
import type { HubClass, SubmissionEntry, TaskInfo } from '@bluepy/protocol'

export class HubRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly reason: string
  ) {
    super(message)
    this.name = 'HubRequestError'
  }
}

export interface HubClientOptions {
  url: string
  teacherKey?: string | null
  timeoutMs?: number
}

export class HubClient {
  constructor(private readonly options: HubClientOptions) {}

  get base(): string {
    return this.options.url.replace(/\/+$/, '')
  }

  private async call<T>(method: string, path: string, body?: unknown, teacher = false): Promise<T> {
    if (!this.base) throw new HubRequestError(0, 'Keine Hub-URL eingestellt (Einstellungen ▸ Aufgaben-Hub)', 'no-url')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (teacher) {
      if (!this.options.teacherKey) throw new HubRequestError(0, 'Kein Lehrer-Schlüssel eingestellt (Einstellungen ▸ Aufgaben-Hub)', 'no-key')
      headers.Authorization = `Bearer ${this.options.teacherKey}`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000)
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal })
    } catch (error) {
      clearTimeout(timer)
      const detail = error instanceof Error ? error.message : String(error)
      throw new HubRequestError(0, `Hub nicht erreichbar (${this.base}): ${detail}`, 'network')
    }
    clearTimeout(timer)
    let data: unknown = null
    const text = await response.text()
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      throw new HubRequestError(response.status, `Unerwartete Antwort vom Hub (${response.status})`, 'bad-response')
    }
    if (!response.ok) {
      const err = (data ?? {}) as { error?: string; reason?: string }
      throw new HubRequestError(response.status, err.error ?? `Fehler ${response.status}`, err.reason ?? 'error')
    }
    return data as T
  }

  health(): Promise<{ ok: boolean; version: string; serverTime: string }> {
    return this.call('GET', '/api/health')
  }

  me(): Promise<{ name: string; classes: number; tasks: number }> {
    return this.call('GET', '/api/me', undefined, true)
  }

  // ----------------------------------------------------------------- learner

  fetchTask(code: string): Promise<TaskInfo & { package: string }> {
    return this.call('GET', `/api/tasks/${encodeURIComponent(code)}`)
  }

  taskInfo(code: string): Promise<TaskInfo> {
    return this.call('GET', `/api/tasks/${encodeURIComponent(code)}/info`)
  }

  submit(code: string, personal: string, packageBase64: string, device: string, allowLate = false): Promise<{ ok: boolean; at: string; name: string; late: boolean }> {
    return this.call('POST', `/api/tasks/${encodeURIComponent(code)}/submissions`, { personal, package: packageBase64, device, allowLate })
  }

  feedback(code: string, personal: string): Promise<{ notes: string; points: string | null; updated: string }> {
    return this.call('GET', `/api/tasks/${encodeURIComponent(code)}/feedback?personal=${encodeURIComponent(personal)}`)
  }

  // ----------------------------------------------------------------- teacher

  async classes(): Promise<HubClass[]> {
    return (await this.call<{ classes: HubClass[] }>('GET', '/api/classes', undefined, true)).classes
  }

  addClass(name: string, students: string[]): Promise<HubClass> {
    return this.call('POST', '/api/classes', { name, students }, true)
  }

  addStudents(id: number, students: string[]): Promise<HubClass> {
    return this.call('POST', `/api/classes/${id}/students`, { students }, true)
  }

  removeClass(id: number): Promise<void> {
    return this.call('DELETE', `/api/classes/${id}`, undefined, true)
  }

  async tasks(): Promise<TaskInfo[]> {
    return (await this.call<{ tasks: TaskInfo[] }>('GET', '/api/tasks', undefined, true)).tasks
  }

  createTask(body: Record<string, unknown>): Promise<TaskInfo> {
    return this.call('POST', '/api/tasks', body, true)
  }

  updateTask(code: string, body: Record<string, unknown>): Promise<TaskInfo> {
    return this.call('PUT', `/api/tasks/${encodeURIComponent(code)}`, body, true)
  }

  submissions(code: string): Promise<{ task: TaskInfo; students: SubmissionEntry[] }> {
    return this.call('GET', `/api/tasks/${encodeURIComponent(code)}/submissions`, undefined, true)
  }

  submission(code: string, personal: string): Promise<{ name: string; personal: string; at: string; late: boolean; size: number; package: string }> {
    return this.call('GET', `/api/tasks/${encodeURIComponent(code)}/submissions/${encodeURIComponent(personal)}`, undefined, true)
  }

  setFeedback(code: string, personal: string, notes: string, points: string | null): Promise<void> {
    return this.call('POST', `/api/tasks/${encodeURIComponent(code)}/feedback/${encodeURIComponent(personal)}`, { notes, points }, true)
  }
}
