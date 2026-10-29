import { compileProject } from './compile.js'
import { runNetlist, runTransient, threadCount } from './run.js'
import { RHO } from './physics.js'
import { adaptResults } from './adapt.js'
import { normalizeSignal, signalLength, irfft, rfft, harmonics, thd, nextPow2, signalFunction } from './dsp.js'

const P_REF = 20e-6

export const splOf = (p) => 20 * Math.log10(Math.max(p, 1e-12) / P_REF)

function sweepOf(project) {
  return (project.analyses || []).find((a) => a.type === 'ac') || { fmin: 10, fmax: 1000, npts: 512 }
}

export function complexOutputs(raw, map) {
  const n = raw.freqs.length
  const z = () => ({ re: new Float64Array(n), im: new Float64Array(n) })
  const pressure = z()
  const driverPressure = z()
  for (const r of map.radiators) {
    if (!r.counts || !r.omega) continue
    const U = raw.vec(`i(${r.sense})`)
    for (let i = 0; i < n; i++) {
      const k = (2 * Math.PI * raw.freqs[i] * RHO) / r.omega
      const re = -k * U.im[i]
      const im = k * U.re[i]
      pressure.re[i] += re; pressure.im[i] += im
      if (r.driver) { driverPressure.re[i] += re; driverPressure.im[i] += im }
    }
  }
  const excursion = {}
  for (const d of map.drivers) {
    const u = raw.vec(`i(${d.velocity})`)
    const x = z()
    for (let i = 0; i < n; i++) {
      const w = 2 * Math.PI * raw.freqs[i]
      x.re[i] = u.im[i] / w
      x.im[i] = -u.re[i] / w
    }
    excursion[d.id] = x
  }
  const c = map.channels[0]
  const current = c ? raw.vec(`i(${c.sense})`) : null
  return { freqs: raw.freqs, pressure, driverPressure, excursion, current }
}

export const LINEAR_DEFAULTS = { bandwidth: 2000, resolution: 0.5, burstHz: 40, burstCycles: 6.5, csdSlices: 8, csdStepMs: 5 }

export async function linearResponses(project, opts = {}, onProgress = () => {}) {
  const o = { ...LINEAR_DEFAULTS, ...opts }
  const df = o.resolution
  const bins = Math.max(8, nextPow2(Math.ceil(o.bandwidth / df)))
  const fmax = bins * df
  onProgress(0.05, 'Solving the fine frequency sweep')
  const sweep = sweepOf(project)
  const { netlist, map } = compileProject(project, { ...sweep, type: 'ac', scale: 'lin', fmin: df, fmax, npts: bins })
  const raw = await runNetlist(netlist)
  onProgress(0.7, 'Transforming to time')
  const out = complexOutputs(raw, map)
  const n = bins * 2
  const fs = 2 * fmax
  const dt = 1 / fs
  const taper = (k) => {
    const f0 = 0.9 * bins
    return k <= f0 ? 1 : 0.5 * (1 + Math.cos((Math.PI * (k - f0)) / (bins - f0)))
  }
  const spectrum = (H, dcFromLowest) => {
    const re = new Float64Array(bins + 1)
    const im = new Float64Array(bins + 1)
    re[0] = dcFromLowest ? H.re[0] : 0
    for (let k = 1; k <= bins; k++) {
      const w = taper(k)
      re[k] = H.re[k - 1] * w
      im[k] = H.im[k - 1] * w
    }
    return { re, im }
  }
  const impulse = (S) => irfft(S.re, S.im).map((v) => (v * fs) / v0)
  const stepOf = (h) => { let s = 0; return h.map((v) => (s += v * dt)) }
  const burstOf = (S, B) => {
    const re = new Float64Array(bins + 1)
    const im = new Float64Array(bins + 1)
    for (let k = 0; k <= bins; k++) {
      re[k] = S.re[k] * B.re[k] - S.im[k] * B.im[k]
      im[k] = S.re[k] * B.im[k] + S.im[k] * B.re[k]
    }
    return irfft(re, im).map((v) => v * Math.SQRT2)
  }
  const v0 = Math.abs(map.channels[0]?.volts) || 1
  const Sp = spectrum(out.pressure, false)
  const Sd = spectrum(out.driverPressure, false)
  const Sx = Object.fromEntries(Object.entries(out.excursion).map(([id, x]) => [id, spectrum(x, true)]))
  const hp = impulse(Sp)
  const hd = impulse(Sd)
  const hx = Object.fromEntries(Object.entries(Sx).map(([id, S]) => [id, impulse(S)]))
  const burstSig = normalizeSignal({ type: 'burst', hz: o.burstHz, cycles: o.burstCycles })
  const bf = signalFunction(burstSig, fs)
  const bs = new Float64Array(n)
  for (let i = 0; i < n; i++) bs[i] = bf(i * dt)
  const B = rfft(bs, n)
  const mm = (a) => a.map((v) => v * 1000)
  const t = Array.from({ length: n }, (_, i) => i * dt)
  onProgress(0.85, 'Cumulative spectral decay')
  const slices = []
  const win = Math.min(n, Math.round(0.3 * fs))
  for (let s = 0; s < o.csdSlices; s++) {
    const start = Math.round((s * o.csdStepMs * fs) / 1000)
    const seg = new Float64Array(nextPow2(win))
    for (let i = 0; i < win && start + i < n; i++) {
      const w = i < win / 2 ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - win / 2)) / (win / 2)))
      seg[i] = hp[start + i] * w * dt
    }
    const S = rfft(seg)
    const db = Array.from(S.re, (re, k) => splOf(Math.hypot(re, S.im[k])))
    slices.push({ ms: s * o.csdStepMs, db, df: fs / seg.length })
  }
  onProgress(1, 'Done')
  return {
    fs, t,
    impulse: { pressure: hp, driverPressure: hd, excursion: Object.fromEntries(Object.entries(hx).map(([id, h]) => [id, mm(h)])) },
    step: { pressure: stepOf(hp), driverPressure: stepOf(hd), excursion: Object.fromEntries(Object.entries(hx).map(([id, h]) => [id, mm(stepOf(h))])) },
    burst: {
      hz: o.burstHz, cycles: o.burstCycles,
      signal: bs,
      pressure: burstOf(Sp, B), driverPressure: burstOf(Sd, B),
      excursion: Object.fromEntries(Object.entries(Sx).map(([id, S]) => [id, mm(burstOf(S, B))])),
    },
    csd: { slices },
    spectrum: { freqs: out.freqs, pressure: out.pressure },
  }
}

export const TRANSIENT_DEFAULTS = {
  signal: { type: 'burst', hz: 40, cycles: 6.5 }, levelDb: 0, fs: 8000, duration: 0.5, bandwidth: 1000, nonlinear: true,
}

function modelFor(project, bandwidth) {
  return { ...sweepOf(project), fmin: 5, fmax: bandwidth }
}

export const SOLVER_SETTINGS = [
  { solver: 'klu', robust: false },
  { solver: 'sparse', robust: false },
  { solver: 'sparse', robust: true },
  { solver: 'klu', robust: true },
]

export async function transientRun(project, run) {
  const signal = normalizeSignal(run.signal)
  const tran = { signal, levelDb: run.levelDb || 0, fs: run.fs, tstop: run.tstop, nonlinear: !!run.nonlinear }
  const { map } = compileProject(project, modelFor(project, run.bandwidth || 1000), { tran })
  let out = null
  let first = null
  for (const settings of SOLVER_SETTINGS) {
    const { netlist } = compileProject(project, modelFor(project, run.bandwidth || 1000), { tran: { ...tran, ...settings } })
    try {
      out = { raw: await runTransient(netlist), map }
      break
    } catch (err) {
      if (err.name === 'Cancelled') throw err
      first = first || err
    }
  }
  if (!out) throw first
  const { raw } = out
  const n = raw.time.length
  const zeros = () => new Float64Array(n)
  const res = {
    t: raw.time,
    pressure: map.pressure ? raw.vec(`v(${map.pressure})`) : zeros(),
    driverPressure: map.driverPressure ? raw.vec(`v(${map.driverPressure})`) : zeros(),
    excursion: {}, current: {}, voltage: {}, velocity: {}, probes: {},
    nonlinearDrivers: map.drivers.filter((d) => d.nonlinear).map((d) => d.id),
  }
  for (const d of map.drivers) res.excursion[d.id] = raw.vec(`v(${d.x})`).map((v) => v * 1000)
  for (const c of map.channels) {
    res.current[c.id] = raw.vec(`i(${c.sense})`)
    res.voltage[c.id] = raw.vec(`v(${c.load})`)
  }
  for (const w of map.waveguides) {
    let best = null
    let bestE = -1
    for (const e of Object.values(w.ends)) {
      const U = raw.vec(`i(${e.sense})`)
      let s = 0
      for (const v of U) s += v * v
      if (s > bestE) { bestE = s; best = U.map((v) => v / e.S) }
    }
    if (best) res.velocity[w.id] = best
  }
  res.acousticPower = zeros()
  for (const r of map.radiators) {
    if (!r.counts) continue
    const U = raw.vec(`i(${r.sense})`)
    const P = raw.vec(`v(${r.node})`)
    for (let i = 0; i < n; i++) res.acousticPower[i] += P[i] * U[i]
  }
  for (const p of map.probes) res.probes[p.key] = { kind: 'pressure', values: raw.vec(`v(${p.node})`) }
  for (const p of map.flowProbes) {
    if (!p.sense) { res.probes[p.key] = { kind: p.kind, values: zeros() }; continue }
    const U = raw.vec(`i(${p.sense})`)
    res.probes[p.key] = { kind: p.kind, values: U.map((v) => (v * p.scale) / (p.kind === 'velocity' ? p.S : 1)) }
  }
  return res
}

export function levels(x) {
  let peak = 0
  let e = 0
  for (const v of x) { const a = Math.abs(v); if (a > peak) peak = a; e += v * v }
  return { peak, rms: Math.sqrt(e / Math.max(x.length, 1)) }
}

export async function transientAnalysis(project, opts = {}, onProgress = () => {}) {
  const o = { ...TRANSIENT_DEFAULTS, ...opts }
  const signal = normalizeSignal(o.signal)
  const tstop = Math.max(o.duration, 1 / o.fs * 16)
  const base = { signal, levelDb: o.levelDb, fs: o.fs, tstop, bandwidth: o.bandwidth }
  const compare = o.compareLinear && o.nonlinear && (hasExitLoss(project) || hasCurves(project, o.bandwidth))
  onProgress(0.05, compare ? 'Nonlinear run, and a linear one for comparison' : o.nonlinear ? 'Nonlinear run' : 'Linear run')
  const [run, linear] = await Promise.all([
    transientRun(project, { ...base, nonlinear: o.nonlinear }),
    compare ? transientRun(project, { ...base, nonlinear: false }) : null,
  ])
  onProgress(1, 'Done')
  return { run, linear, signal, fs: o.fs }
}

function hasExitLoss(project) {
  return (project.nodes || []).some((n) => n.type === 'waveguide' && (Number(n.params.throatK) > 0 || Number(n.params.mouthK) > 0))
}

function hasCurves(project, bandwidth) {
  const signal = normalizeSignal({ type: 'sine', hz: 50 })
  const { map } = compileProject(project, modelFor(project, bandwidth || 1000), { tran: { signal, levelDb: 0, fs: 1000, tstop: 0.01, nonlinear: true } })
  return map.drivers.some((d) => d.nonlinear)
}

export const CEA2010_LIMITS = { 2: -10, 3: -15, 4: -20, 5: -20, 6: -30, 7: -30, 8: -40, 9: -40, 10: -40 }

export const DISTORTION_DEFAULTS = {
  hz: 40, levelDb: 0, harmonics: 10, bandwidth: 1000,
  f1: 15, f2: 200, points: 12,
  levels: [-12, -6, 0, 6, 12],
  bands: [20, 25, 31.5, 40, 50, 63], xLimit: 1.5, maxBoostDb: 30,
}

export async function measureTone(project, hz, levelDb, o) {
  const perPeriod = Math.max(40, Math.ceil((4 * o.bandwidth) / hz), 2 * (o.harmonics + 2))
  const fs = hz * perPeriod
  const periods = Math.max(4, Math.ceil(0.1 * hz))
  const settle = Math.max(0.3, 10 / hz)
  const tstop = Math.ceil(settle * hz) / hz + periods / hz
  const run = await transientRun(project, {
    signal: { type: 'sine', hz }, levelDb, fs, tstop, bandwidth: o.bandwidth, nonlinear: o.nonlinear !== false,
  })
  const h = harmonics(run.pressure, fs, hz, o.harmonics, periods)
  const f = h[0].amp
  const tail = Math.round((periods * fs) / hz)
  const peakOf = (x) => levels(Array.prototype.slice.call(x, x.length - tail)).peak
  const meanOf = (a, b) => {
    let s = 0
    for (let i = a.length - tail; i < a.length; i++) s += a[i] * (b ? b[i] : 1)
    return s / tail
  }
  const firstCh = Object.keys(run.current)[0]
  const z = {}
  let pe = 0
  for (const ch of Object.keys(run.current)) {
    const [v] = harmonics(run.voltage[ch], fs, hz, 1, periods)
    const [i] = harmonics(run.current[ch], fs, hz, 1, periods)
    let ph = ((v.phase - i.phase) * 180) / Math.PI
    while (ph > 180) ph -= 360
    while (ph <= -180) ph += 360
    z[ch] = { mag: v.amp / Math.max(i.amp, 1e-15), phase: ph }
    pe += meanOf(run.voltage[ch], run.current[ch])
  }
  const pa = meanOf(run.acousticPower)
  return {
    hz, levelDb,
    harmonics: h.map((x) => ({ ...x, db: 20 * Math.log10(Math.max(x.amp, 1e-15) / Math.max(f, 1e-15)) })),
    thd: thd(h),
    spl: splOf(f / Math.SQRT2),
    xPeak: Object.fromEntries(Object.entries(run.excursion).map(([id, x]) => [id, peakOf(x)])),
    vPeak: Object.fromEntries(Object.entries(run.velocity).map(([id, v]) => [id, peakOf(v)])),
    z,
    pe,
    pa,
    efficiency: pe > 0 ? pa / pe : null,
    currentPeak: firstCh ? peakOf(run.current[firstCh]) : 0,
    voltagePeak: firstCh ? peakOf(run.voltage[firstCh]) : 0,
    waveform: { fs, t: Array.prototype.slice.call(run.t, run.t.length - tail), pressure: Array.prototype.slice.call(run.pressure, run.pressure.length - tail) },
    ...(o.startup ? { start: startupOf(run, fs, hz) } : {}),
  }
}

export const STARTUP_SAMPLES = 400

export function startupOf(run, fs, hz) {
  const n = Math.min(run.t.length, Math.round(Math.max(0.25, 6 / hz) * fs))
  const step = Math.max(1, Math.ceil(n / STARTUP_SAMPLES))
  const pick = (x) => {
    const out = []
    for (let i = 0; i < n; i += step) out.push(x[i])
    return out
  }
  const each = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pick(v)]))
  return { dt: step / fs, pressure: pick(run.pressure), excursion: each(run.excursion), velocity: each(run.velocity) }
}

export async function linearLevel(project, hz, levelDb) {
  return (await linearPoint(project, hz, levelDb)).spl
}

export async function linearPoint(project, hz, levelDb) {
  const { netlist, map } = compileProject(project, { ...sweepOf(project), type: 'ac', scale: 'lin', fmin: hz, fmax: hz, npts: 1 })
  const raw = await runNetlist(netlist)
  const out = complexOutputs(raw, map)
  const r = adaptResults(raw, map)
  const pe = r.peReal[0]
  const pa = r.power[0]
  return scaleLinear({
    spl: splOf(Math.hypot(out.pressure.re[0], out.pressure.im[0])),
    xPeak: Object.fromEntries(Object.entries(r.excursionByDriver).map(([id, x]) => [id, x[0]])),
    vPeak: Object.fromEntries(Object.entries(r.velocity).map(([id, v]) => [id, v[0]])),
    z: Object.fromEntries(Object.entries(r.zinByChannel).map(([id, c]) => [id, { mag: c.mag[0], phase: c.phase[0] }])),
    pe, pa,
    efficiency: pe > 0 ? pa / pe : null,
  }, levelDb)
}

export function ratioDb(a, b) {
  return a > 0 && b > 0 ? 10 * Math.log10(a / b) : null
}

export function scaleLinear(lin, levelDb) {
  const g = Math.pow(10, levelDb / 20)
  const each = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v * g]))
  return {
    ...lin,
    spl: lin.spl + levelDb,
    xPeak: each(lin.xPeak),
    vPeak: each(lin.vPeak),
    pe: lin.pe * g * g,
    pa: lin.pa * g * g,
  }
}

export function logFreqs(f1, f2, n) {
  if (n <= 1) return [f1]
  return Array.from({ length: n }, (_, i) => Math.round(f1 * Math.pow(f2 / f1, i / (n - 1)) * 10) / 10)
}

export function brokenLimit(m, xLimitMm) {
  for (const h of m.harmonics.slice(1)) {
    const lim = CEA2010_LIMITS[h.n]
    if (lim != null && h.db > lim) return `H${h.n}`
  }
  for (const [id, x] of Object.entries(m.xPeak)) {
    const lim = typeof xLimitMm === 'number' ? xLimitMm : xLimitMm?.[id]
    if (lim > 0 && x > lim) return 'excursion'
  }
  return null
}

export async function measureBurst(project, hz, levelDb, o) {
  const sig = normalizeSignal({ type: 'burst', hz, cycles: 6.5 })
  const fs = Math.max(4 * o.bandwidth, 40 * hz * 2)
  const tstop = signalLength(sig) + 4 / hz
  const run = await transientRun(project, { signal: sig, levelDb, fs, tstop, bandwidth: o.bandwidth, nonlinear: o.nonlinear !== false })
  const p = run.pressure
  const N = p.length
  const mag = (f) => {
    let c = 0
    let s = 0
    const w = (2 * Math.PI * f) / fs
    for (let i = 0; i < N; i++) { c += p[i] * Math.cos(w * i); s += p[i] * Math.sin(w * i) }
    return Math.hypot(c, s)
  }
  const f1 = mag(hz)
  const hs = []
  for (let n = 1; n <= 10; n++) {
    const a = n === 1 ? f1 : mag(n * hz)
    hs.push({ n, hz: n * hz, db: 20 * Math.log10(Math.max(a, 1e-15) / Math.max(f1, 1e-15)) })
  }
  return {
    hz, levelDb,
    spl: splOf(levels(p).peak / Math.SQRT2),
    harmonics: hs,
    xPeak: Object.fromEntries(Object.entries(run.excursion).map(([id, x]) => [id, levels(x).peak])),
  }
}

export async function maxLevel(s) {
  const tried = []
  const bracket = () => {
    let hi = null
    for (const r of tried) if (r.broke && (!hi || r.L < hi.L)) hi = r
    let lo = null
    for (const r of tried) if (!r.broke && (!hi || r.L < hi.L) && (!lo || r.L > lo.L)) lo = r
    return { lo, hi }
  }
  const TOL = 0.25
  for (let round = 0; round < 40; round++) {
    const { lo, hi } = bracket()
    if (lo && hi && hi.L - lo.L <= TOL) break
    const k = Math.max(1, Math.floor(s.width()))
    let levels
    if (lo && hi) {
      levels = Array.from({ length: k }, (_, j) => lo.L + ((hi.L - lo.L) * (j + 1)) / (k + 1))
    } else if (lo) {
      levels = Array.from({ length: k }, (_, j) => lo.L + 3 * (j + 1)).filter((L) => L <= s.top + 1e-9)
    } else if (hi) {
      levels = Array.from({ length: k }, (_, j) => hi.L - 3 * (j + 1)).filter((L) => L >= s.bottom - 1e-9)
    } else {
      const steps = [0]
      let up = 0
      let down = 0
      while (steps.length < k) steps.push(steps.length % 3 === 0 ? -3 * ++down : 3 * ++up)
      levels = steps.map((d) => s.start + d).filter((L) => L <= s.top + 1e-9 && L >= s.bottom - 1e-9)
    }
    if (!levels.length) break
    const results = await Promise.all(levels.map(async (L) => ({ L, ...(await s.test(L)) })))
    tried.push(...results)
    if (s.onRound) {
      const b = bracket()
      s.onRound(b.lo && b.hi ? 0.5 + 0.5 * Math.min(1, Math.log(3 / Math.max(b.hi.L - b.lo.L, TOL)) / Math.log(3 / TOL)) : 0.25)
    }
  }
  return { ...bracket(), tried: tried.length }
}

export const LEVEL_DEFAULTS = { f1: 15, f2: 200, points: 24, harmonics: 10, bandwidth: 1000, thdLimit: 0.1, maxBoostDb: 40, resolutionDb: 0.25 }

export async function thdLimitAt(project, hz, first, o) {
  let tones = 0
  const test = async (L) => {
    tones++
    try {
      const m = await measureTone(project, hz, L, o)
      return { L, m, over: !(m.thd < o.thdLimit) }
    } catch (err) {
      if (err.name === 'Cancelled') throw err
      return { L, m: null, over: true }
    }
  }
  const top = first.L + o.maxBoostDb
  const bottom = first.L - 48
  let at = { L: first.L, m: first.m, over: !first.m || !(first.m.thd < o.thdLimit) }
  let lo = at.over ? null : at
  let hi = at.over ? at : null
  while (!hi && at.L < top) { at = await test(Math.min(at.L + 6, top)); if (at.over) hi = at; else lo = at }
  while (!lo && at.L > bottom) { at = await test(Math.max(at.L - 6, bottom)); if (at.over) hi = at; else lo = at }
  if (!lo) return { hz, levelDb: null, spl: null, thd: null, tones }
  if (!hi) return { hz, levelDb: lo.L, spl: lo.m.spl, thd: lo.m.thd, tones, unreached: true }
  while (hi.L - lo.L > o.resolutionDb) {
    const mid = await test((lo.L + hi.L) / 2)
    if (mid.over) hi = mid
    else lo = mid
  }
  return { hz, levelDb: lo.L, spl: lo.m.spl, thd: lo.m.thd, tones }
}

export async function levelRun(project, opts = {}, onProgress = () => {}) {
  const o = { ...LEVEL_DEFAULTS, ...opts, nonlinear: true }
  const L = Number(o.levelDb) || 0
  const freqs = logFreqs(o.f1, o.f2, o.points)
  const failed = []
  const searching = o.searchMaxSpl === true && !Array.isArray(o.maxSpl)
  let done = 0
  let searched = 0
  const report = () => onProgress(
    searching ? (done + searched * 3) / (freqs.length * 4) : done / freqs.length,
    done < freqs.length ? `${done} of ${freqs.length} tones` : `10% THD search: ${searched} of ${freqs.length} frequencies`,
  )
  report()
  const tones = await Promise.all(freqs.map(async (hz) => {
    const [m, lin] = await Promise.all([
      measureTone(project, hz, L, { ...o, startup: true }).catch((err) => { if (err.name === 'Cancelled') throw err; failed.push({ label: `${hz} Hz`, error: err.message }); return null }),
      linearPoint(project, hz, L).catch((err) => { if (err.name === 'Cancelled') throw err; return null }),
    ])
    done++
    report()
    return { hz, m, lin }
  }))
  if (tones.every((x) => !x.m)) throw new Error(`No frequency could be solved. ${failed[0]?.label}: ${failed[0]?.error}`)
  const rows = tones.map(({ hz, m, lin }) => (m ? {
    hz,
    spl: m.spl,
    linSpl: lin ? lin.spl : null,
    cmp: lin ? m.spl - lin.spl : null,
    thd: m.thd,
    h: m.harmonics.slice(1).map((x) => x.db),
    xPeak: m.xPeak,
    vPeak: m.vPeak,
    z: m.z,
    pe: m.pe,
    pa: m.pa,
    efficiency: m.efficiency,
    effLoss: ratioDb(m.efficiency, lin?.efficiency),
    powerChange: ratioDb(m.pe, lin?.pe),
    currentPeak: m.currentPeak,
    voltagePeak: m.voltagePeak,
    linear: lin ? { spl: lin.spl, xPeak: lin.xPeak, vPeak: lin.vPeak } : null,
  } : { hz, failed: true }))
  const start = tones.map(({ hz, m }) => (m ? { hz, ...m.start } : { hz, failed: true }))
  const maxSpl = searching
    ? await Promise.all(tones.map(async ({ hz, m }) => {
      const r = await thdLimitAt(project, hz, { L, m }, o)
      searched++
      report()
      return r
    }))
    : (Array.isArray(o.maxSpl) ? o.maxSpl : undefined)
  onProgress(1, 'Done')
  return { levelDb: L, freqs, rows, start, maxSpl, failed, thdLimit: o.thdLimit }
}

export async function distortionAnalysis(project, mode, opts = {}, onProgress = () => {}) {
  const o = { ...DISTORTION_DEFAULTS, ...opts }
  if (mode === 'harmonics') {
    onProgress(0.1, `Tone at ${o.hz} Hz`)
    const m = await measureTone(project, o.hz, o.levelDb, o)
    onProgress(1, 'Done')
    return { mode, ...m }
  }
  const freqs = logFreqs(o.f1, o.f2, o.points)
  const failed = []
  const fail = (label, err) => {
    if (err.name === 'Cancelled') throw err
    failed.push({ label, error: err.message })
    return null
  }
  const allFailed = (total) => {
    if (failed.length && failed.length >= total) throw new Error(`No point could be solved. ${failed[0].label}: ${failed[0].error}`)
  }
  const dB = (L) => `${L >= 0 ? '+' : ''}${L} dB`
  if (mode === 'thd') {
    let done = 0
    onProgress(0, `${freqs.length} tones`)
    const rows = await Promise.all(freqs.map(async (f) => {
      const m = await measureTone(project, f, o.levelDb, o).catch((err) => fail(`${f} Hz`, err))
      done++
      onProgress(done / freqs.length, `${done} of ${freqs.length} tones done`)
      if (!m) return { hz: f, thd: null, h2: null, h3: null, spl: null, xPeak: null }
      return { hz: f, thd: m.thd, h2: m.harmonics[1]?.db, h3: m.harmonics[2]?.db, spl: m.spl, xPeak: m.xPeak }
    }))
    allFailed(freqs.length)
    onProgress(1, 'Done')
    return { mode, levelDb: o.levelDb, rows, failed }
  }
  if (mode === 'compression') {
    const total = freqs.length * o.levels.length
    let done = 0
    onProgress(0, `${total} tones`)
    const [lins, tones] = await Promise.all([
      Promise.all(freqs.map((hz) => linearPoint(project, hz, 0).catch((err) => fail(`${hz} Hz, linear level`, err)))),
      Promise.all(o.levels.flatMap((L) => freqs.map(async (hz) => {
        const m = await measureTone(project, hz, L, o).catch((err) => fail(`${hz} Hz at ${dB(L)}`, err))
        done++
        onProgress(done / total, `${done} of ${total} tones done`)
        return { hz, L, m }
      }))),
    ])
    allFailed(total)
    const rows = freqs.map((hz, i) => {
      const row = { hz, at: {}, linear: {} }
      for (const { L, m } of tones.filter((x) => x.hz === hz)) {
        const lin = lins[i] ? scaleLinear(lins[i], L) : null
        row[`spl${L}`] = m ? m.spl : null
        row[`cmp${L}`] = m && lin ? m.spl - lin.spl : null
        row.at[L] = m ? {
          effLoss: ratioDb(m.efficiency, lin?.efficiency),
          powerChange: ratioDb(m.pe, lin?.pe),
          spl: m.spl, cmp: row[`cmp${L}`], thd: m.thd, xPeak: m.xPeak, vPeak: m.vPeak, z: m.z, pe: m.pe, pa: m.pa, efficiency: m.efficiency } : null
        row.linear[L] = lin
      }
      return row
    })
    onProgress(1, 'Done')
    return { mode, levels: o.levels, rows, failed }
  }
  if (mode === 'maxspl') {
    const xmax = Object.fromEntries((project.nodes || []).filter((n) => n.type === 'driver').map((n) => [n.id, (Number(n.params.Xmax) || 0) * o.xLimit]))
    const bands = o.bands
    let active = bands.length
    const partial = new Array(bands.length).fill(0)
    const report = (message) => onProgress(partial.reduce((a, b) => a + b, 0) / bands.length, message)
    const rows = await Promise.all(bands.map(async (f, bi) => {
      const found = await maxLevel({
        start: o.levelDb,
        top: o.levelDb + o.maxBoostDb,
        bottom: o.levelDb - 48,
        test: async (L) => {
          try {
            const m = await measureBurst(project, f, L, o)
            return { m, broke: brokenLimit(m, xmax) }
          } catch (err) {
            fail(`${f} Hz at ${dB(Math.round(L * 100) / 100)}`, err)
            return { m: null, broke: 'no solution' }
          }
        },
        width: () => Math.max(1, Math.ceil(threadCount() / Math.max(active, 1))),
        onRound: (fraction) => {
          partial[bi] = Math.min(0.95, fraction)
          report(`${bands.length - active} of ${bands.length} bands done`)
        },
      })
      active--
      partial[bi] = 1
      report(`${bands.length - active} of ${bands.length} bands done`)
      const lo = found.lo
      return {
        hz: f,
        spl: lo ? lo.m.spl : null,
        levelDb: lo ? lo.L : null,
        limit: found.hi ? found.hi.broke : 'none within range',
        xPeak: lo ? lo.m.xPeak : null,
      }
    }))
    if (rows.every((r) => r.levelDb == null && r.limit === 'no solution')) allFailed(failed.length)
    onProgress(1, 'Done')
    return { mode, rows, failed }
  }
  throw new Error(`unknown distortion analysis "${mode}"`)
}
