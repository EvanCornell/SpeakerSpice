import { RHO, perimeter, viscousCoeff, thermalCoeff } from './physics.js'
import { fmt, resistor, sense } from './netlist.js'
import { fractionalSeries, fractionalShunt } from './networks.js'

const LC_PER = 25

function segment(ctx, a, b, Z0, td, note) {
  const { nl } = ctx
  if (!ctx.tran) {
    nl.add('T', [a, '0', b, '0'], `Z0=${fmt(Z0)} TD=${fmt(td)}`, note)
    return
  }
  const n = Math.max(1, Math.ceil(LC_PER * td * ctx.fmax))
  const L = (Z0 * td) / n
  const C = td / (Z0 * n)
  let at = a
  for (let k = 0; k < n; k++) {
    const mid = nl.node()
    nl.add('L', [at, mid], fmt(k === 0 ? L / 2 : L), k === 0 ? note : undefined)
    nl.add('C', [mid, '0'], fmt(C))
    at = mid
  }
  nl.add('L', [at, b], fmt(L / 2))
}

const MAX_SLICES = 48

export function compileLine(ctx, spec) {
  const { nl } = ctx
  const L = Math.max(spec.L, 1e-6)
  if (spec.lumped) {
    const n = nl.node()
    const S = spec.volume / L
    nl.add('C', [n, '0'], fmt(spec.volume / (RHO * spec.c * spec.c)), `${spec.note} (lumped)`)
    if (spec.thermal > 0) {
      fractionalShunt(nl, n, 0.5, spec.thermal * thermalCoeff(perimeter(S, spec.shape)) * L, ctx.band, `${spec.note} thermal`)
    }
    const at = () => n
    const flowAt = () => null
    return { start: n, end: n, at, flowAt }
  }

  const clamp = (x) => Math.min(Math.max(x, 0), L)
  const flowXs = new Set((spec.flowPoints || []).map(clamp).filter((x) => x > 0 && x < L))
  const xs = [...new Set([0, L, ...spec.points.map(clamp), ...flowXs])].sort((a, b) => a - b)
  const bp = new Map(xs.map((x) => [x, nl.node()]))
  const onward = new Map()
  const flowSense = new Map()
  for (const x of flowXs) {
    const s = sense(nl, bp.get(x), `${spec.note} flow at ${fmt(x * 100)} cm`)
    onward.set(x, s.out)
    flowSense.set(x, s.name)
  }
  const series = spec.viscous > 0 || spec.flowResistance > 0
  const lossy = series || spec.thermal > 0
  let dxMax = Infinity
  if (spec.stepped) dxMax = L / 24
  if (lossy) dxMax = Math.min(dxMax, spec.c / (4 * ctx.fmax))
  dxMax = Math.max(dxMax, L / MAX_SLICES)
  const shunt = new Map()
  const addShunt = (node, len, S) => {
    const cur = shunt.get(node) || [0, S]
    shunt.set(node, [cur[0] + len, S])
  }

  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    const n = Math.max(1, Math.ceil((x1 - x0) / dxMax - 1e-9))
    const dx = (x1 - x0) / n
    let at = onward.get(x0) || bp.get(x0)
    for (let k = 0; k < n; k++) {
      const next = k === n - 1 ? bp.get(x1) : nl.node()
      const S = spec.area(x0 + (k + 0.5) * dx)
      const Z0 = (RHO * spec.c) / S
      if (series) {
        const a = nl.node()
        const b = nl.node()
        segment(ctx, at, a, Z0, dx / 2 / spec.c, spec.note)
        if (spec.viscous > 0) {
          let into = a
          if (spec.flowResistance > 0) {
            into = nl.node()
            resistor(nl, a, into, (spec.flowResistance / S) * dx, `${spec.note} stuffing`)
          }
          fractionalSeries(nl, into, b, 0.5, spec.viscous * viscousCoeff(S, perimeter(S, spec.shape)) * dx, ctx.band, `${spec.note} viscous`)
        } else {
          resistor(nl, a, b, (spec.flowResistance / S) * dx, `${spec.note} stuffing`)
        }
        segment(ctx, b, next, Z0, dx / 2 / spec.c)
      } else {
        segment(ctx, at, next, Z0, dx / spec.c, spec.note)
      }
      if (spec.thermal > 0) {
        addShunt(at, dx / 2, S)
        addShunt(next, dx / 2, S)
      }
      at = next
    }
  }
  for (const [node, [len, S]] of shunt) {
    fractionalShunt(nl, node, 0.5, spec.thermal * thermalCoeff(perimeter(S, spec.shape)) * len, ctx.band, `${spec.note} thermal`)
  }
  return {
    start: bp.get(0),
    end: bp.get(L),
    at: (x) => bp.get(clamp(x)),
    flowAt: (x) => flowSense.get(clamp(x)) || null,
  }
}
