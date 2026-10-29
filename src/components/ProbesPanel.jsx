import React from 'react'
import { useStore } from '../store'
import ExprInput from './ExprInput'
import { nodeHandles } from '../schema/validate'
import { PROBE_KINDS } from '../schema/version'
import { displayName } from '../nodeNames'

const KIND_LABELS = {
  pressure: 'Pressure (SPL)',
  flow: 'Volume flow',
  velocity: 'Air velocity',
}

export default function ProbesPanel() {
  const probes = useStore((s) => s.projectExtras.probes) || []
  const nodes = useStore((s) => s.nodes)
  const setExtra = useStore((s) => s.setExtra)
  const addProbe = useStore((s) => s.addProbe)
  const warnings = useStore((s) => s.results?.validation?.warnings)
  const edit = (i, change, live) => setExtra('probes', probes.map((p, k) => (k === i ? { ...p, ...change } : p)), !live)
  const lines = nodes.filter((n) => n.type === 'chamber' || n.type === 'waveguide')
  return (
    <div className="panel-scroll">
      <div className="panel-section">
        <h4>Probes</h4>
        <div className="ts-hint">
          Measure pressure, flow or air velocity at any handle, or at a distance
          along a chamber or waveguide. A chamber's own “SPL probe” checkbox is
          one of these too.
        </div>
        {probes.map((p, i) => {
          const node = nodes.find((n) => n.id === p.at?.node)
          const along = p.at?.position != null
          const canAlong = node && (node.type === 'chamber' || node.type === 'waveguide')
          const handles = node ? nodeHandles({ type: node.type, params: node.data.params }) : []
          const warn = warnings?.[`probe:${p.id}`]
          return (
            <div className="probe-card" key={p.id}>
              <div className="channel-head">
                <input className="channel-label" value={p.label || ''} placeholder={p.id} onChange={(e) => edit(i, { label: e.target.value || undefined }, true)} />
                <button className="icon-btn" title="Remove this probe" onClick={() => setExtra('probes', probes.filter((_, k) => k !== i))}>✕</button>
              </div>
              <div className="param-row">
                <label>Measures</label>
                <select value={p.kind} onChange={(e) => edit(i, { kind: e.target.value })}>
                  {PROBE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                </select>
                <span className="unit" />
              </div>
              <div className="param-row">
                <label>On</label>
                <select value={p.at?.node || ''} onChange={(e) => {
                  const n = nodes.find((x) => x.id === e.target.value)
                  const h = n ? nodeHandles({ type: n.type, params: n.data.params })[0] : undefined
                  edit(i, { at: { node: e.target.value, handle: h } })
                }}>
                  {!node && <option value="">(missing node)</option>}
                  {nodes.map((n) => <option key={n.id} value={n.id}>{displayName(nodes, n.id)}</option>)}
                </select>
                <span className="unit" />
              </div>
              <div className="param-row">
                <label>At</label>
                <select value={along ? '#position' : p.at?.handle || ''} onChange={(e) => {
                  const v = e.target.value
                  edit(i, { at: v === '#position'
                    ? { node: p.at.node, position: Math.round((Number(node?.data.params.length) || 0) / 2) }
                    : { node: p.at.node, handle: v } })
                }}>
                  {handles.map((h) => <option key={h} value={h}>{h.startsWith('tap:') ? `tap ${h.slice(4)}` : h}</option>)}
                  {canAlong && <option value="#position">a distance along it…</option>}
                </select>
                <span className="unit" />
              </div>
              {along && (
                <div className="param-row">
                  <label>Distance</label>
                  <ExprInput value={p.at.position} min={0} onCommit={(v) => edit(i, { at: { node: p.at.node, position: v } })} />
                  <span className="unit">cm</span>
                </div>
              )}
              {warn?.map((w, k) => <div key={k} className="node-warning"><span className="warn-dot" /> {w}</div>)}
            </div>
          )
        })}
        <button disabled={!nodes.length} onClick={() => {
          const n = lines[0] || nodes[0]
          const at = lines[0]
            ? { node: n.id, position: Math.round((Number(n.data.params.length) || 0) / 2) }
            : { node: n.id, handle: nodeHandles({ type: n.type, params: n.data.params })[0] }
          addProbe({ kind: 'pressure', at })
        }}>+ Probe</button>
      </div>
    </div>
  )
}
