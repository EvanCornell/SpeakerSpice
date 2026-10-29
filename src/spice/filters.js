import { fmt } from './netlist.js'

export const FILTER_TYPES = ['highpass', 'lowpass', 'peq', 'lowshelf', 'highshelf', 'notch', 'allpass', 'transform']

export const FILTER_SHAPES = ['butterworth', 'linkwitz-riley', 'bessel']

export function butterworthStages(order) {
  const n = Math.max(1, Math.round(order))
  const qs = []
  for (let k = 1; k <= Math.floor(n / 2); k++) qs.push(1 / (2 * Math.sin(((2 * k - 1) * Math.PI) / (2 * n))))
  return { qs, first: n % 2 === 1 }
}

export function besselPoles(order) {
  const n = Math.max(1, Math.round(order))
  const fact = (k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f }
  const a = []
  for (let k = 0; k <= n; k++) a.push(fact(2 * n - k) / (2 ** (n - k) * fact(k) * fact(n - k)))
  const monic = a.map((c) => c / a[n])
  const poly = (zr, zi) => {
    let r = 0, i = 0
    for (let k = n; k >= 0; k--) { const t = r * zr - i * zi + monic[k]; i = r * zi + i * zr; r = t }
    return [r, i]
  }
  let roots = Array.from({ length: n }, (_, k) => ({ re: 0.4 * Math.cos(2.1 * k + 0.4) - 1, im: 0.9 * Math.sin(2.1 * k + 0.4) * n / 2 }))
  for (let it = 0; it < 500; it++) {
    let moved = 0
    roots = roots.map((z, k) => {
      const [pr, pi] = poly(z.re, z.im)
      let dr = 1, di = 0
      roots.forEach((w, j) => { if (j !== k) { const xr = z.re - w.re, xi = z.im - w.im; const t = dr * xr - di * xi; di = dr * xi + di * xr; dr = t } })
      const d = dr * dr + di * di
      const qr = (pr * dr + pi * di) / d, qi = (pi * dr - pr * di) / d
      moved = Math.max(moved, Math.hypot(qr, qi))
      return { re: z.re - qr, im: z.im - qi }
    })
    if (moved < 1e-14) break
  }
  const mag2 = (w) => roots.reduce((g, p) => g * (p.re * p.re + p.im * p.im) / (p.re * p.re + (w - p.im) ** 2), 1)
  let lo = 0.01, hi = 100
  for (let i = 0; i < 200; i++) { const mid = Math.sqrt(lo * hi); if (mag2(mid) > 0.5) lo = mid; else hi = mid }
  const w3 = Math.sqrt(lo * hi)
  return roots.filter((p) => p.im > -1e-9).map((p) => ({ re: p.re / w3, im: Math.abs(p.im) < 1e-9 ? 0 : p.im / w3 }))
}

function prototypePoles(shape, order) {
  if (shape === 'bessel') return besselPoles(order)
  const n = Math.max(1, Math.round(order))
  const out = []
  for (let k = 1; k <= Math.ceil(n / 2); k++) {
    const t = (Math.PI * (2 * k + n - 1)) / (2 * n)
    out.push({ re: Math.cos(t), im: Math.abs(Math.sin(t)) < 1e-12 ? 0 : -Math.sin(t) })
  }
  return out.map((p) => ({ re: p.re, im: Math.abs(p.im) }))
}

function passSections(hp, poles, w) {
  return poles.map((p) => {
    const m2 = p.re * p.re + p.im * p.im
    const q = hp ? { re: (w * p.re) / m2, im: (-w * p.im) / m2 } : { re: w * p.re, im: w * p.im }
    if (p.im === 0) {
      const a0 = -q.re
      return { order: 1, b: hp ? [1, 0] : [0, a0], a: [a0] }
    }
    const a1 = -2 * q.re
    const a0 = q.re * q.re + q.im * q.im
    return { order: 2, b: hp ? [1, 0, 0] : [0, 0, a0], a: [a1, a0] }
  })
}

export function filterSections(f) {
  if (f.type === 'transform') {
    const [f0, q0, fp, qp] = [f.f0, f.q0, f.fp, f.qp].map(Number)
    if (!(f0 > 0 && fp > 0)) throw new Error('a Linkwitz transform needs frequencies above zero')
    if (!(q0 > 0 && qp > 0)) throw new Error('a Linkwitz transform needs a Q above zero')
    const w0 = 2 * Math.PI * f0
    const wp = 2 * Math.PI * fp
    return [{ order: 2, b: [1, w0 / q0, w0 * w0], a: [wp / qp, wp * wp] }]
  }
  const hz = Number(f.hz)
  if (!(hz > 0)) throw new Error('a filter needs a frequency above zero')
  const w = 2 * Math.PI * hz
  if (f.type === 'highpass' || f.type === 'lowpass') {
    const hp = f.type === 'highpass'
    let order = Math.max(1, Math.round(Number(f.order) || 2))
    let passes = 1
    let shape = f.shape || 'butterworth'
    if (shape === 'linkwitz-riley') {
      order = Math.max(1, Math.ceil(order / 2))
      passes = 2
      shape = 'butterworth'
    } else if (!FILTER_SHAPES.includes(shape)) {
      throw new Error(`unknown filter shape "${f.shape}"`)
    }
    const one = passSections(hp, prototypePoles(shape, order), w)
    return passes === 2 ? [...one, ...one] : one
  }
  const q = Number(f.q ?? 0.707)
  if (!(q > 0)) throw new Error('a filter needs a Q above zero')
  if (f.type === 'notch') return [{ order: 2, b: [1, 0, w * w], a: [w / q, w * w] }]
  if (f.type === 'allpass') return [{ order: 2, b: [1, -w / q, w * w], a: [w / q, w * w] }]
  const A = Math.pow(10, (Number(f.db) || 0) / 40)
  if (f.type === 'peq') {
    return [{ order: 2, b: [1, (w * A) / q, w * w], a: [w / (A * q), w * w] }]
  }
  const r = Math.sqrt(A)
  if (f.type === 'lowshelf') {
    return [{ order: 2, b: [1, (r * w) / q, A * w * w], a: [w / (r * q), (w * w) / A] }]
  }
  if (f.type === 'highshelf') {
    return [{ order: 2, b: [A * A, (A * r * w) / q, A * w * w], a: [(r * w) / q, A * w * w] }]
  }
  throw new Error(`unknown filter type "${f.type}"`)
}

export function sectionsResponse(sections, hz) {
  const w = 2 * Math.PI * hz
  let re = 1
  let im = 0
  for (const s of sections) {
    let nr, ni, dr, di
    if (s.order === 2) {
      nr = s.b[2] - s.b[0] * w * w; ni = s.b[1] * w
      dr = s.a[1] - w * w; di = s.a[0] * w
    } else {
      nr = s.b[1]; ni = s.b[0] * w
      dr = s.a[0]; di = w
    }
    const d = dr * dr + di * di
    const hr = (nr * dr + ni * di) / d
    const hi = (ni * dr - nr * di) / d
    const r2 = re * hr - im * hi
    im = re * hi + im * hr
    re = r2
  }
  return { re, im }
}

export function compileSections(nl, input, sections, note) {
  let at = input
  for (const s of sections) {
    const out = []
    if (s.order === 2) {
      const [a1, a0] = s.a
      const L = 1 / Math.sqrt(a0)
      const a = nl.node()
      const b = nl.node()
      nl.add('L', [at, a], fmt(L), `${note} filter section`)
      nl.add('R', [a, b], fmt(a1 * L))
      nl.add('C', [b, '0'], fmt(1 / (a0 * L)))
      out.push([s.b[0], at, a], [s.b[1] / a1, a, b], [s.b[2] / a0, b, '0'])
    } else {
      const [a0] = s.a
      const b = nl.node()
      nl.add('C', [at, b], fmt(1 / a0), `${note} filter section`)
      nl.add('R', [b, '0'], '1')
      out.push([s.b[0], b, '0'], [s.b[1] / a0, at, b])
    }
    let base = '0'
    for (const [g, p, m] of out.filter(([g]) => g !== 0)) {
      const next = nl.node()
      nl.add('E', [next, base, p, m], fmt(g))
      base = next
    }
    if (base === '0') { base = nl.node(); nl.add('R', [base, '0'], '1') }
    at = base
  }
  return at
}
