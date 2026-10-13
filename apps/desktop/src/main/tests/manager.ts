/**
 * BlueJ's testing tools on the main-process side: running test classes with
 * live results, recording interactions into a new test method, and moving the
 * object bench to a `setUp` fixture and back.  File edits go through the
 * ProjectManager; the Python side is backend/bluepy_backend/testing.py.
 */
import type { Assertion, BenchObject, FixtureToBenchResult, RecordingState, TestClassDescription, TestRunSummary } from '@bluepy/protocol'
import { RpcRequestError, type BackendProcess } from '../backend/BackendProcess'
import type { ProjectManager } from '../project'
import type { AppState } from '../state'
import { addTestClass, assertionStatement, composeSetUp, composeTestMethod, replaceOrInsertMethod, testClassNameFor, testClassTemplate, testFileFor } from './compose'

export interface TestHost {
  state: AppState
  projects: ProjectManager
  /** Running backend, or throws. */
  backend(): BackendProcess
  /** Save editors + load every module ("Compile"). */
  compile(): Promise<void>
}

export class TestManager {
  constructor(private readonly host: TestHost) {
    host.state.onRecord = (code) => this.onRecord(code)
  }

  private get state(): AppState {
    return this.host.state
  }

  // ------------------------------------------------------------- running

  async run(target: { files: string[]; className?: string; method?: string; label: string }): Promise<TestRunSummary> {
    await this.host.compile()
    const backend = this.host.backend()
    this.state.setTests({ running: true, label: target.label, startedAt: Date.now(), active: null, results: [], summary: null, error: null })
    try {
      const summary = await backend.request('tests.run', {
        files: target.files,
        ...(target.className ? { className: target.className } : {}),
        ...(target.method ? { method: target.method } : {})
      })
      this.state.setBench(summary.bench)
      const { total, passed, failed, errors, skipped, durationMs } = summary
      this.state.setTests({
        running: false,
        label: target.label,
        startedAt: this.state.tests?.startedAt ?? Date.now(),
        active: null,
        results: summary.results,
        summary: { total, passed, failed, errors, skipped, durationMs },
        error: null
      })
      return summary
    } catch (error) {
      const message = error instanceof RpcRequestError && error.rpcError.code === 1000 ? 'Testlauf abgebrochen' : error instanceof Error ? error.message : String(error)
      const tests = this.state.tests
      this.state.setTests({ ...(tests ?? { label: target.label, startedAt: Date.now(), results: [], summary: null }), running: false, active: null, error: message })
      throw error
    }
  }

  describe(file: string, className: string): Promise<TestClassDescription> {
    return this.host.backend().request('tests.describe', { file, className })
  }

  // ----------------------------------------------------------- recording

  async startRecording(file: string, className: string, method: string): Promise<RecordingState> {
    if (this.state.recording) throw new Error('Es läuft bereits eine Aufnahme')
    // The recorded test runs after setUp, so start from the fixture – bench cleared like BlueJ does.
    const fixture = await this.fixtureToBench(file, className)
    if (!fixture.ok) throw new Error(`setUp() schlägt fehl: ${fixture.error?.message ?? 'Fehler'}`)
    const recording: RecordingState = { file, className, method, fixtureNames: fixture.bench.map((o) => o.name), statements: [] }
    this.state.setRecording(recording)
    return recording
  }

  private onRecord(code: string): void {
    const recording = this.state.recording
    if (!recording || code.trim().startsWith('#')) return
    this.state.setRecording({ ...recording, statements: [...recording.statements, code] })
  }

  recordAssertion(code: string, assertion: Assertion): void {
    const recording = this.state.recording
    if (!recording) return
    const statements = [...recording.statements]
    const index = statements.lastIndexOf(code)
    const statement = assertionStatement(code, assertion)
    if (index >= 0) statements[index] = statement
    else statements.push(statement)
    this.state.setRecording({ ...recording, statements })
  }

  async endRecording(save: boolean): Promise<void> {
    const recording = this.state.recording
    if (!recording) return
    this.state.setRecording(null)
    if (!save) return
    const method = composeTestMethod(recording.method, recording.statements, recording.fixtureNames)
    await this.host.state.requestSaveAll()
    const source = await this.host.projects.readFile(recording.file)
    const updated = replaceOrInsertMethod(source, recording.className, recording.method, method)
    await this.host.projects.writeFile(recording.file, updated)
    await this.host.compile()
  }

  // ------------------------------------------------------------- fixture

  async benchToFixture(file: string, className: string): Promise<void> {
    const bench: BenchObject[] = this.state.bench
    const setUp = composeSetUp(bench.map((o) => ({ name: o.name, code: o.code ?? null })))
    await this.host.state.requestSaveAll()
    const source = await this.host.projects.readFile(file)
    await this.host.projects.writeFile(file, replaceOrInsertMethod(source, className, 'setUp', setUp))
    await this.host.compile()
  }

  async fixtureToBench(file: string, className: string): Promise<FixtureToBenchResult> {
    await this.host.compile()
    const result = await this.host.backend().request('tests.fixtureToBench', { file, className })
    this.state.setBench(result.bench)
    return result
  }

  // --------------------------------------------------------- test class

  /** Create (or extend) the test module for a class; returns the test file and class name. */
  async createTestClass(classId: string): Promise<{ file: string; className: string }> {
    const project = this.host.projects.require()
    const cls = project.model?.classes.find((c) => c.id === classId)
    if (!cls) throw new Error(`Klasse ${classId} nicht gefunden`)
    const file = testFileFor(cls.file)
    const testClassName = testClassNameFor(cls.name)
    const exists = project.files.some((f) => f.path === file)
    if (exists) {
      const source = await this.host.projects.readFile(file)
      if (!new RegExp(`^\\s*class\\s+${testClassName}\\b`, 'm').test(source)) {
        await this.host.projects.writeFile(file, addTestClass(source, cls.module, cls.name))
      }
    } else {
      await this.host.projects.createFile(file, testClassTemplate(cls.module, cls.name))
    }
    // place the test class next to its reference class in the diagram
    const layout = project.layout[cls.id]
    const testId = `${file.replace(/\.py$/, '').replace(/\//g, '.')}.${testClassName}`
    if (layout && !project.layout[testId]) {
      await this.host.projects.saveLayout({ ...project.layout, [testId]: { x: layout.x + 40, y: Math.max(0, layout.y - 70) } })
    }
    return { file, className: testClassName }
  }
}

