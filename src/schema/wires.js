import { nominalOf, driverNominal } from './nominal.js'

export const UNIT_ARRANGEMENTS = ['series', 'parallel', 'series-parallel']
export const COIL_ARRANGEMENTS = ['series', 'parallel', 'one']

export const chTerm = (ch, pol) => `ch:${ch}:${pol}`

export const nodeTerm = (node, element, pol) => (element ? `${node}:${element}:${pol}` : `${node}:${pol}`)

export function parseTerm(t) {
  if (typeof t !== 'string') return null
  const pol = t.slice(-1)
  if ((pol !== '+' && pol !== '-') || t[t.length - 2] !== ':') return null
  const body = t.slice(0, -2)
  if (body.startsWith('ch:')) return { kind: 'channel', ch: body.slice(3), pol }
  const i = body.indexOf(':')
  return i < 0 ? { kind: 'node', node: body, element: '', pol } : { kind: 'node', node: body.slice(0, i), element: body.slice(i + 1), pol }
}

export const unitsOf = (p) => Math.max(1, Math.round(Number(p?.count) || 1))

export const isCustom = (p) => p?.wiring === 'custom'

export const coilsOf = (p) => (p?.dvc ? ['A', 'B'] : [''])

export function elementsOf(node) {
  const p = node.params || node.data?.params || {}
  if (!isCustom(p)) return [{ key: '', label: '', plus: nodeTerm(node.id, '', '+'), minus: nodeTerm(node.id, '', '-'), nominal: driverNominal(p) }]
  const coils = coilsOf(p)
  const n = unitsOf(p)
  const coilOhms = nominalOf(p) / coils.length
  const out = []
  for (let u = 1; u <= n; u++) {
    for (const c of coils) {
      const key = `${u}${c}`
      const label = [n > 1 ? `Driver ${u}` : '', c ? `coil ${c}` : ''].filter(Boolean).join(' · ') || 'Coil'
      out.push({ key, label: label[0].toUpperCase() + label.slice(1), plus: nodeTerm(node.id, key, '+'), minus: nodeTerm(node.id, key, '-'), nominal: coilOhms })
    }
  }
  return out
}

export function allTerminals(wiring, nodes) {
  const out = new Set()
  for (const c of wiring?.channels || []) { out.add(chTerm(c.id, '+')); out.add(chTerm(c.id, '-')) }
  for (const n of nodes || []) {
    if (n.type !== 'driver') continue
    for (const e of elementsOf(n)) { out.add(e.plus); out.add(e.minus) }
  }
  return out
}

export function liveWires(wires, terms) {
  const seen = new Set()
  const out = []
  for (const w of wires || []) {
    if (!terms.has(w?.a) || !terms.has(w?.b) || w.a === w.b) continue
    const key = [w.a, w.b].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ a: w.a, b: w.b })
  }
  return out
}

export const GROUND = 'ground'

export function netsOf(wires, terms = []) {
  const parent = new Map()
  const find = (t) => {
    if (!parent.has(t)) parent.set(t, t)
    let r = t
    while (parent.get(r) !== r) r = parent.get(r)
    parent.set(t, r)
    return r
  }
  const all = [...terms, ...(wires || []).flatMap((w) => [w.a, w.b])]
  for (const t of all) find(t)
  for (const t of all) if (parseTerm(t)?.kind === 'channel' && parseTerm(t).pol === '-') parent.set(find(t), find(GROUND))
  for (const w of wires || []) parent.set(find(w.a), find(w.b))
  const out = new Map()
  const groundRoot = find(GROUND)
  for (const t of all) out.set(t, find(t) === groundRoot ? GROUND : find(t))
  return out
}

export function wireRefusal(wiring, a, b, names = {}) {
  if (a === b) return 'A cable needs two different terminals.'
  const wires = wiring?.wires || []
  if (wires.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return 'Those two are already joined.'
  const pa = parseTerm(a)
  const pb = parseTerm(b)
  if (pa?.kind === 'channel' && pb?.kind === 'channel') return 'Two channel terminals can\'t be joined directly — wire a driver between them.'
  const nets = netsOf([...wires, { a, b }], [a, b])
  const outputs = new Map()
  for (const c of wiring?.channels || []) {
    const net = nets.get(chTerm(c.id, '+'))
    if (net == null) continue
    const name = names[c.id] || c.label || c.id
    if (net === GROUND) return `That would short ${name}: its + would be joined to the ground.`
    if (outputs.has(net)) return `That would join ${outputs.get(net)} and ${name} directly.`
    outputs.set(net, name)
  }
  return null
}

export function driverStatus(wiring, nodes) {
  const terms = allTerminals(wiring, nodes)
  const wires = liveWires(wiring?.wires, terms)
  const nets = netsOf(wires, terms)
  const count = new Map()
  for (const t of terms) count.set(nets.get(t), (count.get(nets.get(t)) || 0) + 1)
  const parent = new Map()
  const find = (n) => {
    if (!parent.has(n)) parent.set(n, n)
    let r = n
    while (parent.get(r) !== r) r = parent.get(r)
    parent.set(n, r)
    return r
  }
  const elements = (nodes || []).filter((n) => n.type === 'driver').map((n) => ({ node: n, els: elementsOf(n) }))
  for (const { els } of elements) {
    for (const e of els) {
      const a = nets.get(e.plus); const b = nets.get(e.minus)
      if (a !== GROUND && b !== GROUND) parent.set(find(a), find(b))
    }
  }
  const grounded = new Set()
  for (const { els } of elements) {
    for (const e of els) {
      const a = nets.get(e.plus); const b = nets.get(e.minus)
      if (a === GROUND && b !== GROUND) grounded.add(find(b))
      if (b === GROUND && a !== GROUND) grounded.add(find(a))
    }
  }
  const channelsOf = new Map()
  for (const c of wiring?.channels || []) {
    const net = nets.get(chTerm(c.id, '+'))
    if (net == null || net === GROUND) continue
    const root = find(net)
    if (!channelsOf.has(root)) channelsOf.set(root, [])
    channelsOf.get(root).push(c.id)
  }
  const out = new Map()
  for (const { node, els } of elements) {
    const chans = new Set()
    let dangling = false
    let shorted = false
    for (const e of els) {
      for (const t of [e.plus, e.minus]) {
        const net = nets.get(t)
        if (net === GROUND) continue
        const root = find(net)
        if (grounded.has(root)) for (const id of channelsOf.get(root) || []) chans.add(id)
      }
      const lone = (t) => count.get(nets.get(t)) === 1
      if (lone(e.plus) !== lone(e.minus)) dangling = true
      if (nets.get(e.plus) === nets.get(e.minus) && wires.some((w) => [w.a, w.b].includes(e.plus) || [w.a, w.b].includes(e.minus))) shorted = true
    }
    out.set(node.id, { channels: [...chans], dangling, shorted })
  }
  return out
}

export function nominalSolve(wiring, nodes, volts) {
  const terms = allTerminals(wiring, nodes)
  const wires = liveWires(wiring?.wires, terms)
  const nets = netsOf(wires, terms)
  const names = [...new Set(nets.values())].filter((n) => n !== GROUND)
  const index = new Map(names.map((n, i) => [n, i]))
  const channels = (wiring?.channels || []).filter((c) => nets.get(chTerm(c.id, '+')) !== GROUND)
  const size = names.length + channels.length
  const A = Array.from({ length: size }, () => new Float64Array(size))
  const z = new Float64Array(size)
  const stamp = (a, b, g) => {
    const i = index.get(a); const j = index.get(b)
    if (i != null) A[i][i] += g
    if (j != null) A[j][j] += g
    if (i != null && j != null) { A[i][j] -= g; A[j][i] -= g }
  }
  const elements = []
  for (const n of nodes || []) {
    if (n.type !== 'driver') continue
    for (const e of elementsOf(n)) {
      const r = e.nominal > 0 ? e.nominal : 1e9
      elements.push({ e, r })
      stamp(nets.get(e.plus), nets.get(e.minus), 1 / r)
    }
  }
  for (const n of names) A[index.get(n)][index.get(n)] += 1e-9
  channels.forEach((c, k) => {
    const row = names.length + k
    const i = index.get(nets.get(chTerm(c.id, '+')))
    A[i][row] += 1; A[row][i] += 1
    z[row] = Number(volts[c.id]) || 0
  })
  const x = solve(A, z)
  const v = (net) => (net === GROUND ? 0 : x[index.get(net)] || 0)
  const out = { channels: {}, elements: {} }
  for (const c of wiring?.channels || []) out.channels[c.id] = { ohms: Infinity, amps: 0, watts: 0 }
  channels.forEach((c, k) => {
    const amps = -x[names.length + k]
    const vc = Number(volts[c.id]) || 0
    const ohms = Math.abs(amps) > 1e-6 * Math.max(Math.abs(vc), 1) ? vc / amps : Infinity
    out.channels[c.id] = { ohms, amps, watts: Number.isFinite(ohms) ? vc * amps : 0 }
  })
  for (const { e, r } of elements) out.elements[e.plus] = (v(nets.get(e.plus)) - v(nets.get(e.minus))) / r
  return out
}

function solve(A, b) {
  const n = b.length
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-15) continue
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[b[c], b[p]] = [b[p], b[c]]
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      if (!f) continue
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    if (Math.abs(A[r][r]) < 1e-15) continue
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]
    x[r] = s / A[r][r]
  }
  return x
}

export function arrangementWires(node) {
  const p = node.params || node.data?.params || {}
  const wires = []
  const coils = coilsOf(p)
  const n = unitsOf(p)
  const series = (blocks) => {
    for (let i = 1; i < blocks.length; i++) wires.push({ a: blocks[i - 1].minus, b: blocks[i].plus })
    return { plus: blocks[0].plus, minus: blocks[blocks.length - 1].minus }
  }
  const parallel = (blocks) => {
    for (let i = 1; i < blocks.length; i++) {
      wires.push({ a: blocks[0].plus, b: blocks[i].plus })
      wires.push({ a: blocks[0].minus, b: blocks[i].minus })
    }
    return { plus: blocks[0].plus, minus: blocks[0].minus }
  }
  const units = []
  for (let u = 1; u <= n; u++) {
    const cs = coils.map((c) => ({ plus: nodeTerm(node.id, `${u}${c}`, '+'), minus: nodeTerm(node.id, `${u}${c}`, '-') }))
    const how = p.dvc?.coils
    units.push(cs.length === 1 || how === 'one' ? cs[0] : how === 'parallel' ? parallel(cs) : series(cs))
  }
  let whole
  if (p.wiring === 'series') whole = series(units)
  else if (p.wiring === 'series-parallel' && Math.round(Math.sqrt(n)) ** 2 === n && n > 1) {
    const r = Math.round(Math.sqrt(n))
    whole = parallel(Array.from({ length: r }, (_, g) => series(units.slice(g * r, g * r + r))))
  } else whole = parallel(units)
  return { wires, ...whole }
}

export function parallelWires(drivers, ch) {
  const out = []
  for (const n of drivers) {
    const p = n.params || n.data?.params || {}
    if (isCustom(p)) continue
    out.push({ a: chTerm(ch, '+'), b: nodeTerm(n.id, '', '+') }, { a: chTerm(ch, '-'), b: nodeTerm(n.id, '', '-') })
  }
  return out
}

export function wiresFromLoads(channels, driverIds) {
  const claimed = new Set()
  const claim = (t) => {
    if (!t) return
    if (t.driver) claimed.add(t.driver)
    for (const k of ['parallel', 'series']) if (Array.isArray(t[k])) t[k].forEach(claim)
  }
  for (const c of channels || []) claim(c.load)
  const ids = new Set(driverIds)
  const members = new Map()
  let fresh = 0
  const join = (net, t) => {
    if (!members.has(net)) members.set(net, [])
    members.get(net).push(t)
  }
  const lay = (t, a, b) => {
    if (!t) return
    if (t.driver) {
      if (!ids.has(t.driver)) return
      join(a, nodeTerm(t.driver, '', '+'))
      join(b, nodeTerm(t.driver, '', '-'))
      return
    }
    if (Array.isArray(t.parallel)) for (const k of t.parallel) lay(k, a, b)
    if (Array.isArray(t.series)) {
      let at = a
      t.series.forEach((k, i) => {
        const next = i === t.series.length - 1 ? b : `n${fresh++}`
        lay(k, at, next)
        at = next
      })
    }
  }
  let catchAll = false
  for (const c of channels || []) {
    const a = `${c.id}+`
    const b = `${c.id}-`
    join(a, chTerm(c.id, '+'))
    join(b, chTerm(c.id, '-'))
    if (c.load) lay(c.load, a, b)
    else if (!catchAll) {
      catchAll = true
      for (const id of driverIds) if (!claimed.has(id)) lay({ driver: id }, a, b)
    }
  }
  const out = []
  for (const ts of members.values()) for (let i = 1; i < ts.length; i++) out.push({ a: ts[0], b: ts[i] })
  return out
}

export function toolbarChannel(wiring) {
  const chs = wiring?.channels || []
  return chs.find((c) => c.id === wiring?.toolbar) || chs[0]
}
