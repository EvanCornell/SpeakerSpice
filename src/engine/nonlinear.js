export const NL_PARAMS = ['Bl', 'Cms', 'Kms', 'Le']

export function emptyCurve() {
  return { points: [], table: null }
}

export function defaultNL() {
  return { Bl: emptyCurve(), Cms: emptyCurve(), Kms: emptyCurve(), Le: emptyCurve() }
}

export function curveHasContent(curve) {
  return (curve?.points?.length || 0) > 0 || (curve?.table?.length || 0) > 0 || (curve?.poly?.coeffs?.length || 0) > 1
}

export function polyRatio(poly, x) {
  const c = poly.coeffs
  const lo = Number.isFinite(poly.min) ? poly.min : -Infinity
  const hi = Number.isFinite(poly.max) ? poly.max : Infinity
  const xc = Math.min(Math.max(x, lo), hi)
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) v = v * xc + c[i]
  return c[0] ? v / c[0] : 1
}

function baseValue(curve, x) {
  if ((curve?.poly?.coeffs?.length || 0) > 1) return polyRatio(curve.poly, x)
  const t = curve?.table
  if (!t || t.length === 0) return 1
  if (x <= t[0][0]) return t[0][1]
  if (x >= t[t.length - 1][0]) return t[t.length - 1][1]
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1]
      const [x1, y1] = t[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return 1
}

function rawEval(curve, x) {
  let r = baseValue(curve, x)
  for (const p of curve?.points || []) {
    const w = Math.max(p.w, 0.1)
    r += p.g * Math.exp(-0.5 * Math.pow((x - p.x) / w, 2))
    if (curve?.sym && Math.abs(p.x) > 0.01) {
      r += p.g * Math.exp(-0.5 * Math.pow((x + p.x) / w, 2))
    }
  }
  return r
}

export function evalCurve(curve, x, xmax = 0) {
  let r
  if (curve?.extrap && xmax > 0 && Math.abs(x) > xmax) {
    const s = Math.sign(x)
    const xe = s * xmax
    const d = 0.25
    const slope = (rawEval(curve, xe) - rawEval(curve, xe - s * d)) / (s * d)
    r = rawEval(curve, xe) + slope * (x - xe)
  } else {
    r = rawEval(curve, x)
  }
  return Math.max(r, 0.01)
}

export function normalizeTable(table) {
  let v0 = null
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1]
    const [x1, y1] = table[i]
    if (x0 <= 0 && x1 >= 0) { v0 = y0 + ((y1 - y0) * (0 - x0)) / (x1 - x0); break }
  }
  if (v0 == null) v0 = table[0][1]
  if (Math.abs(v0) < 1e-12) throw new Error('Curve value at x=0 is zero — cannot normalize.')
  const isAbsolute = v0 < 0.5 || v0 > 2
  if (!isAbsolute) return { table, wasAbsolute: false, v0 }
  return { table: table.map(([x, y]) => [x, y / v0]), wasAbsolute: true, v0 }
}

export function parseCurveCSV(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#') || /[a-df-z]/i.test(s.split(',')[0])) continue
    const parts = s.split(/[,;\t]+/).map(parseFloat)
    if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) rows.push([parts[0], parts[1]])
  }
  if (rows.length < 2) throw new Error('Need at least two "x_mm, ratio" rows.')
  return rows.sort((a, b) => a[0] - b[0])
}

export const BL_AT_XMAX = 0.7

export const XVAR_DB = 6

export function variationDb(bl, kms) {
  return -20 * Math.log10(bl) + 10 * Math.log10(kms)
}

export function curvesFromRatings(xmax, xvar) {
  if (!(xmax > 0)) throw new Error('Xmax must be a positive number of mm.')
  checkXvar(xvar)
  const c2 = (xmax * xmax) / Math.log(1 / BL_AT_XMAX)
  const bl = (x) => Math.exp((-x * x) / c2)
  const span = Math.max(4 * xmax, xvar > 0 ? 2 * xvar : 0, 20)
  const out = withSuspension(bl, span, xvar)
  out.info.blSixDbAt = Math.sqrt(c2 * Math.log(Math.pow(10, XVAR_DB / 20)))
  return out
}

function checkXvar(xvar) {
  if (xvar != null && xvar !== '' && !(xvar > 0)) throw new Error('Xvar must be a positive number of mm.')
}

function withSuspension(bl, span, xvar) {
  const rows = 120
  const table = []
  for (let i = -rows; i <= rows; i++) {
    const x = Number(((span * i) / rows).toFixed(4))
    table.push([x, Number(Math.max(bl(x), 1e-4).toPrecision(6))])
  }
  const Bl = { points: [], table, poly: null, sym: true, extrap: false }
  let Kms = { points: [], table: null, poly: null, sym: true, extrap: false }
  const info = { blSixDbAt: null, blAtXvar: null, kmsAtXvar: null, blDb: null, kmsDb: null, blAlone: false }
  if (xvar > 0) {
    const blDb = variationDb(bl(xvar), 1)
    const kmsDb = XVAR_DB - blDb
    info.blAtXvar = bl(xvar)
    info.blDb = blDb
    if (kmsDb > 0) {
      const K = Math.pow(10, kmsDb / 10)
      Kms = { ...Kms, poly: { coeffs: [1, 0, (K - 1) / (xvar * xvar)], min: -span, max: span } }
      info.kmsAtXvar = K
      info.kmsDb = kmsDb
    } else {
      info.kmsAtXvar = 1
      info.kmsDb = 0
      info.blAlone = true
    }
  }
  return { Bl, Kms, info }
}

export const FRINGE_LEVEL = 0.1

export const DEFAULT_FRINGE_SHARE = 0.25

function logCosh(t) {
  const a = Math.abs(t)
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2
}

export function blFromGeometry({ coil, gap, fringe, split }) {
  if (!(coil > 0)) throw new Error('Coil height must be a positive number of mm.')
  if (!(gap > 0)) throw new Error('Gap height must be a positive number of mm.')
  const s = split == null || split === '' ? 0 : Number(split)
  if (!(s >= 0)) throw new Error('Split must be 0 or more mm.')
  const h = fringe == null || fringe === '' ? DEFAULT_FRINGE_SHARE * gap : Number(fringe)
  if (!(h >= 0)) throw new Error('Fringe height must be 0 or more mm.')
  const f = (2 * h) / Math.log((1 - FRINGE_LEVEL) / FRINGE_LEVEL)
  const F = f > 1e-9
    ? (z) => (f / 2) * (logCosh((z + gap / 2) / f) - logCosh((z - gap / 2) / f))
    : (z) => (Math.min(Math.max(z, -gap / 2), gap / 2))
  const end = s / 2 + coil / 2
  const linked = (x) => F(x + end) - F(x + s / 2) + F(x - s / 2) - F(x - end)
  const rest = linked(0)
  if (!(rest > 0.02 * Math.min(gap, coil / 2))) throw new Error('At rest the windings sit outside the field: the split must be narrower than the gap and its fringe.')
  return (x) => linked(x) / rest
}

export function excursionAt(fn, level, limit) {
  const steps = 800
  let lo = 0
  let hi = null
  for (let i = 1; i <= steps; i++) {
    const x = (limit * i) / steps
    if (fn(x) <= level) { hi = x; break }
    lo = x
  }
  if (hi == null) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (fn(mid) > level) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function curvesFromGeometry({ coil, gap, fringe, split, xvar, xmax }) {
  checkXvar(xvar)
  const bl = blFromGeometry({ coil, gap, fringe, split })
  const s = Number(split) > 0 ? Number(split) : 0
  const h = fringe == null || fringe === '' ? DEFAULT_FRINGE_SHARE * gap : Number(fringe)
  const reach = (coil + s + gap) / 2 + 4 * h
  const span = Math.max(reach + 2, xvar > 0 ? 2 * xvar : 0, xmax > 0 ? 4 * xmax : 0, 20)
  const out = withSuspension(bl, span, xvar)
  let blPeak = 1
  let blPeakAt = 0
  for (let i = 1; i <= 800; i++) {
    const x = (span * i) / 800
    if (bl(x) > blPeak) { blPeak = bl(x); blPeakAt = x }
  }
  Object.assign(out.info, {
    fringe: h,
    split: s,
    winding: s ? coil / 2 : coil,
    blPeak,
    blPeakAt,
    flat: s ? null : Math.abs(coil - gap) / 2,
    overhung: coil >= gap,
    bl82At: excursionAt(bl, 0.82, span),
    bl70At: excursionAt(bl, BL_AT_XMAX, span),
    blSixDbAt: excursionAt(bl, Math.pow(10, -XVAR_DB / 20), span),
    blAtXmax: xmax > 0 ? bl(xmax) : null,
  })
  return out
}

export const __internals = { baseValue, rawEval, logCosh }
