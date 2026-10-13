import { describe, expect, it } from 'vitest'
import { crc32, createZip, readZip } from './zip'

describe('zip', () => {
  it('computes crc32 like zlib', () => {
    expect(crc32(Buffer.from('')).toString(16)).toBe('0')
    expect(crc32(Buffer.from('123456789')).toString(16)).toBe('cbf43926')
  })

  it('round-trips text, binary and empty entries with utf-8 names', () => {
    const entries = [
      { name: 'konto.py', data: Buffer.from('class Konto:\n    pass\n'.repeat(50)) },
      { name: 'leer.txt', data: Buffer.alloc(0) },
      { name: 'ördner/Übung.md', data: Buffer.from('# Übung\n') },
      { name: 'bin.dat', data: Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256)) }
    ]
    const archive = createZip(entries)
    expect(archive.readUInt32LE(0)).toBe(0x04034b50)
    const back = readZip(archive)
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name))
    for (let i = 0; i < entries.length; i++) expect(back[i]?.data.equals(entries[i]?.data as Buffer)).toBe(true)
    expect(archive.length).toBeLessThan(entries[0]?.data.length as number) // deflate did its job
  })

  it('rejects garbage', () => {
    expect(() => readZip(Buffer.from('not a zip at all, really not'))).toThrow()
  })
})
