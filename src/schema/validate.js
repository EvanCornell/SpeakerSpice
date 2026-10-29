import { DEFAULT_PARAMS, NODE_HANDLES, PROBE_KINDS } from './version.js'
import { netsOf, liveWires, allTerminals, chTerm, driverStatus, GROUND } from './wires.js'
import { displayNames, channelNames } from '../nodeNames.js'

export function nodeHandles(node) {
  const base = NODE_HANDLES[node.type] || []
  const taps = Array.isArray(node.params?.taps) ? node.params.taps.map((t) => `tap:${t.id}`) : []
  return [...base, ...taps]
}

export function driverChannels(proj) {
  const out = new Map()
  for (const [id, st] of driverStatus(proj.wiring, proj.nodes)) out.set(id, st.channels)
  return out
}

const POSITIVE = {
  driver: ['Fs', 'Re', 'Bl', 'Mms', 'Cms', 'Sd', 'count'],
  chamber: ['volume', 'length'],
  waveguide: ['S1', 'S2', 'length'],
  pr: ['Mmd', 'Cms', 'Sd', 'count'],
  radiation: [],
}

function endArea(node, handle) {
  const p = node.params || {}
  if (node.type === 'waveguide') {
    if (handle === 'throat') return Number(p.S1)
    if (handle === 'mouth') return Number(p.S2)
  }
  if (node.type === 'chamber' && (handle === 'in' || handle === 'out')) {
    return (Number(p.volume) * 1000) / Number(p.length)
  }
  return null
}

export function validateProject(proj) {
  const errors = []
  const warnings = {}
  const warn = (id, msg) => { (warnings[id] ||= []).push(msg) }
  const nodes = proj.nodes || []
  const shown = displayNames(nodes)
  const byId = new Map()
  for (const [i, n] of nodes.entries()) {
    if (!n.id) { errors.push(`nodes[${i}] is missing "id"`); continue }
    if (byId.has(n.id)) errors.push(`node id "${n.id}" is used more than once`)
    byId.set(n.id, n)
    if (!DEFAULT_PARAMS[n.type]) { errors.push(`node "${n.id}" has unknown type "${n.type}"`); continue }
    const name = shown[n.id]
    for (const k of POSITIVE[n.type]) {
      const v = Number(n.params?.[k])
      if (!(v > 0)) errors.push(`${name}: ${k} must be greater than zero`)
    }
    for (const t of n.params?.taps || []) {
      const pos = Number(t.position)
      const len = Number(n.params.length)
      if (!(pos > 0 && pos < len)) warn(n.id, `Tap ${t.id} at ${pos} cm is not inside the ${len} cm length.`)
    }
  }

  const conns = new Map()
  for (const [i, e] of (proj.edges || []).entries()) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    if (!a) { errors.push(`edges[${i}] source "${e.source}" is not a node id`); continue }
    if (!b) { errors.push(`edges[${i}] target "${e.target}" is not a node id`); continue }
    if (!nodeHandles(a).includes(e.sourceHandle)) { errors.push(`edges[${i}]: ${shown[a.id]} has no handle "${e.sourceHandle}"`); continue }
    if (!nodeHandles(b).includes(e.targetHandle)) { errors.push(`edges[${i}]: ${shown[b.id]} has no handle "${e.targetHandle}"`); continue }
    if (a.id === b.id && e.sourceHandle === e.targetHandle) { errors.push(`edges[${i}] joins a handle to itself`); continue }
    for (const [x, hx, y, hy] of [[a, e.sourceHandle, b, e.targetHandle], [b, e.targetHandle, a, e.sourceHandle]]) {
      const k = `${x.id}:${hx}`
      if (!conns.has(k)) conns.set(k, [])
      conns.get(k).push({ node: y, handle: hy })
    }
  }
  const connected = (id, h) => (conns.get(`${id}:${h}`) || []).length > 0

  const drivers = nodes.filter((n) => n.type === 'driver')
  if (!drivers.length) errors.push('Add a Driver node to run a simulation.')

  const channels = proj.wiring?.channels || []
  if (!channels.length) errors.push('Add a channel to drive the drivers.')
  const ids = new Set()
  for (const c of channels) {
    if (ids.has(c.id)) errors.push(`channel id "${c.id}" is used more than once`)
    ids.add(c.id)
  }
  const terms = allTerminals(proj.wiring, nodes)
  const nets = netsOf(liveWires(proj.wiring?.wires, terms), terms)
  const outputs = new Map()
  const names = channelNames(channels)
  for (const c of channels) {
    const name = names[c.id] || c.id
    const net = nets.get(chTerm(c.id, '+'))
    if (net === GROUND) errors.push(`${name} is shorted: its + is wired to the ground.`)
    else if (outputs.has(net)) errors.push(`${outputs.get(net)} and ${name} are wired directly together.`)
    else outputs.set(net, name)
  }
  for (const [id, st] of driverStatus(proj.wiring, nodes)) {
    if (!st.channels.length) warn(id, 'Not wired to any channel — undriven, with its coil open.')
    if (st.dangling) warn(id, 'A coil has a cable on one terminal but not the other, so no current flows through it.')
    if (st.shorted) warn(id, 'A coil has its + and − wired together, so it is shorted.')
  }

  const analyses = proj.analyses || []
  if (!analyses.length) errors.push('Add an analysis to say what to simulate.')
  for (const a of analyses) {
    if (a.type === 'ac') {
      if (!(a.fmin > 0)) errors.push(`analysis ${a.id}: the lowest frequency must be greater than zero`)
      if (!(a.fmax > a.fmin)) errors.push(`analysis ${a.id}: the highest frequency must be above the lowest`)
      if (!(a.npts >= 2)) errors.push(`analysis ${a.id}: at least two frequency points are needed`)
    }
  }

  for (const p of proj.probes || []) {
    const key = `probe:${p.id}`
    const name = p.label || p.id
    if (!PROBE_KINDS.includes(p.kind)) { errors.push(`Probe ${name}: unknown kind "${p.kind}"`); continue }
    const n = byId.get(p.at?.node)
    if (!n) { warn(key, `Probe ${name} is on a node that does not exist.`); continue }
    if (p.at.position != null) {
      const len = Number(n.params?.length)
      if (n.type !== 'chamber' && n.type !== 'waveguide') warn(key, `Probe ${name}: only chambers and waveguides have positions along them.`)
      else if (!(Number(p.at.position) >= 0 && Number(p.at.position) <= len)) warn(key, `Probe ${name} at ${p.at.position} cm is not within the ${len} cm length.`)
    } else if (!nodeHandles(n).includes(p.at.handle)) {
      warn(key, `Probe ${name}: ${shown[n.id]} has no handle "${p.at.handle}".`)
    }
  }

  for (const n of nodes) {
    if (!DEFAULT_PARAMS[n.type]) continue
    const handles = nodeHandles(n)
    const any = handles.some((h) => connected(n.id, h))
    if (n.type === 'driver') {
      if (!connected(n.id, 'front') && !connected(n.id, 'rear')) {
        warn(n.id, 'Neither face is connected — treated as mounted in an infinite baffle; only the front counts toward the output.')
      }
      const Sd = Number(n.params.Sd) * Math.max(1, Number(n.params.count) || 1)
      for (const face of ['front', 'rear']) {
        for (const o of conns.get(`${n.id}:${face}`) || []) {
          const area = endArea(o.node, o.handle)
          if (area != null && Sd > area * 1.05) {
            warn(n.id, `The ${face} face (${Sd.toFixed(0)} cm²) meets ${shown[o.node.id]}'s ${o.handle} (${area.toFixed(0)} cm²), which is smaller than the cone. A real build needs a throat chamber between them; this is simulated as an ideal coupling with no trapped air.`)
          }
        }
      }
    } else if (!any) {
      warn(n.id, 'Not connected to anything.')
    }
  }
  return { errors, warnings }
}
