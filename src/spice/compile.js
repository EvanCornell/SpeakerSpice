import { createNetlist, fmt, resistor } from './netlist.js'
import { RHO } from './physics.js'
import { PROBE_KINDS } from '../schema/version.js'
import { buildNets } from './nets.js'
import { fitBand } from './networks.js'
import { compileWiring } from './wiring.js'
import { compileDriver, compileChamber, compileWaveguide, compilePR, compileRadiation } from './elements.js'

const JUNCTION_LEAK = 1e12

export function pointsPerDecade(fmin, fmax, npts) {
  const decades = Math.log10(fmax / fmin)
  return Math.max(1, Math.round((npts - 1) / Math.max(decades, 1e-6)))
}

const TOP_HAIR = 1e-6

export function decadeStep(fstart, ppd, i, top = false) {
  return Number((fstart * Math.pow(10, (i + (top ? TOP_HAIR : 0)) / ppd)).toPrecision(15)).toString()
}

function transientOutputs(ctx) {
  const { nl, map } = ctx
  for (const [key, pick] of [['pressure', () => true], ['driverPressure', (r) => r.driver]]) {
    const rads = map.radiators.filter((r) => r.counts && r.omega && pick(r))
    if (!rads.length) continue
    const node = nl.node()
    nl.add('L', [node, '0'], fmt(RHO), `far-field ${key} at 1 m`)
    for (const r of rads) nl.add('F', ['0', node, r.sense], fmt(1 / r.omega))
    map[key] = node
  }
}

export function compileProject(proj, analysis, opts = {}) {
  const nl = createNetlist(`SpeakerSpice: ${proj.name || 'project'}`)
  const nets = buildNets(proj, nl)
  const tran = opts.tran || null
  const ctx = {
    nl,
    nets,
    tran,
    nonlinear: !!tran?.nonlinear,
    band: fitBand(tran ? Math.min(analysis.fmin, 5) : analysis.fmin, analysis.fmax),
    fmax: analysis.fmax,
    masking: !!analysis.masking,
    probes: [],
    endFlowProbes: [],
    map: { channels: [], drivers: [], waveguides: [], radiators: [], probes: [], flowProbes: [], handleFlows: {} },
  }
  const handleProbes = []
  for (const p of proj.probes || []) {
    if (!PROBE_KINDS.includes(p.kind)) throw new Error(`Probe ${p.label || p.id}: unknown kind "${p.kind}"`)
    if (p.at?.position != null) ctx.probes.push(p)
    else if (p.at?.handle && nets.netOf(p.at.node, p.at.handle)) {
      if (p.kind === 'pressure') ctx.map.probes.push({ key: p.id, node: nets.netOf(p.at.node, p.at.handle) })
      else handleProbes.push(p)
    }
  }
  nl.lines.push('.options rshunt=1e12')
  for (const n of nets.all) resistor(nl, n, '0', JUNCTION_LEAK)
  const termOf = compileWiring(ctx, proj)
  for (const node of proj.nodes || []) {
    if (node.type === 'driver') compileDriver(ctx, node, termOf)
    else if (node.type === 'chamber') compileChamber(ctx, node)
    else if (node.type === 'waveguide') compileWaveguide(ctx, node)
    else if (node.type === 'pr') compilePR(ctx, node)
    else if (node.type === 'radiation') compileRadiation(ctx, node)
  }
  for (const p of [...handleProbes, ...ctx.endFlowProbes]) {
    const f = ctx.map.handleFlows[`${p.at.node}:${p.at.handle}`]
    ctx.map.flowProbes.push(f ? { key: p.id, kind: p.kind, ...f } : { key: p.id, kind: p.kind, sense: null })
  }
  if (tran) transientOutputs(ctx)
  const m = ctx.map
  const saves = [
    ...m.channels.flatMap((c) => [`i(${c.sense})`, `v(${c.load})`]),
    ...m.drivers.map((d) => `i(${d.velocity})`),
    ...m.waveguides.flatMap((w) => Object.values(w.ends).map((e) => `i(${e.sense})`)),
    ...m.radiators.flatMap((r) => [`i(${r.sense})`, `v(${r.node})`]),
    ...m.probes.map((p) => `v(${p.node})`),
    ...m.flowProbes.filter((p) => p.sense).map((p) => `i(${p.sense})`),
    ...(tran ? [m.pressure, m.driverPressure, ...m.drivers.map((d) => d.x)].filter(Boolean).map((n) => `v(${n})`) : []),
  ].map((s) => s.toLowerCase())
  const unique = [...new Set(saves)]
  nl.lines.push(`.save ${unique.join(' ')}`)
  if (tran) {
    const step = 1 / tran.fs
    let maxStep = Math.min(step, 1 / (8 * analysis.fmax))
    for (const l of nl.lines) {
      const m = /^T\S* .* TD=(\S+)/.exec(l)
      if (m) maxStep = Math.min(maxStep, 0.9 * Number(m[1]))
    }
    const klu = tran.solver !== 'sparse'
    const gear = tran.robust ? ' method=gear maxord=2 itl4=100 reltol=0.002' : ''
    nl.lines.push(`.options interp${klu ? ' klu' : ''}${gear}`)
    nl.lines.push(`.tran ${fmt(step)} ${fmt(tran.tstop)} 0 ${fmt(maxStep)}${klu ? ' uic' : ''}`)
  } else if (analysis.scale === 'lin') {
    nl.lines.push(`.ac lin ${Math.round(analysis.npts)} ${analysis.fmin} ${analysis.fmax}`)
  } else {
    const ppd = pointsPerDecade(analysis.fmin, analysis.fmax, analysis.npts)
    const steps = Math.max(1, Math.round(ppd * Math.log10(analysis.fmax / analysis.fmin)))
    nl.lines.push(`.ac dec ${ppd} ${analysis.fmin} ${decadeStep(analysis.fmin, ppd, steps, true)}`)
  }
  nl.lines.push('.end')
  return { netlist: nl.text(), map: m, saves: unique }
}
