import { nodeHandles } from '../schema/validate.js'
import { junctionCorrection } from '../engine/geometry.js'
import { driverSI } from './physics.js'

export function faceArea(node, handle) {
  const p = node.params || {}
  if (handle.startsWith('tap:')) return null
  if (node.type === 'waveguide') return Math.max((handle === 'throat' ? p.S1 : p.S2) * 1e-4, 1e-8)
  if (node.type === 'chamber') return Math.max(p.volume * 1e-3, 1e-8) / Math.max(p.length * 1e-2, 1e-4)
  if (node.type === 'driver') return driverSI(p).Sd
  if (node.type === 'pr') return Math.max(p.Sd * 1e-4, 1e-8) * Math.max(1, Math.round(p.count || 1))
  return null
}

export function buildNets(proj, nl) {
  const parent = new Map()
  const find = (k) => {
    let r = k
    while (parent.get(r) !== r) r = parent.get(r)
    let c = k
    while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n }
    return r
  }
  const byId = new Map()
  for (const n of proj.nodes || []) {
    byId.set(n.id, n)
    for (const h of nodeHandles(n)) parent.set(`${n.id}:${h}`, `${n.id}:${h}`)
  }
  const adj = new Map()
  for (const e of proj.edges || []) {
    const a = `${e.source}:${e.sourceHandle}`
    const b = `${e.target}:${e.targetHandle}`
    if (!parent.has(a) || !parent.has(b)) continue
    parent.set(find(a), find(b))
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push({ node: byId.get(e.target), handle: e.targetHandle })
    adj.get(b).push({ node: byId.get(e.source), handle: e.sourceHandle })
  }
  const names = new Map()
  for (const k of parent.keys()) {
    const r = find(k)
    if (!names.has(r)) names.set(r, nl.node())
  }
  return {
    netOf: (id, handle) => names.get(find(`${id}:${handle}`)),
    neighbours: (id, handle) => adj.get(`${id}:${handle}`) || [],
    connected: (id, handle) => (adj.get(`${id}:${handle}`) || []).length > 0,
    all: [...new Set(names.values())],
  }
}

export function endCorrection(nets, node, handle) {
  const nb = nets.neighbours(node.id, handle)
  if (!nb.length) return 0
  let total = 0
  let farSideCanHold = true
  for (const o of nb) {
    const area = faceArea(o.node, o.handle)
    if (area == null) return 0
    total += area
    if (o.node.type !== 'waveguide' && o.node.type !== 'chamber') farSideCanHold = false
  }
  const self = faceArea(node, handle)
  if (self > total && farSideCanHold) return 0
  return junctionCorrection(self, total)
}
