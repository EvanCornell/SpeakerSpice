import { displayNames } from './nodeNames.js'

export const RUN_DEFAULTS = { f1: 15, f2: 200, points: 24 }

export const MAX_SPL_THD = 0.1

export const isLevelRun = (r) => r?.analysis === 'level'

export const dbText = (L) => `${L > 0 ? '+' : L < 0 ? '−' : ''}${Math.abs(Number(Number(L).toFixed(2)))} dB`

export const recordLabel = (name) => (/^\d+$/.test(String(name)) ? `Record ${name}` : String(name))

export function defaultRunName(project, record) {
  return `${project || 'Untitled'} · ${recordLabel(record)}`
}

export function cleanLevels(levels) {
  const out = []
  for (const v of levels || []) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace('−', '-'))
    if (Number.isFinite(n) && !out.includes(n)) out.push(n)
  }
  return out
}

const DIGITS = 5

export function packResult(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toPrecision(DIGITS)) : null
  if (ArrayBuffer.isView(v)) return Array.from(v, (x) => (Number.isFinite(x) ? Number(x.toPrecision(DIGITS)) : null))
  if (Array.isArray(v)) return v.map(packResult)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, packResult(x)]))
  return v
}

export function projectInfo(project) {
  const names = {}
  const xmax = {}
  const shown = displayNames(project.nodes || [])
  for (const n of project.nodes || []) {
    names[n.id] = shown[n.id]
    if (n.type === 'driver') xmax[n.id] = Number(n.params?.Xmax) || 0
  }
  return { names, xmax }
}

export const TABS = [
  ['output', 'Output'],
  ['compression', 'Compression'],
  ['distortion', 'Distortion'],
  ['excursion', 'Excursion'],
  ['velocity', 'Port velocity'],
  ['impedance', 'Impedance'],
  ['power', 'Power'],
  ['maxspl', 'Max SPL (10% THD)'],
  ['waveforms', 'Waveforms'],
]

export const TAB_VIEWS = {
  output: [['spl', 'Output', 'dB SPL']],
  compression: [['cmp', 'Compression', 'dB'], ['effLoss', 'Efficiency loss', 'dB'], ['powerChange', 'Power drawn', 'dB']],
  distortion: [['thd', 'THD', '%'], ['h2', '2nd harmonic', 'dB re fundamental'], ['h3', '3rd harmonic', 'dB re fundamental']],
  excursion: [['xPeak', 'Peak excursion', 'mm']],
  velocity: [['vPeak', 'Peak port velocity', 'm/s']],
  impedance: [['zMag', 'Impedance', 'Ω']],
  power: [['pe', 'Electrical power', 'W'], ['efficiency', 'Efficiency', '%']],
  maxspl: [['spl', 'Max SPL at 10% THD', 'dB SPL'], ['levelDb', 'Drive at 10% THD', 'dB']],
  waveforms: [['pressure', 'Pressure', 'Pa'], ['excursion', 'Excursion', 'mm'], ['velocity', 'Port velocity', 'm/s']],
}

function idsOf(rows, field) {
  const out = []
  for (const r of rows || []) for (const k of Object.keys(r?.[field] || {})) if (!out.includes(k)) out.push(k)
  return out
}

export function hasTab(tab, result) {
  if (!result?.rows) return false
  if (tab === 'excursion') return idsOf(result.rows, 'xPeak').length > 0
  if (tab === 'velocity') return idsOf(result.rows, 'vPeak').length > 0
  if (tab === 'impedance') return idsOf(result.rows, 'z').length > 0
  if (tab === 'maxspl') return Array.isArray(result.maxSpl) && result.maxSpl.some((m) => m && m.levelDb != null)
  if (tab === 'waveforms') return Array.isArray(result.start) && result.start.some((s) => s && !s.failed)
  return true
}

export function sharedTabs(results) {
  if (!results.length) return []
  return TABS.map((t) => t[0]).filter((t) => results.every((r) => hasTab(t, r)))
}

export function tabTraces(tab, view, result, names = {}, hz) {
  const rows = (result?.rows || []).filter((r) => r && !r.failed)
  const line = (key, label, get, extra = {}) => {
    const pts = rows.map((r) => [r.hz, get(r)]).filter(([, y]) => Number.isFinite(y))
    return { key, label, x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), ...extra }
  }
  const perId = (field, pick = (v) => v) => {
    const ids = idsOf(rows, field)
    return ids.flatMap((id) => {
      const lab = ids.length > 1 ? (names[id] || id) : ''
      const out = [line(id, lab, (r) => pick(r[field]?.[id]))]
      if (field !== 'z' && rows.some((r) => Number.isFinite(r.linear?.[field]?.[id]))) {
        out.push(line(`${id}:lin`, lab ? `${lab}, linear` : 'Linear', (r) => r.linear?.[field]?.[id], { dash: true }))
      }
      return out
    })
  }
  if (tab === 'output') return [line('spl', '', (r) => r.spl), line('lin', 'Linear', (r) => r.linSpl, { dash: true })]
  if (tab === 'compression') return [line(view, '', (r) => r[view])]
  if (tab === 'distortion') {
    if (view === 'thd') return [line('thd', '', (r) => (Number.isFinite(r.thd) ? r.thd * 100 : null))]
    const n = view === 'h2' ? 0 : 1
    return [line(view, '', (r) => r.h?.[n])]
  }
  if (tab === 'excursion') return perId('xPeak')
  if (tab === 'velocity') return perId('vPeak')
  if (tab === 'impedance') return perId('z', (v) => v?.mag)
  if (tab === 'power') {
    if (view === 'efficiency') return [line('eff', '', (r) => (Number.isFinite(r.efficiency) ? r.efficiency * 100 : null))]
    return [line('pe', '', (r) => r.pe)]
  }
  if (tab === 'maxspl') {
    const m = (result?.maxSpl || []).filter((x) => x && x.levelDb != null)
    const pts = m.map((x) => [x.hz, x[view]]).filter(([, y]) => Number.isFinite(y))
    return [{ key: view, label: '', x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), marker: true }]
  }
  if (tab === 'waveforms') {
    const s = nearestStart(result, hz)
    if (!s) return []
    const wave = (key, label, y) => ({ key, label, x: y.map((_, i) => i * s.dt * 1000), y })
    if (view === 'pressure') return [wave('p', '', s.pressure || [])]
    const m = (view === 'excursion' ? s.excursion : s.velocity) || {}
    const ids = Object.keys(m)
    return ids.map((id) => wave(id, ids.length > 1 ? (names[id] || id) : '', m[id]))
  }
  return []
}

export function nearestStart(result, hz) {
  const all = (result?.start || []).filter((s) => s && !s.failed)
  if (!all.length) return null
  if (!(hz > 0)) return all[0]
  return all.reduce((a, b) => (Math.abs(Math.log(b.hz / hz)) < Math.abs(Math.log(a.hz / hz)) ? b : a))
}

export function unreachedAt(result) {
  return (result?.maxSpl || []).filter((m) => m?.unreached).map((m) => m.hz)
}
