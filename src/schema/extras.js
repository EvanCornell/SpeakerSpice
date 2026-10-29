import { evaluateParams, evaluateExpression, isExpression } from './params.js'
import { parseTerm, toolbarChannel } from './wires.js'

export function pruneExtras(extras, nodeIds) {
  const ids = new Set(nodeIds)
  const alive = (t) => {
    const p = parseTerm(t)
    return !!p && (p.kind === 'channel' || ids.has(p.node))
  }
  const w = extras.wiring
  const wiring = w && {
    ...w,
    wires: (w.wires || []).filter((c) => alive(c.a) && alive(c.b)),
    layout: Object.fromEntries(Object.entries(w.layout || {}).filter(([id]) => ids.has(id))),
  }
  return {
    ...extras,
    wiring,
    probes: (extras.probes || []).filter((p) => ids.has(p.at?.node)),
  }
}

export function valueOf(v, values) {
  if (isExpression(v)) return evaluateExpression(v, values).value
  return Number(v)
}

export function driveOf(wiring, params) {
  const { values } = evaluateParams(params || [])
  const ch = toolbarChannel(wiring)
  const master = Math.pow(10, (valueOf(wiring?.masterDb ?? 0, values) || 0) / 20)
  return {
    voltage: ch ? valueOf(ch.volts, values) * master : NaN,
    rg: ch ? valueOf(ch.outputOhms ?? 0, values) || 0 : 0,
  }
}

const DEFAULT_OHMS = 8

export function channelDrive(wiring, nodes, params, id) {
  const { values } = evaluateParams(params || [])
  const channel = id ? (wiring?.channels || []).find((c) => c.id === id) : toolbarChannel(wiring)
  const master = Math.pow(10, (valueOf(wiring?.masterDb ?? 0, values) || 0) / 20)
  if (!channel) return { channel, volts: NaN, ohms: DEFAULT_OHMS, watts: 0, master }
  const volts = valueOf(channel.volts, values) * master
  const typed = channel.ohms == null || channel.ohms === '' ? NaN : valueOf(channel.ohms, values)
  const ohms = typed > 0 ? typed : DEFAULT_OHMS
  const watts = Number.isFinite(volts) ? (volts * volts) / ohms : 0
  return { channel, volts, ohms, watts, master }
}

export function channelPatch(drive, field, value) {
  if (field === 'impedance') return value > 0 ? { ohms: value } : null
  const volts = field === 'power' ? (value >= 0 ? Math.sqrt(value * drive.ohms) : NaN) : value
  if (!(volts >= 0)) return null
  return { volts: Number((volts / (drive.master || 1)).toPrecision(12)) }
}

export function freshId(prefix, used) {
  const taken = new Set(used)
  let i = 1
  while (taken.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}
