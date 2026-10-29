import {
  SCHEMA_VERSION, DEFAULT_PARAMS, DEFAULT_ANALYSIS, DEFAULT_CHANNEL, DEFAULT_WIRING,
  DEFAULT_DISPLAY, DEFAULT_AIR,
} from './version.js'
import { wiresFromLoads, liveWires, allTerminals } from './wires.js'
import { normalizeDsp } from './dsp.js'

const LEGACY_EC_FACTOR = 0.732

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

function prFs(p) {
  const Mm = ((Number(p.Mmd) || 50) + (Number(p.addedMass) || 0)) * 1e-3
  const Cm = (Number(p.Cms) || 0.5) * 1e-3
  return 1 / (2 * Math.PI * Math.sqrt(Mm * Cm))
}

function migrateNodeParams(node, from) {
  const p = { ...clone(node.params || {}) }
  let probe = null
  if (node.type === 'waveguide' && from < 2 && p.ecFactor != null) {
    const k = Number(p.ecFactor)
    if (isFinite(k) && k >= 0) p.ecFactor = k / LEGACY_EC_FACTOR
  }
  if (node.type === 'waveguide') {
    if (p.space != null) p.mouthSpace = p.space
    p.loss = p.lossless ? 0 : 1
    delete p.space; delete p.Q; delete p.lossless
  } else if (node.type === 'chamber') {
    p.leakQL = p.lossless ? null : (Number(p.Q) > 0 ? Number(p.Q) : 50)
    if (p.probe) {
      const length = Number(p.length) || DEFAULT_PARAMS.chamber.length
      const pos = Math.min(Math.max(Number(p.probePos ?? 100), 0), 100)
      probe = {
        id: `probe_${node.id}`, kind: 'pressure',
        at: { node: node.id, position: (pos / 100) * length },
      }
    }
    delete p.Q; delete p.lossless; delete p.probe; delete p.probePos
  } else if (node.type === 'driver') {
    const Q = Number(p.Q ?? 50)
    if (p.lossless === false && Q > 0 && isFinite(Q)) {
      const Fs = Number(p.Fs ?? DEFAULT_PARAMS.driver.Fs)
      const Mms = Number(p.Mms ?? DEFAULT_PARAMS.driver.Mms) * 1e-3
      p.Rms = Number(p.Rms ?? DEFAULT_PARAMS.driver.Rms) + (2 * Math.PI * Fs * Mms) / Q
    }
    delete p.Q; delete p.lossless
  } else if (node.type === 'pr') {
    const Q = Number(p.Q ?? 50)
    if (p.lossless !== true && Q > 0 && isFinite(Q)) {
      const merged = { ...DEFAULT_PARAMS.pr, ...p }
      const Mm = (Number(merged.Mmd) + (Number(merged.addedMass) || 0)) * 1e-3
      p.Rms = Number(merged.Rms) + (2 * Math.PI * prFs(merged) * Mm) / Q
    }
    delete p.Q; delete p.lossless; delete p.space
  }
  return { params: p, probe }
}

function splitSettings(s = {}) {
  const pick = (k, d) => (s[k] ?? d)
  const analyses = [{
    ...DEFAULT_ANALYSIS,
    fmin: pick('fmin', DEFAULT_ANALYSIS.fmin),
    fmax: pick('fmax', DEFAULT_ANALYSIS.fmax),
    npts: pick('npts', DEFAULT_ANALYSIS.npts),
    masking: !!pick('masking', false),
  }]
  const wiring = {
    masterDb: 0,
    channels: [{
      ...clone(DEFAULT_CHANNEL),
      volts: pick('voltage', DEFAULT_CHANNEL.volts),
      outputOhms: pick('rg', 0),
    }],
  }
  const display = {
    ...DEFAULT_DISPLAY,
    vThreshold: pick('vThreshold', DEFAULT_DISPLAY.vThreshold),
    unwrapPhase: pick('unwrapPhase', DEFAULT_DISPLAY.unwrapPhase),
    delayOffset: pick('delayOffset', DEFAULT_DISPLAY.delayOffset),
    nominalOhms: pick('impedance', DEFAULT_DISPLAY.nominalOhms),
  }
  if (s.yScales) display.yScales = clone(s.yScales)
  return { analyses, wiring, display }
}

function normalize(proj) {
  const nodes = (proj.nodes || []).map((n) => {
    const params = { ...clone(DEFAULT_PARAMS[n.type] || {}), ...clone(n.params || {}) }
    if (n.type === 'driver' && (params.wiring === 'single' || !params.wiring)) params.wiring = 'parallel'
    return { id: n.id, type: n.type, position: clone(n.position) || { x: 0, y: 0 }, params }
  })
  const rawEdges = [...(proj.edges || [])]
  for (const n of [...nodes]) {
    if (n.type !== 'waveguide') continue
    const p = n.params
    for (const h of ['throat', 'mouth']) {
      const space = p[`${h}Space`]
      delete p[`${h}Space`]
      if (!space || space === 'half') continue
      if (rawEdges.some((e) => (e.source === n.id && e.sourceHandle === h) || (e.target === n.id && e.targetHandle === h))) continue
      let id = `${n.id}_${h}_radiation`
      while (nodes.some((m) => m.id === id)) id += '_'
      const at = n.position || { x: 0, y: 0 }
      nodes.push({ id, type: 'radiation', position: { x: at.x, y: at.y + (h === 'mouth' ? 160 : -120) }, params: { ...clone(DEFAULT_PARAMS.radiation), space } })
      rawEdges.push({ source: n.id, sourceHandle: h, target: id, targetHandle: 'in' })
    }
  }
  const used = new Set(rawEdges.map((e) => e.id).filter(Boolean))
  let k = 0
  const freshId = () => {
    while (used.has(`e_${k}`)) k++
    used.add(`e_${k}`)
    return `e_${k}`
  }
  const edges = rawEdges.map((e) => ({
    id: e.id || freshId(),
    source: e.source, sourceHandle: e.sourceHandle,
    target: e.target, targetHandle: e.targetHandle,
  }))
  const w = proj.wiring || {}
  const saved = w.channels && w.channels.length ? w.channels : DEFAULT_WIRING.channels
  const channels = saved.map((c, i) => {
    const { load, dsp, ...rest } = clone(c)
    const label = !rest.label || /^(Amp|Channel)( \d+)?$/.test(rest.label.trim()) ? 'Channel' : rest.label
    const ohms = rest.ohms ?? (i === 0 && Number(proj.display?.nominalOhms) > 0 ? Number(proj.display.nominalOhms) : DEFAULT_CHANNEL.ohms)
    return { ...clone(DEFAULT_CHANNEL), ...rest, label, ohms, ...(dsp ? { dsp: normalizeDsp(dsp) } : {}) }
  })
  const driverIds = nodes.filter((n) => n.type === 'driver').map((n) => n.id)
  const cables = Array.isArray(w.wires) ? clone(w.wires) : wiresFromLoads(saved, driverIds)
  const analyses = (proj.analyses && proj.analyses.length ? proj.analyses : [DEFAULT_ANALYSIS])
    .map((a) => ({ ...(a.type === 'ac' || !a.type ? DEFAULT_ANALYSIS : {}), ...clone(a) }))
  const out = {
    schemaVersion: SCHEMA_VERSION,
    app: proj.app || 'SpeakerSpice',
    name: proj.name || '',
    air: { ...DEFAULT_AIR, ...clone(proj.air || {}) },
    params: clone(proj.params || []),
    nodes,
    edges,
    wiring: {
      masterDb: typeof w.masterDb === 'string' ? w.masterDb : Number(w.masterDb) || 0,
      toolbar: channels.some((c) => c.id === w.toolbar) ? w.toolbar : channels[0].id,
      channels,
      wires: liveWires(cables, allTerminals({ channels }, nodes)),
      layout: clone(w.layout || {}),
    },
    analyses,
    probes: clone(proj.probes || []),
    components: clone(proj.components || []),
    display: { ...DEFAULT_DISPLAY, ...clone(proj.display || {}) },
  }
  if (proj.modified) out.modified = proj.modified
  return out
}

export function migrateProject(proj) {
  const from = Number(proj?.schemaVersion) || 1
  if (from >= 3) return normalize(proj || {})
  const probes = []
  const prIds = new Set((proj.nodes || []).filter((n) => n.type === 'pr').map((n) => n.id))
  const nodes = (proj.nodes || []).map((n) => {
    const { params, probe } = migrateNodeParams(n, from)
    if (probe) probes.push(probe)
    return { ...n, params }
  })
  const edges = (proj.edges || []).map((e) => ({
    ...e,
    sourceHandle: prIds.has(e.source) && e.sourceHandle === 'in' ? 'rear' : e.sourceHandle,
    targetHandle: prIds.has(e.target) && e.targetHandle === 'in' ? 'rear' : e.targetHandle,
  }))
  const { analyses, wiring, display } = splitSettings(proj.settings)
  return normalize({ ...proj, nodes, edges, analyses, wiring, display, probes })
}

export const __internals = { migrateNodeParams, splitSettings, normalize, prFs }
