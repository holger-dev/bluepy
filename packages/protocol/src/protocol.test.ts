import { describe, expect, it } from 'vitest'
import { compareVersion, meetsMinimum } from './python'
import { CodePadResultSchema, HelloParamsSchema, RpcIncomingSchema } from './schemas'

describe('version comparison', () => {
  it('orders versions numerically', () => {
    expect(compareVersion([3, 11, 0], [3, 11])).toBe(0)
    expect(compareVersion([3, 9, 20], [3, 11])).toBe(-1)
    expect(compareVersion([3, 14, 0], [3, 11])).toBe(1)
    expect(compareVersion([4, 0, 0], [3, 99, 99])).toBe(1)
  })

  it('applies the minimum version', () => {
    expect(meetsMinimum([3, 10, 12])).toBe(false)
    expect(meetsMinimum([3, 11, 0])).toBe(true)
    expect(meetsMinimum([3, 13, 2])).toBe(true)
  })
})

describe('rpc schemas', () => {
  it('accepts a hello notification as sent by the backend', () => {
    const line =
      '{"jsonrpc":"2.0","method":"hello","params":{"token":"abc","pid":674,"backendVersion":"0.1.0","protocolVersion":"0.1","python":{"version":"3.13.16","executable":"/usr/bin/python3","implementation":"CPython","platform":"linux"}}}'
    const message = RpcIncomingSchema.parse(JSON.parse(line))
    expect('method' in message && message.method).toBe('hello')
    if ('method' in message) {
      const hello = HelloParamsSchema.parse(message.params)
      expect(hello.python.implementation).toBe('CPython')
    }
  })

  it('accepts a response and a code pad result', () => {
    const line =
      '{"jsonrpc":"2.0","id":2,"result":{"kind":"expression","value":{"repr":"2","truncated":false,"type":"int","typeModule":"builtins","isNone":false,"objectId":1}}}'
    const message = RpcIncomingSchema.parse(JSON.parse(line))
    expect('id' in message && message.id).toBe(2)
    if ('id' in message) {
      const result = CodePadResultSchema.parse(message.result)
      expect(result.value?.repr).toBe('2')
    }
  })

  it('rejects garbage', () => {
    expect(RpcIncomingSchema.safeParse({ jsonrpc: '1.0' }).success).toBe(false)
  })
})
