import { RHO } from './physics.js'

const P_REF = 20e-6

const spl = (p) => 20 * Math.log10(Math.max(p, 1e-12) / P_REF)

export function phaseAndDelay(phase, freqs) {
  const n = phase.length
  const unwrapped = new Array(n)
  unwrapped[0] = phase[0]
  for (let i = 1; i < n; i++) {
    let d = phase[i] - phase[i - 1]
    while (d > 180) d -= 360
    while (d < -180) d += 360
    unwrapped[i] = unwrapped[i - 1] + d
  }
  const groupDelay = new Array(n)
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(n - 1, i + 1)
    const df = freqs[i1] - freqs[i0]
    groupDelay[i] = df > 0 ? (-(unwrapped[i1] - unwrapped[i0]) / 360 / df) * 1000 : 0
  }
  return { unwrapped, groupDelay }
}

export function adaptResults(raw, map) {
  const freqs = raw.freqs
  const n = freqs.length
  const arr = () => new Array(n).fill(0)
  const res = {
    ok: true, freqs,
    splCombined: arr(), splDriver: new Array(n).fill(null), splPorts: {}, splInterior: {},
    zinMag: arr(), zinPhase: arr(), excursion: arr(), excursionByDriver: {}, excursionRatio: arr(),
    xmaxByDriver: {}, velocity: {}, power: arr(), peReal: arr(), peApparent: arr(),
    zinByChannel: {}, powerByChannel: {}, probeFlow: {},
    phase: arr(), phaseUnwrapped: null, groupDelay: null,
    nl: { active: false, iterations: 1 },
  }
  const ch = map.channels.map((c) => ({ ...c, I: raw.vec(`i(${c.sense})`), V: raw.vec(`v(${c.load})`) }))
  for (const c of ch) {
    res.zinByChannel[c.id] = { label: c.label, loaded: c.loaded !== false, mag: arr(), phase: arr() }
    res.powerByChannel[c.id] = { label: c.label, values: arr() }
  }
  const drv = map.drivers.map((d) => ({ ...d, u: raw.vec(`i(${d.velocity})`) }))
  for (const d of drv) { res.excursionByDriver[d.id] = arr(); res.xmaxByDriver[d.id] = d.Xmax * 1000 }
  const wgs = map.waveguides.map((w) => ({ id: w.id, ends: Object.values(w.ends).map((e) => ({ S: e.S, U: raw.vec(`i(${e.sense})`) })) }))
  for (const w of wgs) res.velocity[w.id] = arr()
  const rads = map.radiators.map((r) => ({ ...r, U: raw.vec(`i(${r.sense})`), P: raw.vec(`v(${r.node})`) }))
  for (const r of rads) if (r.counts && !r.driver) res.splPorts[r.key] = new Array(n).fill(null)
  const probes = map.probes.map((p) => ({ ...p, P: raw.vec(`v(${p.node})`) }))
  for (const p of probes) res.splInterior[p.key] = arr()
  const flows = (map.flowProbes || []).map((p) => ({ ...p, U: p.sense ? raw.vec(`i(${p.sense})`) : null }))
  for (const p of flows) res.probeFlow[p.key] = { kind: p.kind, values: arr() }
  let anyDriverFace = false
  const shown = Math.max(0, ch.findIndex((c) => c.loaded !== false))

  for (let i = 0; i < n; i++) {
    const w = 2 * Math.PI * freqs[i]
    ch.forEach((c, k) => {
      const Vr = c.V.re[i], Vi = c.V.im[i], Ir = c.I.re[i], Ii = c.I.im[i]
      res.peReal[i] += Vr * Ir + Vi * Ii
      res.powerByChannel[c.id].values[i] = Vr * Ir + Vi * Ii
      res.peApparent[i] += Math.hypot(Vr, Vi) * Math.hypot(Ir, Ii)
      const d = Ir * Ir + Ii * Ii
      const zr = (Vr * Ir + Vi * Ii) / d
      const zi = (Vi * Ir - Vr * Ii) / d
      const z = res.zinByChannel[c.id]
      z.mag[i] = Math.hypot(zr, zi)
      z.phase[i] = (Math.atan2(zi, zr) * 180) / Math.PI
      if (k === shown) {
        res.zinMag[i] = z.mag[i]
        res.zinPhase[i] = z.phase[i]
      }
    })
    for (const d of drv) {
      const xPk = (Math.hypot(d.u.re[i], d.u.im[i]) * Math.SQRT2) / w
      res.excursionByDriver[d.id][i] = xPk * 1000
      if (xPk * 1000 > res.excursion[i]) res.excursion[i] = xPk * 1000
      if (d.Xmax > 0) res.excursionRatio[i] = Math.max(res.excursionRatio[i], xPk / d.Xmax)
    }
    for (const g of wgs) {
      let v = 0
      for (const e of g.ends) v = Math.max(v, Math.hypot(e.U.re[i], e.U.im[i]) / e.S)
      res.velocity[g.id][i] = v * Math.SQRT2
    }
    let pr = 0, pi = 0, dr = 0, di = 0
    let power = 0
    for (const r of rads) {
      if (!r.counts) continue
      const k = (w * RHO) / r.omega
      const re = -k * r.U.im[i]
      const im = k * r.U.re[i]
      pr += re; pi += im
      if (r.driver) { dr += re; di += im; anyDriverFace = true } else res.splPorts[r.key][i] = spl(Math.hypot(re, im))
      power += r.P.re[i] * r.U.re[i] + r.P.im[i] * r.U.im[i]
    }
    res.splCombined[i] = spl(Math.hypot(pr, pi))
    res.splDriver[i] = anyDriverFace && Math.hypot(dr, di) > 1e-12 ? spl(Math.hypot(dr, di)) : null
    res.power[i] = power
    res.phase[i] = (Math.atan2(pi, pr) * 180) / Math.PI
    for (const p of probes) res.splInterior[p.key][i] = spl(Math.hypot(p.P.re[i], p.P.im[i]))
    for (const p of flows) {
      if (!p.U) continue
      const U = Math.hypot(p.U.re[i], p.U.im[i]) * p.scale * Math.SQRT2
      res.probeFlow[p.key].values[i] = p.kind === 'velocity' ? U / p.S : U
    }
  }
  const { unwrapped, groupDelay } = phaseAndDelay(res.phase, freqs)
  res.phaseUnwrapped = unwrapped
  res.groupDelay = groupDelay
  return res
}
