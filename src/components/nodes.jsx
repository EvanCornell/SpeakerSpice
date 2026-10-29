import React, { useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals } from 'reactflow'
import { useStore } from '../store'
import { C_AIR, flareCutoff, endCorrectionLength, waveguideVolume } from '../engine/geometry'
import { useResolvedParams } from '../useResolved'
import { driverNominal, fmtOhms } from '../schema/nominal'
import { driverStatus } from '../schema/wires'
import { nameNumbers } from '../nodeNames'

const NODE_COLORS = {
  driver: 'var(--s1)',
  chamber: 'var(--s2)',
  waveguide: 'var(--s3)',
  pr: 'var(--s4)',
  radiation: 'var(--s5)',
}

function useWarnings(id) {
  return useStore((s) => s.results?.validation?.warnings?.[id])
}

function Head({ id, type, label, warn }) {
  const num = useStore((s) => nameNumbers(s.nodes)[id])
  return (
    <div className="node-head">
      <span className="pi-dot" style={{ background: NODE_COLORS[type] }} />
      {label}
      {num ? <span className="name-num" title="Another component has this name too; the number tells them apart">#{num}</span> : null}
      {warn && <span className="warn-dot" title={warn.join('\n')} />}
    </div>
  )
}

function Port({ id, side, at, label, title }) {
  const position = { top: Position.Top, bottom: Position.Bottom, left: Position.Left, right: Position.Right }[side]
  const along = side === 'top' || side === 'bottom' ? { left: at || '50%' } : { top: at || '50%' }
  const labelPos = {
    top: { top: 1, left: `calc(${at || '50%'} + 6px)` },
    bottom: { bottom: 1, left: `calc(${at || '50%'} + 6px)` },
    left: { left: 4, top: `calc(${at || '50%'} - 17px)` },
    right: { right: 4, top: `calc(${at || '50%'} - 17px)` },
  }[side]
  return (
    <>
      <Handle type="source" position={position} id={id} style={along} title={title || label} />
      <span className="handle-label" style={labelPos}>{label}</span>
    </>
  )
}

function TapPorts({ id, taps, length }) {
  const updateInternals = useUpdateNodeInternals()
  const shape = (taps || []).map((t) => `${t.id}@${t.position}`).join(',') + `/${length}`
  useEffect(() => { updateInternals(id) }, [id, shape, updateInternals])
  return (
    <>
      {(taps || []).map((t) => {
        const f = Math.min(Math.max(Number(t.position) / Number(length), 0), 1)
        const at = `${(12 + f * 76).toFixed(1)}%`
        return <Port key={t.id} id={`tap:${t.id}`} side="right" at={at} label={t.id} title={`Tap ${t.id} at ${t.position} cm`} />
      })}
    </>
  )
}

export function driverSummary(p, channels) {
  const n = Number(p.count) || 1
  const parts = []
  if (n > 1) parts.push(p.wiring === 'custom' ? `${n}×` : `${n}× ${p.wiring}`)
  if (p.dvc) parts.push(p.wiring === 'custom' ? 'dual coil' : `dual coil ${p.dvc.coils === 'one' ? 'one coil' : p.dvc.coils}`)
  if (p.wiring === 'custom') parts.push('wired by hand')
  else {
    const z = driverNominal(p)
    parts.push(`${fmtOhms(z)} Ω`)
  }
  parts.push(channels || 'not wired')
  return parts.join(' · ')
}

export function DriverNode({ id, data, selected }) {
  const warn = useWarnings(id)
  const p = useResolvedParams(id, 'driver', data.params)
  const channels = useStore((s) => {
    const st = driverStatus(s.projectExtras.wiring, s.nodes).get(id)
    return (st?.channels || []).map((c) => `Ch ${(s.projectExtras.wiring.channels.findIndex((x) => x.id === c) + 1) || c}`).join('+')
  })
  const summary = driverSummary(p, channels)
  return (
    <div className={`acou-node ${selected ? 'selected' : ''}`}>
      <Head id={id} type="driver" label={p.label || 'Driver'} warn={warn} />
      <div className="node-body">
        Fs <span className="node-readout">{p.Fs} Hz</span> · Qts <span className="node-readout">{p.Qts}</span><br />
        Sd <span className="node-readout">{p.Sd} cm²</span><br />
        <span className="node-readout" title="How the node's drivers and coils are joined, its nominal impedance, and the channel driving it">{summary}</span>
      </div>
      <Port id="front" side="right" at="35%" label="front" title="Front face — unconnected, it radiates as if in an infinite baffle" />
      <Port id="rear" side="left" at="35%" label="rear" title="Rear face — unconnected, it radiates behind the baffle" />
    </div>
  )
}

export function ChamberNode({ id, data, selected }) {
  const warn = useWarnings(id)
  const p = useResolvedParams(id, 'chamber', data.params)
  const fRes = C_AIR / (2 * (p.length / 100))
  return (
    <div className={`acou-node ${selected ? 'selected' : ''}`}>
      <Head id={id} type="chamber" label={p.label || 'Chamber'} warn={warn} />
      <div className="node-body">
        <span className="node-readout">{p.volume} L</span> · L {p.length} cm<br />
        1st mode <span className="node-readout">{fRes.toFixed(0)} Hz</span> · {Number(p.leakQL) > 0 ? `QL ${p.leakQL}` : 'sealed'}
      </div>
      <Port id="in" side="top" label="in" title="One end — anything may join it; unconnected, it is a closed wall" />
      <Port id="out" side="bottom" label="out" title="The other end — anything may join it; unconnected, it is a closed wall" />
      <TapPorts id={id} taps={p.taps} length={p.length} />
    </div>
  )
}

export function WaveguideNode({ id, data, selected }) {
  const warn = useWarnings(id)
  const setVelocityPopup = useStore((s) => s.setVelocityPopup)
  const vThreshold = useStore((s) => s.settings.vThreshold)
  const vmax = useStore((s) => {
    const v = s.results?.velocity?.[id]
    return v && v.length ? Math.max(...v) : null
  })
  const p = useResolvedParams(id, 'waveguide', data.params)
  const L = p.length / 100
  const S2 = p.S2 * 1e-4
  const isStraight = Math.abs(p.S1 - p.S2) < 0.001 * Math.max(p.S1, p.S2, 1)
  const ec = endCorrectionLength(S2, 0.85) * (p.ecFactor ?? 1)
  const fq = C_AIR / (4 * (L + ec))
  const fc = flareCutoff(p.flare, p.S1 * 1e-4, S2, L)
  const volL = waveguideVolume(p.flare, p.S1 * 1e-4, S2, L) * 1000
  return (
    <div className={`acou-node ${selected ? 'selected' : ''}`}>
      <Head id={id} type="waveguide" label={p.label || 'Waveguide'} warn={warn} />
      <div className="node-body">
        {p.S1}→{p.S2} cm² · {p.length} cm · {p.flare}<br />
        vol <span className="node-readout" title="Internal air volume of this segment (from the flare profile)">{volL >= 100 ? volL.toFixed(0) : volL.toFixed(1)} L</span> ·{' '}
        {isStraight
          ? <>λ/4 <span className="node-readout">{fq.toFixed(1)} Hz</span></>
          : fc
            ? <>flare fc <span className="node-readout">{fc.toFixed(1)} Hz</span></>
            : <>no cutoff (conical/parabolic)</>}
        <br />
        <span
          className={`vel-readout ${vmax != null && vmax > vThreshold ? 'over' : ''}`}
          title="Peak air velocity in this segment — click for the velocity chart"
          onClick={(e) => { e.stopPropagation(); setVelocityPopup(id) }}
        >
          ⇥ {vmax != null ? vmax.toFixed(1) : '—'} m/s
        </span>
      </div>
      <Port id="throat" side="top" label="throat" title="Throat (S1) — unconnected, it radiates into half space" />
      <Port id="mouth" side="bottom" label="mouth" title="Mouth (S2) — unconnected, it radiates into half space" />
      <TapPorts id={id} taps={p.taps} length={p.length} />
    </div>
  )
}

export function PRNode({ id, data, selected }) {
  const warn = useWarnings(id)
  const p = useResolvedParams(id, 'pr', data.params)
  const m = (p.Mmd + (p.addedMass || 0)) / 1000
  const c = p.Cms / 1000
  const fs = 1 / (2 * Math.PI * Math.sqrt(Math.max(m * c, 1e-12)))
  return (
    <div className={`acou-node ${selected ? 'selected' : ''}`}>
      <Head id={id} type="pr" label={p.label || 'Passive Radiator'} warn={warn} />
      <div className="node-body">
        Sd {p.Sd} cm² · M {p.Mmd}{p.addedMass ? `+${p.addedMass}` : ''} g<br />
        Fs <span className="node-readout">{fs.toFixed(1)} Hz</span>{p.count > 1 && <> · <span className="node-readout">{p.count}×</span></>}
      </div>
      <Port id="rear" side="top" label="rear" title="Rear face — unconnected, it radiates behind the baffle" />
      <Port id="front" side="bottom" label="front" title="Front face — unconnected, it radiates as if in an infinite baffle" />
    </div>
  )
}

const SPACE_LABELS = {
  free: 'Free space (4π)', half: 'Half space (2π)', quarter: 'Quarter space (π)',
  eighth: 'Eighth space (π/2)', rigid: 'Rigid wall', anechoic: 'Anechoic',
}

export function RadiationNode({ id, data, selected }) {
  const warn = useWarnings(id)
  const p = data.params
  return (
    <div className={`acou-node ${selected ? 'selected' : ''}`}>
      <Head id={id} type="radiation" label={p.label || 'Radiation'} warn={warn} />
      <div className="node-body">{SPACE_LABELS[p.space] || p.space}</div>
      <Handle type="source" position={Position.Top} id="in" title="One shared opening — everything joined here radiates together" />
    </div>
  )
}

export const nodeTypes = {
  driver: DriverNode,
  chamber: ChamberNode,
  waveguide: WaveguideNode,
  pr: PRNode,
  radiation: RadiationNode,
}
