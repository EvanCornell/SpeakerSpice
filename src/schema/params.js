import { parse } from 'mathjs'
import { DEFAULT_PARAMS } from './version.js'
import { channelNames } from '../nodeNames.js'

const FUNCTIONS = new Set(['sqrt', 'min', 'max', 'abs', 'log', 'log10', 'exp', 'pow', 'round', 'floor', 'ceil'])

const CONSTANTS = { pi: Math.PI, e: Math.E }

const OPERATORS = new Set(['add', 'subtract', 'multiply', 'divide', 'pow', 'unaryMinus', 'unaryPlus'])

const NULLABLE_NUMERIC = new Set(['leakQL', 'areaOverride'])

export function isExpression(v) {
  return typeof v === 'string'
}

export function isValidParamName(name) {
  return typeof name === 'string'
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    && !FUNCTIONS.has(name)
    && !(name in CONSTANTS)
}

function parseExpression(src) {
  if (!src.trim()) return { node: null, symbols: [], error: 'empty expression' }
  let node
  try {
    node = parse(src)
  } catch (err) {
    return { node: null, symbols: [], error: `cannot parse "${src}": ${err.message}` }
  }
  const symbols = new Set()
  let error = null
  node.traverse((n, path, parent) => {
    if (error) return
    switch (n.type) {
      case 'ConstantNode':
        if (typeof n.value !== 'number') error = `"${src}" contains a non-numeric constant`
        break
      case 'ParenthesisNode':
        break
      case 'OperatorNode':
        if (!OPERATORS.has(n.fn)) error = `"${src}" uses the operator "${n.op}", which is not allowed`
        break
      case 'FunctionNode':
        if (!FUNCTIONS.has(n.fn?.name)) error = `"${src}" calls "${n.fn?.name}", which is not an allowed function`
        break
      case 'SymbolNode':
        if (parent?.type === 'FunctionNode' && path === 'fn') break
        if (!(n.name in CONSTANTS)) symbols.add(n.name)
        break
      default:
        error = `"${src}" uses ${n.type}, which is not allowed in an expression`
    }
  })
  return { node: error ? null : node, symbols: [...symbols], error }
}

export function evaluateParams(params = []) {
  const errors = []
  const defs = new Map()
  for (const p of params) {
    if (!isValidParamName(p?.name)) { errors.push(`"${p?.name}" is not a valid parameter name`); continue }
    if (defs.has(p.name)) { errors.push(`parameter "${p.name}" is defined more than once`); continue }
    defs.set(p.name, p.value)
  }
  const values = {}
  const state = new Map()
  const resolve = (name, stack) => {
    if (state.get(name) === 'done') return true
    if (state.get(name) === 'failed') return false
    if (state.get(name) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(name)), name]
      errors.push(`parameters reference each other in a cycle: ${cycle.join(' → ')}`)
      return false
    }
    state.set(name, 'visiting')
    const raw = defs.get(name)
    let ok = true
    let v = NaN
    if (typeof raw === 'number') {
      v = raw
    } else if (isExpression(raw)) {
      const { node, symbols, error } = parseExpression(raw)
      if (error) { errors.push(`parameter "${name}": ${error}`); ok = false }
      for (const s of ok ? symbols : []) {
        if (!defs.has(s)) { errors.push(`parameter "${name}" refers to "${s}", which is not defined`); ok = false; continue }
        if (!resolve(s, [...stack, name])) ok = false
      }
      if (ok) v = node.compile().evaluate({ ...CONSTANTS, ...values })
    } else {
      errors.push(`parameter "${name}" has no value`)
      ok = false
    }
    if (ok && !(typeof v === 'number' && isFinite(v))) {
      errors.push(`parameter "${name}" does not evaluate to a finite number`)
      ok = false
    }
    state.set(name, ok ? 'done' : 'failed')
    if (ok) values[name] = v
    return ok
  }
  for (const name of defs.keys()) resolve(name, [])
  return { values, errors }
}

export function evaluateExpression(src, values) {
  const { node, symbols, error } = parseExpression(src)
  if (error) return { value: NaN, error }
  const missing = symbols.filter((s) => !(s in values))
  if (missing.length) return { value: NaN, error: `"${src}" refers to ${missing.map((s) => `"${s}"`).join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not defined` }
  const v = node.compile().evaluate({ ...CONSTANTS, ...values })
  if (!(typeof v === 'number' && isFinite(v))) return { value: NaN, error: `"${src}" does not evaluate to a finite number` }
  return { value: v, error: null }
}

export function isNumericField(type, field) {
  return typeof DEFAULT_PARAMS[type]?.[field] === 'number' || NULLABLE_NUMERIC.has(field)
}

export function resolveNodeParams(node, values, errors = []) {
  const name = node.params?.label || node.id
  const num = (v, where) => {
    if (!isExpression(v)) return v
    const r = evaluateExpression(v, values)
    if (r.error) errors.push(`${where}: ${r.error}`)
    return r.value
  }
  const params = { ...node.params }
  for (const [k, v] of Object.entries(params)) {
    if (isNumericField(node.type, k)) params[k] = num(v, `${name} › ${k}`)
  }
  if (Array.isArray(params.taps)) {
    params.taps = params.taps.map((t) => ({ ...t, position: num(t.position, `${name} › tap ${t.id}`) }))
  }
  return params
}

export function resolveProject(proj) {
  const { values, errors } = evaluateParams(proj.params)
  const num = (v, where) => {
    if (!isExpression(v)) return v
    const r = evaluateExpression(v, values)
    if (r.error) errors.push(`${where}: ${r.error}`)
    return r.value
  }
  const nodes = (proj.nodes || []).map((n) => ({ ...n, params: resolveNodeParams(n, values, errors) }))
  const w = proj.wiring || { masterDb: 0, channels: [] }
  const shown = channelNames(w.channels)
  const wiring = {
    ...w,
    masterDb: num(w.masterDb, 'master level'),
    channels: (w.channels || []).map((c) => ({
      ...c,
      volts: num(c.volts, `${shown[c.id]} › volts`),
      outputOhms: num(c.outputOhms, `${shown[c.id]} › Rg`),
    })),
  }
  const analyses = (proj.analyses || []).map((a) => {
    const out = { ...a }
    for (const k of ['fmin', 'fmax', 'npts', 'duration', 'step']) {
      if (k in out) out[k] = num(out[k], `analysis ${a.id} › ${k}`)
    }
    return out
  })
  const probes = (proj.probes || []).map((p) => (
    p.at && 'position' in p.at
      ? { ...p, at: { ...p.at, position: num(p.at.position, `probe ${p.label || p.id} › position`) } }
      : p
  ))
  return { project: { ...proj, nodes, wiring, analyses, probes }, values, errors }
}

export const __internals = { parseExpression }
