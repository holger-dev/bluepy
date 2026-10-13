/** Project model: files, the static analysis (class diagram) and runtime bench state. */
import type { UserError, ValueDescription } from './rpc'

export interface ProjectFile {
  /** Relative path with forward slashes, e.g. "konto.py" or "pkg/mod.py". */
  path: string
  name: string
  module: string
}

export interface ParamInfo {
  name: string
  annotation: string | null
  default: string | null
  kind: 'positional' | 'vararg' | 'kwonly' | 'kwarg'
}

export interface MethodInfo {
  name: string
  line: number
  params: ParamInfo[]
  returns: string | null
  doc: string | null
  kind: 'instance' | 'static' | 'classmethod' | 'property' | 'function'
  visibility: 'public' | 'private' | 'dunder'
  isAbstract: boolean
}

export interface AttributeInfo {
  name: string
  line: number
  annotation: string | null
  source: 'init' | 'method' | 'class'
  target: string | null
  multiplicity: '1' | '0..1' | '*' | null
  relation: 'composition' | 'aggregation' | 'association' | null
}

export type Stereotype = 'class' | 'abstract' | 'interface' | 'enum' | 'dataclass' | 'exception' | 'unittest'

export interface ClassInfo {
  id: string
  name: string
  module: string
  file: string
  line: number
  endLine: number
  bases: string[]
  stereotype: Stereotype
  doc: string | null
  methods: MethodInfo[]
  attributes: AttributeInfo[]
  decorators: string[]
}

export interface ModuleInfo {
  id: string
  file: string
  doc: string | null
  functions: MethodInfo[]
  hasMain: boolean
  imports: string[]
  error: { message: string; line: number | null; offset: number | null } | null
}

export type EdgeInfo =
  | { kind: 'inheritance'; from: string; to: string }
  | { kind: 'uses'; from: string; to: string }
  | {
      kind: 'association'
      from: string
      to: string
      role: string
      multiplicity: '1' | '0..1' | '*'
      relation: 'composition' | 'aggregation' | 'association'
    }

export interface ProjectModel {
  root: string
  modules: ModuleInfo[]
  classes: ClassInfo[]
  edges: EdgeInfo[]
}

export interface ClassLayout {
  x: number
  y: number
}

export interface CompileResult {
  file: string
  module: string
  ok: boolean
  stage: 'syntax' | 'read' | 'import' | 'loaded'
  error: UserError | null
}

export interface ProjectInfo {
  dir: string
  name: string
  files: ProjectFile[]
  model: ProjectModel | null
  /** Why there is no model (no Python, analyzer failed, …). */
  modelError: string | null
  layout: Record<string, ClassLayout>
  /** Result of the last Compile per file; absent = not compiled since the backend started. */
  compile: Record<string, CompileResult>
}

// ------------------------------------------------------------- runtime

export interface BenchObject {
  name: string
  type: string
  module: string
  repr: string
}

export interface LiveMethodInfo {
  name: string
  kind: 'instance' | 'static' | 'classmethod' | 'property'
  params: ParamInfo[]
  returns: string | null
  doc: string | null
  definedIn: string
  inherited: boolean
  visibility: 'public' | 'private' | 'dunder'
  isAbstract: boolean
}

export interface LiveClassInfo {
  name: string
  module: string
  doc: string | null
  isAbstract: boolean
  bases: string[]
  constructor: { params: ParamInfo[]; doc: string | null }
  methods: LiveMethodInfo[]
  classAttributes: { name: string; value: ValueDescription }[]
}

export interface InvocationResult {
  ok: boolean
  value?: ValueDescription | null
  inspectable?: boolean
  error?: UserError
  record: string
  bench: BenchObject[]
  object?: BenchObject
}

export interface InspectField {
  name: string
  kind: 'field' | 'item'
  value: ValueDescription
  inspectable: boolean
}

export interface InspectResult {
  value: ValueDescription
  className: string
  module: string
  mro: string[]
  fields: InspectField[]
  classAttributes: { name: string; value: ValueDescription }[]
}

export interface ModuleLoadResult {
  results: CompileResult[]
  removedObjects: string[]
  bench: BenchObject[]
}

export interface ModuleRunResult {
  ok: boolean
  exitCode?: number | null
  error?: UserError
}

// ------------------------------------------------------------ debugger

export interface DebugFrame {
  index: number
  file: string
  line: number
  function: string
  className: string | null
}

export interface DebugVariable {
  name: string
  value: ValueDescription
  inspectable: boolean
}

export interface DebugVariables {
  frame: number
  locals: DebugVariable[]
  instance: DebugVariable[]
  static: DebugVariable[]
}

export type DebugScope = 'locals' | 'instance' | 'static'

export interface DebugInspectResult {
  value: ValueDescription
  className: string
  fields: InspectField[]
}

export interface DebugState {
  paused: boolean
  reason: 'breakpoint' | 'step' | 'pause' | null
  frames: DebugFrame[]
  /** Debugger window open → user code is traced so Halt pauses instead of aborting. */
  armed: boolean
}
