import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow'
import { SCHEMA_VERSION, DEFAULT_PARAMS, DEFAULT_CHANNEL } from './schema/version'
import { migrateProject } from './schema/migrate'
import { toEditor, fromEditor } from './schema/editor'
import { pruneExtras, driveOf, channelDrive, channelPatch, freshId } from './schema/extras'
import * as WR from './schema/wires'
import { channelNames } from './nodeNames'
import { getPool, relay, cancelLane } from './engine/poolHost'
import { loadTheme, saveTheme, THEMES } from './theme'
import * as L from './layout'
import * as D from './driverParams'
import { PANEL_META, PANEL_IDS } from './panelMeta'
import { exportProjectJSON, exportWorkspaceZip } from './utils/export'
import * as W from './workspace'
import { stripLegacySuffix } from './legacy'
import * as R from './records'
import * as Z from './utils/zip'
import * as F from './utils/folder'
import { preloadedWorkspace } from './bootWorkspace'
import * as RUNS from './runs'
import { DEFAULT_TOOLBAR, sanitizeToolbar } from './toolbarItems'
import { channel, isPopout, openPanelWindow, openPanelGroupWindow, popoutPanelId, popoutPanelIds, SHARED_KEYS, SIM_INPUT_KEYS } from './popout'
import { loadBindings, saveBindings, DEFAULT_BINDINGS, COMMAND_IDS, findConflict } from './keymap'
import { planGroupConnect, planReplace } from './groupEdit'

let inGroupEdit = false

const POPOUT = isPopout()

let simWorker = null
let simReqId = 0
const simPending = new Map()

function simulateInWorker(project) {
  if (!simWorker) {
    simWorker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' })
    simWorker.onmessage = (e) => {
      if (relay(simWorker, e.data, 'live')) return
      const resolve = simPending.get(e.data.id)
      if (!resolve) return
      simPending.delete(e.data.id)
      resolve(e.data)
    }
  }
  const id = ++simReqId
  return new Promise((resolve) => {
    simPending.set(id, resolve)
    simWorker.postMessage({ id, project })
  })
}

let tdWorker = null
let tdReqId = 0

function startTdJob(msg, onMessage) {
  if (!tdWorker) tdWorker = new Worker(new URL('./engine/tdWorker.js', import.meta.url), { type: 'module' })
  const w = tdWorker
  const id = ++tdReqId
  w.onmessage = (e) => {
    if (relay(w, e.data, 'td')) return
    if (e.data.id === id) onMessage(e.data)
  }
  w.postMessage({ id, threads: getPool().size, ...msg })
  return id
}

function stopTdWorker() {
  if (tdWorker) tdWorker.terminate()
  tdWorker = null
  cancelLane('td')
}

let recordsQueue = Promise.resolve()

function inRecordsQueue(fn) {
  const p = recordsQueue.then(fn)
  recordsQueue = p.catch(() => {})
  return p
}

const runCache = new Map()

const maxSplCache = new Map()

const maxSplKey = (job) => `${job.path}|${job.sig}|${job.opts.f1}|${job.opts.f2}|${job.opts.points}`

export function runDataOf(id) {
  return runCache.get(id) || null
}

const projectNameOf = (path, data) => data?.name || W.baseName(path).replace(/\.speakerspice$/, '')

export function runIndex(st) {
  const out = []
  for (const [path, f] of Object.entries(st.workspace.files)) {
    if (f.kind !== 'project') continue
    const open = path === st.activeFile
    const recs = open ? st.records : f.data?.records
    const runs = Array.isArray(recs?.runs) ? recs.runs : []
    const project = open ? st.projectName || projectNameOf(path, null) : projectNameOf(path, f.data)
    for (const r of runs) {
      if (!RUNS.isLevelRun(r)) continue
      const record = Array.isArray(recs.ids) ? recs.ids.indexOf(r.recordId) : -1
      out.push({ ...r, path, project, open, record, recordName: record >= 0 ? RUNS.recordLabel(R.recordName(recs, record)) : 'Deleted record' })
    }
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0))
}

export const TD_DEFAULTS = {
  linear: { bandwidth: 2000, resolution: 0.5, burstHz: 40, burstCycles: 6.5, csdSlices: 8, csdStepMs: 5 },
  transient: {
    signal: { type: 'burst', hz: 40, cycles: 6.5, f1: 10, f2: 500, length: 1 },
    levelDb: 0, fs: 8000, duration: 0.5, bandwidth: 1000, nonlinear: true, compareLinear: true,
  },
  distortion: {
    mode: 'harmonics', hz: 40, levelDb: 0, harmonics: 10, bandwidth: 1000,
    f1: 15, f2: 200, points: 12, levels: [-12, -6, 0, 6, 12],
    bands: [20, 25, 31.5, 40, 50, 63], xLimit: 1.5, nonlinear: true,
  },
}

export function tdSettingsOf(extras) {
  const a = (extras?.analyses || []).find((x) => x.type === 'timedomain') || {}
  return {
    linear: { ...TD_DEFAULTS.linear, ...(a.linear || {}) },
    transient: { ...TD_DEFAULTS.transient, ...(a.transient || {}), signal: { ...TD_DEFAULTS.transient.signal, ...(a.transient?.signal || {}) } },
    distortion: { ...TD_DEFAULTS.distortion, ...(a.distortion || {}) },
  }
}

function syncPopoutUrl(ids, active) {
  if (typeof window === 'undefined' || !window.history?.replaceState || !ids.length) return
  const query = `id=${encodeURIComponent(ids.join(','))}${active ? `&active=${encodeURIComponent(active)}` : ''}`
  window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
}

const LAYOUT_KEY = 'speakerspice:layout'
const PRESETS_KEY = 'speakerspice:layoutPresets'
const TOOLBAR_KEY = 'speakerspice:toolbar'
const WORKSPACE_KEY = 'speakerspice:workspace'
const LEGACY_DRIVERS_KEY = 'speakerspice:customDrivers'
const STORAGE_CHOICE_KEY = 'speakerspice:workspaceChosen'

export const SNAPSHOT_LIMIT = 3

export const SNAPSHOT_COLORS = ['#f59e0b', '#10b981', '#8b5cf6']

function needsStorageChoice() {
  if (POPOUT) return false
  try { return !localStorage.getItem(STORAGE_CHOICE_KEY) } catch { return false }
}

let workspaceRestored = false

function loadWorkspace() {
  try {
    const raw = preloadedWorkspace() || localStorage.getItem(WORKSPACE_KEY)
    if (raw) {
      const parsed = W.parseWorkspace(raw)
      if (parsed.ok) { workspaceRestored = true; return parsed.workspace }
    }
  } catch {  }

  const fresh = W.newWorkspace()
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_DRIVERS_KEY))
    if (Array.isArray(legacy) && legacy.length) return W.writeDrivers(fresh, legacy)
  } catch {  }
  return fresh
}

const INITIAL_WORKSPACE = W.dropBoards(loadWorkspace())

function loadLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY))
    if (raw?.version === L.LAYOUT_VERSION) {
      const clean = L.sanitize(raw.tree, PANEL_IDS)
      if (clean && L.isOpen(clean, 'canvas')) return clean
    }
  } catch {  }
  return L.defaultLayout()
}

function loadPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY))
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

function loadToolbar() {
  try {
    return sanitizeToolbar(JSON.parse(localStorage.getItem(TOOLBAR_KEY))) || DEFAULT_TOOLBAR
  } catch { return DEFAULT_TOOLBAR }
}

let folderHandle = null

let folderState = { files: new Map(), folders: [] }

let folderTimer = null

let folderWriting = false
let folderAgain = false

const FOLDER_SYNC_MS = 700

function scheduleFolderSync() {
  if (!folderHandle || useStore.getState().folderStatus === 'locked') return
  clearTimeout(folderTimer)
  folderTimer = setTimeout(() => useStore.getState()._syncFolder(), FOLDER_SYNC_MS)
}

export { SCHEMA_VERSION, DEFAULT_PARAMS }

let idCounter = 1
export const nextId = (type) => `${type}_${Date.now().toString(36)}_${idCounter++}`

const HISTORY_LIMIT = 80

const defaultExtras = () => toEditor(migrateProject({ schemaVersion: SCHEMA_VERSION })).extras

function freeSpotNear(spot, nodes, step = 34, limit = 40) {
  const taken = (x, y) => nodes.some((n) => Math.abs(n.position.x - x) < step && Math.abs(n.position.y - y) < step)
  let { x, y } = spot
  for (let i = 0; i < limit && taken(x, y); i++) { x += step; y += step }
  return { x, y }
}

function graphSignature(nodes, edges, settings, extras = {}, tag = '') {
  return JSON.stringify([
    nodes.map((n) => [n.id, n.type, n.data.params]),
    edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle]),
    settings.fmin, settings.fmax, settings.npts, settings.voltage, settings.rg, settings.masking,
    extras.params, extras.wiring, extras.analyses, extras.probes, extras.components, extras.air,
    tag,
  ])
}

let applyingRemote = false
let muted = POPOUT

export function isLocked(s) {
  const n = s.recordNav
  return !!n && (n.busy || (n.selected < n.count - 1 && !n.editing))
}

export function recordNavOf(records, editing, busy) {
  return { count: records ? records.list.length : 1, selected: records ? records.selected : 0, editing: !!editing, busy: !!busy }
}

export const useStore = create((rawSet, get) => {
  const set = (partial, replace) => {
    rawSet(partial, replace)
    if (applyingRemote || muted || !channel) return
    const touched = typeof partial === 'function' ? SHARED_KEYS : Object.keys(partial)
    const patch = {}
    for (const k of SHARED_KEYS) if (touched.includes(k)) patch[k] = get()[k]
    if (Object.keys(patch).length) channel.postMessage({ type: 'patch', patch })
  }

  return {
  nodes: [],
  edges: [],
  projectName: '',
  workspace: INITIAL_WORKSPACE,
  activeFile: W.listProjects(INITIAL_WORKSPACE)[0] || null,
  wsSelection: [],
  wsExpanded: [],
  wsEdit: null,
  fileClipboard: null,
  workspacePrompt: needsStorageChoice(),
  folderStatus: 'off',
  folderName: null,
  folderError: null,
  folderSaved: null,
  selectedNodeId: null,
  results: null,
  metrics: null,
  velocityPopupNodeId: null,
  showDriverDB: false,
  showTSCalc: false,
  saveDriverFor: null,
  settings: {
    fmin: 10, fmax: 1000, npts: 512,
    voltage: 2.83, impedance: 4, power: 2, rg: 0,
    vThreshold: 17, masking: false, unwrapPhase: true, delayOffset: 0,
  },
  projectExtras: defaultExtras(),
  records: null,
  recordNav: recordNavOf(null, false, false),
  recordError: null,
  theme: loadTheme(),
  tdOpen: false,
  wiringOpen: false,
  wiringSel: null,
  dspOpen: false,
  dspChannel: null,
  tdTab: 'runs',
  tdJob: null,
  tdError: null,
  tdResults: { linear: null, transient: null, distortion: {} },
  tdQueue: [],
  tdDrawer: false,
  tdDraft: { name: '', levels: [0], ...RUNS.RUN_DEFAULTS },
  tdView: { runs: [], tab: 'output', linear: true },
  tdDataTick: 0,
  nlDriver: null,
  nlParam: 'Bl',
  nlOverlays: [],
  layout: loadLayout(),
  layoutPresets: loadPresets(),
  maximized: null,
  focusedPanel: POPOUT ? popoutPanelId() : 'canvas',
  draggingPanel: null,
  showSettings: false,
  settingsSection: 'keyboard',
  clipboard: null,
  contextMenu: null,

  openContextMenu: (x, y, target) => set({ contextMenu: { x, y, target } }),
  closeContextMenu: () => { if (get().contextMenu) set({ contextMenu: null }) },

  setDraggingPanel: (id) => set({ draggingPanel: id }),
  focusPanel: (id) => { if (get().focusedPanel !== id) set({ focusedPanel: id }) },
  toggleMaximize: (id) => set({ maximized: get().maximized === id ? null : id }),
  setShowSettings: (v, section) => set({ showSettings: v, ...(section ? { settingsSection: section } : {}) }),
  setSettingsSection: (id) => set({ settingsSection: id }),

  bindings: loadBindings(),
  setBinding: (id, combos) => {
    const next = { ...get().bindings, [id]: combos }
    set({ bindings: next })
    saveBindings(next)
  },
  assignBinding: (id, combo) => {
    const next = {}
    for (const cid of COMMAND_IDS) next[cid] = [...(get().bindings[cid] || [])]
    const stolenFrom = findConflict(next, combo, id)
    if (stolenFrom) next[stolenFrom] = next[stolenFrom].filter((c) => c !== combo)
    if (!next[id].includes(combo)) next[id] = [...next[id], combo]
    set({ bindings: next })
    saveBindings(next)
    return stolenFrom
  },
  removeBinding: (id, combo) => get().setBinding(id, (get().bindings[id] || []).filter((c) => c !== combo)),
  resetBindings: () => {
    const fresh = Object.fromEntries(COMMAND_IDS.map((id) => [id, [...(DEFAULT_BINDINGS[id] || [])]]))
    set({ bindings: fresh })
    saveBindings(fresh)
  },

  _commitLayout: (tree) => {
    if (!tree) return
    set({ layout: tree })
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: L.LAYOUT_VERSION, tree }))
    } catch {  }
  },

  layoutOps: {
    activate: (stackId, panelId) => get()._commitLayout(L.setActive(get().layout, stackId, panelId)),
    dock: (panelId, stackId, zone) => get()._commitLayout(L.dockPanel(get().layout, panelId, stackId, zone)),
    dockEdge: (panelId, edge) => get()._commitLayout(L.dockToEdge(get().layout, panelId, edge)),
    resize: (splitId, index, a, b) => get()._commitLayout(L.resizeChildren(get().layout, splitId, index, a, b)),
    dropOnTab: (panelId, stackId, index) => {
      const tree = get().layout
      const from = L.findPanelStack(tree, panelId)
      if (from?.id === stackId) {
        const cur = from.panels.indexOf(panelId)
        if (cur === index) return
        get()._commitLayout(L.moveTabInStack(tree, stackId, cur, index))
      } else {
        get()._commitLayout(L.dockPanel(tree, panelId, stackId, 'center'))
      }
    },
    close: (panelId) => {
      if (PANEL_META[panelId]?.closable === false) return
      const next = L.removePanel(get().layout, panelId)
      if (!next) return
      if (get().maximized === panelId) set({ maximized: null })
      get()._commitLayout(next)
    },
    open: (panelId) => {
      set({ maximized: null })
      get()._commitLayout(L.openPanel(get().layout, panelId, PANEL_META[panelId]?.dock))
      get().focusPanel(panelId)
    },
    toggle: (panelId) => {
      const ops = get().layoutOps
      if (L.isOpen(get().layout, panelId)) ops.close(panelId)
      else ops.open(panelId)
    },
    reset: () => { set({ maximized: null }); get()._commitLayout(L.defaultLayout()) },
  },

  saveLayoutPreset: (name) => {
    const presets = [
      ...get().layoutPresets.filter((p) => p.name !== name),
      { name, tree: get().layout },
    ]
    set({ layoutPresets: presets })
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)) } catch {  }
  },
  applyLayoutPreset: (name) => {
    const p = get().layoutPresets.find((x) => x.name === name)
    if (!p) return
    const clean = L.sanitize(p.tree, PANEL_IDS)
    if (!clean) return
    set({ maximized: null })
    get()._commitLayout(L.isOpen(clean, 'canvas') ? clean : L.dockToEdge(clean, 'canvas', 'right'))
  },
  toolbar: loadToolbar(),
  setToolbar: (ids) => {
    const kept = sanitizeToolbar(ids)
    const clean = !kept || (kept.length === 0 && ids.length > 0) ? DEFAULT_TOOLBAR : kept
    set({ toolbar: clean })
    try { localStorage.setItem(TOOLBAR_KEY, JSON.stringify(clean)) } catch {  }
  },
  toggleToolbarItem: (id) => {
    const cur = get().toolbar
    get().setToolbar(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  },
  moveToolbarItem: (id, delta) => {
    const cur = [...get().toolbar]
    const i = cur.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= cur.length) return
    ;[cur[i], cur[j]] = [cur[j], cur[i]]
    get().setToolbar(cur)
  },
  resetToolbar: () => get().setToolbar(DEFAULT_TOOLBAR),

  deleteLayoutPreset: (name) => {
    const presets = get().layoutPresets.filter((p) => p.name !== name)
    set({ layoutPresets: presets })
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)) } catch {  }
  },

  xZoom: {},
  setXZoom: (id, range) => set({ xZoom: { ...get().xZoom, [id]: range } }),
  history: [],
  future: [],

  pushHistory: () => {
    if (inGroupEdit) return
    const { nodes, edges, history, projectExtras } = get()
    const snap = JSON.parse(JSON.stringify({ nodes, edges, projectExtras }))
    set({ history: [...history.slice(-(HISTORY_LIMIT - 1)), snap], future: [] })
  },
  undo: () => {
    if (isLocked(get())) return
    const { history, future, nodes, edges, projectExtras } = get()
    if (!history.length) return
    const prev = history[history.length - 1]
    set({
      nodes: prev.nodes, edges: prev.edges,
      history: history.slice(0, -1),
      future: [...future, { nodes, edges, projectExtras }],
    })
    if (prev.projectExtras) get()._setExtras(prev.projectExtras)
    get().scheduleCompute()
  },
  redo: () => {
    if (isLocked(get())) return
    const { history, future, nodes, edges, projectExtras } = get()
    if (!future.length) return
    const next = future[future.length - 1]
    set({
      nodes: next.nodes, edges: next.edges,
      future: future.slice(0, -1),
      history: [...history, { nodes, edges, projectExtras }],
    })
    if (next.projectExtras) get()._setExtras(next.projectExtras)
    get().scheduleCompute()
  },

  onNodesChange: (changes) => {
    if (isLocked(get())) changes = changes.filter((c) => c.type === 'select' || c.type === 'dimensions')
    if (!changes.length) return
    set({ nodes: applyNodeChanges(changes, get().nodes) })
    if (changes.some((c) => c.type === 'remove')) get().scheduleCompute()
  },
  onEdgesChange: (changes) => {
    if (isLocked(get())) changes = changes.filter((c) => c.type === 'select')
    if (!changes.length) return
    if (changes.some((c) => c.type === 'remove')) get().pushHistory()
    set({ edges: applyEdgeChanges(changes, get().edges) })
    if (changes.some((c) => c.type === 'remove')) get().scheduleCompute()
  },
  onConnect: (conn) => {
    if (isLocked(get())) return
    const plan = planGroupConnect(get().nodes, get().edges, conn)
    if (plan.error) { get().showCanvasAlert(plan.error); return }
    if (!plan.conns.length) return
    get().pushHistory()
    let edges = get().edges
    for (const c of plan.conns) edges = addEdge({ ...c, type: 'default' }, edges)
    set({ edges })
    get().scheduleCompute()
  },

  canvasAlert: null,
  showCanvasAlert: (text) => set({ canvasAlert: text ? { text, at: Date.now() + Math.random() } : null }),

  setSelected: (id) => set({ selectedNodeId: id }),

  addNode: (type, position) => {
    if (isLocked(get())) return null
    get().pushHistory()
    const id = nextId(type)
    const params = JSON.parse(JSON.stringify(DEFAULT_PARAMS[type]))
    const node = { id, type, position, data: { params }, selected: true }
    set({
      nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
      edges: get().edges.some((e) => e.selected)
        ? get().edges.map((e) => (e.selected ? { ...e, selected: false } : e))
        : get().edges,
      selectedNodeId: id,
    })
    get()._wireNewDrivers([node])
    get().scheduleCompute()
    return id
  },

  applyDriverParams: (id, params) => {
    if (isLocked(get())) return
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const merged = { ...node.data.params, ...params }
    set({
      nodes: get().nodes.map((n) => (n.id === id
        ? { ...n, data: { ...n.data, params: merged, baseline: D.pickTS(merged) } }
        : n)),
    })
    get().scheduleCompute()
  },

  restoreDriverParams: (id) => {
    if (isLocked(get())) return
    const node = get().nodes.find((n) => n.id === id)
    const base = node && D.baselineOf(node)
    if (!base) return
    get().updateParams(id, { Znom: null, ...base })
  },

  saveDriverAsCustom: (id, name) => {
    const node = get().nodes.find((n) => n.id === id)
    const model = (name || '').trim()
    if (!node || node.type !== 'driver' || !model) return
    const entry = { brand: 'Custom', model, ...D.pickTS(node.data.params) }
    const drivers = W.readDrivers(get().workspace)
    const at = drivers.findIndex((d) => d.model === model)
    get().setCustomDrivers(at < 0
      ? [...drivers, entry]
      : drivers.map((d, i) => (i === at ? entry : d)))
  },

  setDriverParam: (id, field, value) => {
    if (isLocked(get())) return
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    get()._markDriverBaseline(id)
    if (!D.COUPLED.includes(field)) { get().updateParams(id, { [field]: value }); return }
    const basis = D.basisOf(node)
    if (!basis.includes(field)) return
    const { ok, values } = D.derive({ ...node.data.params, [field]: value }, basis)
    get().updateParams(id, ok ? { ...values, [field]: value } : { [field]: value })
  },

  _markDriverBaseline: (id) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || D.baselineOf(node)) return
    set({
      nodes: get().nodes.map((n) => (n.id === id
        ? { ...n, data: { ...n.data, baseline: D.pickTS(n.data.params) } } : n)),
    })
  },

  setDriverLock: (id, field, held) => {
    if (isLocked(get())) return
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !D.COUPLED.includes(field)) return
    const basis = D.basisOf(node)
    const next = held ? D.lockParam(basis, field) : D.unlockParam(basis, field)
    if (!next) return
    get()._markDriverBaseline(id)
    const { ok, values } = D.derive(node.data.params, next)
    set({
      nodes: get().nodes.map((n) => (n.id === id
        ? { ...n, data: { ...n.data, locks: next, params: ok ? { ...n.data.params, ...values } : n.data.params } }
        : n)),
    })
    if (ok) get().scheduleCompute()
  },

  editGroup: (ids, fn) => {
    if (isLocked(get()) || !ids.length) return
    get().pushHistory()
    inGroupEdit = true
    try { for (const id of ids) fn(id) } finally { inGroupEdit = false }
  },

  updateParams: (id, patch) => {
    if (isLocked(get())) return
    const nodes = get().nodes
    if (!nodes.some((n) => n.id === id)) return
    set({
      nodes: nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, ...patch } } } : n),
    })
    if (['count', 'dvc', 'wiring'].some((k) => k in patch)) get().setWiring(get().projectExtras.wiring, false)
    get().scheduleCompute()
  },

  deleteSelected: () => {
    if (isLocked(get())) return
    const { nodes, edges } = get()
    const selNodes = nodes.filter((n) => n.selected).map((n) => n.id)
    const selEdges = edges.filter((e) => e.selected).map((e) => e.id)
    if (!selNodes.length && !selEdges.length) return
    get().pushHistory()
    const kept = nodes.filter((n) => !n.selected)
    set({
      nodes: kept,
      edges: edges.filter((e) => !e.selected && !selNodes.includes(e.source) && !selNodes.includes(e.target)),
      selectedNodeId: null,
    })
    if (selNodes.length) get()._setExtras(pruneExtras(get().projectExtras, kept.map((n) => n.id)))
    get().scheduleCompute()
  },

  duplicateSelected: () => {
    if (isLocked(get())) return
    const { nodes } = get()
    const sel = nodes.filter((n) => n.selected)
    if (!sel.length) return
    get().pushHistory()
    const copies = sel.map((n) => ({
      ...n,
      id: nextId(n.type),
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      selected: false,
      data: { params: JSON.parse(JSON.stringify(n.data.params)) },
    }))
    set({
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...copies.map((c) => ({ ...c, selected: true }))],
      selectedNodeId: copies[copies.length - 1].id,
    })
    get()._wireNewDrivers(copies)
    get().scheduleCompute()
  },

  selectAll: () => set({ nodes: get().nodes.map((n) => ({ ...n, selected: true })) }),

  setSelection: (ids, additive = false) => {
    const want = new Set(ids)
    const nodes = get().nodes.map((n) => {
      const selected = want.has(n.id) || (additive && !!n.selected)
      return n.selected === selected ? n : { ...n, selected }
    })
    const last = nodes.filter((n) => n.selected).pop()
    set({ nodes, selectedNodeId: last ? last.id : null })
  },

  copySelection: () => {
    const { nodes, edges } = get()
    const sel = nodes.filter((n) => n.selected)
    if (!sel.length) return 0
    const ids = new Set(sel.map((n) => n.id))
    set({
      clipboard: {
        nodes: sel.map((n) => ({
          type: n.type, id: n.id, position: { ...n.position }, params: JSON.parse(JSON.stringify(n.data.params)),
          ...(n.data.baseline ? { baseline: { ...n.data.baseline } } : {}),
        })),
        edges: edges
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .map((e) => ({ source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle })),
      },
    })
    return sel.length
  },
  cutSelection: () => {
    if (isLocked(get())) return
    if (!get().copySelection()) return
    get().deleteSelected()
  },
  pasteClipboard: (at) => {
    if (isLocked(get())) return
    const clip = get().clipboard
    if (!clip?.nodes?.length) return
    get().pushHistory()
    const dx = at ? at.x - Math.min(...clip.nodes.map((n) => n.position.x)) : 40
    const dy = at ? at.y - Math.min(...clip.nodes.map((n) => n.position.y)) : 40
    const remap = {}
    const fresh = clip.nodes.map((n) => {
      const id = nextId(n.type)
      remap[n.id] = id
      return {
        id,
        type: n.type,
        position: { x: n.position.x + dx, y: n.position.y + dy },
        selected: true,
        data: {
          params: JSON.parse(JSON.stringify({ ...DEFAULT_PARAMS[n.type], ...n.params })),
          ...(n.baseline ? { baseline: { ...n.baseline } } : {}),
        },
      }
    })
    const freshEdges = clip.edges.map((e) => ({
      id: `e_${remap[e.source]}_${remap[e.target]}_${Math.random().toString(36).slice(2, 7)}`,
      source: remap[e.source], sourceHandle: e.sourceHandle,
      target: remap[e.target], targetHandle: e.targetHandle,
    }))
    set({
      nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), ...fresh],
      edges: [...get().edges, ...freshEdges],
      selectedNodeId: fresh[fresh.length - 1].id,
    })
    get()._wireNewDrivers(fresh)
    get().scheduleCompute()
  },

  replaceSelection: () => {
    if (isLocked(get())) return
    const { nodes, edges, clipboard } = get()
    const plan = planReplace(nodes, edges, clipboard, nodes.filter((n) => n.selected).map((n) => n.id))
    if (plan.error) { get().showCanvasAlert(plan.error); return }
    get().pushHistory()
    set({
      nodes: nodes.map((n) => {
        if (!plan.params[n.id]) return n
        const { baseline, ...data } = n.data
        return { ...n, data: { ...data, params: { ...DEFAULT_PARAMS[n.type], ...plan.params[n.id] }, ...(plan.baseline ? { baseline: { ...plan.baseline } } : {}) } }
      }),
      edges: plan.edges,
    })
    get().setWiring(get().projectExtras.wiring, false)
    if (plan.dropped) get().showCanvasAlert(`${plan.dropped} join${plan.dropped > 1 ? 's' : ''} to taps the copied node doesn't have ${plan.dropped > 1 ? 'were' : 'was'} removed.`)
    get().scheduleCompute()
  },

  _flowApi: null,
  addNodeAtCursor: (type) => {
    if (isLocked(get())) return
    const api = get()._flowApi
    const spot = api?.dropPoint?.() || { x: 80, y: 80 }
    return get().addNode(type, freeSpotNear(spot, get().nodes))
  },

  nudgeVoltage: (delta) => {
    if (isLocked(get())) return
    const v = Math.max(0, Math.round((get().settings.voltage + delta) * 100) / 100)
    get().setAmp('voltage', v)
  },
  recomputeNow: () => {
    useStore.setState({ _lastSig: '' })
    get().scheduleCompute()
  },

  updateSettings: (patch) => {
    if (isLocked(get())) return
    set({ settings: { ...get().settings, ...patch } })
    if ('rg' in patch) {
      const w = get().projectExtras.wiring
      const ch = WR.toolbarChannel(w)
      if (ch && typeof ch.outputOhms !== 'string') {
        get()._setExtras({ ...get().projectExtras, wiring: { ...w, channels: w.channels.map((c) => (c === ch ? { ...c, outputOhms: Number(patch.rg) || 0 } : c)) } })
      }
    }
    get().scheduleCompute()
  },
  setAmp: (field, value) => {
    if (isLocked(get())) return
    const ex = get().projectExtras
    const w = ex.wiring
    const ch = WR.toolbarChannel(w)
    if (!ch) return
    const patch = channelPatch(channelDrive(w, get().nodes, ex.params, ch.id), field, value)
    if (!patch) return
    const before = Number(ch.volts)
    const ratio = 'volts' in patch && typeof ch.volts === 'number' && before > 0 ? patch.volts / before : null
    const channels = w.channels.map((c) => {
      if (c === ch) return { ...c, ...patch }
      if (ratio == null || typeof c.volts !== 'number') return c
      return { ...c, volts: Number((c.volts * ratio).toPrecision(12)) }
    })
    get().setWiring({ ...w, channels }, false)
  },
  setChannelDrive: (id, field, value, undoable = true) => {
    if (isLocked(get())) return
    const ex = get().projectExtras
    const patch = channelPatch(channelDrive(ex.wiring, get().nodes, ex.params, id), field, value)
    if (patch) get().updateChannel(id, patch, undoable)
  },

  _setExtras: (extras) => {
    const { voltage, rg } = driveOf(extras.wiring, extras.params)
    const d = channelDrive(extras.wiring, get().nodes, extras.params)
    const s = get().settings
    const settings = Number.isFinite(voltage)
      ? (() => {
        const impedance = Number.isFinite(d.ohms) ? d.ohms : s.impedance || 4
        return { ...s, voltage, rg, impedance, power: (voltage * voltage) / impedance }
      })()
      : s
    set({ projectExtras: extras, settings })
  },
  setExtra: (key, value, undoable = true) => {
    if (isLocked(get())) return
    if (undoable) get().pushHistory()
    get()._setExtras({ ...get().projectExtras, [key]: value })
    get().scheduleCompute()
  },
  _wireNewDrivers: (added) => {
    const drivers = added.filter((n) => n.type === 'driver')
    const w = get().projectExtras.wiring
    if (!drivers.length || !w?.channels?.length) return
    get().setWiring({ ...w, wires: [...(w.wires || []), ...WR.parallelWires(drivers, w.channels[0].id)] }, false)
  },
  setWiring: (wiring, undoable = true) => {
    if (isLocked(get())) return
    const wires = WR.liveWires(wiring.wires, WR.allTerminals(wiring, get().nodes))
    get().setExtra('wiring', { ...wiring, wires }, undoable)
  },
  addWire: (a, b) => {
    if (isLocked(get())) return 'This record is read-only.'
    const w = get().projectExtras.wiring
    const why = WR.wireRefusal(w, a, b, channelNames(w.channels))
    if (why) return why
    get().setWiring({ ...w, wires: [...(w.wires || []), { a, b }] })
    return null
  },
  removeWire: (index) => {
    const w = get().projectExtras.wiring
    get().setWiring({ ...w, wires: (w.wires || []).filter((_, i) => i !== index) })
  },
  moveWireEnd: (index, end, to) => {
    if (isLocked(get())) return 'This record is read-only.'
    const w = get().projectExtras.wiring
    const cable = w.wires?.[index]
    if (!cable) return null
    const other = end === 'a' ? cable.b : cable.a
    const rest = { ...w, wires: w.wires.filter((_, i) => i !== index) }
    const why = WR.wireRefusal(rest, other, to, channelNames(rest.channels))
    if (why) return why
    get().setWiring({ ...w, wires: w.wires.map((c, i) => (i === index ? { ...c, [end]: to } : c)) })
    return null
  },
  placeWiringNode: (id, pos, undoable = false) => {
    if (isLocked(get())) return
    if (undoable) get().pushHistory()
    const w = get().projectExtras.wiring
    get()._setExtras({ ...get().projectExtras, wiring: { ...w, layout: { ...(w.layout || {}), [id]: pos } } })
  },
  updateChannel: (id, patch, undoable = true) => {
    const w = get().projectExtras.wiring
    get().setWiring({ ...w, channels: w.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, undoable)
  },
  addChannel: () => {
    if (isLocked(get())) return undefined
    const w = get().projectExtras.wiring
    const id = freshId('ch', w.channels.map((c) => c.id))
    const ch = { ...DEFAULT_CHANNEL, id, label: 'Channel' }
    get().setWiring({ ...w, channels: [...w.channels, ch] })
    return id
  },
  removeChannel: (id) => {
    const w = get().projectExtras.wiring
    if (w.channels.length < 2) return
    const channels = w.channels.filter((c) => c.id !== id)
    get().setWiring({ ...w, channels, toolbar: w.toolbar === id ? channels[0].id : w.toolbar })
  },
  setToolbarChannel: (id) => {
    const w = get().projectExtras.wiring
    if (!w.channels.some((c) => c.id === id)) return
    get().setWiring({ ...w, toolbar: id })
  },
  resetWiring: () => {
    if (isLocked(get())) return
    get().pushHistory()
    const nodes = get().nodes.map((n) => (n.type === 'driver' && WR.isCustom(n.data.params)
      ? { ...n, data: { ...n.data, params: { ...n.data.params, wiring: 'parallel' } } }
      : n))
    set({ nodes })
    const w = get().projectExtras.wiring
    const wires = WR.parallelWires(nodes.filter((n) => n.type === 'driver'), w.channels[0].id)
    get().setWiring({ ...w, wires }, false)
  },
  setDriverArrangement: (id, patch) => {
    if (isLocked(get())) return null
    const node = get().nodes.find((n) => n.id === id)
    if (!node || node.type !== 'driver') return null
    get().pushHistory()
    const before = node.data.params
    const after = { ...before, ...patch }
    const w = get().projectExtras.wiring
    let wires = w.wires || []
    let note = null
    if (!WR.isCustom(before) && WR.isCustom(after)) {
      const inner = WR.arrangementWires({ id, params: before })
      const plus = WR.nodeTerm(id, '', '+')
      const minus = WR.nodeTerm(id, '', '-')
      const swap = (t) => (t === plus ? inner.plus : t === minus ? inner.minus : t)
      wires = [...wires.map((c) => ({ a: swap(c.a), b: swap(c.b) })), ...inner.wires]
    } else if (WR.isCustom(before) && !WR.isCustom(after)) {
      const status = WR.driverStatus(w, get().nodes).get(id)
      const mine = (t) => WR.parseTerm(t)?.node === id
      wires = wires.filter((c) => !mine(c.a) && !mine(c.b))
      const ch = status?.channels?.[0]
      if (ch) wires = [...wires, ...WR.parallelWires([{ id, params: after }], ch)]
      const name = w.channels.find((c) => c.id === ch)?.label
      note = ch ? `Its coil cables were replaced: it is now on ${name || ch}, wired as a whole.` : 'Its coil cables were removed.'
    }
    const nodes = get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, params: after } } : n))
    set({ nodes })
    get().setWiring({ ...w, wires }, false)
    return note
  },
  setTaps: (id, taps) => {
    if (isLocked(get())) return
    get().pushHistory()
    const live = new Set(taps.map((t) => `tap:${t.id}`))
    const gone = (node, handle) => node === id && handle?.startsWith('tap:') && !live.has(handle)
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, taps } } } : n)),
      edges: get().edges.filter((e) => !gone(e.source, e.sourceHandle) && !gone(e.target, e.targetHandle)),
    })
    get().scheduleCompute()
  },
  insertThroatChamber: (driverId, face) => {
    if (isLocked(get())) return
    const { nodes, edges } = get()
    const drv = nodes.find((n) => n.id === driverId)
    const joined = edges.filter((e) => (e.source === driverId && e.sourceHandle === face) || (e.target === driverId && e.targetHandle === face))
    if (!drv || !joined.length) return null
    get().pushHistory()
    const id = nextId('chamber')
    const p = drv.data.params
    const sd = (Number(p.Sd) || 500) * Math.max(1, Number(p.count) || 1)
    const params = { ...JSON.parse(JSON.stringify(DEFAULT_PARAMS.chamber)), label: 'Throat chamber', volume: Math.round(sd * 3) / 1000, length: 5 }
    const far = nodes.find((n) => n.id === (joined[0].source === driverId ? joined[0].target : joined[0].source))
    const mid = far ? { x: (drv.position.x + far.position.x) / 2, y: (drv.position.y + far.position.y) / 2 + 120 } : { x: drv.position.x + 220, y: drv.position.y + 120 }
    const position = freeSpotNear(mid, nodes, 120)
    const rewired = edges.map((e) => {
      if (!joined.includes(e)) return e
      return e.source === driverId
        ? { ...e, id: `e_${id}_${e.target}`, source: id, sourceHandle: 'out' }
        : { ...e, id: `e_${e.source}_${id}`, target: id, targetHandle: 'out' }
    })
    set({
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), { id, type: 'chamber', position, data: { params }, selected: true }],
      edges: [...rewired, { id: `e_${driverId}_${id}`, source: driverId, sourceHandle: face, target: id, targetHandle: 'in' }],
      selectedNodeId: id,
    })
    get().scheduleCompute()
    return id
  },
  addProbe: (probe) => {
    if (isLocked(get())) return
    const probes = get().projectExtras.probes || []
    const id = freshId('probe', probes.map((p) => p.id))
    get().setExtra('probes', [...probes, { id, ...probe }])
    return id
  },

  takeSnapshot: () => {
    const { results, workspace, projectName } = get()
    if (!results || !results.ok) return
    const snapshots = W.readSnapshots(workspace)
    if (snapshots.length >= SNAPSHOT_LIMIT) return

    const used = new Set(snapshots.map((s) => s.color))
    const taken = new Set(snapshots.map((s) => s.label))
    let label = projectName || 'Snapshot'
    for (let n = 2; taken.has(label); n++) label = `${projectName || 'Snapshot'} ${n}`

    get()._commitWorkspace(W.writeSnapshots(workspace, [...snapshots, {
      id: Date.now(),
      label,
      project: projectName,
      taken: new Date().toISOString(),
      color: SNAPSHOT_COLORS.find((c) => !used.has(c)) || SNAPSHOT_COLORS[0],
      freqs: results.freqs,
      splCombined: results.splCombined,
      zinMag: results.zinMag,
      excursion: results.excursion,
      excursionRatio: results.excursionRatio,
      groupDelay: results.groupDelay,
      power: results.power,
    }]))
  },
  removeSnapshot: (id) => {
    const ws = get().workspace
    get()._commitWorkspace(W.writeSnapshots(ws, W.readSnapshots(ws).filter((s) => s.id !== id)))
  },
  renameSnapshot: (id, label) => {
    const ws = get().workspace
    get()._commitWorkspace(W.writeSnapshots(ws, W.readSnapshots(ws).map((s) => (s.id === id ? { ...s, label } : s))))
  },

  setVelocityPopup: (id) => set({ velocityPopupNodeId: id }),
  setShowDriverDB: (v) => set({ showDriverDB: v }),
  setShowTSCalc: (v) => set({ showTSCalc: v }),
  setSaveDriverFor: (id) => set({ saveDriverFor: id }),
  setTheme: (theme) => {
    if (!THEMES.some(([k]) => k === theme)) return
    saveTheme(theme)
    set({ theme })
  },
  openTimeDomain: (tab) => {
    if (typeof Worker !== 'undefined') getPool().warm()
    set({ tdOpen: true, wiringOpen: false, dspOpen: false, ...(tab ? { tdTab: tab } : {}) })
  },
  openWiring: (nodeId) => set({ wiringOpen: true, tdOpen: false, dspOpen: false, ...(nodeId ? { wiringSel: nodeId } : {}) }),
  closeWiring: () => set({ wiringOpen: false }),
  setWiringSel: (id) => set({ wiringSel: id }),
  openDsp: (channelId) => set({ dspOpen: true, tdOpen: false, wiringOpen: false, ...(channelId ? { dspChannel: channelId } : {}) }),
  closeDsp: () => set({ dspOpen: false }),
  setDspChannel: (id) => set({ dspChannel: id }),
  setChannelDsp: (id, dsp, undoable = true) => get().updateChannel(id, { dsp }, undoable),
  closeTimeDomain: () => set({ tdOpen: false }),
  setTdTab: (tab) => set({ tdTab: tab }),
  setTdSettings: (section, patch) => {
    if (isLocked(get())) return
    const ex = get().projectExtras
    const cur = tdSettingsOf(ex)
    const others = (ex.analyses || []).filter((x) => x.type !== 'timedomain')
    const base = (ex.analyses || []).find((x) => x.type === 'timedomain') || { id: 'timedomain', type: 'timedomain' }
    const next = { ...base, [section]: { ...cur[section], ...patch } }
    set({ projectExtras: { ...ex, analyses: [...others, next] } })
    get().saveActiveFile()
  },
  tdSignature: () => {
    const { nodes, edges, settings, projectExtras } = get()
    const ex = { ...projectExtras, analyses: (projectExtras.analyses || []).filter((a) => a.type !== 'timedomain') }
    return graphSignature(nodes, edges, settings, ex, 'td')
  },
  runTimeDomain: (kind, mode) => {
    const st = get()
    if (!st.nodes.length) return
    if (st.tdQueue.some((j) => j.status === 'running')) return
    if (st.tdJob) stopTdWorker()
    const cfg = tdSettingsOf(st.projectExtras)
    const m = kind === 'distortion' ? (mode || cfg.distortion.mode) : undefined
    const project = fromEditor({ name: st.projectName, nodes: st.nodes, edges: st.edges, settings: st.settings, extras: st.projectExtras })
    const sig = st.tdSignature()
    const opts = cfg[kind]
    set({ tdJob: { kind, mode: m, fraction: 0, message: 'Starting' }, tdError: null })
    startTdJob({ kind, project, opts, mode: m }, (msg) => {
      if (msg.type === 'progress') {
        set({ tdJob: { kind, mode: m, fraction: msg.fraction, message: msg.message } })
        return
      }
      if (msg.type === 'error') {
        set({ tdJob: null, tdError: msg.projectErrors?.length ? msg.projectErrors.join('; ') : msg.error })
        return
      }
      const r = get().tdResults
      const entry = { ...msg.result, sig, opts, at: Date.now() }
      set({
        tdJob: null,
        tdResults: kind === 'distortion'
          ? { ...r, distortion: { ...r.distortion, [m]: entry } }
          : { ...r, [kind]: entry },
      })
    })
  },
  cancelTimeDomain: () => {
    stopTdWorker()
    const q = get().tdQueue
    set({ tdJob: null, tdQueue: q.filter((j) => j.status !== 'running') })
    get()._pumpTdQueue()
  },

  setTdDrawer: (open) => set({ tdDrawer: !!open }),
  setTdDraft: (patch) => set({ tdDraft: { ...get().tdDraft, ...patch } }),
  queueRuns: async () => {
    const st = get()
    if (!st.nodes.length || POPOUT) return []
    const draft = st.tdDraft
    const levels = RUNS.cleanLevels(draft.levels)
    if (!levels.length) return []
    const project = st.serialize()
    const sig = st.tdSignature()
    const path = st.activeFile
    const bp = await inRecordsQueue(async () => {
      const out = await R.branchPoint(get().records, project)
      set({ records: out.records, recordNav: recordNavOf(out.records, get().recordNav.editing, get().recordNav.busy) })
      get().saveActiveFile()
      return out
    })
    const title = (draft.name || '').trim() || RUNS.defaultRunName(project.name, R.recordName(bp.records, bp.records.selected))
    const range = { f1: Number(draft.f1) || RUNS.RUN_DEFAULTS.f1, f2: Number(draft.f2) || RUNS.RUN_DEFAULTS.f2, points: Math.round(Number(draft.points)) || RUNS.RUN_DEFAULTS.points }
    const jobs = levels.map((levelDb) => ({
      id: R.newId('run'), analysis: 'level', opts: { ...range, levelDb }, levelDb, content: bp.content, name: project.name,
      parent: bp.parent, recordId: bp.recordId, path, sig, title,
      status: 'queued', fraction: 0, message: 'Queued',
    }))
    set({ tdQueue: [...get().tdQueue, ...jobs] })
    get()._pumpTdQueue()
    return jobs.map((j) => j.id)
  },
  _pumpTdQueue: () => {
    const q = get().tdQueue
    if (q.some((j) => j.status === 'running')) return
    const job = q.find((j) => j.status === 'queued')
    if (!job) return
    if (get().tdJob) stopTdWorker()
    const kind = 'level'
    const mode = undefined
    const maxSpl = maxSplCache.get(maxSplKey(job))
    const update = (patch) => set({ tdQueue: get().tdQueue.map((j) => (j.id === job.id ? { ...j, ...patch } : j)) })
    const finish = (failed) => {
      set({
        tdJob: null,
        tdQueue: failed
          ? get().tdQueue.map((j) => (j.id === job.id ? { ...j, status: 'failed', error: failed.error } : j))
          : get().tdQueue.filter((j) => j.id !== job.id),
      })
      get()._pumpTdQueue()
    }
    update({ status: 'running', message: 'Starting' })
    set({ tdJob: { kind, mode, fraction: 0, message: 'Starting', runId: job.id } })
    startTdJob({ kind, project: { ...job.content, name: job.name }, opts: { ...job.opts, ...(maxSpl ? { maxSpl } : {}) }, mode }, (msg) => {
      if (msg.type === 'progress') {
        update({ fraction: msg.fraction, message: msg.message })
        set({ tdJob: { kind, mode, fraction: msg.fraction, message: msg.message, runId: job.id } })
        return
      }
      if (msg.type === 'error') {
        finish({ error: msg.projectErrors?.length ? msg.projectErrors.join('; ') : msg.error })
        return
      }
      update({ fraction: 1, message: 'Storing' })
      get()._storeRun(job, msg.result, msg.warnings).then(() => finish(), (err) => finish({ error: err.message }))
    })
  },
  _storeRun: async (job, result, warnings) => {
    maxSplCache.set(maxSplKey(job), result.maxSpl)
    const info = RUNS.projectInfo(job.content)
    const data = { analysis: 'level', opts: job.opts, result: RUNS.packResult(result) }
    const meta = {
      title: job.title, analysis: 'level', levelDb: job.levelDb, opts: job.opts, sig: job.sig, info,
      ...(warnings?.length ? { warnings } : {}),
    }
    await get()._updateProject(job.path, async ({ records }) => {
      if (!records) throw new Error('The project this run belongs to has no records.')
      return { records: await R.addRun(records, { id: job.id, parent: job.parent, recordId: job.recordId, content: job.content, data, meta }) }
    })
    runCache.set(job.id, { data, content: job.content })
    set({ tdDataTick: get().tdDataTick + 1 })
  },
  _updateProject: (path, fn) => inRecordsQueue(async () => {
    if (path === get().activeFile) {
      const out = await fn({ records: get().records, project: get().serialize() })
      const nav = get().recordNav
      if (out.records) set({ records: out.records, recordNav: recordNavOf(out.records, nav.editing, nav.busy) })
      get().saveActiveFile()
      return
    }
    const entry = get().workspace.files[path]
    if (!entry || entry.kind !== 'project') throw new Error('The project this run belongs to is no longer in the workspace.')
    const out = await fn({ records: R.readRecords(entry.data?.records), project: entry.data })
    const data = { ...entry.data, ...(out.records ? { records: out.records } : {}) }
    get()._commitWorkspace(W.writeFile(get().workspace, path, { kind: 'project', data }))
  }),
  removeQueued: (id) => {
    const job = get().tdQueue.find((j) => j.id === id)
    if (job?.status === 'running') { get().cancelTimeDomain(); return }
    set({ tdQueue: get().tdQueue.filter((j) => j.id !== id) })
  },
  loadRunData: (entry) => {
    if (!entry || runCache.has(entry.id)) return
    runCache.set(entry.id, { loading: true })
    const recs = entry.path === get().activeFile ? get().records : R.readRecords(get().workspace.files[entry.path]?.data?.records)
    Promise.resolve()
      .then(() => {
        if (!recs) throw new Error('Its project has no records.')
        return R.readRun(recs, entry.oid)
      })
      .then((r) => runCache.set(entry.id, { data: r.data, content: r.content }), (err) => runCache.set(entry.id, { error: err.message }))
      .then(() => set({ tdDataTick: get().tdDataTick + 1 }))
  },
  restoreRunAsRecord: (entry) => get()._recordOp(async () => {
    const src = entry.path === get().activeFile ? get().records : R.readRecords(get().workspace.files[entry.path]?.data?.records)
    if (!src) throw new Error('The run\'s project has no records.')
    const { content } = await R.readRun(src, entry.oid)
    const records = await R.addRecordFrom(get().records, get().serialize(), content)
    get()._showRecord(records, content)
  }),
  deleteRuns: async (entries) => {
    const byPath = new Map()
    for (const e of entries) byPath.set(e.path, [...(byPath.get(e.path) || []), e.id])
    for (const [path, ids] of byPath) {
      await get()._updateProject(path, async ({ records }) => ({ records: records ? await R.deleteRuns(records, ids) : null }))
      for (const id of ids) runCache.delete(id)
    }
    const all = entries.map((e) => e.id)
    const v = get().tdView
    if (v.runs.some((r) => all.includes(r))) set({ tdView: { ...v, runs: v.runs.filter((r) => !all.includes(r)) } })
  },
  renameRun: (entry, title) => get()._updateProject(entry.path, async ({ records }) => ({
    records: records ? { ...records, runs: records.runs.map((r) => (r.id === entry.id ? { ...r, title } : r)) } : null,
  })),
  setNl: (patch) => set(patch),

  viewRuns: (ids, overlay = false) => {
    const v = get().tdView
    const runs = overlay ? [...v.runs, ...ids.filter((id) => !v.runs.includes(id))] : [...new Set(ids)]
    set({ tdView: { ...v, runs }, tdTab: 'runs' })
  },
  closeRun: (id) => {
    const v = get().tdView
    set({ tdView: { ...v, runs: id ? v.runs.filter((r) => r !== id) : [] } })
  },
  setViewTab: (tab) => set({ tdView: { ...get().tdView, tab } }),
  setViewLinear: (on) => set({ tdView: { ...get().tdView, linear: !!on } }),

  _computeTimer: null,
  _lastSig: '',
  _simToken: null,
  simBusy: false,
  simError: null,
  scheduleCompute: () => {
    if (POPOUT) return
    const st = get()
    if (st._computeTimer) clearTimeout(st._computeTimer)
    const timer = setTimeout(async () => {
      const { nodes, edges, settings, projectExtras, projectName } = get()
      if (!nodes.length) return
      const sig = graphSignature(nodes, edges, settings, projectExtras)
      if (sig === get()._lastSig && get().results) return
      const token = {}
      set({ _simToken: token, simBusy: true })
      const reply = await simulateInWorker(
        fromEditor({ name: projectName, nodes, edges, settings, extras: projectExtras }),
      )
      if (get()._simToken !== token) return
      set({ simBusy: false })
      if (reply.ok) {
        set({ results: reply.results, metrics: reply.metrics, _lastSig: sig, simError: null })
        get().saveActiveFile()
      } else {
        const detail = reply.projectErrors?.length ? reply.projectErrors.join('; ') : reply.error
        set({ simError: `Simulation failed: ${detail}`, _lastSig: '' })
      }
    }, 150)
    set({ _computeTimer: timer })
  },

  _recordOp: async (op) => {
    if (get().recordNav.busy || POPOUT) return
    set({ recordNav: { ...get().recordNav, busy: true }, recordError: null })
    try {
      await inRecordsQueue(op)
    } catch (err) {
      set({ recordError: err.message })
    } finally {
      set({ recordNav: recordNavOf(get().records, get().recordNav.editing, false) })
    }
  },
  _showRecord: (records, content) => {
    get().loadSerialized({ ...content, name: get().projectName, records })
    get().saveActiveFile()
  },
  recordGo: (index) => get()._recordOp(async () => {
    const cur = get().records
    if (index === (cur ? cur.selected : 0) || index < 0) return
    const { records, content } = await R.selectRecord(cur, get().serialize(), index)
    get()._showRecord(records, content)
  }),
  recordStep: (delta) => {
    const n = get().recordNav
    const to = n.selected + delta
    if (to < 0 || to >= n.count) return Promise.resolve()
    return get().recordGo(to)
  },
  recordAdd: () => get()._recordOp(async () => {
    const records = await R.addRecord(get().records, get().serialize())
    set({ records, recordNav: recordNavOf(records, false, true) })
    get().saveActiveFile()
  }),
  recordDelete: () => get()._recordOp(async () => {
    const cur = get().records
    if (!cur || cur.list.length <= 1) return
    const records = await R.deleteRecord(cur)
    get()._showRecord(records, await R.readRecord(records, records.selected))
  }),
  setRecordEditing: (on) => set({ recordNav: { ...get().recordNav, editing: !!on } }),
  recordRename: (name) => inRecordsQueue(async () => {
    if (POPOUT || !get().activeFile) return
    let records = get().records
    if (!records) records = await R.saveRecord(null, get().serialize())
    set({ records: R.renameRecord(records, records.selected, name), recordNav: recordNavOf(records, get().recordNav.editing, get().recordNav.busy) })
    get().saveActiveFile()
  }),

  serialize: () => {
    const { nodes, edges, projectName, settings, projectExtras, records } = get()
    const proj = fromEditor({ name: projectName, nodes, edges, settings, extras: projectExtras })
    return { ...proj, modified: new Date().toISOString(), ...(records ? { records } : {}) }
  },
  loadSerialized: (proj) => {
    const ed = toEditor(migrateProject(proj))
    const bare = !proj.settings && !proj.analyses && !proj.wiring && !proj.display
    const cur = get()
    const keep = cur.projectExtras.wiring
    const was = keep?.channels?.find((c) => c.id === keep.toolbar) || keep?.channels?.[0]
    const fresh = { ...DEFAULT_CHANNEL, ...(was ? { volts: was.volts } : {}) }
    const wiring = bare
      ? { ...ed.extras.wiring, masterDb: keep?.masterDb ?? 0, toolbar: fresh.id, channels: [fresh], wires: WR.parallelWires(ed.nodes.filter((n) => n.type === 'driver'), fresh.id), layout: {} }
      : ed.extras.wiring
    set({
      nodes: ed.nodes, edges: ed.edges,
      projectName: proj.name || '',
      settings: bare ? cur.settings : { ...cur.settings, ...ed.settings },
      projectExtras: bare
        ? { ...ed.extras, wiring, analyses: cur.projectExtras.analyses, display: cur.projectExtras.display }
        : ed.extras,
      history: [], future: [], selectedNodeId: null,
      records: R.readRecords(proj.records),
      recordNav: recordNavOf(R.readRecords(proj.records), false, false),
      recordError: null,
      tdResults: { linear: null, transient: null, distortion: {} }, tdError: null,
    })
    get()._setExtras(get().projectExtras)
    get().scheduleCompute()
  },
  saveProjectJSON: () => {
    get().saveActiveFile()
    exportProjectJSON(get().serialize())
  },

  importProject: (proj, filename) => {
    const stem = (proj.name || stripLegacySuffix(filename.replace(/\.speakerspice\.json$/i, '')).replace(/\.json$/i, '') || 'Imported').trim()
    const name = W.uniqueName(get().workspace, '', `${stem}${W.PROJECT_EXT}`)
    get().saveActiveFile()
    get()._commitWorkspace(W.writeFile(get().workspace, name, {
      kind: 'project',
      data: { ...proj, name: name.replace(/\.speakerspice$/, '') },
    }))
    set({ activeFile: name, wsSelection: [name] })
    get().loadSerialized({ ...proj, name: name.replace(/\.speakerspice$/, '') })
    return name
  },

  _commitWorkspace: (ws) => set({ workspace: W.dropBoards(ws) }),

  setWorkspaceName: (name) => {
    get()._commitWorkspace({ ...W.touch(get().workspace), name })
  },

  saveActiveFile: () => {
    if (POPOUT) return
    const { workspace, activeFile } = get()
    if (!activeFile || workspace.files[activeFile]?.kind !== 'project') return
    get()._commitWorkspace(W.writeFile(workspace, activeFile, { kind: 'project', data: get().serialize() }))
  },

  openFile: (path) => {
    const entry = get().workspace.files[path]
    if (!entry || entry.kind !== 'project') return
    if (path === get().activeFile) return
    get().saveActiveFile()
    set({ activeFile: path })
    get().loadSerialized({ ...entry.data, name: entry.data?.name || W.baseName(path).replace(/\.speakerspice$/, '') })
  },

  newFile: (folder = '') => {
    const name = W.uniqueName(get().workspace, folder, `Untitled${W.PROJECT_EXT}`)
    const path = W.joinPath(folder, name)
    const stem = name.replace(/\.speakerspice$/, '')
    get().saveActiveFile()
    get()._commitWorkspace(W.writeFile(get().workspace, path, {
      kind: 'project',
      data: { name: stem, nodes: [], edges: [] },
    }))
    set({ activeFile: path })
    get().loadSerialized({ name: stem, nodes: [], edges: [] })
    return path
  },

  newFolder: (parent = '') => {
    const name = W.uniqueName(get().workspace, parent, 'New folder')
    const path = W.joinPath(parent, name)
    get()._commitWorkspace(W.addFolder(get().workspace, path))
    return path
  },

  renamePath: (from, to) => {
    const dest = W.normalizePath(to)
    if (!dest || dest === from) return false
    if (W.isSystemPath(from) || W.isSystemPath(dest)) return false
    const ws = get().workspace
    if (!W.hasEntry(ws, from) || W.hasEntry(ws, dest)) return false

    let next = W.renameEntry(ws, from, dest)
    if (next === ws) return false

    const entry = next.files[dest]
    if (entry?.kind === 'project') {
      const stem = W.baseName(dest).replace(/\.speakerspice$/, '')
      next = W.writeFile(next, dest, { ...entry, data: { ...entry.data, name: stem } })
      if (get().activeFile === from) set({ projectName: stem })
    }
    get()._commitWorkspace(next)
    if (get().activeFile && W.isUnder(from, get().activeFile)) {
      set({ activeFile: dest + get().activeFile.slice(from.length) })
    }
    return true
  },

  deletePath: (path) => {
    const ws = get().workspace
    if (!W.hasEntry(ws, path)) return
    const wasActive = get().activeFile && W.isUnder(path, get().activeFile)
    const next = W.deleteEntry(ws, path)
    get()._commitWorkspace(next)
    const kept = get().wsSelection.filter((p) => !W.isUnder(path, p))
    if (kept.length !== get().wsSelection.length) set({ wsSelection: kept })
    if (!wasActive) return

    const fallback = W.listProjects(next)[0] || null
    set({ activeFile: fallback })
    if (fallback) {
      const entry = next.files[fallback]
      get().loadSerialized({ ...entry.data, name: entry.data?.name || W.baseName(fallback).replace(/\.speakerspice$/, '') })
    } else {
      get().loadSerialized({ name: 'Untitled', nodes: [], edges: [] })
    }
  },

  downloadWorkspace: async () => {
    get().saveActiveFile()
    const ws = { ...get().workspace, downloaded: new Date().toISOString() }
    await exportWorkspaceZip(ws)
    get()._commitWorkspace(ws)
  },

  importWorkspaceFile: async (file) => {
    let parsed
    try {
      const buffer = await file.arrayBuffer()
      if (Z.isZip(buffer)) {
        const stem = stripLegacySuffix(file.name.replace(/\.zip$/i, '').replace(/\.speakerspice$/i, ''))
        parsed = W.entriesToWorkspace(await Z.readZip(buffer), stem || W.DEFAULT_WORKSPACE_NAME)
      } else {
        parsed = W.parseWorkspace(new TextDecoder().decode(buffer))
      }
    } catch (err) {
      return { ok: false, error: err?.message || 'Could not read that file.' }
    }
    if (!parsed.ok) return { ok: false, error: parsed.error }
    return { ...get()._adoptWorkspace(parsed.workspace), skipped: parsed.skipped }
  },

  _adoptWorkspace: (ws) => {
    get()._commitWorkspace(ws)
    set({ wsSelection: [], wsExpanded: [], wsEdit: null, fileClipboard: null })

    const first = W.listProjects(ws)[0] || null
    set({ activeFile: first })
    const entry = first ? ws.files[first] : null
    get().loadSerialized(entry
      ? { ...entry.data, name: entry.data?.name || W.baseName(first).replace(/\.speakerspice$/, '') }
      : { name: 'Untitled', nodes: [], edges: [] })
    return { ok: true }
  },

  setWsSelection: (paths) => set({ wsSelection: paths }),

  toggleWsFolder: (path, open) => {
    const expanded = get().wsExpanded
    const isOpen = expanded.includes(path)
    const want = open === undefined ? !isOpen : open
    if (want === isOpen) return
    set({ wsExpanded: want ? [...expanded, path] : expanded.filter((p) => p !== path) })
  },

  collapseAllWsFolders: () => set({ wsExpanded: [] }),

  beginWsEdit: (mode, path) => {
    if (mode !== 'rename' && path) get().toggleWsFolder(path, true)
    set({ wsEdit: { mode, path } })
  },

  endWsEdit: () => { if (get().wsEdit) set({ wsEdit: null }) },

  setFileClipboard: (paths, cut) => set({ fileClipboard: paths.length ? { paths, cut } : null }),

  pasteFiles: (folder) => {
    const clip = get().fileClipboard
    if (!clip) return
    let ws = get().workspace
    let active = get().activeFile

    for (const from of clip.paths) {
      if (clip.cut) {
        const moved = W.moveInto(ws, from, folder)
        if (active && W.isUnder(from, active)) active = moved.path + active.slice(from.length)
        ws = moved.ws
      } else {
        ws = W.copyInto(ws, from, folder)
      }
    }
    get()._commitWorkspace(ws)
    if (active !== get().activeFile) set({ activeFile: active })
    if (clip.cut) set({ fileClipboard: null })
  },

  duplicateFile: (path) => {
    get()._commitWorkspace(W.copyInto(get().workspace, path, W.parentOf(path)))
  },

  moveFile: (from, folder) => {
    if (W.isSystemPath(from)) return
    const { ws, path } = W.moveInto(get().workspace, from, folder)
    if (ws === get().workspace) return
    get()._commitWorkspace(ws)
    const active = get().activeFile
    if (active && W.isUnder(from, active)) set({ activeFile: path + active.slice(from.length) })
  },

  createWsEntry: (mode, parent, name) => {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: 'A name is required.' }
    const path = W.normalizePath(W.joinPath(parent, trimmed))
    if (!path) return { ok: false, error: `“${trimmed}” is not a usable name.` }
    if (W.hasEntry(get().workspace, path)) return { ok: false, error: `“${trimmed}” already exists here.` }

    if (mode === 'newFolder') {
      get()._commitWorkspace(W.addFolder(get().workspace, path))
      return { ok: true }
    }

    const stem = W.baseName(path).replace(/\.speakerspice$/, '')
    get().saveActiveFile()
    get()._commitWorkspace(W.writeFile(get().workspace, path, {
      kind: 'project',
      data: { name: stem, nodes: [], edges: [] },
    }))
    set({ activeFile: path, wsSelection: [path] })
    get().loadSerialized({ name: stem, nodes: [], edges: [] })
    return { ok: true }
  },

  chooseWorkspaceStorage: (kind) => {
    try { localStorage.setItem(STORAGE_CHOICE_KEY, kind) } catch {  }
    set({ workspacePrompt: false })
  },

  connectWorkspaceFolder: async (confirmAdopt) => {
    if (POPOUT) return { ok: false }
    if (!F.supportsFolders()) {
      return { ok: false, error: 'This browser cannot keep a workspace in a folder. Chrome and Edge can.' }
    }
    const handle = await F.pickFolder()
    if (!handle) return { ok: false, cancelled: true }

    const read = await F.readFolderWorkspace(handle)
    if (read.ok && confirmAdopt) {
      const proceed = await confirmAdopt({ name: handle.name, files: Object.keys(read.workspace.files).length })
      if (!proceed) return { ok: false, cancelled: true }
    }

    await F.rememberFolder(handle)
    try { localStorage.setItem(STORAGE_CHOICE_KEY, 'folder') } catch {  }
    set({ workspacePrompt: false })
    await get()._openFolder(handle, read, true)
    return { ok: true, adopted: read.ok }
  },

  reconnectWorkspaceFolder: async () => {
    if (POPOUT || !folderHandle) return { ok: false }
    const state = await F.folderPermission(folderHandle, true)
    if (state !== 'granted') {
      set({ folderStatus: 'locked', folderError: 'SpeakerSpice needs permission to use that folder.' })
      return { ok: false, error: 'Permission was not granted.' }
    }
    const read = await F.readFolderWorkspace(folderHandle)
    await get()._openFolder(folderHandle, read, false)
    return { ok: true }
  },

  disconnectWorkspaceFolder: async () => {
    clearTimeout(folderTimer)
    folderHandle = null
    folderState = { files: new Map(), folders: [] }
    set({ folderStatus: 'off', folderName: null, folderError: null, folderSaved: null })
    try { localStorage.setItem(STORAGE_CHOICE_KEY, 'browser') } catch {  }
    await F.forgetFolder()
  },

  _openFolder: async (handle, read, prefer) => {
    folderHandle = handle
    set({ folderName: handle.name, folderStatus: 'connected', folderError: null })
    set({ workspacePrompt: false })
    try { localStorage.setItem(STORAGE_CHOICE_KEY, 'folder') } catch {  }

    const ours = Date.parse(get().workspace.modified || '') || 0
    const theirs = read.ok ? (Date.parse(read.workspace.modified || '') || 0) : -1

    if (read.ok && (prefer || theirs >= ours)) {
      folderState = read.previous
      get()._adoptWorkspace(read.workspace)
      set({ folderSaved: new Date().toISOString() })
      return
    }

    folderState = read.ok ? read.previous : { files: new Map(), folders: [] }
    get().saveActiveFile()
    await get()._syncFolder(false)
  },

  _syncFolder: async (prune = true) => {
    if (!folderHandle || get().folderStatus === 'locked') return
    if (folderWriting) { folderAgain = true; return }
    folderWriting = true
    try {
      const plan = F.planSync(get().workspace, folderState, prune)
      if (!plan.writes.length && !plan.deletes.length && !plan.gone.length) return
      const { failed } = await F.applyPlan(folderHandle, plan)
      folderState = plan.next
      if (!failed.length) {
        set({ folderStatus: 'connected', folderError: null, folderSaved: new Date().toISOString() })
        return
      }
      const state = await F.folderPermission(folderHandle, false)
      if (state !== 'granted') {
        set({ folderStatus: 'locked', folderError: 'Permission for that folder has lapsed.' })
      } else {
        set({ folderStatus: 'error', folderError: `${failed.length} file${failed.length === 1 ? '' : 's'} could not be written.` })
      }
    } catch (err) {
      set({ folderStatus: 'error', folderError: err?.message || 'The folder could not be written.' })
    } finally {
      folderWriting = false
      if (folderAgain) { folderAgain = false; scheduleFolderSync() }
    }
  },

  _resumeFolder: async (since) => {
    const handle = await F.recallFolder()
    if (!handle) return
    folderHandle = handle
    if (await F.folderPermission(handle, false) !== 'granted') {
      set({ folderStatus: 'locked', folderName: handle.name })
      return
    }
    const read = await F.readFolderWorkspace(handle)
    const stale = Date.parse(since || '') || 0
    const theirs = read.ok ? (Date.parse(read.workspace.modified || '') || 0) : -1
    await get()._openFolder(handle, read, read.ok && (!workspaceRestored || theirs >= stale))
  },

  setCustomDrivers: (drivers) => {
    get()._commitWorkspace(W.writeDrivers(get().workspace, drivers))
  },

  poppedOut: [],
  popoutIds: POPOUT ? popoutPanelIds() : [],
  popoutActive: POPOUT ? popoutPanelId() : null,
  setPopoutActive: (id) => {
    set({ popoutActive: id })
    syncPopoutUrl(get().popoutIds, id)
  },
  addViewToPopout: (id) => {
    if (!POPOUT) return
    const ids = get().popoutIds
    if (!ids.includes(id)) {
      const next = [...ids, id]
      set({ popoutIds: next, popoutActive: id })
      syncPopoutUrl(next, id)
      channel?.postMessage({ type: 'claim', panels: [id] })
    } else {
      get().setPopoutActive(id)
    }
    get().focusPanel(id)
  },
  closeViewInPopout: (id) => {
    if (!POPOUT) return
    const ids = get().popoutIds
    if (!ids.includes(id)) return
    const next = ids.filter((p) => p !== id)
    if (!next.length) { window.close(); return }
    const front = get().popoutActive === id
      ? next[Math.min(ids.indexOf(id), next.length - 1)]
      : get().popoutActive
    set({ popoutIds: next, popoutActive: front })
    syncPopoutUrl(next, front)
    channel?.postMessage({ type: 'release', panels: [id] })
  },
  popOutPanel: (id) => {
    openPanelWindow(id)
    if (!POPOUT) get()._detachPanel(id)
  },
  popOutStack: (stackId) => {
    const node = L.findNode(get().layout, stackId)
    if (node?.type !== 'stack' || !node.panels.length) return
    const panels = [...node.panels]
    openPanelGroupWindow(panels, node.active)
    for (const id of panels) get()._detachPanel(id)
  },
  addViewToStack: (panelId, stackId) => {
    if (L.findNode(get().layout, stackId)?.type !== 'stack') return
    if (get().poppedOut.includes(panelId)) {
      set({ poppedOut: get().poppedOut.filter((p) => p !== panelId) })
    }
    set({ maximized: null })
    get()._commitLayout(L.dockPanel(get().layout, panelId, stackId, 'center'))
    get().focusPanel(panelId)
  },
  _detachPanel: (id) => {
    if (!get().poppedOut.includes(id)) set({ poppedOut: [...get().poppedOut, id] })
    if (PANEL_META[id]?.closable !== false) get().layoutOps.close(id)
  },
  _reattachPanel: (id) => {
    if (!get().poppedOut.includes(id)) return
    set({ poppedOut: get().poppedOut.filter((p) => p !== id) })
    get().layoutOps.open(id)
  },

  _applyRemote: (patch) => {
    applyingRemote = true
    try { rawSet(patch) } finally { applyingRemote = false }
  },
  _sharedSnapshot: () => {
    const st = get()
    return Object.fromEntries(SHARED_KEYS.map((k) => [k, st[k]]))
  },
  }
})

let persisting = false
let pendingWorkspace = null

async function persistWorkspace(ws) {
  pendingWorkspace = ws
  if (persisting) return
  persisting = true
  try {
    while (pendingWorkspace) {
      const next = pendingWorkspace
      pendingWorkspace = null
      const text = JSON.stringify(next)
      if (await F.storeWorkspace(text)) {
        try { localStorage.removeItem(WORKSPACE_KEY) } catch {  }
      } else {
        try { localStorage.setItem(WORKSPACE_KEY, text) } catch {  }
      }
    }
  } finally {
    persisting = false
  }
}
if (!POPOUT) {
  let last = useStore.getState().workspace
  useStore.subscribe((st) => {
    if (st.workspace === last) return
    last = st.workspace
    persistWorkspace(st.workspace)
    scheduleFolderSync()
  })

  if (F.supportsFolders()) useStore.getState()._resumeFolder(INITIAL_WORKSPACE.modified)
}

if (channel) {
  channel.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object') return
    const st = useStore.getState()

    if (data.type === 'patch' || data.type === 'full') {
      st._applyRemote(data.patch)
      muted = false
      if (!POPOUT && SIM_INPUT_KEYS.some((k) => k in data.patch)) {
        useStore.setState({ _lastSig: '' })
        useStore.getState().scheduleCompute()
      }
      return
    }

    if (POPOUT) return

    if (data.type === 'hello') {
      channel.postMessage({ type: 'full', patch: st._sharedSnapshot() })
      for (const id of data.panels || [data.panel]) st._detachPanel(id)
    } else if (data.type === 'claim') {
      for (const id of data.panels) st._detachPanel(id)
    } else if (data.type === 'release' || data.type === 'bye') {
      for (const id of data.panels || [data.panel]) st._reattachPanel(id)
    }
  }

  if (POPOUT) {
    channel.postMessage({ type: 'hello', panel: popoutPanelId(), panels: popoutPanelIds() })
    window.addEventListener('pagehide', () => {
      const st = useStore.getState()
      channel.postMessage({ type: 'bye', panel: st.popoutActive, panels: st.popoutIds })
    })
  }
}

export const __internals = { loadLayout, loadPresets, loadToolbar, freeSpotNear, graphSignature }
