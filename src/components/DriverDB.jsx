import React, { useMemo, useState } from 'react'
import { useStore } from '../store'
import { readDrivers, DRIVERS_PATH } from '../workspace'
import {
  BUILTIN_DRIVERS, DRIVER_BRANDS, EXT_FIELDS, EXT_GROUPS, driverToParams,
} from '../data/drivers'
import { useBackdropDismiss } from '../utils/backdrop'
import { withCurvesFor } from '../driverParams'

function ExtDetail({ driver }) {
  const groups = EXT_GROUPS
    .map((g) => [g, EXT_FIELDS.filter((f) => f.group === g && driver.ext[f.key] != null)])
    .filter(([, fields]) => fields.length)

  if (!groups.length) {
    return (
      <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-3)' }}>
        No extended parameters published for this driver.
      </div>
    )
  }
  return (
    <div style={{ padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 18 }}>
      {groups.map(([group, fields]) => (
        <div key={group} style={{ minWidth: 170 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-3)', marginBottom: 3 }}>
            {group}
          </div>
          {fields.map((f) => (
            <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11.5 }}>
              <span style={{ color: 'var(--text-2)' }} title={f.desc}>{f.label}</span>
              <span>{driver.ext[f.key]}{f.unit ? ` ${f.unit}` : ''}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function DriverDB() {
  const show = useStore((s) => s.showDriverDB)
  const setShow = useStore((s) => s.setShowDriverDB)
  const node = useStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId))
  const applyDriverParams = useStore((s) => s.applyDriverParams)
  const setSaveDriverFor = useStore((s) => s.setSaveDriverFor)
  const addNode = useStore((s) => s.addNode)
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [fsMax, setFsMax] = useState('')
  const [vasMin, setVasMin] = useState('')
  const [xmaxMin, setXmaxMin] = useState('')
  const [open, setOpen] = useState(null)
  const workspace = useStore((s) => s.workspace)
  const custom = useMemo(() => readDrivers(workspace), [workspace])

  const all = useMemo(() => [
    ...custom.map((d) => ({ ...d, ext: d.ext || {}, custom: true })),
    ...BUILTIN_DRIVERS,
  ], [custom])

  const brands = useMemo(
    () => (custom.length ? ['Custom', ...DRIVER_BRANDS] : DRIVER_BRANDS),
    [custom.length],
  )

  const filtered = useMemo(() => all.filter((d) => {
    const q = query.trim().toLowerCase()
    if (q && !`${d.brand} ${d.model}`.toLowerCase().includes(q)) return false
    if (brand && !(brand === 'Custom' ? d.custom : d.brand === brand)) return false
    if (fsMax !== '' && d.Fs > parseFloat(fsMax)) return false
    if (vasMin !== '' && !(d.Vas >= parseFloat(vasMin))) return false
    if (xmaxMin !== '' && !(d.Xmax >= parseFloat(xmaxMin))) return false
    return true
  }), [all, query, brand, fsMax, vasMin, xmaxMin])

  const dismiss = useBackdropDismiss(() => setShow(false))
  if (!show) return null

  const apply = (d) => {
    const params = driverToParams(d)
    const st = useStore.getState()
    const onto = (id) => applyDriverParams(id, withCurvesFor(useStore.getState().nodes.find((n) => n.id === id), params))
    const picked = st.nodes.filter((n) => n.selected)
    if (picked.length > 1 && picked.every((n) => n.type === 'driver')) {
      st.editGroup(picked.map((n) => n.id), onto)
      setShow(false)
      return
    }
    const target = node && node.type === 'driver' ? node.id : addNode('driver', { x: 100, y: 100 })
    onto(target)
    setShow(false)
  }

  const saveCurrentAsCustom = () => {
    if (!node || node.type !== 'driver') { alert('Select a Driver node first.'); return }
    setSaveDriverFor(node.id)
  }

  const removeCustom = (i) => {
    useStore.getState().setCustomDrivers(custom.filter((_, k) => k !== i))
  }

  const key = (d, i) => `${d.brand}|${d.model}|${i}`

  return (
    <div className="modal-backdrop" {...dismiss}>
      <div className="modal" style={{ minWidth: 780 }}>
        <h3>Driver Database</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input placeholder="Search brand or model…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus style={{ flex: 1, minWidth: 180 }} />
          <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ width: 140 }}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input placeholder="Fs ≤ Hz" style={{ width: 78 }} value={fsMax} onChange={(e) => setFsMax(e.target.value)} />
          <input placeholder="Vas ≥ L" style={{ width: 78 }} value={vasMin} onChange={(e) => setVasMin(e.target.value)} />
          <input placeholder="Xmax ≥ mm" style={{ width: 88 }} value={xmaxMin} onChange={(e) => setXmaxMin(e.target.value)} />
          <button onClick={saveCurrentAsCustom} title={`Store the selected Driver node's parameters as a custom database entry, saved in the workspace as ${DRIVERS_PATH}`}>+ Save current</button>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: -4, marginBottom: 8 }}>
          Custom drivers are stored in the workspace as <code>{DRIVERS_PATH}</code>, so they travel with a downloaded workspace.
        </div>
        <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Brand</th><th>Model</th><th>Fs</th><th>Qts</th><th>Vas L</th>
                <th>Re Ω</th><th>Sd cm²</th><th>Xmax</th><th>Power W</th><th /><th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <React.Fragment key={key(d, i)}>
                  <tr className="clickable" onClick={() => apply(d)}>
                    <td>{d.brand}</td>
                    <td>
                      {d.model}
                      {d.suspect && (
                        <span title={d.suspect.join('\n')} style={{ color: 'var(--amber)', marginLeft: 5 }}>⚠</span>
                      )}
                    </td>
                    <td>{d.Fs}</td><td>{d.Qts}</td><td>{d.Vas}</td><td>{d.Re}</td>
                    <td>{d.Sd}</td><td>{d.Xmax}</td><td>{d.ext.pNom ?? ''}</td>
                    <td>
                      <span
                        title={open === key(d, i) ? 'Hide details' : 'Show extended parameters'}
                        style={{ cursor: 'pointer', color: 'var(--text-3)' }}
                        onClick={(e) => { e.stopPropagation(); setOpen(open === key(d, i) ? null : key(d, i)) }}
                      >{open === key(d, i) ? '▾' : '▸'}</span>
                    </td>
                    <td>{d.custom && (
                      <span className="x" style={{ cursor: 'pointer', color: 'var(--red)' }}
                        onClick={(e) => { e.stopPropagation(); removeCustom(custom.indexOf(d)) }}>✕</span>
                    )}</td>
                  </tr>
                  {open === key(d, i) && (
                    <tr>
                      <td colSpan={11} style={{ background: 'var(--surface-2)' }}>
                        {d.suspect && (
                          <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--amber)' }}>
                            {d.suspect.map((s) => <div key={s}>⚠ {s}</div>)}
                            <div style={{ color: 'var(--text-3)', marginTop: 2 }}>
                              The simulation follows Bl/Re/Mms/Cms/Rms, not the published Q figures.
                            </div>
                          </div>
                        )}
                        <ExtDetail driver={d} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>
            Click a row to fill the {node?.type === 'driver' ? 'selected' : 'new'} Driver node; ▸ shows the extended
            parameters. Catalog-sourced values come from the manufacturer's own data export; ⚠ marks a row whose
            published figures disagree with each other.
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>{filtered.length} of {all.length}</span>
        </div>
        <div className="close-row"><button onClick={() => setShow(false)}>Close</button></div>
      </div>
    </div>
  )
}
