export const TYPE_NAMES = {
  driver: 'Driver', chamber: 'Chamber', waveguide: 'Waveguide', pr: 'Passive Radiator', radiation: 'Radiation',
}

const paramsOf = (node) => node?.params || node?.data?.params || {}

export function baseName(node) {
  const label = String(paramsOf(node).label ?? '').trim()
  return label || TYPE_NAMES[node?.type] || node?.id || ''
}

const cache = new WeakMap()

export function nameNumbers(nodes) {
  if (!Array.isArray(nodes)) return {}
  const hit = cache.get(nodes)
  if (hit) return hit
  const groups = new Map()
  for (const n of nodes) {
    const key = baseName(n)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(n.id)
  }
  const out = {}
  for (const ids of groups.values()) ids.forEach((id, i) => { out[id] = ids.length > 1 ? i + 1 : 0 })
  cache.set(nodes, out)
  return out
}

export function displayNames(nodes) {
  const nums = nameNumbers(nodes)
  const out = {}
  for (const n of nodes || []) out[n.id] = nums[n.id] ? `${baseName(n)} #${nums[n.id]}` : baseName(n)
  return out
}

export function displayName(nodes, id) {
  const node = (nodes || []).find((n) => n.id === id)
  if (!node) return id
  const num = nameNumbers(nodes)[id]
  return num ? `${baseName(node)} #${num}` : baseName(node)
}

export const CHANNEL_NAME = 'Channel'

export function channelBase(c) {
  return String(c?.label ?? '').trim() || CHANNEL_NAME
}

const channelCache = new WeakMap()

export function channelNumbers(channels) {
  if (!Array.isArray(channels)) return {}
  const hit = channelCache.get(channels)
  if (hit) return hit
  const groups = new Map()
  for (const c of channels) {
    const key = channelBase(c)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c.id)
  }
  const out = {}
  for (const ids of groups.values()) ids.forEach((id, i) => { out[id] = ids.length > 1 ? i + 1 : 0 })
  channelCache.set(channels, out)
  return out
}

export function channelNames(channels) {
  const nums = channelNumbers(channels)
  const out = {}
  for (const c of channels || []) out[c.id] = nums[c.id] ? `${channelBase(c)} #${nums[c.id]}` : channelBase(c)
  return out
}
