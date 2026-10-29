import { areaProfile } from '../engine/geometry.js'
import { RHO, C_AIR, perimeter, viscousCoeff, flowResistivity, stuffedSoundSpeed, driverSI } from './physics.js'
import { fmt, resistor, sense } from './netlist.js'
import { radiationLoad, fractionalSeries } from './networks.js'
import { compileLine } from './line.js'
import { endCorrection, faceArea } from './nets.js'
import { curveSpan, pwlOf, stiffnessRatio, ratioOf, slopeOf } from './nonlinear.js'
import { isCustom, unitsOf, coilsOf, nodeTerm } from '../schema/wires.js'

const noteOf = (node) => `${node.params?.label || node.type} [${node.id}]`

function endMass(ctx, from, to, dl, S, viscous, note) {
  const { nl } = ctx
  const mid = viscous > 0 ? nl.node() : to
  nl.add('L', [from, mid], fmt((RHO * dl) / S), `${note} end correction`)
  if (viscous > 0) fractionalSeries(nl, mid, to, 0.5, viscous * viscousCoeff(S, perimeter(S)) * dl, ctx.band, `${note} end loss`)
}

function probesOn(ctx, node) {
  return (ctx.probes || [])
    .filter((p) => p.at?.node === node.id && p.at.position != null)
    .map((p) => ({ probe: p, x: Number(p.at.position) * 1e-2, flow: p.kind === 'flow' || p.kind === 'velocity' }))
}

function linePoints(node, probes) {
  return {
    points: [...(node.params.taps || []).map((t) => Number(t.position) * 1e-2), ...probes.filter((q) => !q.flow).map((q) => q.x)],
    flowPoints: probes.filter((q) => q.flow).map((q) => q.x),
  }
}

function placeProbes(ctx, node, line, probes, areaAt, ends) {
  const L = Number(node.params.length) * 1e-2
  for (const q of probes) {
    const p = q.probe
    if (!q.flow) {
      const key = p.id === `probe_${p.at.node}` ? p.at.node : p.id
      ctx.map.probes.push({ key, node: line.at(q.x) })
      continue
    }
    const name = line.flowAt(q.x)
    if (name) ctx.map.flowProbes.push({ key: p.id, kind: p.kind, sense: name, scale: 1, S: areaAt(q.x) })
    else if (q.x <= 0 || q.x >= L) ctx.endFlowProbes.push({ ...p, at: { node: node.id, handle: q.x <= 0 ? ends[0] : ends[1] } })
    else ctx.map.flowProbes.push({ key: p.id, kind: p.kind, sense: null })
  }
}

function recordFlow(ctx, id, handle, name, scale, S) {
  ctx.map.handleFlows[`${id}:${handle}`] = { sense: name, scale, S }
}

function connectTaps(ctx, node, line, areaAt) {
  for (const t of node.params.taps || []) {
    const h = `tap:${t.id}`
    if (!ctx.nets.connected(node.id, h)) continue
    const x = Number(t.position) * 1e-2
    const s = sense(ctx.nl, ctx.nets.netOf(node.id, h), `${noteOf(node)} tap ${t.id}`, line.at(x))
    recordFlow(ctx, node.id, h, s.name, 1, areaAt(x))
  }
}

function exitLoss(ctx, from, to, senseName, K, S, note) {
  const out = to || ctx.nl.node()
  ctx.nl.add('B', [from, out], `V=${fmt((K * RHO) / (2 * S * S))}*i(${senseName})*abs(i(${senseName}))`, `${note} exit loss`)
  return out
}

export function compileWaveguide(ctx, node) {
  const p = node.params
  const note = noteOf(node)
  const S1 = Math.max(p.S1 * 1e-4, 1e-8)
  const S2 = Math.max(p.S2 * 1e-4, 1e-8)
  const L = Math.max(p.length * 1e-2, 1e-4)
  const loss = Math.max(Number(p.loss) || 0, 0)
  const probes = probesOn(ctx, node)
  const area = areaProfile(p.flare || 'conical', S1, S2, L)
  const line = compileLine(ctx, {
    note, L, area, c: C_AIR, shape: 'round',
    viscous: loss, thermal: 0, flowResistance: 0,
    stepped: Math.abs(S1 - S2) > 1e-12, lumped: false, volume: 0,
    ...linePoints(node, probes),
  })
  connectTaps(ctx, node, line, area)
  placeProbes(ctx, node, line, probes, area, ['throat', 'mouth'])
  const k = p.ecFactor ?? 1
  const ends = {}
  for (const [h, endNode, S] of [['throat', line.start, S1], ['mouth', line.end, S2]]) {
    const K = Number(h === 'throat' ? p.throatK : p.mouthK) || 0
    if (ctx.nets.connected(node.id, h)) {
      const step = endCorrection(ctx.nets, node, h) > 0
      const dl = k * endCorrection(ctx.nets, node, h)
      const jet = ctx.nonlinear && step && K > 0
      const s = sense(ctx.nl, ctx.nets.netOf(node.id, h), `${note} ${h} flow`, dl > 0 || jet ? undefined : endNode)
      let at = s.out
      if (jet) at = exitLoss(ctx, at, dl > 0 ? undefined : endNode, s.name, K, S, `${note} ${h}`)
      if (dl > 0) endMass(ctx, at, endNode, dl, S, loss, `${note} ${h}`)
      ends[h] = { sense: s.name, S }
      recordFlow(ctx, node.id, h, s.name, 1, S)
    } else {
      const s = sense(ctx.nl, endNode, `${note} ${h} radiates`)
      const radLen = (8 / (3 * Math.PI)) * Math.sqrt(S / Math.PI)
      let radIn = ctx.nonlinear && K > 0 ? exitLoss(ctx, s.out, undefined, s.name, K, S, `${note} ${h}`) : s.out
      if (loss > 0) {
        const from = radIn
        radIn = ctx.nl.node()
        fractionalSeries(ctx.nl, from, radIn, 0.5, loss * viscousCoeff(S, perimeter(S)) * radLen, ctx.band, `${note} ${h} radiation-air loss`)
      }
      const omega = radiationLoad(ctx.nl, radIn, S, 'half', `${note} ${h} radiation`)
      ends[h] = { sense: s.name, S }
      recordFlow(ctx, node.id, h, s.name, 1, S)
      ctx.map.radiators.push({ key: h === 'mouth' ? node.id : `${node.id}:throat`, sense: s.name, node: radIn, omega, counts: true, driver: false })
    }
  }
  ctx.map.waveguides.push({ id: node.id, ends })
}

export function compileChamber(ctx, node) {
  const p = node.params
  const note = noteOf(node)
  const V = Math.max(p.volume * 1e-3, 1e-8)
  const L = Math.max(p.length * 1e-2, 1e-4)
  const S = V / L
  const c = stuffedSoundSpeed(p.stuffing)
  const probes = probesOn(ctx, node)
  const shape = p.shape === 'cylindrical' ? 'round' : 'rectangular'
  const area = () => S
  const line = compileLine(ctx, {
    note, L, area, c, shape,
    viscous: 1, thermal: 1, flowResistance: flowResistivity(p.stuffing),
    stepped: false, lumped: ctx.masking, volume: V,
    ...linePoints(node, probes),
  })
  connectTaps(ctx, node, line, area)
  placeProbes(ctx, node, line, probes, area, ['in', 'out'])
  if (Number(p.leakQL) > 0) {
    const Cbox = V / (RHO * c * c)
    const R = Number(p.leakQL) / (2 * Math.PI * Math.max(Number(p.leakHz) || 30, 0.1) * Cbox)
    if (line.start === line.end) resistor(ctx.nl, line.start, '0', R, `${note} leak`)
    else { resistor(ctx.nl, line.start, '0', 2 * R, `${note} leak`); resistor(ctx.nl, line.end, '0', 2 * R, `${note} leak`) }
  }
  for (const [h, endNode] of [['in', line.start], ['out', line.end]]) {
    if (!ctx.nets.connected(node.id, h)) continue
    const dl = endCorrection(ctx.nets, node, h)
    const s = sense(ctx.nl, ctx.nets.netOf(node.id, h), `${note} ${h} flow`, dl > 0 ? undefined : endNode)
    recordFlow(ctx, node.id, h, s.name, 1, S)
    if (dl > 0) endMass(ctx, s.out, endNode, dl, S, 0, `${note} ${h}`)
  }
}

export function applyDvc(p) {
  const coils = p.dvc?.coils
  if (coils === 'parallel') return { ...p, Re: p.Re / 4, Bl: p.Bl / 2, Le: p.Le / 4 }
  if (coils === 'one') return { ...p, Re: p.Re / 2, Bl: p.Bl / 2, Le: p.Le / 4 }
  return p
}

function exposedFaces(ctx, node, Sd, isDriver) {
  const note = noteOf(node)
  const frontOpen = !ctx.nets.connected(node.id, 'front')
  for (const face of ['front', 'rear']) {
    if (ctx.nets.connected(node.id, face)) continue
    const s = sense(ctx.nl, ctx.nets.netOf(node.id, face), `${note} ${face} radiates`)
    const omega = radiationLoad(ctx.nl, s.out, Sd, 'half', `${note} ${face} radiation`)
    const counts = face === 'front' || !frontOpen
    const key = isDriver ? `${node.id}:${face}` : (face === 'front' ? node.id : `${node.id}:rear`)
    ctx.map.radiators.push({ key, sense: s.name, node: s.out, omega, counts, driver: isDriver })
  }
}

function driverCurves(p, xmax) {
  const span = curveSpan(xmax)
  const bl = ratioOf(p.nl?.Bl, xmax)
  const k = stiffnessRatio(p.nl, xmax)
  const le = ratioOf(p.nl?.Le, xmax)
  if (!bl && !k && !le) return null
  const expr = (f) => (f ? (x) => pwlOf(f, span, x) : null)
  return { bl: expr(bl), k: expr(k), le: expr(le), leSlope: expr(le && slopeOf(le)) }
}

export function compileDriver(ctx, node, termOf) {
  const p = node.params
  if (!isCustom(p)) {
    const d = driverSI(applyDvc(p))
    compileUnit(ctx, node, d, [{ ep: termOf(nodeTerm(node.id, '', '+')), em: termOf(nodeTerm(node.id, '', '-')) }], '', true)
    exposedFaces(ctx, node, d.Sd, true)
    return
  }
  const n = unitsOf(p)
  const d = driverSI({ ...p, count: 1, wiring: 'parallel', dvc: null })
  const coils = coilsOf(p)
  for (let u = 1; u <= n; u++) {
    const terms = coils.map((c) => ({ ep: termOf(nodeTerm(node.id, `${u}${c}`, '+')), em: termOf(nodeTerm(node.id, `${u}${c}`, '-')) }))
    compileUnit(ctx, node, d, terms, n > 1 ? ` #${u}` : '', u === 1, n)
  }
  exposedFaces(ctx, node, d.Sd * n, true)
}

function compileUnit(ctx, node, d, coils, tag, primary, flowScale = 1) {
  const { nl } = ctx
  const note = `${noteOf(node)}${tag}`
  const front = ctx.nets.netOf(node.id, 'front')
  const rear = ctx.nets.netOf(node.id, 'rear')
  const m1 = nl.node(); const m2 = nl.node(); const m3 = nl.node(); const m4 = nl.node(); const m5 = nl.node()
  const vm = `V_${m5}`
  nl.comment(`driver ${note}`)
  let xn = null
  if (ctx.tran) {
    xn = nl.node()
    nl.add('F', ['0', xn, vm], '1', `${note} excursion`)
    nl.add('C', [xn, '0'], '1')
    resistor(nl, xn, '0', 1e12)
  }
  const curves = ctx.nonlinear && xn ? driverCurves(node.params, d.Xmax * 1000) : null
  const x = xn && `v(${xn})`
  const k = coils.length
  const Re = d.Re / k
  const Bl = d.Bl / k
  const Le = d.Le / (k * k)
  const blOf = curves?.bl ? `${fmt(Bl)}*${curves.bl(x)}` : null
  const parts = coils.map((c, i) => {
    const x1 = nl.node(); const x2 = nl.node(); const x3 = nl.node()
    const cn = k > 1 ? `${note} coil ${'AB'[i]}` : note
    resistor(nl, c.ep, x1, Re, `${cn} Re`)
    return { ...c, x1, x2, x3, ve: `V_${x3}`, cn }
  })
  const sum = parts.map((q) => `i(${q.ve})`).join('+')
  if (k === 1 && !curves?.le) {
    const q = parts[0]
    if (d.LeExp >= 0.999 || !(Le > 0)) nl.add('L', [q.x1, q.x2], fmt(Math.max(Le, 1e-9)), `${note} Le`)
    else fractionalSeries(nl, q.x1, q.x2, d.LeExp, Le, ctx.band, `${note} Le^${d.LeExp}`, 3)
  } else {
    const sh = nl.node()
    for (const q of parts) nl.add('F', ['0', sh, q.ve], '1', `${q.cn} flux`)
    if (d.LeExp >= 0.999 || !(Le > 0)) nl.add('L', [sh, '0'], fmt(Math.max(Le, 1e-9)))
    else fractionalSeries(nl, sh, '0', d.LeExp, Le, ctx.band, `${note} Le^${d.LeExp}`, 3)
    for (const q of parts) {
      if (curves?.le) nl.add('B', [q.x1, q.x2], `V=${curves.le(x)}*v(${sh})+${fmt(Le)}*${curves.leSlope(x)}*(${sum})*i(${vm})`, `${q.cn} Le(x)`)
      else nl.add('E', [q.x1, q.x2, sh, '0'], '1', `${q.cn} Le`)
    }
  }
  for (const q of parts) {
    if (blOf) nl.add('B', [q.x2, q.x3], `V=${blOf}*i(${vm})`, `${q.cn} back EMF, Bl(x)`)
    else nl.add('H', [q.x2, q.x3, vm], fmt(Bl), `${q.cn} back EMF`)
    nl.lines.push(`${q.ve} ${q.x3} ${q.em} DC 0 ; ${q.cn} coil current`)
  }
  let force = m1
  if (curves?.le) {
    force = nl.node()
    nl.add('B', [m1, force], `V=${fmt(0.5 * Le)}*${curves.leSlope(x)}*(${sum})*(${sum})`, `${note} reluctance force`)
  }
  let at = '0'
  parts.forEach((q, i) => {
    const to = i === parts.length - 1 ? force : nl.node()
    if (blOf) nl.add('B', [to, at], `V=${blOf}*i(${q.ve})`, `${q.cn} motor force, Bl(x)`)
    else nl.add('H', [to, at, q.ve], fmt(Bl), `${q.cn} motor force`)
    at = to
  })
  resistor(nl, m1, m2, d.Rms, `${note} Rms`)
  nl.add('L', [m2, m3], fmt(d.Mms), `${note} Mms`)
  if (curves?.k) nl.add('B', [m3, m4], `V=${fmt(1 / d.Cms)}*${curves.k(x)}*${x}`, `${note} Kms(x)`)
  else nl.add('C', [m3, m4], fmt(d.Cms), `${note} Cms`)
  nl.add('E', [m4, m5, front, rear], fmt(d.Sd), `${note} acoustic reaction`)
  nl.lines.push(`${vm} ${m5} 0 DC 0 ; ${note} cone velocity`)
  nl.add('F', [rear, front, vm], fmt(d.Sd), `${note} cone flow`)
  if (!primary) return
  ctx.map.drivers.push({ id: node.id, velocity: vm, Xmax: d.Xmax, x: xn, nonlinear: !!curves })
  for (const face of ['front', 'rear']) recordFlow(ctx, node.id, face, vm, d.Sd * flowScale, d.Sd * flowScale)
}

export function compilePR(ctx, node) {
  const { nl } = ctx
  const p = node.params
  const note = noteOf(node)
  const n = Math.max(1, Math.round(p.count || 1))
  const Sd = Math.max(p.Sd * 1e-4, 1e-8) * n
  const Mm = ((p.Mmd || 0) + (p.addedMass || 0)) * 1e-3 * n
  const Cm = Math.max(p.Cms * 1e-3, 1e-9) / n
  const Rm = Math.max(p.Rms || 0, 0) * n
  const front = ctx.nets.netOf(node.id, 'front')
  const rear = ctx.nets.netOf(node.id, 'rear')
  const m2 = Rm > 0 ? nl.node() : '0'
  const m3 = nl.node(); const m4 = nl.node(); const m5 = nl.node()
  const vm = `V_${m5}`
  nl.comment(`passive radiator ${note}`)
  if (Rm > 0) resistor(nl, '0', m2, Rm, `${note} Rms`)
  nl.add('L', [m2, m3], fmt(Math.max(Mm, 1e-9)), `${note} mass`)
  nl.add('C', [m3, m4], fmt(Cm), `${note} compliance`)
  nl.add('E', [m4, m5, front, rear], fmt(Sd), `${note} acoustic reaction`)
  nl.lines.push(`${vm} ${m5} 0 DC 0 ; ${note} velocity`)
  nl.add('F', [rear, front, vm], fmt(Sd), `${note} flow`)
  for (const face of ['front', 'rear']) recordFlow(ctx, node.id, face, vm, Sd, Sd)
  exposedFaces(ctx, node, Sd, false)
}

export function compileRadiation(ctx, node) {
  if (!ctx.nets.connected(node.id, 'in')) return
  const p = node.params
  const note = noteOf(node)
  let S = Number(p.areaOverride) > 0 ? p.areaOverride * 1e-4 : 0
  if (!S) for (const o of ctx.nets.neighbours(node.id, 'in')) S += faceArea(o.node, o.handle) || 0
  if (!S) S = 1e-2
  const s = sense(ctx.nl, ctx.nets.netOf(node.id, 'in'), `${note} radiates`)
  recordFlow(ctx, node.id, 'in', s.name, 1, S)
  const omega = radiationLoad(ctx.nl, s.out, S, p.space || 'half', `${note} radiation`)
  const driver = ctx.nets.neighbours(node.id, 'in').every((o) => o.node.type === 'driver')
  if (omega) ctx.map.radiators.push({ key: node.id, sense: s.name, node: s.out, omega, counts: true, driver })
}
