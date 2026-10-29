const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50

const STORED = 0
const DEFLATE = 8

const FLAG_UTF8 = 0x800

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff]

const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

export function dosStamp(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  }
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined' || !bytes.length) {
    return { method: STORED, data: bytes }
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    const out = new Uint8Array(await new Response(stream).arrayBuffer())
    return out.length < bytes.length ? { method: DEFLATE, data: out } : { method: STORED, data: bytes }
  } catch {
    return { method: STORED, data: bytes }
  }
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read compressed archives.')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function createZip(entries, stamp = new Date()) {
  const encoder = new TextEncoder()
  const { time, date } = dosStamp(stamp)
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const isFolder = !!entry.folder
    const path = isFolder && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path
    const name = encoder.encode(path)
    const raw = isFolder
      ? new Uint8Array(0)
      : (typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data)
    const { method, data } = isFolder ? { method: STORED, data: raw } : await deflate(raw)
    const sum = crc32(raw)

    const local = Uint8Array.from([
      ...u32(SIG_LOCAL), ...u16(20), ...u16(FLAG_UTF8), ...u16(method),
      ...u16(time), ...u16(date), ...u32(sum), ...u32(data.length), ...u32(raw.length),
      ...u16(name.length), ...u16(0),
    ])
    chunks.push(local, name, data)

    central.push(Uint8Array.from([
      ...u32(SIG_CENTRAL), ...u16(20), ...u16(20), ...u16(FLAG_UTF8), ...u16(method),
      ...u16(time), ...u16(date), ...u32(sum), ...u32(data.length), ...u32(raw.length),
      ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(isFolder ? 0x10 : 0),
      ...u32(offset),
    ]), name)

    offset += local.length + name.length + data.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = Uint8Array.from([
    ...u32(SIG_END), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ])

  return new Blob([...chunks, ...central, end], { type: 'application/zip' })
}

export function isZip(buffer) {
  if (buffer.byteLength < 4) return false
  const b = new Uint8Array(buffer, 0, 4)
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

function findEnd(view) {
  const min = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_END) return i
  }
  return -1
}

export async function readZip(buffer) {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const decoder = new TextDecoder()

  const end = findEnd(view)
  if (end === -1) throw new Error('Not a ZIP archive, or it is truncated.')

  const count = view.getUint16(end + 10, true)
  let p = view.getUint32(end + 16, true)
  const out = []

  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.byteLength || view.getUint32(p, true) !== SIG_CENTRAL) {
      throw new Error('This archive’s index is damaged.')
    }
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const csize = view.getUint32(p + 20, true)
    const usize = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))

    if (flags & 0x1) throw new Error('Encrypted archives are not supported.')
    if (method !== STORED && method !== DEFLATE) {
      throw new Error(`“${path}” uses an unsupported compression method.`)
    }

    const folder = path.endsWith('/')
    if (folder) {
      out.push({ path: path.slice(0, -1), data: null, folder: true })
    } else {
      if (view.getUint32(local, true) !== SIG_LOCAL) throw new Error(`“${path}” is not where the index says it is.`)
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const raw = bytes.subarray(start, start + csize)
      const data = method === DEFLATE ? await inflate(raw) : raw.slice()
      if (data.length !== usize) throw new Error(`“${path}” did not unpack to its recorded size.`)
      if (crc32(data) !== view.getUint32(p + 16, true)) throw new Error(`“${path}” failed its checksum.`)
      out.push({ path, data, folder: false })
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
