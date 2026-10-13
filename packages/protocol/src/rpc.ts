/**
 * JSON-RPC 2.0 contracts between the Electron main process and the Python
 * backend (docs/03-rpc-protokoll.md).
 *
 * This module is runtime-free apart from two constants: all types are derived
 * from the zod schemas in ./schemas via type-only imports, so importing it
 * never pulls zod into a bundle.  Runtime validation lives in
 * `@bluepy/protocol/schemas` (main process only).
 */
import type { z } from 'zod'
import type * as S from './schemas'
import type {
  BenchObject,
  DebugFrame,
  DebugInspectResult,
  DebugScope,
  DebugVariables,
  InspectResult,
  InvocationResult,
  LiveClassInfo,
  ModuleLoadResult,
  ModuleRunResult
} from './project'

export const PROTOCOL_VERSION = '0.1'

export const RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HALTED: 1000
} as const

export type RpcId = z.infer<typeof S.RpcIdSchema>
export type RpcError = z.infer<typeof S.RpcErrorSchema>
export type RpcResponse = z.infer<typeof S.RpcResponseSchema>
export type RpcNotification = z.infer<typeof S.RpcNotificationSchema>
export type RpcIncoming = z.infer<typeof S.RpcIncomingSchema>

export type PythonSummary = z.infer<typeof S.PythonSummarySchema>
export type HelloParams = z.infer<typeof S.HelloParamsSchema>
export type OutputParams = z.infer<typeof S.OutputParamsSchema>

export type EnvInfo = z.infer<typeof S.EnvInfoSchema>
export type ValueDescription = z.infer<typeof S.ValueDescriptionSchema>
export type UserError = z.infer<typeof S.UserErrorSchema>
export type CodePadResult = z.infer<typeof S.CodePadResultSchema>

/** Request methods the main process may send, with their param/result types. */
export interface RpcMethods {
  ping: { params: Record<string, never>; result: { pong: true } }
  'env.info': { params: Record<string, never>; result: EnvInfo }
  'codepad.eval': { params: { code: string }; result: CodePadResult }
  halt: { params: Record<string, never>; result: { halted: boolean } }
  shutdown: { params: Record<string, never>; result: { ok: true } }
  'project.open': { params: { dir: string }; result: { ok: true; cwd: string } }
  'module.load': { params: { files: string[] }; result: ModuleLoadResult }
  'module.run': { params: { file: string }; result: ModuleRunResult }
  'class.describe': { params: { module: string; name: string }; result: LiveClassInfo }
  'object.create': { params: { module: string; name: string; benchName?: string; args: string[] }; result: InvocationResult }
  'object.call': {
    params: { target?: string; module?: string; name?: string; method: string; args: string[] }
    result: InvocationResult
  }
  'object.inspect': { params: { name: string; path?: (string | number)[] }; result: InspectResult }
  'object.get': { params: { name: string; path?: (string | number)[]; newName?: string }; result: InvocationResult }
  'object.remove': { params: { name: string }; result: { ok: true; bench: BenchObject[] } }
  'bench.list': { params: Record<string, never>; result: { bench: BenchObject[] } }
  'bench.suggestName': { params: { className: string }; result: { name: string } }
  'debug.setBreakpoints': { params: { file: string; lines: number[] }; result: { ok: true } }
  'debug.clearBreakpoints': { params: Record<string, never>; result: { ok: true } }
  'debug.arm': { params: { enabled: boolean }; result: { ok: true; armed: boolean } }
  'debug.continue': { params: Record<string, never>; result: { ok: boolean } }
  'debug.step': { params: Record<string, never>; result: { ok: boolean } }
  'debug.stepInto': { params: Record<string, never>; result: { ok: boolean } }
  'debug.stepOut': { params: Record<string, never>; result: { ok: boolean } }
  'debug.terminate': { params: Record<string, never>; result: { ok: boolean } }
  'debug.pause': { params: Record<string, never>; result: { ok: boolean } }
  'debug.frames': { params: Record<string, never>; result: { paused: boolean; frames: DebugFrame[] } }
  'debug.variables': { params: { frame: number }; result: DebugVariables }
  'debug.inspect': {
    params: { frame: number; scope: DebugScope; name: string; path: (string | number)[] }
    result: DebugInspectResult
  }
  'debug.state': { params: Record<string, never>; result: { paused: boolean; armed: boolean; active: boolean } }
}
export type RpcMethodName = keyof RpcMethods
