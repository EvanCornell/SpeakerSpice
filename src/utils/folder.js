import { workspaceToEntries, entriesToWorkspace, DEFAULT_WORKSPACE_NAME } from '../workspace'
import { LEGACY_DB_NAME } from '../legacy'

const DB_NAME = 'speakerspice'

const DB_STORE = 'handles'

const DB_KEY = 'workspace-folder'

const WORKSPACE_DB_KEY = 'workspace'

const MAX_READ_BYTES = 96 * 1024 * 1024

const MAX_ENTRIES = 5000

export function supportsFolders() {
  return typeof window !== 'undefined'
    && typeof window.showDirectoryPicker === 'function'
    && typeof window.indexedDB !== 'undefined'
}

export function diskContents(ws) {
  const entries = workspaceToEntries(ws)
  const files = new Map()
  const folders = []
  for (const entry of entries) {
    if (entry.folder) folders.push(entry.path)
    else files.set(entry.path, entry.data)
  }
  return { files, folders }
}

export function planSync(ws, previous, prune = true) {
  const next = diskContents(ws)
  const writes = []
  for (const [path, data] of next.files) {
    if (previous.files.get(path) !== data) writes.push({ path, data })
  }
  if (!prune) return { writes, deletes: [], folders: next.folders, gone: [], next }
  const deletes = [...previous.files.keys()].filter((p) => !next.files.has(p))
  const keep = new Set(next.folders)
  const gone = previous.folders.filter((f) => !keep.has(f))
  return { writes, deletes, folders: next.folders, gone, next }
}

function openDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore(mode, run, name = DB_NAME) {
  const db = await openDb(name)
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode)
      const req = run(tx.objectStore(DB_STORE))
      tx.oncomplete = () => resolve(req ? req.result : null)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function rememberFolder(handle) {
  try {
    await withStore('readwrite', (store) => store.put(handle, DB_KEY))
    return true
  } catch {
    return false
  }
}

export async function recallFolder() {
  try {
    const handle = await withStore('readonly', (store) => store.get(DB_KEY))
    if (handle) return handle
  } catch {
    return null
  }
  try {
    const old = await withStore('readonly', (store) => store.get(DB_KEY), LEGACY_DB_NAME)
    if (old && await rememberFolder(old)) indexedDB.deleteDatabase(LEGACY_DB_NAME)
    return old || null
  } catch {
    return null
  }
}

export async function readStoredWorkspace() {
  try {
    if (typeof indexedDB === 'undefined') return null
    const text = await withStore('readonly', (store) => store.get(WORKSPACE_DB_KEY))
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

export async function storeWorkspace(text) {
  try {
    if (typeof indexedDB === 'undefined') return false
    await withStore('readwrite', (store) => store.put(text, WORKSPACE_DB_KEY))
    return true
  } catch {
    return false
  }
}

export async function forgetFolder() {
  try {
    await withStore('readwrite', (store) => store.delete(DB_KEY))
  } catch {  }
}

export async function folderPermission(handle, ask = false) {
  const opts = { mode: 'readwrite' }
  try {
    const state = await handle.queryPermission(opts)
    if (state === 'granted' || !ask) return state
    return await handle.requestPermission(opts)
  } catch {
    return 'denied'
  }
}

export async function pickFolder() {
  try {
    return await window.showDirectoryPicker({ id: 'speakerspice-workspace', mode: 'readwrite' })
  } catch {
    return null
  }
}

export async function readFolderEntries(handle, prefix = '', budget = { n: MAX_ENTRIES }) {
  const out = []
  for await (const [name, child] of handle.entries()) {
    if (budget.n-- <= 0) break
    const path = prefix ? `${prefix}/${name}` : name
    if (child.kind === 'directory') {
      out.push({ path, data: null, folder: true })
      out.push(...await readFolderEntries(child, path, budget))
      continue
    }
    try {
      const file = await child.getFile()
      if (file.size > MAX_READ_BYTES) continue
      out.push({ path, data: new Uint8Array(await file.arrayBuffer()), folder: false })
    } catch {  }
  }
  return out
}

export async function readFolderWorkspace(handle) {
  let entries
  try {
    entries = await readFolderEntries(handle)
  } catch (err) {
    return { ok: false, error: err?.message || 'That folder could not be read.' }
  }
  if (!entries.length) return { ok: false, empty: true }

  const parsed = entriesToWorkspace(entries, handle.name || DEFAULT_WORKSPACE_NAME)
  if (!parsed.ok) return { ok: false, empty: true, error: parsed.error }

  const previous = diskContents(parsed.workspace)
  for (const r of parsed.renamed || []) {
    if (r.folder) { previous.folders.push(r.from); continue }
    previous.files.delete(r.to)
    previous.files.set(r.from, '')
  }
  return { ok: true, workspace: parsed.workspace, skipped: parsed.skipped, previous }
}

async function dirFor(root, path, create = true) {
  let dir = root
  for (const seg of path.split('/').filter(Boolean)) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create })
    } catch {
      return null
    }
  }
  return dir
}

export async function applyPlan(root, plan) {
  const failed = []
  let written = 0

  for (const path of plan.folders) {
    await dirFor(root, path, true)
  }

  for (const { path, data } of plan.writes) {
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? root : await dirFor(root, path.slice(0, slash), true)
    if (!dir) { failed.push(path); continue }
    try {
      const file = await dir.getFileHandle(path.slice(slash + 1), { create: true })
      const stream = await file.createWritable()
      await stream.write(data)
      await stream.close()
      written++
    } catch {
      failed.push(path)
    }
  }

  for (const path of plan.deletes) {
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? root : await dirFor(root, path.slice(0, slash), false)
    if (!dir) continue
    try { await dir.removeEntry(path.slice(slash + 1)) } catch {  }
  }

  for (const path of [...plan.gone].sort((a, b) => b.length - a.length)) {
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? root : await dirFor(root, path.slice(0, slash), false)
    if (!dir) continue
    try { await dir.removeEntry(path.slice(slash + 1)) } catch {  }
  }

  return { written, failed }
}
