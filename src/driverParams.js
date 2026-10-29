import { RHO, C_AIR } from './engine/geometry'

const TAU = 2 * Math.PI
const K = RHO * C_AIR * C_AIR

export const COUPLED = ['Fs', 'Qts', 'Qes', 'Qms', 'Vas', 'Re', 'Bl', 'Mms', 'Cms', 'Sd', 'Rms']

export const TS_FIELDS = [...COUPLED, 'Le', 'LeExp', 'Xmax', 'Znom']

export const BASIS_SIZE = 6

export const DEFAULT_BASIS = ['Sd', 'Bl', 'Cms', 'Rms', 'Mms', 'Re']

const toSI = { Vas: 1e-3, Mms: 1e-3, Cms: 1e-3, Sd: 1e-4 }

function si(v, key) {
  return v[key] * (toSI[key] || 1)
}

function relCompliance(target, v) {
  if (target === 'Vas') return (K * si(v, 'Sd') ** 2 * si(v, 'Cms')) / toSI.Vas
  if (target === 'Cms') return si(v, 'Vas') / (K * si(v, 'Sd') ** 2) / toSI.Cms
  return Math.sqrt(si(v, 'Vas') / (K * si(v, 'Cms'))) / toSI.Sd
}

function relResonance(target, v) {
  if (target === 'Fs') return 1 / (TAU * Math.sqrt(si(v, 'Mms') * si(v, 'Cms')))
  const ws = TAU * v.Fs
  if (target === 'Mms') return 1 / (ws * ws * si(v, 'Cms')) / toSI.Mms
  return 1 / (ws * ws * si(v, 'Mms')) / toSI.Cms
}

function relMechanicalQ(target, v) {
  if (target === 'Qms') return (TAU * v.Fs * si(v, 'Mms')) / v.Rms
  if (target === 'Rms') return (TAU * v.Fs * si(v, 'Mms')) / v.Qms
  if (target === 'Mms') return (v.Qms * v.Rms) / (TAU * v.Fs) / toSI.Mms
  return (v.Qms * v.Rms) / (TAU * si(v, 'Mms'))
}

function relElectricalQ(target, v) {
  if (target === 'Qes') return (TAU * v.Fs * si(v, 'Mms') * v.Re) / (v.Bl * v.Bl)
  if (target === 'Bl') return Math.sqrt((TAU * v.Fs * si(v, 'Mms') * v.Re) / v.Qes)
  if (target === 'Re') return (v.Qes * v.Bl * v.Bl) / (TAU * v.Fs * si(v, 'Mms'))
  if (target === 'Mms') return (v.Qes * v.Bl * v.Bl) / (TAU * v.Fs * v.Re) / toSI.Mms
  return (v.Qes * v.Bl * v.Bl) / (TAU * si(v, 'Mms') * v.Re)
}

function relTotalQ(target, v) {
  if (target === 'Qts') return (v.Qes * v.Qms) / (v.Qes + v.Qms)
  if (target === 'Qes') return (v.Qts * v.Qms) / (v.Qms - v.Qts)
  return (v.Qts * v.Qes) / (v.Qes - v.Qts)
}

export const RELATIONS = [
  { id: 'compliance', vars: ['Vas', 'Cms', 'Sd'], solve: relCompliance },
  { id: 'resonance', vars: ['Fs', 'Mms', 'Cms'], solve: relResonance },
  { id: 'mechanicalQ', vars: ['Qms', 'Fs', 'Mms', 'Rms'], solve: relMechanicalQ },
  { id: 'electricalQ', vars: ['Qes', 'Fs', 'Mms', 'Re', 'Bl'], solve: relElectricalQ },
  { id: 'totalQ', vars: ['Qts', 'Qes', 'Qms'], solve: relTotalQ },
]

export function round6(v) {
  if (!isFinite(v) || v === 0) return v
  const mag = Math.ceil(Math.log10(Math.abs(v)))
  const f = Math.pow(10, 6 - mag)
  return Math.round(v * f) / f
}

export function derive(params, basis) {
  const known = {}
  for (const key of basis) {
    const v = params[key]
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
      return { ok: false, values: {}, unresolved: COUPLED.filter((k) => !basis.includes(k)) }
    }
    known[key] = v
  }

  const pending = COUPLED.filter((k) => !(k in known))
  let progress = true
  while (progress && pending.length) {
    progress = false
    for (const rel of RELATIONS) {
      const missing = rel.vars.filter((k) => !(k in known))
      if (missing.length !== 1) continue
      const target = missing[0]
      const v = rel.solve(target, known)
      if (!isFinite(v) || v <= 0) continue
      known[target] = v
      pending.splice(pending.indexOf(target), 1)
      progress = true
    }
  }

  const values = {}
  for (const key of COUPLED) if (!basis.includes(key)) values[key] = round6(known[key])
  return { ok: pending.length === 0, values, unresolved: pending }
}

const PROBE = {
  Fs: 30, Qts: 0.454545, Qes: 0.5, Qms: 5, Vas: 60, Re: 3.6,
  Bl: 14.336, Mms: 151.425, Cms: 0.186, Sd: 480, Rms: 5.709,
}

export function canSolve(basis) {
  if (basis.length !== BASIS_SIZE) return false
  const probe = Object.fromEntries(basis.map((k) => [k, PROBE[k]]))
  return derive(probe, basis).ok
}

export function lockParam(basis, key) {
  if (basis.includes(key)) return basis
  for (const drop of basis) {
    const next = [...basis.filter((k) => k !== drop), key]
    if (canSolve(next)) return next
  }
  return null
}

export function unlockParam(basis, key) {
  if (!basis.includes(key)) return basis
  const rest = basis.filter((k) => k !== key)
  for (const add of COUPLED) {
    if (rest.includes(add) || add === key) continue
    const next = [...rest, add]
    if (canSolve(next)) return next
  }
  return null
}

export function basisOf(node) {
  const stored = node?.data?.locks
  return Array.isArray(stored) && canSolve(stored) ? stored : DEFAULT_BASIS
}

export function pickTS(params) {
  const out = {}
  for (const k of TS_FIELDS) if (params?.[k] != null) out[k] = params[k]
  return out
}

export function baselineOf(node) {
  const b = node?.data?.baseline
  return b && typeof b === 'object' ? b : null
}

export function withCurvesFor(node, params) {
  const base = baselineOf(node)
  const same = base && Object.entries(pickTS(params)).every(([k, v]) => base[k] === v)
  return same ? params : { ...params, nl: null }
}

export function matchesBaseline(node) {
  const base = baselineOf(node)
  if (!base) return false
  const p = node.data.params || {}
  return TS_FIELDS.every((k) => (p[k] ?? null) === (base[k] ?? null))
}
