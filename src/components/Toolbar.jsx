import React from 'react'
import { useStore, SNAPSHOT_LIMIT, isLocked } from '../store'
import { useDrive } from '../useDrive'
import { readSnapshots } from '../workspace'
import { TOOLBAR_ITEMS, metricValue } from '../toolbarItems'
import NumInput from './NumInput'
import { channelNames } from '../nodeNames'

function UndoRedo() {
  const store = useStore()
  const locked = isLocked(store)
  return (
    <div className="tb-pill tb-undo">
      <button className="tb-icon" title="Undo (Ctrl+Z)" disabled={locked || !store.history.length} onClick={store.undo}>↶</button>
      <button className="tb-icon" title="Redo (Ctrl+Y)" disabled={locked || !store.future.length} onClick={store.redo}>↷</button>
    </div>
  )
}

function VoltageControl() {
  const drive = useDrive()
  const setAmp = useStore((s) => s.setAmp)
  const locked = useStore(isLocked)
  const name = useStore((s) => (drive.channel ? channelNames(s.projectExtras.wiring.channels)[drive.channel.id] : 'the channel'))
  const watts = drive.watts
  return (
    <div className="tb-pill tb-voltage" title={`${name}'s voltage — power follows as V²/Z. Changing it scales every channel together.`}>
      <label>Drive</label>
      <NumInput step="0.01" min="0" value={Number.isFinite(drive.volts) ? Number(drive.volts.toPrecision(6)) : null} disabled={locked}
        onCommit={(x) => setAmp('voltage', x)} />
      <label>V</label>
      <span className="tb-derived">{watts >= 100 ? watts.toFixed(0) : watts.toFixed(1)} W</span>
    </div>
  )
}

function SweepRange() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const locked = useStore(isLocked)
  return (
    <div className="tb-pill tb-group" title="Frequency sweep range">
      <label>Sweep</label>
      <NumInput value={settings.fmin} above="0" disabled={locked}
        validate={(v) => (v < settings.fmax ? null : 'Must be below the end frequency')}
        onCommit={(v) => updateSettings({ fmin: v })} />
      <label>–</label>
      <NumInput value={settings.fmax} above={settings.fmin} disabled={locked}
        onCommit={(v) => updateSettings({ fmax: v })} />
      <label>Hz</label>
    </div>
  )
}

function MaskingToggle() {
  const masking = useStore((s) => s.settings.masking)
  const updateSettings = useStore((s) => s.updateSettings)
  const locked = useStore(isLocked)
  return (
    <label className="tb-pill tb-group" title="Suppress chamber standing-wave resonances (lumped-compliance chambers)" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={masking} disabled={locked} onChange={(e) => updateSettings({ masking: e.target.checked })} />
      <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Mask resonances</span>
    </label>
  )
}

function SnapshotControl() {
  const store = useStore()
  const snapshots = readSnapshots(store.workspace)
  return (
    <div className="tb-pill">
      <button
        className="snap-btn"
        onClick={store.takeSnapshot}
        disabled={snapshots.length >= SNAPSHOT_LIMIT || !store.results?.ok}
        title={`Freeze the current result as a reference overlay, kept until you remove it (max ${SNAPSHOT_LIMIT})`}
      >Snapshot</button>
      {snapshots.map((s) => (
        <span key={s.id} className="snapshot-chip" title={s.project ? `From ${s.project}` : ''}>
          <span className="pi-dot" style={{ background: s.color }} />
          <input value={s.label} size={Math.max(4, s.label.length)} style={{ width: 'auto' }}
            onChange={(e) => store.renameSnapshot(s.id, e.target.value)} />
          <span className="x" title="Remove this snapshot" onClick={() => store.removeSnapshot(s.id)}>✕</span>
        </span>
      ))}
    </div>
  )
}

const CONTROLS = {
  undo: UndoRedo,
  voltage: VoltageControl,
  sweep: SweepRange,
  masking: MaskingToggle,
  snapshot: SnapshotControl,
}

const TITLES = {
  m_bw: 'Bandwidth between the −3 dB points',
  m_maxpower: 'Largest input before the cone reaches Xmax, and the voltage it takes',
  m_volume: 'Air enclosed by every chamber and duct',
  m_xf3: 'Cone excursion at F3, as a share of Xmax',
  m_xfb: 'Cone excursion at Fb, as a share of Xmax',
  m_zpeaks: 'Impedance peaks: frequency / magnitude',
}

function Metric({ id }) {
  const metrics = useStore((s) => s.metrics)
  const results = useStore((s) => s.results)
  const nodes = useStore((s) => s.nodes)
  const m = metricValue(id, { metrics, results, nodes })
  if (!m || m.value === '—') return null
  return (
    <div className="tb-metric" title={TITLES[id] || m.label}>
      <span className="m-label">{m.label}</span>
      <span className={`m-value ${m.bad ? 'bad' : ''}`}>{m.value}</span>
    </div>
  )
}

function MetricPill({ ids }) {
  const metrics = useStore((s) => s.metrics)
  const results = useStore((s) => s.results)
  const nodes = useStore((s) => s.nodes)
  const shown = ids.filter((id) => metricValue(id, { metrics, results, nodes })?.value !== '—')
  if (!shown.length) return null
  return <div className="tb-pill">{shown.map((id) => <Metric key={id} id={id} />)}</div>
}

export default function Toolbar() {
  const toolbar = useStore((s) => s.toolbar)

  const runs = []
  for (const id of toolbar) {
    const group = TOOLBAR_ITEMS[id]?.group
    const last = runs[runs.length - 1]
    if (last && last.group === group) last.ids.push(id)
    else runs.push({ group, ids: [id] })
  }

  return (
    <div className="toolbar">
      {runs.map((run) => (
        run.group === 'metrics' ? (
          <div className="tb-metrics" key={run.ids[0]}>
            {clusters(run.ids).map((ids) => <MetricPill key={ids[0]} ids={ids} />)}
          </div>
        ) : run.ids.map((id) => {
          const Control = CONTROLS[id]
          return Control ? <Control key={id} /> : null
        })
      ))}
    </div>
  )
}

export function clusters(ids) {
  const out = []
  for (const id of ids) {
    const c = TOOLBAR_ITEMS[id]?.cluster || id
    const last = out[out.length - 1]
    if (last && (TOOLBAR_ITEMS[last[0]]?.cluster || last[0]) === c) last.push(id)
    else out.push([id])
  }
  return out
}
