import { waveguideVolume } from './engine/geometry'

export const TOOLBAR_ITEMS = {
  undo: { label: 'Undo / redo', group: 'controls' },
  voltage: { label: 'Drive voltage', group: 'controls' },
  sweep: { label: 'Sweep range', group: 'controls' },
  masking: { label: 'Mask resonances', group: 'controls' },
  snapshot: { label: 'Snapshot + overlays', group: 'controls' },

  m_f3: { label: 'F3', group: 'metrics', cluster: 'response' },
  m_f10: { label: 'F10', group: 'metrics', cluster: 'response' },
  m_fb: { label: 'Fb', group: 'metrics', cluster: 'response' },
  m_qtc: { label: 'Qtc', group: 'metrics', cluster: 'response' },
  m_bw: { label: 'BW', group: 'metrics', cluster: 'response' },
  m_zpeaks: { label: 'Z peaks (Hz/Ω)', group: 'metrics', cluster: 'impedance' },
  m_peakspl: { label: 'Peak SPL', group: 'metrics', cluster: 'limits' },
  m_xf3: { label: 'X @ F3', group: 'metrics', cluster: 'limits' },
  m_xfb: { label: 'X @ Fb', group: 'metrics', cluster: 'limits' },
  m_maxpower: { label: 'Max power', group: 'metrics', cluster: 'limits' },
  m_volume: { label: 'Volume', group: 'metrics', cluster: 'volume' },
  m_solve: { label: 'Solve time', group: 'metrics', cluster: 'solve' },
}

export const TOOLBAR_GROUPS = [
  ['controls', 'Controls'],
  ['metrics', 'Metrics readout'],
]

export const ALL_ITEM_IDS = Object.keys(TOOLBAR_ITEMS)

export const DEFAULT_TOOLBAR = [
  'undo', 'voltage', 'snapshot',
  'm_f3', 'm_f10', 'm_fb', 'm_qtc', 'm_bw', 'm_zpeaks',
  'm_peakspl', 'm_xf3', 'm_xfb', 'm_maxpower', 'm_volume',
]

const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d))

export function systemVolume(nodes) {
  let v = 0
  for (const n of nodes) {
    const p = n.data.params
    if (n.type === 'chamber') v += p.volume || 0
    else if (n.type === 'waveguide') v += waveguideVolume(p.flare, p.S1 * 1e-4, p.S2 * 1e-4, p.length / 100) * 1000
  }
  return v
}

export function metricValue(id, { metrics, results, nodes }) {
  const m = metrics || {}
  const xmax = nodes.find((n) => n.type === 'driver')?.data.params.Xmax
  const label = TOOLBAR_ITEMS[id]?.label
  const frac = (x) => (x != null && xmax ? `${((x / xmax) * 100).toFixed(0)}%` : '—')
  const over = (x) => x != null && xmax && x > xmax

  switch (id) {
    case 'm_f3': return { label, value: m.f3 ? `${fmt(m.f3)} Hz` : '—' }
    case 'm_f10': return { label, value: m.f10 ? `${fmt(m.f10)} Hz` : '—' }
    case 'm_fb': return { label, value: m.fb ? `${fmt(m.fb)} Hz` : '—' }
    case 'm_qtc': return { label, value: m.qtc ? fmt(m.qtc, 2) : '—' }
    case 'm_zpeaks': return {
      label,
      value: (m.zPeaks || []).slice(0, 3).map((p) => `${p.f.toFixed(0)}/${p.v.toFixed(0)}Ω`).join(' · ') || '—',
    }
    case 'm_peakspl': return { label, value: m.peakSPL ? `${fmt(m.peakSPL)} dB` : '—' }
    case 'm_xfb': return { label, value: frac(m.xAtFb), bad: over(m.xAtFb) }
    case 'm_xf3': return { label, value: frac(m.xAtF3), bad: over(m.xAtF3) }
    case 'm_bw': return { label, value: m.bwHz ? `${fmt(m.bwHz, 0)} Hz / ${fmt(m.bwOct, 1)} oct` : '—' }
    case 'm_maxpower': return { label, value: m.maxPower ? `${fmt(m.maxPower, 0)} W @ ${fmt(m.vMax, 1)} V` : '—' }
    case 'm_volume': {
      const v = systemVolume(nodes)
      return { label, value: v > 0 ? `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} L` : '—' }
    }
    case 'm_solve': return { label, value: results?.elapsedMs != null ? `${results.elapsedMs.toFixed(0)} ms` : '—' }
    default: return null
  }
}

export function sanitizeToolbar(ids) {
  if (!Array.isArray(ids)) return null
  const seen = new Set()
  const out = ids.filter((id) => TOOLBAR_ITEMS[id] && !seen.has(id) && seen.add(id))
  return out
}

export const __internals = { fmt }
