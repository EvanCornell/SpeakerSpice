import { fmt, resistor } from './netlist.js'
import { signalExpression, signalPoints } from './dsp.js'
import { compileSections } from './filters.js'
import { normalizeDsp, dspScale, dspSections, isFlat } from '../schema/dsp.js'
import { allTerminals, liveWires, netsOf, chTerm, toolbarChannel, driverStatus, GROUND } from '../schema/wires.js'
import { channelNames } from '../nodeNames.js'

function transientSource(ctx, node, volts, label) {
  const { signal, levelDb = 0, fs } = ctx.tran
  const rms = volts * Math.pow(10, levelDb / 20)
  if (signal.type === 'noise') {
    const pts = signalPoints(signal, rms, Math.min(fs, Math.max(8 * signal.f2, 1000))).map((v) => fmt(v))
    const rows = []
    for (let i = 0; i < pts.length; i += 16) rows.push(`+ ${pts.slice(i, i + 16).join(' ')}`)
    ctx.nl.add('V', [node, '0'], `DC 0 PWL(\n${rows.join('\n')}\n+ )`, `${label} source`)
    return
  }
  ctx.nl.add('B', [node, '0'], `V=${signalExpression(signal, rms * Math.SQRT2)}`, `${label} source`)
}

export function compileWiring(ctx, proj) {
  const { nl } = ctx
  const wiring = proj.wiring || {}
  const terms = allTerminals(wiring, proj.nodes)
  const nets = netsOf(liveWires(wiring.wires, terms), terms)
  const nodeOf = new Map([[GROUND, '0']])
  const members = new Map()
  for (const net of nets.values()) members.set(net, (members.get(net) || 0) + 1)
  const termOf = (t) => {
    const net = nets.get(t) ?? t
    if (!nodeOf.has(net)) {
      const n = nl.node()
      nodeOf.set(net, n)
      if ((members.get(net) || 1) === 1) resistor(nl, n, '0', 1e9, 'open terminal')
    }
    return nodeOf.get(net)
  }
  const master = Math.pow(10, (Number(wiring.masterDb) || 0) / 20)
  const first = toolbarChannel(wiring)
  const channels = [first, ...(wiring.channels || []).filter((c) => c !== first)].filter(Boolean)
  const used = new Set()
  const names = channelNames(wiring.channels)
  const loaded = new Set([...driverStatus(wiring, proj.nodes).values()].flatMap((s) => s.channels))
  for (const c of channels) {
    const label = names[c.id] || c.id
    const net = nets.get(chTerm(c.id, '+'))
    if (net === GROUND) throw new Error(`${label} is shorted: its + is wired to the ground.`)
    if (used.has(net)) throw new Error(`${label} is wired directly to another channel's output.`)
    used.add(net)
    nl.comment(`channel ${label}`)
    const src = nl.node()
    const volts = Number(c.volts) * master
    const dsp = normalizeDsp(c.dsp)
    const flat = dsp.on === false || isFlat(dsp)
    const k = flat ? 1 : dspScale(dsp)
    if (ctx.tran) transientSource(ctx, src, volts * k, label)
    else nl.add('V', [src, '0'], `DC 0 AC ${fmt(volts * Math.abs(k))} ${k < 0 ? 180 : 0}`, `${label} source`)
    let drive = src
    const delay = (Number(dsp.delayMs) || 0) * 1e-3
    if (!flat && delay > 0) {
      const d = nl.node()
      const out = nl.node()
      nl.add('T', [src, '0', d, '0'], `Z0=1 TD=${fmt(delay)}`, `${label} DSP delay`)
      resistor(nl, d, '0', 1)
      nl.add('E', [out, '0', d, '0'], '1')
      drive = out
    }
    if (!flat) {
      let sections
      try { sections = dspSections(dsp) } catch (err) { throw new Error(`${label} › DSP ${err.message}`) }
      if (sections.length) drive = compileSections(nl, drive, sections, `${label} DSP`)
    }
    if (Number(c.outputOhms) > 0) {
      const r = nl.node()
      resistor(nl, drive, r, Number(c.outputOhms), `${label} Rg`)
      drive = r
    }
    const load = termOf(chTerm(c.id, '+'))
    const sense = nl.add('V', [drive, load], 'DC 0', `${label} current`)
    ctx.map.channels.push({ id: c.id, label, sense, load, volts, loaded: loaded.has(c.id) })
  }
  return termOf
}
