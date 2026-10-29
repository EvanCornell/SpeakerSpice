import { displayNames, TYPE_NAMES } from './nodeNames.js'

export const plural = (type) => {
  const name = TYPE_NAMES[type] || type
  return name.endsWith('s') ? name : `${name}s`
}

export const handleName = (handle) => (handle?.startsWith('tap:') ? `tap ${handle.slice(4)}` : handle)

export function hasHandle(node, handle) {
  if (!handle?.startsWith('tap:')) return true
  const tap = handle.slice(4)
  return (node?.data?.params?.taps || []).some((t) => t.id === tap)
}

const sameJoin = (a, b) =>
  (a.source === b.source && a.sourceHandle === b.sourceHandle && a.target === b.target && a.targetHandle === b.targetHandle)
  || (a.source === b.target && a.sourceHandle === b.targetHandle && a.target === b.source && a.targetHandle === b.sourceHandle)

function listNames(names) {
  if (names.length <= 3) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

export function planGroupConnect(nodes, edges, conn) {
  const from = nodes.find((n) => n.id === conn.source)
  const group = from?.selected ? nodes.filter((n) => n.selected && n.id !== conn.target) : []
  const members = group.length > 1 ? group : [from].filter(Boolean)
  if (members.length > 1) {
    const types = [...new Set(members.map((n) => n.type))]
    if (types.length > 1) {
      return { error: `Can't join these together: the selection mixes ${listNames(types.map(plural))}. Select nodes of one kind to join them at once.` }
    }
    const lacking = members.filter((n) => !hasHandle(n, conn.sourceHandle))
    if (lacking.length) {
      const shown = displayNames(nodes)
      return { error: `Can't join these together: ${listNames(lacking.map((n) => shown[n.id]))} ${lacking.length > 1 ? 'have' : 'has'} no ${handleName(conn.sourceHandle)}.` }
    }
  }
  const conns = []
  for (const n of members) {
    const c = { source: n.id, sourceHandle: conn.sourceHandle, target: conn.target, targetHandle: conn.targetHandle }
    if (edges.some((e) => sameJoin(e, c)) || conns.some((e) => sameJoin(e, c))) continue
    conns.push(c)
  }
  return { conns }
}

export function planReplace(nodes, edges, clipboard, targetIds) {
  const copied = clipboard?.nodes || []
  if (copied.length !== 1) {
    return { error: copied.length ? 'Copy a single node to replace with — the clipboard holds several.' : 'Copy a node first, then select the nodes to replace with it.' }
  }
  const src = copied[0]
  const targets = nodes.filter((n) => targetIds.includes(n.id))
  if (!targets.length) return { error: 'Select the nodes to replace.' }
  const wrong = targets.filter((n) => n.type !== src.type)
  if (wrong.length) {
    const shown = displayNames(nodes)
    return { error: `Can't replace ${listNames(wrong.map((n) => shown[n.id]))} with a ${TYPE_NAMES[src.type] || src.type}: a node can only be replaced by one of its own kind.` }
  }
  const params = {}
  for (const n of targets) {
    const p = JSON.parse(JSON.stringify(src.params))
    if (n.data?.params?.label != null) p.label = n.data.params.label
    else delete p.label
    params[n.id] = p
  }
  const taps = new Set((src.params.taps || []).map((t) => `tap:${t.id}`))
  const lost = (node, handle) => node in params && handle?.startsWith('tap:') && !taps.has(handle)
  const kept = edges.filter((e) => !lost(e.source, e.sourceHandle) && !lost(e.target, e.targetHandle))
  return { params, baseline: src.baseline, edges: kept, dropped: edges.length - kept.length }
}

export function mergeParams(nodes) {
  const keys = new Set(nodes.flatMap((n) => Object.keys(n.data?.params || {})))
  const params = {}
  const mixed = new Set()
  for (const k of keys) {
    const vals = nodes.map((n) => JSON.stringify(n.data?.params?.[k] ?? null))
    if (vals.every((v) => v === vals[0])) params[k] = nodes[0].data?.params?.[k]
    else mixed.add(k)
  }
  const lockSets = nodes.map((n) => JSON.stringify(n.data?.locks ?? null))
  const locks = lockSets.every((v) => v === lockSets[0]) ? nodes[0].data?.locks : undefined
  return { params, mixed, locks }
}
