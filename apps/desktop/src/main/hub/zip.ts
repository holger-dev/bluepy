/**
 * Minimal ZIP reader/writer for `.bluepy` packages – deflate via node:zlib,
 * no third-party dependency.  Supports what BluePy writes and what the hub
 * stores: plain files, UTF-8 names, deflate or stored entries, no encryption,
 * no ZIP64 (packages are capped at 20 MB anyway).
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  name: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

export function createZip(entries: readonly ZipEntry[], when = new Date()): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const stamp = dosDateTime(when)
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf-8')
    const crc = crc32(entry.data)
    let method = 0
    let payload = entry.data
    if (entry.data.length > 0) {
      const compressed = deflateRawSync(entry.data, { level: 6 })
      if (compressed.length < entry.data.length) {
        method = 8
        payload = compressed
      }
    }
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    locals.push(local, payload)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // made by
    central.writeUInt16LE(20, 6) // needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + payload.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

export function readZip(archive: Buffer): ZipEntry[] {
  // find the end-of-central-directory record (search backwards, comment ≤ 64 KB)
  let eocd = -1
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 65_535); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Kein ZIP-Archiv (End-of-central-directory fehlt)')
  const count = archive.readUInt16LE(eocd + 10)
  let pos = archive.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP-Archiv beschädigt (Central Directory)')
    const method = archive.readUInt16LE(pos + 10)
    const crc = archive.readUInt32LE(pos + 16)
    const compressedSize = archive.readUInt32LE(pos + 20)
    const size = archive.readUInt32LE(pos + 24)
    const nameLength = archive.readUInt16LE(pos + 28)
    const extraLength = archive.readUInt16LE(pos + 30)
    const commentLength = archive.readUInt16LE(pos + 32)
    const localOffset = archive.readUInt32LE(pos + 42)
    const name = archive.subarray(pos + 46, pos + 46 + nameLength).toString('utf-8')
    pos += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue // directory entry
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP-Archiv beschädigt (${name})`)
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const payload = archive.subarray(start, start + compressedSize)
    let data: Buffer
    if (method === 0) data = Buffer.from(payload)
    else if (method === 8) data = inflateRawSync(payload)
    else throw new Error(`ZIP-Kompressionsmethode ${method} nicht unterstützt (${name})`)
    if (data.length !== size || crc32(data) !== crc) throw new Error(`ZIP-Eintrag beschädigt: ${name}`)
    entries.push({ name, data })
  }
  return entries
}
