import { filterSections, sectionsResponse } from '../spice/filters.js'

export const PASS_SLOPES = {
  butterworth: [6, 12, 18, 24, 30, 36, 42, 48],
  'linkwitz-riley': [12, 24, 36, 48],
  bessel: [6, 12, 18, 24, 30, 36, 42, 48],
}

export const PASS_LABELS = { butterworth: 'Butterworth', 'linkwitz-riley': 'Linkwitz-Riley', bessel: 'Bessel' }

export const BAND_TYPES = [
  ['peak', 'Peak'], ['lowshelf', 'Low shelf'], ['highshelf', 'High shelf'], ['notch', 'Notch'], ['allpass', 'All-pass'],
]

export const GAINED = new Set(['peak', 'lowshelf', 'highshelf'])

export const DEFAULT_DSP = {
  on: true, gainDb: 0, mute: false, invert: false, delayMs: 0,
  hpf: { on: false, shape: 'butterworth', slope: 24, hz: 25 },
  lpf: { on: false, shape: 'linkwitz-riley', slope: 24, hz: 80 },
  lt: { on: false, f0: 40, q0: 0.9, fp: 25, qp: 0.6 },
  peq: [],
}

export const MUTE_SCALE = 1e-9

const clone = (v) => JSON.parse(JSON.stringify(v))

export function fitSlope(shape, slope) {
  const ok = PASS_SLOPES[shape] || PASS_SLOPES.butterworth
  const s = Number(slope) || 12
  return ok.find((x) => x >= s) ?? ok[ok.length - 1]
}

export function normalizeDsp(d) {
  const out = clone(DEFAULT_DSP)
  if (!d || typeof d !== 'object') return out
  if (Array.isArray(d.filters) || 'polarity' in d) {
    out.invert = d.polarity === -1
    out.delayMs = Number(d.delayMs) || 0
    for (const f of d.filters || []) {
      const on = !f.bypass
      if ((f.type === 'highpass' || f.type === 'lowpass') && !out[f.type === 'highpass' ? 'hpf' : 'lpf'].on) {
        const shape = PASS_SLOPES[f.shape] ? f.shape : 'butterworth'
        out[f.type === 'highpass' ? 'hpf' : 'lpf'] = { on, shape, slope: fitSlope(shape, 6 * (Number(f.order) || 2)), hz: Number(f.hz) }
      } else if (['peq', 'lowshelf', 'highshelf'].includes(f.type)) {
        out.peq.push({ id: `b${out.peq.length + 1}`, on, type: f.type === 'peq' ? 'peak' : f.type, hz: Number(f.hz), db: Number(f.db) || 0, q: Number(f.q ?? 0.707) })
      }
    }
    return out
  }
  for (const k of ['on', 'gainDb', 'mute', 'invert', 'delayMs']) if (d[k] != null) out[k] = d[k]
  for (const k of ['hpf', 'lpf', 'lt']) out[k] = { ...out[k], ...(d[k] || {}) }
  for (const k of ['hpf', 'lpf']) out[k].slope = fitSlope(out[k].shape, out[k].slope)
  out.peq = (Array.isArray(d.peq) ? d.peq : []).map((b, i) => ({ id: b.id || `b${i + 1}`, on: b.on !== false, type: b.type || 'peak', hz: Number(b.hz) || 100, db: Number(b.db) || 0, q: Number(b.q) || 1 }))
  return out
}

export function dspFilters(d, only = {}) {
  const out = []
  if (only.pass !== false) {
    if (d.hpf?.on) out.push({ type: 'highpass', shape: d.hpf.shape, order: d.hpf.slope / 6, hz: d.hpf.hz })
    if (d.lpf?.on) out.push({ type: 'lowpass', shape: d.lpf.shape, order: d.lpf.slope / 6, hz: d.lpf.hz })
  }
  if (only.bands !== false) {
    if (d.lt?.on) out.push({ type: 'transform', f0: d.lt.f0, q0: d.lt.q0, fp: d.lt.fp, qp: d.lt.qp })
    for (const b of d.peq || []) if (b.on) out.push({ type: b.type === 'peak' ? 'peq' : b.type, hz: b.hz, q: b.q, db: b.db })
  }
  return out
}

export function dspScale(d) {
  const g = Math.pow(10, (Number(d.gainDb) || 0) / 20) * (d.invert ? -1 : 1)
  return d.mute ? g * MUTE_SCALE : g
}

export function dspSections(d) {
  const out = []
  for (const f of dspFilters(d)) {
    const name = f.type === 'highpass' ? 'high-pass' : f.type === 'lowpass' ? 'low-pass' : f.type === 'transform' ? 'Linkwitz transform' : 'EQ band'
    try { out.push(...filterSections(f)) } catch (err) { throw new Error(`${name}: ${err.message}`) }
  }
  return out
}

export function isFlat(d) {
  return !d.mute && !d.invert && !(Number(d.gainDb)) && !(Number(d.delayMs) > 0) && dspFilters(d).length === 0
}

export function dspResponse(d, freqs, only = {}) {
  const secs = []
  for (const f of dspFilters(d, only)) { try { secs.push(...filterSections(f)) } catch {  } }
  const whole = only.pass !== false && only.bands !== false
  const k = whole ? dspScale(d) : 1
  const tau = whole ? (Number(d.delayMs) || 0) * 1e-3 : 0
  const db = []
  const phase = []
  for (const hz of freqs) {
    const h = sectionsResponse(secs, hz)
    const th = -2 * Math.PI * hz * tau
    const re = k * (h.re * Math.cos(th) - h.im * Math.sin(th))
    const im = k * (h.re * Math.sin(th) + h.im * Math.cos(th))
    db.push(20 * Math.log10(Math.max(Math.hypot(re, im), 1e-12)))
    phase.push((Math.atan2(im, re) * 180) / Math.PI)
  }
  return { db, phase }
}
