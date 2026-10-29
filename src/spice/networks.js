import { fitAtoms, fitFractional, logspace } from './fit.js'
import { RHO, C_AIR, SOLID_ANGLE, pistonImpedance } from './physics.js'
import { fmt, resistor } from './netlist.js'

export function seriesNetwork(nl, a, b, fit, zScale, omegaScale, note) {
  let at = a
  fit.forEach((atom, k) => {
    const next = k === fit.length - 1 ? b : nl.node()
    const R = atom.weight * zScale
    const w0 = atom.q0 * omegaScale
    resistor(nl, at, next, R, note)
    if (atom.kind === 'corner') {
      nl.add('L', [at, next], fmt(R / w0))
    } else {
      nl.add('L', [at, next], fmt(R / (atom.Q * w0)))
      nl.add('C', [at, next], fmt(atom.Q / (R * w0)))
    }
    at = next
  })
  if (!fit.length) throw new Error('empty fitted network')
}

export function shuntNetwork(nl, node, fit, yScale, omegaScale, note) {
  for (const atom of fit) {
    const G = atom.weight * yScale
    if (!(G > 0)) continue
    const mid = nl.node()
    resistor(nl, node, mid, 1 / G, note)
    nl.add('C', [mid, '0'], fmt(G / (atom.q0 * omegaScale)))
  }
}

export function fitBand(fmin, fmax) {
  return { f1: Math.max(0.5, fmin / 2), f2: Math.max(fmax * 2, fmin * 4) }
}

export function fractionalSeries(nl, a, b, alpha, coeff, band, note, perDecade = 1.5) {
  const w1 = 2 * Math.PI * band.f1
  const fit = fitFractional(alpha, band.f2 / band.f1, perDecade)
  seriesNetwork(nl, a, b, fit, coeff * Math.pow(w1, alpha), w1, note)
}

export function fractionalShunt(nl, node, alpha, coeff, band, note, perDecade = 1.5) {
  const w1 = 2 * Math.PI * band.f1
  const fit = fitFractional(alpha, band.f2 / band.f1, perDecade)
  shuntNetwork(nl, node, fit, coeff * Math.pow(w1, alpha), w1, note)
}

let radiationFit = null

export function halfSpaceRadiationFit() {
  if (radiationFit) return radiationFit
  const S = Math.PI
  const z0 = (RHO * C_AIR) / S
  const samples = logspace(0.003, 12, 240).map((q) => {
    const z = pistonImpedance(S, q * C_AIR)
    return { q, z: { re: z.re / z0, im: z.im / z0 }, w: q < 3 ? 1 : 0.3 }
  })
  const atoms = [
    ...logspace(0.01, 100, 20).map((q0) => ({ kind: 'corner', q0 })),
    ...logspace(0.4, 10, 20).flatMap((q0) => [0.5, 1, 2].map((Q) => ({ kind: 'resonance', q0, Q }))),
  ]
  radiationFit = fitAtoms(atoms, samples, true)
  return radiationFit
}

export function radiationScale(S, space) {
  const omega = SOLID_ANGLE[space] ?? SOLID_ANGLE.half
  const n = (2 * Math.PI) / omega
  const aEff = Math.sqrt((n * S) / Math.PI)
  return { zScale: (RHO * C_AIR) / S, omegaScale: C_AIR / aEff, omega }
}

export function radiationLoad(nl, node, S, space, note) {
  if (space === 'rigid') return null
  if (space === 'anechoic') {
    resistor(nl, node, '0', (RHO * C_AIR) / S, note)
    return SOLID_ANGLE.half
  }
  const { zScale, omegaScale, omega } = radiationScale(S, space)
  seriesNetwork(nl, node, '0', halfSpaceRadiationFit(), zScale, omegaScale, note)
  return omega
}
