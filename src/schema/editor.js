import { DEFAULT_ANALYSIS, DEFAULT_CHANNEL, DEFAULT_DISPLAY, DEFAULT_WIRING, SCHEMA_VERSION } from './version.js'
import { toolbarChannel } from './wires.js'

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

const gain = (db) => Math.pow(10, (Number(db) || 0) / 20)

export function toEditor(proj) {
  const analysis = proj.analyses?.[0] || DEFAULT_ANALYSIS
  const channel = toolbarChannel(proj.wiring) || DEFAULT_CHANNEL
  const display = { ...DEFAULT_DISPLAY, ...(proj.display || {}) }
  const lengths = new Map((proj.nodes || []).filter((n) => n.type === 'chamber').map((n) => [n.id, Number(n.params?.length)]))
  const chamberProbe = new Map()
  const otherProbes = []
  for (const p of proj.probes || []) {
    const id = p.at?.node
    if (p.id === `probe_${id}` && p.kind === 'pressure' && lengths.has(id) && p.at.position != null && !chamberProbe.has(id)) {
      chamberProbe.set(id, p.at.position)
    } else {
      otherProbes.push(clone(p))
    }
  }
  const nodes = (proj.nodes || []).map((n) => {
    const params = clone(n.params || {})
    if (n.type === 'chamber') {
      params.probe = chamberProbe.has(n.id)
      params.probePos = chamberProbe.has(n.id)
        ? Math.min(Math.max((Number(chamberProbe.get(n.id)) / lengths.get(n.id)) * 100, 0), 100)
        : 100
    }
    return { id: n.id, type: n.type, position: clone(n.position) || { x: 0, y: 0 }, data: { params } }
  })
  const voltage = Number(channel.volts) * gain(proj.wiring?.masterDb)
  const settings = {
    fmin: analysis.fmin, fmax: analysis.fmax, npts: analysis.npts,
    masking: !!analysis.masking,
    voltage, rg: Number(channel.outputOhms) || 0,
    impedance: display.nominalOhms, power: (voltage * voltage) / (Number(display.nominalOhms) || 4),
    vThreshold: display.vThreshold, unwrapPhase: display.unwrapPhase, delayOffset: display.delayOffset,
  }
  if (display.yScales) settings.yScales = clone(display.yScales)
  return {
    name: proj.name || '',
    nodes,
    edges: clone(proj.edges || []),
    settings,
    extras: {
      air: clone(proj.air),
      params: clone(proj.params || []),
      wiring: clone(proj.wiring),
      analyses: clone(proj.analyses || []),
      probes: otherProbes,
      components: clone(proj.components || []),
      display: clone(proj.display || {}),
    },
  }
}

export function fromEditor({ name, nodes, edges, settings, extras = {} }) {
  const s = settings || {}
  const probes = []
  const outNodes = (nodes || []).map((n) => {
    const params = clone(n.data?.params || {})
    if (n.type === 'chamber') {
      if (params.probe) {
        const pos = Math.min(Math.max(Number(params.probePos ?? 100), 0), 100)
        probes.push({ id: `probe_${n.id}`, kind: 'pressure', at: { node: n.id, position: (pos / 100) * Number(params.length) } })
      }
      delete params.probe
      delete params.probePos
    }
    return { id: n.id, type: n.type, position: clone(n.position), params }
  })
  const analyses = clone(extras.analyses?.length ? extras.analyses : [DEFAULT_ANALYSIS])
  analyses[0] = {
    ...analyses[0],
    fmin: s.fmin ?? analyses[0].fmin, fmax: s.fmax ?? analyses[0].fmax, npts: s.npts ?? analyses[0].npts,
    masking: !!s.masking,
  }
  delete analyses[0].nlEnabled
  const wiring = clone(extras.wiring || DEFAULT_WIRING)
  if (!wiring.channels?.length) wiring.channels = [clone(DEFAULT_CHANNEL)]
  const at = Math.max(0, wiring.channels.indexOf(toolbarChannel(wiring)))
  const ch0 = wiring.channels[at]
  wiring.channels[at] = {
    ...ch0,
    volts: typeof ch0.volts === 'string' || !Number.isFinite(Number(s.voltage))
      ? ch0.volts
      : Number(s.voltage) / gain(wiring.masterDb),
    outputOhms: typeof ch0.outputOhms === 'string' ? ch0.outputOhms : Number(s.rg) || 0,
  }
  const display = {
    ...clone(extras.display || {}),
    vThreshold: s.vThreshold ?? DEFAULT_DISPLAY.vThreshold,
    unwrapPhase: s.unwrapPhase ?? DEFAULT_DISPLAY.unwrapPhase,
    delayOffset: s.delayOffset ?? DEFAULT_DISPLAY.delayOffset,
    nominalOhms: s.impedance ?? DEFAULT_DISPLAY.nominalOhms,
  }
  if (s.yScales) display.yScales = clone(s.yScales)
  else delete display.yScales
  return {
    schemaVersion: SCHEMA_VERSION,
    app: 'SpeakerSpice',
    name: name || '',
    air: clone(extras.air),
    params: clone(extras.params || []),
    nodes: outNodes,
    edges: (edges || []).map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle })),
    wiring,
    analyses,
    probes: [...probes, ...clone(extras.probes || [])],
    components: clone(extras.components || []),
    display,
  }
}
