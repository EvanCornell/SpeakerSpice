let counter = 0

export const uid = (p = 'n') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`

export const LAYOUT_VERSION = 2

export function stack(panels, opts = {}) {
  return {
    id: opts.id || uid('s'),
    type: 'stack',
    size: opts.size ?? 1,
    panels,
    active: opts.active ?? panels[0] ?? null,
  }
}

export function split(dir, children, size = 1) {
  return { id: uid('d'), type: 'split', dir, size, children }
}

export const defaultLayout = () => split('row', [
  stack(['files'], { size: 16 }),
  split('col', [
    stack(['canvas'], { size: 60 }),
    stack(['spl', 'zin', 'exc', 'vel'], { size: 40, active: 'spl' }),
  ], 60),
  stack(['params', 'probes'], { size: 24, active: 'params' }),
])

export function findNode(tree, id) {
  if (!tree) return null
  if (tree.id === id) return tree
  if (tree.type === 'split') {
    for (const c of tree.children) {
      const hit = findNode(c, id)
      if (hit) return hit
    }
  }
  return null
}

export function findPanelStack(tree, panelId) {
  if (!tree) return null
  if (tree.type === 'stack') return tree.panels.includes(panelId) ? tree : null
  for (const c of tree.children) {
    const hit = findPanelStack(c, panelId)
    if (hit) return hit
  }
  return null
}

export function openPanels(tree, out = []) {
  if (!tree) return out
  if (tree.type === 'stack') out.push(...tree.panels)
  else tree.children.forEach((c) => openPanels(c, out))
  return out
}

export function isOpen(tree, panelId) {
  return !!findPanelStack(tree, panelId)
}

function mapStacks(tree, fn) {
  if (tree.type === 'stack') return fn(tree)
  return { ...tree, children: tree.children.map((c) => mapStacks(c, fn)) }
}

export function setActive(tree, stackId, panelId) {
  return mapStacks(tree, (s) => (s.id === stackId ? { ...s, active: panelId } : s))
}

function removeRec(node, panelId) {
  if (node.type === 'stack') {
    const idx = node.panels.indexOf(panelId)
    if (idx < 0) return node
    const panels = node.panels.filter((p) => p !== panelId)
    if (!panels.length) return null
    const active = node.active === panelId
      ? panels[Math.min(idx, panels.length - 1)]
      : node.active
    return { ...node, panels, active }
  }
  const children = node.children.map((c) => removeRec(c, panelId)).filter(Boolean)
  if (!children.length) return null
  if (children.length === 1) return { ...children[0], size: node.size }
  return { ...node, children }
}

export function removePanel(tree, panelId) {
  return removeRec(tree, panelId)
}

const dirOf = (zone) => (zone === 'left' || zone === 'right' ? 'row' : 'col')
const isBefore = (zone) => zone === 'left' || zone === 'top'

function insertRec(node, targetId, zone, panelId) {
  if (node.type === 'stack') {
    if (node.id !== targetId) return node
    if (zone === 'center') {
      return { ...node, panels: [...node.panels, panelId], active: panelId }
    }
    const half = node.size / 2
    const fresh = stack([panelId], { size: half })
    const kept = { ...node, size: half }
    return split(dirOf(zone), isBefore(zone) ? [fresh, kept] : [kept, fresh], node.size)
  }

  const i = node.children.findIndex((c) => c.id === targetId)
  if (i >= 0 && zone !== 'center' && dirOf(zone) === node.dir) {
    const target = node.children[i]
    const half = target.size / 2
    const children = [...node.children]
    children[i] = { ...target, size: half }
    children.splice(isBefore(zone) ? i : i + 1, 0, stack([panelId], { size: half }))
    return { ...node, children }
  }

  return { ...node, children: node.children.map((c) => insertRec(c, targetId, zone, panelId)) }
}

export function dockPanel(tree, panelId, targetStackId, zone) {
  const from = findPanelStack(tree, panelId)
  if (from && from.id === targetStackId && (zone === 'center' || from.panels.length === 1)) {
    return setActive(tree, targetStackId, panelId)
  }
  const pruned = from ? removePanel(tree, panelId) : tree
  if (!pruned) return tree
  if (!findNode(pruned, targetStackId)) return dockToEdge(pruned, panelId, 'right')
  return insertRec(pruned, targetStackId, zone, panelId)
}

export function dockToEdge(tree, panelId, edge) {
  const pruned = findPanelStack(tree, panelId) ? removePanel(tree, panelId) : tree
  if (!pruned) return stack([panelId])
  const dir = dirOf(edge)
  if (pruned.type === 'split' && pruned.dir === dir) {
    const total = pruned.children.reduce((a, c) => a + c.size, 0)
    const fresh = stack([panelId], { size: total / 4 })
    const children = isBefore(edge) ? [fresh, ...pruned.children] : [...pruned.children, fresh]
    return { ...pruned, children }
  }
  const fresh = stack([panelId], { size: 22 })
  const kept = { ...pruned, size: 78 }
  return split(dir, isBefore(edge) ? [fresh, kept] : [kept, fresh], 1)
}

export function moveTabInStack(tree, stackId, from, to) {
  return mapStacks(tree, (s) => {
    if (s.id !== stackId) return s
    const panels = [...s.panels]
    const [p] = panels.splice(from, 1)
    panels.splice(to, 0, p)
    return { ...s, panels }
  })
}

export function openPanel(tree, panelId, hint) {
  const existing = findPanelStack(tree, panelId)
  if (existing) return setActive(tree, existing.id, panelId)
  const candidates = hint?.nextTo ? [hint.nextTo] : (hint?.nextToAny || [])
  for (const sibling of candidates) {
    if (sibling === panelId) continue
    const host = findPanelStack(tree, sibling)
    if (host) return dockPanel(tree, panelId, host.id, hint.zone || 'center')
  }
  return dockToEdge(tree, panelId, hint?.edge || 'bottom')
}

export function resizeChildren(tree, splitId, index, weightA, weightB) {
  if (tree.type !== 'split') return tree
  if (tree.id === splitId) {
    const children = [...tree.children]
    children[index] = { ...children[index], size: weightA }
    children[index + 1] = { ...children[index + 1], size: weightB }
    return { ...tree, children }
  }
  return { ...tree, children: tree.children.map((c) => resizeChildren(c, splitId, index, weightA, weightB)) }
}

function sanitizeSize(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function sanitize(tree, knownPanels) {
  if (!tree || typeof tree !== 'object') return null
  if (tree.type === 'stack') {
    const panels = (Array.isArray(tree.panels) ? tree.panels : []).filter((p) => knownPanels.includes(p))
    if (!panels.length) return null
    return {
      id: typeof tree.id === 'string' && tree.id ? tree.id : uid('s'),
      type: 'stack',
      size: sanitizeSize(tree.size),
      panels,
      active: panels.includes(tree.active) ? tree.active : panels[0],
    }
  }
  if (tree.type === 'split') {
    const kids = Array.isArray(tree.children) ? tree.children : []
    const children = kids.map((c) => sanitize(c, knownPanels)).filter(Boolean)
    if (!children.length) return null
    if (children.length === 1) return { ...children[0], size: sanitizeSize(tree.size) }
    return {
      id: typeof tree.id === 'string' && tree.id ? tree.id : uid('d'),
      type: 'split',
      dir: tree.dir === 'col' ? 'col' : 'row',
      size: sanitizeSize(tree.size),
      children,
    }
  }
  return null
}

export const __internals = { mapStacks, removeRec, dirOf, isBefore, insertRec }
