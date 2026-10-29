import { Buffer } from 'buffer'

if (!globalThis.Buffer) globalThis.Buffer = Buffer

const GITDIR = '/records'

const FILE = 'project.json'

const RUN_FILE = 'run.json'

const AUTHOR = 'SpeakerSpice'

const NOT_RECORDED = ['name', 'modified', 'records', 'tdBoards']

const OID = /^[0-9a-f]{40}$/

const RUN_KIND = 'level'

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 8)}`
}

let gitModule = null

async function git() {
  if (!gitModule) gitModule = await import('isomorphic-git')
  return gitModule.default?.readCommit ? gitModule.default : gitModule
}

function fsError(code, path) {
  const err = new Error(`${code}: ${path}`)
  err.code = code
  return err
}

function statOf(file, size) {
  return {
    type: file ? 'file' : 'dir', mode: file ? 0o100644 : 0o40000, size,
    ino: 0, mtimeMs: 0, ctimeMs: 0, uid: 0, gid: 0, dev: 0,
    isFile: Boolean.bind(null, file),
    isDirectory: Boolean.bind(null, !file),
    isSymbolicLink: Boolean.bind(null, false),
  }
}

function memoryRepo(objects) {
  const files = new Map()
  const prefix = `${GITDIR}/objects/`
  for (const [oid, b64] of Object.entries(objects || {})) {
    files.set(`${prefix}${oid.slice(0, 2)}/${oid.slice(2)}`, new Uint8Array(Buffer.from(b64, 'base64')))
  }
  const isDir = (path) => {
    const p = path.endsWith('/') ? path : `${path}/`
    for (const k of files.keys()) if (k.startsWith(p)) return true
    return false
  }
  const stat = async (path) => {
    if (files.has(path)) return statOf(true, files.get(path).length)
    if (isDir(path)) return statOf(false, 0)
    throw fsError('ENOENT', path)
  }
  const promises = {
    async readFile(path, opts) {
      if (!files.has(path)) throw fsError('ENOENT', path)
      const data = files.get(path)
      const enc = typeof opts === 'string' ? opts : opts?.encoding
      return enc ? Buffer.from(data).toString(enc) : Buffer.from(data)
    },
    async writeFile(path, data) {
      files.set(path, typeof data === 'string' ? new Uint8Array(Buffer.from(data)) : new Uint8Array(data))
    },
    async unlink(path) { files.delete(path) },
    async readdir(path) {
      const p = path.endsWith('/') ? path : `${path}/`
      const names = new Set()
      for (const k of files.keys()) if (k.startsWith(p)) names.add(k.slice(p.length).split('/')[0])
      if (!names.size) throw fsError('ENOENT', path)
      return [...names]
    },
    async mkdir() {},
    async rmdir() {},
    stat,
    lstat: stat,
    async readlink(path) { throw fsError('ENOENT', path) },
    async symlink(target, path) { throw fsError('ENOTSUP', path) },
    async chmod() {},
  }
  return { fs: { promises }, files }
}

function objectsOf(files) {
  const out = {}
  const prefix = `${GITDIR}/objects/`
  for (const [path, data] of files) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length).split('/')
    if (rest.length === 2 && rest[0].length === 2) out[rest[0] + rest[1]] = Buffer.from(data).toString('base64')
  }
  return out
}

export function recordContent(project) {
  const out = { ...project }
  for (const k of NOT_RECORDED) delete out[k]
  return out
}

export function readRecords(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list) || !raw.list.length) return null
  const keep = raw.list.map((oid) => typeof oid === 'string' && OID.test(oid))
  const list = raw.list.filter((_, i) => keep[i])
  if (!list.length || !raw.objects || typeof raw.objects !== 'object') return null
  const selected = Math.min(Math.max(Math.round(Number(raw.selected) || 0), 0), list.length - 1)
  const given = Array.isArray(raw.ids) && raw.ids.length === raw.list.length ? raw.ids.filter((_, i) => keep[i]) : null
  const ids = given && given.every((x) => typeof x === 'string' && x) && new Set(given).size === given.length
    ? given : list.map((oid, i) => `r-${oid.slice(0, 8)}${i}`)
  const runs = (Array.isArray(raw.runs) ? raw.runs : [])
    .filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.oid === 'string' && OID.test(r.oid) && raw.objects[r.oid])
    .filter((r) => r.analysis === RUN_KIND)
  const names = {}
  if (raw.names && typeof raw.names === 'object') {
    for (const id of ids) if (typeof raw.names[id] === 'string' && raw.names[id].trim()) names[id] = raw.names[id].trim()
  }
  return { list, ids, selected, objects: { ...raw.objects }, runs, names }
}

export function recordName(records, index) {
  const id = records?.ids?.[index]
  return (id && records.names?.[id]) || String(index + 1)
}

export function renameRecord(records, index, name) {
  const id = records.ids[index]
  const names = { ...(records.names || {}) }
  const t = String(name || '').trim()
  if (t && t !== String(index + 1)) names[id] = t
  else delete names[id]
  return { ...records, names }
}

async function writeRecord(repo, content, now) {
  const g = await git()
  const blob = await g.writeBlob({ fs: repo.fs, gitdir: GITDIR, blob: new Uint8Array(Buffer.from(JSON.stringify(content))) })
  const tree = await g.writeTree({ fs: repo.fs, gitdir: GITDIR, tree: [{ mode: '100644', path: FILE, oid: blob, type: 'blob' }] })
  const who = { name: AUTHOR, email: '', timestamp: Math.floor(now / 1000), timezoneOffset: 0 }
  return g.writeCommit({ fs: repo.fs, gitdir: GITDIR, commit: { message: 'Record\n', tree, parent: [], author: who, committer: who } })
}

async function recordParts(repo, oid) {
  const g = await git()
  const { commit } = await g.readCommit({ fs: repo.fs, gitdir: GITDIR, oid })
  const { tree } = await g.readTree({ fs: repo.fs, gitdir: GITDIR, oid: commit.tree })
  const entry = tree.find((e) => e.path === FILE)
  if (!entry) throw new Error('A record holds no project.')
  return { tree: commit.tree, blob: entry.oid, time: commit.committer.timestamp * 1000 }
}

async function collect(repo, list, runs = []) {
  const keep = new Set()
  for (const oid of list) {
    const p = await recordParts(repo, oid)
    keep.add(oid).add(p.tree).add(p.blob)
  }
  const g = await git()
  for (const run of runs) {
    const { commit } = await g.readCommit({ fs: repo.fs, gitdir: GITDIR, oid: run.oid })
    keep.add(run.oid).add(commit.tree)
    const { tree } = await g.readTree({ fs: repo.fs, gitdir: GITDIR, oid: commit.tree })
    for (const e of tree) keep.add(e.oid)
    for (const parent of commit.parent) {
      if (!repo.files.has(`${GITDIR}/objects/${parent.slice(0, 2)}/${parent.slice(2)}`)) continue
      const p = await recordParts(repo, parent)
      keep.add(parent).add(p.tree).add(p.blob)
    }
  }
  for (const oid of Object.keys(objectsOf(repo.files))) {
    if (!keep.has(oid)) repo.files.delete(`${GITDIR}/objects/${oid.slice(0, 2)}/${oid.slice(2)}`)
  }
}

export async function readRecord(records, index) {
  const oid = records.list[index]
  if (!oid) throw new Error(`There is no record ${index + 1}.`)
  const repo = memoryRepo(records.objects)
  const g = await git()
  const { blob } = await recordParts(repo, oid)
  const { blob: bytes } = await g.readBlob({ fs: repo.fs, gitdir: GITDIR, oid: blob })
  return JSON.parse(Buffer.from(bytes).toString('utf8'))
}

export async function recordTimes(records) {
  const repo = memoryRepo(records.objects)
  const out = []
  for (const oid of records.list) out.push((await recordParts(repo, oid)).time)
  return out
}

export async function saveRecord(records, project, now = Date.now()) {
  const content = recordContent(project)
  if (!records) {
    const repo = memoryRepo({})
    const oid = await writeRecord(repo, content, now)
    return { list: [oid], ids: [newId('r')], selected: 0, objects: objectsOf(repo.files), runs: [] }
  }
  const repo = memoryRepo(records.objects)
  const g = await git()
  const { oid: blob } = await g.hashBlob({ object: new Uint8Array(Buffer.from(JSON.stringify(content))) })
  const current = records.list[records.selected]
  if (current && (await recordParts(repo, current)).blob === blob) return records
  const oid = await writeRecord(repo, content, now)
  const list = records.list.slice()
  list[records.selected] = oid
  await collect(repo, list, records.runs)
  return { ...records, list, objects: objectsOf(repo.files) }
}

export async function addRecord(records, project, now = Date.now()) {
  const saved = await saveRecord(records, project, now)
  const repo = memoryRepo(saved.objects)
  const oid = await writeRecord(repo, recordContent(project), now + 1000)
  const list = [...saved.list, oid]
  return { ...saved, list, ids: [...saved.ids, newId('r')], selected: list.length - 1, objects: objectsOf(repo.files) }
}

export async function deleteRecord(records) {
  if (records.list.length <= 1) throw new Error('A project keeps at least one record.')
  const list = records.list.filter((_, i) => i !== records.selected)
  const ids = records.ids.filter((_, i) => i !== records.selected)
  const names = { ...(records.names || {}) }
  delete names[records.ids[records.selected]]
  const repo = memoryRepo(records.objects)
  await collect(repo, list, records.runs)
  return { ...records, list, ids, names, selected: Math.max(0, records.selected - 1), objects: objectsOf(repo.files) }
}

export async function selectRecord(records, project, index, now = Date.now()) {
  const saved = await saveRecord(records, project, now)
  if (index < 0 || index >= saved.list.length) throw new Error(`There is no record ${index + 1}.`)
  const next = { ...saved, selected: index }
  return { records: next, content: await readRecord(next, index) }
}

export async function branchPoint(records, project, now = Date.now()) {
  const saved = await saveRecord(records, project, now)
  return { records: saved, parent: saved.list[saved.selected], recordId: saved.ids[saved.selected], content: recordContent(project) }
}

export async function addRun(records, run, now = Date.now()) {
  const repo = memoryRepo(records.objects)
  const g = await git()
  const blobOf = (value) => g.writeBlob({ fs: repo.fs, gitdir: GITDIR, blob: new Uint8Array(Buffer.from(JSON.stringify(value))) })
  const tree = await g.writeTree({
    fs: repo.fs, gitdir: GITDIR,
    tree: [
      { mode: '100644', path: FILE, oid: await blobOf(run.content), type: 'blob' },
      { mode: '100644', path: RUN_FILE, oid: await blobOf(run.data), type: 'blob' },
    ],
  })
  const has = (oid) => !!oid && repo.files.has(`${GITDIR}/objects/${oid.slice(0, 2)}/${oid.slice(2)}`)
  const byId = records.ids.indexOf(run.recordId)
  const parent = has(run.parent) ? run.parent : byId >= 0 ? records.list[byId] : null
  const who = { name: AUTHOR, email: '', timestamp: Math.floor(now / 1000), timezoneOffset: 0 }
  const oid = await g.writeCommit({
    fs: repo.fs, gitdir: GITDIR,
    commit: { message: `Run ${run.meta?.title || run.id}\n`, tree, parent: parent ? [parent] : [], author: who, committer: who },
  })
  const entry = { ...(run.meta || {}), id: run.id, oid, recordId: run.recordId || null, at: now }
  return { ...records, runs: [...(records.runs || []), entry], objects: objectsOf(repo.files) }
}

export async function readRun(records, oid) {
  const repo = memoryRepo(records.objects)
  const g = await git()
  const { commit } = await g.readCommit({ fs: repo.fs, gitdir: GITDIR, oid })
  const { tree } = await g.readTree({ fs: repo.fs, gitdir: GITDIR, oid: commit.tree })
  const out = {}
  for (const [key, path] of [['content', FILE], ['data', RUN_FILE]]) {
    const entry = tree.find((e) => e.path === path)
    if (!entry) throw new Error('A run is missing its files.')
    const { blob } = await g.readBlob({ fs: repo.fs, gitdir: GITDIR, oid: entry.oid })
    out[key] = JSON.parse(Buffer.from(blob).toString('utf8'))
  }
  return out
}

export async function deleteRuns(records, ids) {
  const runs = (records.runs || []).filter((r) => !ids.includes(r.id))
  const repo = memoryRepo(records.objects)
  await collect(repo, records.list, runs)
  return { ...records, runs, objects: objectsOf(repo.files) }
}

export async function addRecordFrom(records, project, content, now = Date.now()) {
  const saved = await saveRecord(records, project, now)
  const repo = memoryRepo(saved.objects)
  const oid = await writeRecord(repo, recordContent(content), now + 1000)
  const list = [...saved.list, oid]
  return { ...saved, list, ids: [...saved.ids, newId('r')], selected: list.length - 1, objects: objectsOf(repo.files) }
}
