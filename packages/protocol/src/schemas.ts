/**
 * zod schemas for everything the backend sends over the socket.
 *
 * Imported ONLY by the Electron main process (`@bluepy/protocol/schemas`).
 * The package's main entry is zod-free so that preload and renderer bundles
 * stay small and the sandboxed preload never needs `require('zod')`.
 */
import { z } from 'zod'

export const RpcIdSchema = z.union([z.number(), z.string(), z.null()])

export const RpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional()
})

export const RpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: RpcIdSchema,
  result: z.unknown().optional(),
  error: RpcErrorSchema.optional()
})

export const RpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional()
})

/** Any line the backend may send. */
export const RpcIncomingSchema = z.union([RpcNotificationSchema, RpcResponseSchema])

// ---------------------------------------------------------------- hello

export const PythonSummarySchema = z.object({
  version: z.string(),
  executable: z.string(),
  implementation: z.string(),
  platform: z.string()
})

export const HelloParamsSchema = z.object({
  token: z.string(),
  pid: z.number(),
  backendVersion: z.string(),
  protocolVersion: z.string(),
  python: PythonSummarySchema
})

// --------------------------------------------------------- notifications

export const OutputParamsSchema = z.object({
  stream: z.enum(['stdout', 'stderr']),
  text: z.string(),
  invocation: RpcIdSchema
})

export const StdinRequestParamsSchema = z.object({
  invocation: RpcIdSchema
})

export const RecordParamsSchema = z.object({
  code: z.string(),
  invocation: RpcIdSchema
})

export const ResultParamsSchema = z.object({
  repr: z.string(),
  type: z.string(),
  invocation: RpcIdSchema
})

export const InvocationStartedParamsSchema = z.object({
  invocation: RpcIdSchema,
  method: z.string()
})

export const InvocationFinishedParamsSchema = z.object({
  invocation: RpcIdSchema,
  method: z.string(),
  ok: z.boolean()
})

// ---------------------------------------------------------------- results

export const EnvInfoSchema = z.object({
  version: z.string(),
  versionInfo: z.tuple([z.number(), z.number(), z.number()]),
  executable: z.string(),
  implementation: z.string(),
  platform: z.string(),
  platformDetails: z.string(),
  machine: z.string(),
  prefix: z.string(),
  basePrefix: z.string(),
  isVenv: z.boolean(),
  hasTkinter: z.boolean(),
  hasVenv: z.boolean(),
  hasPip: z.boolean(),
  cwd: z.string(),
  sysPath: z.array(z.string())
})

export const ValueDescriptionSchema = z.object({
  repr: z.string(),
  truncated: z.boolean(),
  type: z.string(),
  typeModule: z.string(),
  isNone: z.boolean(),
  objectId: z.number()
})

export const UserErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
  traceback: z.string(),
  line: z.number().nullable().optional(),
  offset: z.number().nullable().optional()
})

export const CodePadResultSchema = z.object({
  kind: z.enum(['expression', 'statement', 'error']),
  value: ValueDescriptionSchema.optional(),
  error: UserErrorSchema.optional()
})

// --------------------------------------------------------------- debugger

export const DebugFrameSchema = z.object({
  index: z.number(),
  file: z.string(),
  line: z.number(),
  function: z.string(),
  className: z.string().nullable()
})

export const DebugPausedParamsSchema = z.object({
  reason: z.enum(['breakpoint', 'step', 'pause']),
  frames: z.array(DebugFrameSchema),
  invocation: RpcIdSchema
})

export const DebugResumedParamsSchema = z.object({
  command: z.string()
})
