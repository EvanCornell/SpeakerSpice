import { modernPath } from './legacy.js'

export const WORKSPACE_VERSION = 1

export const SYSTEM_FOLDER = '.speakerspice'

export const DRIVERS_PATH = `${SYSTEM_FOLDER}/drivers.json`

export const SNAPSHOTS_PATH = `${SYSTEM_FOLDER}/snapshots.json`

export const BOARDS_PATH = `${SYSTEM_FOLDER}/boards.json`

export const PROJECT_EXT = '.speakerspice'

export const DEFAULT_WORKSPACE_NAME = 'workspace'

export const DEFAULT_PROJECT_NAME = 'project'

const ILLEGAL = /[\\/:*?"<>|]/

export function normalizePath(path) {
  if (typeof path !== 'string') return null
  const segs = path.split('/').map((s) => s.trim()).filter(Boolean)
  if (!segs.length) return null
  for (const s of segs) {
    if (s === '.' || s === '..') return null
    if (ILLEGAL.test(s)) return null
  }
  return segs.join('/')
}

export function baseName(path) {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function parentOf(path) {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function joinPath(folder, name) {
  return folder ? `${folder}/${name}` : name
}

export function isSystemPath(path) {
  return path === SYSTEM_FOLDER || path.startsWith(`${SYSTEM_FOLDER}/`)
}

export function isUnder(folder, path) {
  return path === folder || path.startsWith(`${folder}/`)
}

export function uniqueName(ws, folder, name) {
  if (!hasEntry(ws, joinPath(folder, name))) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`
    if (!hasEntry(ws, joinPath(folder, candidate))) return candidate
  }
}

export function newWorkspace(name = DEFAULT_WORKSPACE_NAME, projectName = DEFAULT_PROJECT_NAME) {
  const now = new Date().toISOString()
  return {
    schemaVersion: WORKSPACE_VERSION,
    app: 'SpeakerSpice',
    kind: 'workspace',
    name,
    created: now,
    modified: now,
    downloaded: null,
    folders: [],
    files: {
      [`${projectName}${PROJECT_EXT}`]: {
        kind: 'project',
        modified: now,
        data: { name: projectName, nodes: [], edges: [] },
      },
    },
  }
}

export function touch(ws) {
  return { ...ws, modified: new Date().toISOString() }
}

export function hasEntry(ws, path) {
  if (ws.files[path]) return true
  if ((ws.folders || []).includes(path)) return true
  return Object.keys(ws.files).some((p) => p.startsWith(`${path}/`))
}

export function listFolders(ws) {
  const out = new Set(ws.folders || [])
  for (const path of Object.keys(ws.files)) {
    let parent = parentOf(path)
    while (parent) {
      out.add(parent)
      parent = parentOf(parent)
    }
  }
  return [...out].sort()
}

export function listProjects(ws) {
  return Object.keys(ws.files).filter((p) => ws.files[p].kind === 'project').sort()
}

export function buildTree(ws) {
  const folders = listFolders(ws)
  const children = new Map([['', []]])
  for (const path of folders) children.set(path, [])

  for (const path of folders) {
    children.get(parentOf(path)).push({ kind: 'folder', name: baseName(path), path })
  }
  for (const path of Object.keys(ws.files)) {
    children.get(parentOf(path)).push({ kind: 'file', name: baseName(path), path, entry: ws.files[path] })
  }

  const build = (folder) => children.get(folder)
    .sort((a, b) => {
      const aSys = isSystemPath(a.path) ? 1 : 0
      const bSys = isSystemPath(b.path) ? 1 : 0
      if (aSys !== bSys) return aSys - bSys
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((n) => (n.kind === 'folder' ? { ...n, children: build(n.path) } : n))

  return build('')
}

export function writeFile(ws, path, entry) {
  const now = new Date().toISOString()
  const files = { ...ws.files, [path]: { ...entry, modified: now } }
  const folders = (ws.folders || []).filter((f) => !isUnder(f, parentOf(path)))
  return { ...touch(ws), files, folders }
}

export function addFolder(ws, path) {
  if (hasEntry(ws, path)) return ws
  return { ...touch(ws), folders: [...(ws.folders || []), path].sort() }
}

function preserveFolders(before, after, removed) {
  const survivors = listFolders(before).filter((f) => !isUnder(removed, f))
  const present = new Set(listFolders(after))
  const missing = survivors.filter((f) => !present.has(f))
  if (!missing.length) return after
  return { ...after, folders: [...new Set([...(after.folders || []), ...missing])].sort() }
}

export function deleteEntry(ws, path) {
  const files = {}
  for (const [p, entry] of Object.entries(ws.files)) {
    if (!isUnder(path, p)) files[p] = entry
  }
  const folders = (ws.folders || []).filter((f) => !isUnder(path, f))
  return preserveFolders(ws, { ...touch(ws), files, folders }, path)
}

export function renameEntry(ws, from, to) {
  if (from === to) return ws
  if (!hasEntry(ws, from)) return ws
  if (hasEntry(ws, to)) return ws
  if (isUnder(from, to)) return ws

  const moved = (p) => (isUnder(from, p) ? to + p.slice(from.length) : p)

  const files = {}
  for (const [p, entry] of Object.entries(ws.files)) files[moved(p)] = entry
  const folders = (ws.folders || []).map(moved)
  return preserveFolders(ws, { ...touch(ws), files, folders }, from)
}

export function filesUnder(ws, path) {
  return Object.keys(ws.files).filter((p) => isUnder(path, p)).sort()
}

export function copyInto(ws, from, folder) {
  if (!hasEntry(ws, from)) return ws
  if (isUnder(from, folder)) return ws
  const to = joinPath(folder, uniqueName(ws, folder, baseName(from)))

  const files = { ...ws.files }
  const now = new Date().toISOString()
  for (const p of filesUnder(ws, from)) {
    files[to + p.slice(from.length)] = { ...ws.files[p], modified: now }
  }
  const folders = [...(ws.folders || [])]
  for (const f of ws.folders || []) {
    if (isUnder(from, f)) folders.push(to + f.slice(from.length))
  }
  if (!filesUnder(ws, from).length) folders.push(to)
  return { ...touch(ws), files, folders: [...new Set(folders)].sort() }
}

export function moveInto(ws, from, folder) {
  const to = joinPath(folder, baseName(from))
  if (to === from) return { ws, path: from }
  const next = renameEntry(ws, from, to)
  return next === ws ? { ws, path: from } : { ws: next, path: to }
}

const NOTHING = []

function readList(ws, path) {
  const entry = ws.files[path]
  return Array.isArray(entry?.data) ? entry.data : NOTHING
}

export function readDrivers(ws) {
  return readList(ws, DRIVERS_PATH)
}

export function writeDrivers(ws, drivers) {
  return writeFile(ws, DRIVERS_PATH, { kind: 'drivers', data: drivers })
}

export function readSnapshots(ws) {
  return readList(ws, SNAPSHOTS_PATH)
}

export function writeSnapshots(ws, snapshots) {
  return writeFile(ws, SNAPSHOTS_PATH, { kind: 'snapshots', data: snapshots })
}

export function dropBoards(ws) {
  const carriers = Object.keys(ws.files).filter((p) => ws.files[p].kind === 'project' && ws.files[p].data && 'tdBoards' in ws.files[p].data)
  if (!carriers.length && !ws.files[BOARDS_PATH]) return ws
  let out = ws
  for (const path of carriers) {
    const { tdBoards, ...data } = ws.files[path].data
    out = writeFile(out, path, { ...ws.files[path], data })
  }
  if (out.files[BOARDS_PATH]) {
    const files = { ...out.files }
    delete files[BOARDS_PATH]
    out = { ...out, files }
  }
  return out
}

export const META_PATH = `${SYSTEM_FOLDER}/workspace.json`

export function workspaceToEntries(ws) {
  const meta = {
    schemaVersion: WORKSPACE_VERSION,
    app: 'SpeakerSpice',
    kind: 'workspace',
    name: ws.name || DEFAULT_WORKSPACE_NAME,
    created: ws.created,
    modified: ws.modified,
    downloaded: ws.downloaded,
  }
  return [
    ...listFolders(ws).map((path) => ({ path, folder: true })),
    { path: META_PATH, data: JSON.stringify(meta, null, 2) },
    ...Object.keys(ws.files).sort().map((path) => ({
      path,
      data: JSON.stringify(ws.files[path].data, null, 2),
    })),
  ]
}

export function kindForPath(path) {
  if (path === DRIVERS_PATH) return 'drivers'
  if (path === SNAPSHOTS_PATH) return 'snapshots'
  if (path.endsWith(PROJECT_EXT)) return 'project'
  return 'json'
}

export function entriesToWorkspace(entries, fallbackName) {
  const decoder = new TextDecoder()
  const now = new Date().toISOString()
  const files = {}
  const folders = new Set()
  const skipped = []
  let meta = null

  const renamed = []
  const modern = new Set(entries.map((e) => normalizePath(e.path)).filter((p) => p && modernPath(p, SYSTEM_FOLDER, PROJECT_EXT) === p))
  for (const entry of entries) {
    const original = normalizePath(entry.path)
    if (!original) continue
    const path = modernPath(original, SYSTEM_FOLDER, PROJECT_EXT)
    if (path !== original) {
      if (modern.has(path)) continue
      renamed.push({ from: original, to: path, folder: !!entry.folder })
    }
    if (entry.folder) { folders.add(path); continue }

    let parsed
    try { parsed = JSON.parse(decoder.decode(entry.data)) } catch { skipped.push(path); continue }
    if (path === META_PATH) { meta = parsed; continue }
    files[path] = { kind: kindForPath(path), modified: now, data: parsed }
  }

  if (!Object.keys(files).length && !folders.size) {
    return { ok: false, error: 'That archive holds no workspace files.' }
  }
  if (meta && Number(meta.schemaVersion) > WORKSPACE_VERSION) {
    return { ok: false, error: 'This workspace was saved by a newer version of SpeakerSpice.' }
  }

  for (const path of Object.keys(files)) {
    let parent = parentOf(path)
    while (parent) { folders.delete(parent); parent = parentOf(parent) }
  }

  return {
    ok: true,
    skipped,
    renamed,
    workspace: {
      schemaVersion: WORKSPACE_VERSION,
      app: 'SpeakerSpice',
      kind: 'workspace',
      name: typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim() : fallbackName,
      created: typeof meta?.created === 'string' ? meta.created : now,
      modified: typeof meta?.modified === 'string' ? meta.modified : now,
      downloaded: typeof meta?.downloaded === 'string' ? meta.downloaded : null,
      folders: [...folders].sort(),
      files,
    },
  }
}

export function workspaceFilename(ws) {
  return `${ws.name || DEFAULT_WORKSPACE_NAME}.speakerspice.zip`
}

export function parseWorkspace(text) {
  let raw
  try { raw = JSON.parse(text) } catch { return { ok: false, error: 'Not valid JSON.' } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Not a SpeakerSpice workspace.' }
  }
  if (raw.kind !== 'workspace' || !raw.files || typeof raw.files !== 'object') {
    return { ok: false, error: 'Not a SpeakerSpice workspace — no workspace files in it.' }
  }
  if (Number(raw.schemaVersion) > WORKSPACE_VERSION) {
    return { ok: false, error: 'This workspace was saved by a newer version of SpeakerSpice.' }
  }

  const now = new Date().toISOString()
  const files = {}
  for (const [rawPath, entry] of Object.entries(raw.files)) {
    const original = normalizePath(rawPath)
    if (!original || !entry || typeof entry !== 'object') continue
    const path = modernPath(original, SYSTEM_FOLDER, PROJECT_EXT)
    if (path !== original && raw.files[path]) continue
    files[path] = {
      kind: typeof entry.kind === 'string' ? entry.kind : 'json',
      modified: typeof entry.modified === 'string' ? entry.modified : now,
      data: entry.data ?? null,
    }
  }
  const folders = [...new Set(
    (Array.isArray(raw.folders) ? raw.folders : []).map(normalizePath).filter(Boolean).map((p) => modernPath(p, SYSTEM_FOLDER, PROJECT_EXT)),
  )].sort()

  return {
    ok: true,
    workspace: {
      schemaVersion: WORKSPACE_VERSION,
      app: 'SpeakerSpice',
      kind: 'workspace',
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : DEFAULT_WORKSPACE_NAME,
      created: typeof raw.created === 'string' ? raw.created : now,
      modified: typeof raw.modified === 'string' ? raw.modified : now,
      downloaded: typeof raw.downloaded === 'string' ? raw.downloaded : null,
      folders,
      files,
    },
  }
}

export const STALE_DOWNLOAD_MS = 7 * 24 * 60 * 60 * 1000

const SCALES = [
  [60, 'minute'],
  [3600, 'hour'],
  [86400, 'day'],
  [604800, 'week'],
  [2629800, 'month'],
  [31557600, 'year'],
]

export function timeAgo(iso, now) {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'never'
  const s = Math.max(0, (now - then) / 1000)
  if (s < 60) return 'just now'
  let [size, unit] = SCALES[0]
  for (const scale of SCALES) if (s >= scale[0]) [size, unit] = scale
  const n = Math.floor(s / size)
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

export function isDownloadStale(ws, now) {
  const stamp = Date.parse(ws.downloaded || ws.created || '')
  if (Number.isNaN(stamp)) return true
  return now - stamp > STALE_DOWNLOAD_MS
}
