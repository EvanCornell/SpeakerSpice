import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { waveguideVolume } from '../engine/geometry'
import { basisOf, baselineOf, matchesBaseline, BASIS_SIZE } from '../driverParams'
import ExprInput from './ExprInput'
import NumInput from './NumInput'
import { useResolvedParams } from '../useResolved'
import { freshId } from '../schema/extras'
import { driverNominal, estimateNominal, fmtOhms } from '../schema/nominal'
import { baseName, nameNumbers, channelNames } from '../nodeNames'
import { mergeParams, plural } from '../groupEdit'
import { driverStatus } from '../schema/wires'
import { useDrive } from '../useDrive'
import DriveFields from './DriveFields'

const TIPS = {
  Fs: 'Free-air resonance frequency of the moving system.',
  Qts: 'Total Q at Fs combining mechanical and electrical damping.',
  Qes: 'Electrical Q at Fs — damping from the motor (Bl²/Re).',
  Qms: 'Mechanical Q at Fs — damping from suspension losses.',
  Vas: 'Volume of air with the same compliance as the suspension.',
  Re: 'DC resistance of the voice coil.',
  Bl: 'Motor force factor — force per ampere.',
  Mms: 'Total moving mass including air load.',
  Cms: 'Suspension compliance — displacement per newton.',
  Sd: 'Effective radiating piston area.',
  Le: 'Voice-coil inductance at 1 kHz.',
  LeExp: 'Semi-inductance exponent: 1 = pure inductor, ~0.6–0.7 with shorting rings.',
  Xmax: 'Linear excursion limit (one-way).',
  Znom: 'Nominal impedance of one voice coil — the rating the amplifier\'s watts are worked out against. The database\'s listed figure, else an estimate from Re and Qes; type one to override.',
  Rms: 'Mechanical resistance of the suspension.',
  leakQL: 'Box leakage as the familiar QL: lower = leakier. Compiled to the equivalent leak resistance at the reference frequency.',
  leakHz: 'Frequency QL is referred to — conventionally the box tuning.',
  loss: 'Scales the wall loss worked out from this duct’s size and shape: 1 is the physical estimate, 0 is lossless, above 1 adds loss the model misses.',
  count: 'Number of identical units.',
  wiring: 'Electrical wiring of the array — changes Re, Le and Bl of the equivalent driver.',
  volume: 'Internal net air volume.',
  length: 'Longest internal dimension — sets the first standing-wave frequency c/2L.',
  shape: 'Cross-section shape (affects higher-order mode onset).',
  stuffing: 'Fiber fill density: slows sound in the cavity and adds absorption.',
  S1: 'Throat (input) area.',
  S2: 'Mouth (output) area. Equal to S1 for a straight port.',
  flare: 'Area expansion law along the segment.',
  ecFactor: 'Scales the end corrections this duct gets. Those are worked out from what each end opens into — nearly 0.85·a into a box, nothing into a duct of its own area, and nothing into open air, where the radiation impedance already carries it. 1 leaves that alone.',
  Mmd: 'Moving mass of the passive radiator cone (without air load).',
  addedMass: 'Extra mass bolted to the cone to lower its resonance.',
  space: 'Solid angle the opening radiates into — boundary loading.',
  label: 'Display name for this node.',
}

const OPEN = {}

function useOpen(id, initial) {
  const [open, setOpen] = useState(OPEN[id] ?? initial)
  const toggle = () => { OPEN[id] = !open; setOpen(!open) }
  return [open, toggle]
}

const short = (v) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  if (Math.abs(n) >= 100) return String(Math.round(n))
  return String(Number(n.toPrecision(3)))
}

const Group = createContext(null)

const MIXED = 'Mixed'

const isMixed = (group, field) => !!group?.mixed.has(field)

const anyMixed = (group, ...fields) => fields.some((f) => isMixed(group, f))

function useEdit() {
  const group = useContext(Group)
  return useMemo(() => {
    const st = useStore.getState
    const fan = (name) => (id, ...args) => (group
      ? st().editGroup(group.ids, (gid) => st()[name](gid, ...args))
      : st()[name](id, ...args))
    return {
      updateParams: fan('updateParams'),
      setDriverParam: fan('setDriverParam'),
      setDriverLock: fan('setDriverLock'),
      setTaps: fan('setTaps'),
      restoreDriverParams: fan('restoreDriverParams'),
    }
  }, [group])
}

function Check({ checked, mixed = false, onChange }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <input ref={ref} type="checkbox" checked={!mixed && checked} onChange={onChange} />
}

function Section({ id, title, summary, color, focus, actions, initial = false, fixed = false, children }) {
  const [shut, toggle] = useOpen(id, initial)
  const open = fixed || shut
  return (
    <div className={`psec${open ? ' open' : ''}${focus ? ' focus' : ''}${fixed ? ' fixed' : ''}`} style={color ? { '--nc': color } : undefined}>
      <div className="psec-head" onClick={fixed ? undefined : toggle} role={fixed ? undefined : 'button'} aria-expanded={fixed ? undefined : open}>
        {!fixed && <span className="psec-twisty">{open ? '▾' : '▸'}</span>}
        {color && <span className="psec-dot" />}
        <span className="psec-title">{title}</span>
        {open && actions
          ? <span className="psec-actions" onClick={(e) => e.stopPropagation()}>{actions}</span>
          : <span className="psec-summary">{summary}</span>}
      </div>
      {open && <div className="psec-body">{children}</div>}
    </div>
  )
}

function Sub({ id, title, summary, initial = false, children }) {
  const [open, toggle] = useOpen(id, initial)
  return (
    <div className={`psub${open ? ' open' : ''}`}>
      <div className="psub-head" onClick={toggle} role="button" aria-expanded={open}>
        <span className="psec-twisty">{open ? '▾' : '▸'}</span>
        <span className="psec-title">{title}</span>
        <span className="psec-summary">{summary}</span>
      </div>
      {open && <div className="psub-body">{children}</div>}
    </div>
  )
}

function LockIcon({ closed }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.3" fill="currentColor" />
      <path d={closed ? 'M3.8 5.5V4a2.2 2.2 0 0 1 4.4 0v1.5' : 'M3.8 5.5V4a2.2 2.2 0 0 1 4.3-.7'} fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function NumField({ id, field, value, unit, label, step, min, above, onCommit }) {
  const { updateParams } = useEdit()
  const mixed = isMixed(useContext(Group), field)
  return (
    <div className={`param-row${mixed ? ' mixed' : ''}`}>
      <label title={TIPS[field] || ''}>{label || field}</label>
      <ExprInput
        value={mixed ? null : value}
        placeholder={mixed ? MIXED : undefined}
        step={step}
        min={min}
        above={above}
        onCommit={(v) => (onCommit ? onCommit(v) : updateParams(id, { [field]: v }))}
      />
      <span className="unit">{unit || ''}</span>
    </div>
  )
}

function SelectField({ id, field, value, label, options }) {
  const { updateParams } = useEdit()
  const mixed = isMixed(useContext(Group), field)
  return (
    <div className={`param-row wide${mixed ? ' mixed' : ''}`}>
      <label title={TIPS[field] || ''}>{label || field}</label>
      <select value={mixed ? MIXED : value} onChange={(e) => updateParams(id, { [field]: e.target.value })}>
        {mixed && <option value={MIXED} disabled>{MIXED}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <span className="unit" />
    </div>
  )
}

function LeakSection({ id, p }) {
  const { updateParams } = useEdit()
  const mixed = isMixed(useContext(Group), 'leakQL')
  const sealed = !mixed && !(Number(p.leakQL) > 0)
  return (
    <>
      <div className={`param-row wide${mixed ? ' mixed' : ''}`}>
        <label title={TIPS.leakQL}>Leakage QL</label>
        <NumInput
          step="1" min="1"
          value={sealed || mixed ? null : p.leakQL}
          placeholder={mixed ? MIXED : 'sealed'}
          disabled={sealed}
          onCommit={(v) => updateParams(id, { leakQL: v })}
        />
        <span className="unit">
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, cursor: 'pointer' }}>
            <Check checked={sealed} mixed={mixed} onChange={(e) => updateParams(id, { leakQL: e.target.checked ? null : 10 })} />sealed
          </label>
        </span>
      </div>
      {!sealed && <NumField id={id} field="leakHz" value={p.leakHz} label="QL at" unit="Hz" min="1" />}
    </>
  )
}

function LabelField({ id, p }) {
  const { updateParams } = useEdit()
  const group = useContext(Group)
  const mixed = isMixed(group, 'label')
  const num = useStore((s) => nameNumbers(s.nodes)[id])
  const name = useStore((s) => baseName(s.nodes.find((n) => n.id === id)))
  return (
    <>
      <div className={`param-row wide${mixed ? ' mixed' : ''}`}>
        <label title={TIPS.label}>Label</label>
        <input value={mixed ? '' : p.label || ''} placeholder={mixed ? MIXED : group ? '' : name} onChange={(e) => updateParams(id, { label: e.target.value })} />
        <span className="unit" />
      </div>
      {group ? (
        <div className="ts-hint wide">
          A name typed here goes to all {group.ids.length}; each is then told apart by its number.
        </div>
      ) : num ? (
        <div className="ts-hint wide name-note">
          Another component is also called “{name}”, so this one is shown
          as {name} <span className="name-num">#{num}</span> on the canvas and in charts. Give it its own name to drop the number.
        </div>
      ) : null}
    </>
  )
}

function NameNum({ id }) {
  const group = useContext(Group)
  const num = useStore((s) => nameNumbers(s.nodes)[id])
  return num && !group ? <span className="name-num">#{num}</span> : null
}

function AmpSolver() {
  const drive = useDrive()
  const setAmp = useStore((s) => s.setAmp)
  const updateSettings = useStore((s) => s.updateSettings)
  const ch = drive.channel
  const channel = useStore((s) => (ch ? channelNames(s.projectExtras.wiring.channels)[ch.id] : 'The first channel'))
  return (
    <Section
      id="amp" title="Amplifier"
      summary={`${short(drive.volts)} V · ${short(drive.ohms)} Ω · ${short(drive.watts)} W`}
      actions={<button onClick={() => useStore.getState().openWiring()}
        title={`${channel} — the channel the toolbar's drive level shows. Changing its voltage or power scales every channel together; each is set on its own in the Wiring window.`}>Wiring…</button>}
    >
      <DriveFields drive={drive} onSet={setAmp} rg={ch?.outputOhms} onRg={(v) => updateSettings({ rg: v })} />
    </Section>
  )
}

function SweepSection() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  return (
    <Section id="sweep" title="Sweep" fixed summary={`${short(settings.fmin)}–${short(settings.fmax)} Hz · ${settings.npts}`}>
      <div className="param-grid">
        <div className="param-row">
          <label title="Lowest frequency of the sweep">From</label>
          <NumInput above="0" value={settings.fmin}
            validate={(v) => (v < settings.fmax ? null : 'Must be below the end frequency')}
            onCommit={(v) => updateSettings({ fmin: v })} />
          <span className="unit">Hz</span>
        </div>
        <div className="param-row">
          <label title="Highest frequency of the sweep">To</label>
          <NumInput above={settings.fmin} value={settings.fmax}
            onCommit={(v) => updateSettings({ fmax: v })} />
          <span className="unit">Hz</span>
        </div>
        <div className="param-row">
          <label title="Frequencies solved across the sweep, spaced logarithmically">Points</label>
          <NumInput min="16" step="16" integer value={settings.npts}
            onCommit={(v) => updateSettings({ npts: v })} />
          <span className="unit" />
        </div>
        <label className="param-row" style={{ cursor: 'pointer' }}
          title="Suppress chamber standing-wave resonances (lumped-compliance chambers)">
          <input type="checkbox" checked={!!settings.masking} onChange={(e) => updateSettings({ masking: e.target.checked })} />
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Mask resonances</span>
        </label>
      </div>
    </Section>
  )
}

const round3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)

function TSField({ id, field, value, held, unit, step }) {
  const { setDriverParam, setDriverLock } = useEdit()
  const mixed = isMixed(useContext(Group), field)
  return (
    <div className={`param-row ts-row${held ? '' : ' derived'}${mixed ? ' mixed' : ''}`}>
      <button
        className={`ts-lock${held ? ' held' : ''}`}
        aria-pressed={held}
        aria-label={`${held ? 'Release' : 'Hold'} ${field}`}
        title={held
          ? `${field} is yours to set. Release it to let it follow the others.`
          : `${field} follows the others. Hold it to set it yourself.`}
        onClick={() => setDriverLock(id, field, !held)}
      ><LockIcon closed={held} /></button>
      <label title={TIPS[field] || ''}>{field}</label>
      <NumInput
        step={step}
        above="0"
        value={mixed ? null : value}
        placeholder={mixed ? MIXED : undefined}
        readOnly={!held}
        tabIndex={held ? undefined : -1}
        title={held ? '' : 'Derived from the held parameters — click the padlock to set it yourself'}
        onCommit={(v) => setDriverParam(id, field, v)}
      />
      <span className="unit">{unit || ''}</span>
    </div>
  )
}

const formTitle = (group, node, fallback) => (group
  ? `${group.ids.length} ${plural(node.type)}`
  : <>{node.data.params.label || fallback}<NameNum id={node.id} /></>)

function znomSource(p, baseline) {
  const listed = Number(baseline?.Znom) > 0 ? Number(baseline.Znom) : null
  const set = Number(p.Znom) > 0 ? Number(p.Znom) : null
  return { set, listed, source: set == null ? 'estimated' : set === listed ? 'listed' : 'entered' }
}

function ZnomField({ id, p, r, baseline }) {
  const { updateParams } = useEdit()
  const mixed = isMixed(useContext(Group), 'Znom')
  const z = znomSource(p, baseline)
  const { set, listed } = z
  const estimate = estimateNominal(r.Re, r.Qes)
  const source = mixed ? null : z.source === 'estimated' ? 'estimated from Re and Qes' : z.source
  const fallback = listed ?? estimate
  const differs = source === 'entered' && fallback > 0 && set !== fallback
  return (
    <div className={`param-row${mixed ? ' mixed' : ''}`}>
      <label title={`${TIPS.Znom}${source ? ` Now ${source}.` : ''}`}>
        {differs && <span className="override-dot"
          title={`Entered by hand — the ${listed ? 'listed figure' : 'estimate'} is ${fmtOhms(fallback)} Ω`} />}
        Nominal Z
      </label>
      <NumInput
        value={mixed ? null : set}
        placeholder={mixed ? MIXED : estimate > 0 ? fmtOhms(estimate) : ''}
        allowEmpty above="0" step="1"
        title={source ? `Nominal impedance, ${source}` : undefined}
        onCommit={(v) => updateParams(id, { Znom: v })}
      />
      <span className="unit">
        Ω
        {!mixed && source === 'entered' && (
          <button className="icon-btn" title={listed ? `Back to the listed ${fmtOhms(listed)} Ω` : 'Back to the estimate'}
            onClick={() => updateParams(id, { Znom: listed })}>↺</button>
        )}
      </span>
    </div>
  )
}

function DriverForm({ node }) {
  const p = node.data.params
  const id = node.id
  const group = useContext(Group)
  const setShowDriverDB = useStore((s) => s.setShowDriverDB)
  const setShowTSCalc = useStore((s) => s.setShowTSCalc)
  const setSaveDriverFor = useStore((s) => s.setSaveDriverFor)
  const { restoreDriverParams } = useEdit()
  const canRestore = useStore((s) => (group ? group.ids : [id])
    .map((gid) => s.nodes.find((n) => n.id === gid))
    .some((n) => n && baselineOf(n) != null && !matchesBaseline(n)))
  const basis = basisOf(node)
  const baseline = baselineOf(node)
  const ts = (field, unit, step) => (
    <TSField id={id} field={field} value={p[field]} held={basis.includes(field)} unit={unit} step={step} />
  )
  const nominal = driverNominal(p)
  const r = useResolvedParams(id, node.type, p)
  return (
    <Section
      id="driver" title={formTitle(group, node, 'Driver')} color="var(--s1)" focus fixed
      summary={`Fs ${short(p.Fs)} Hz · Qts ${short(p.Qts)}`}
      actions={<>
        <button onClick={() => setShowDriverDB(true)}
          title={group ? `Load a driver from the library into all ${group.ids.length}` : undefined}>Database</button>
        {!group && <button onClick={() => setShowTSCalc(true)}>T/S solver</button>}
      </>}
    >
      <div className="param-grid"><LabelField id={id} p={p} /></div>
      <div className="psec-caption">
        Core T/S
        <span className="psec-caption-note" title={`${BASIS_SIZE} of the T/S figures are yours to set; the rest follow. Click a padlock to change which.`}>
          {BASIS_SIZE} held · padlocks choose
        </span>
      </div>
      <div className="param-grid">
        {ts('Fs', 'Hz')}
        {ts('Qts', '', '0.01')}
        {ts('Vas', 'L')}
        {ts('Sd', 'cm²')}
        {ts('Bl', 'T·m')}
      </div>
      <div className="psec-caption">Electrical</div>
      <div className="param-grid">
        {ts('Re', 'Ω')}
        {ts('Qes', '', '0.01')}
        <NumField id={id} field="Le" value={p.Le} unit="mH" step="0.1" min="0" />
        <NumField id={id} field="LeExp" value={p.LeExp} label="Le exp." step="0.05" min="0.3" />
      </div>
      <div className="psec-caption">Mechanical</div>
      <div className="param-grid">
        {ts('Mms', 'g')}
        {ts('Cms', 'mm/N', '0.01')}
        {ts('Rms', 'kg/s', '0.1')}
        {ts('Qms', '', '0.1')}
      </div>
      <div className="psec-caption">
        Other
        {!isMixed(group, 'Znom') && <span className="psec-caption-note">nominal Z {znomSource(p, baseline).source}</span>}
      </div>
      <div className="param-grid">
        <ZnomField id={id} p={p} r={r} baseline={baseline} />
        <NumField id={id} field="Xmax" value={p.Xmax} unit="mm" above="0" />
      </div>
      <div className="psec-caption">
        Array & wiring
        <span className="psec-caption-note">{p.wiring === 'custom'
          ? `${short(p.count)}× · wired by hand`
          : Number.isFinite(nominal) && nominal > 0
            ? `${short(p.count)}× · ${fmtOhms(nominal)} Ω`
            : ''}</span>
      </div>
      <ArrayField id={id} p={p} />
      <div className="drv-actions">
        {!group && <button
          onClick={() => setSaveDriverFor(id)}
          title="Store these parameters in the workspace's driver library under a name you choose"
        >Save to library…</button>}
        <button
          disabled={!canRestore}
          onClick={() => restoreDriverParams(id)}
          title={group
            ? 'Put each driver\'s T/S parameters back to what it started as'
            : baseline
              ? 'Put every T/S parameter back to what this driver started as'
              : 'Nothing to restore — this driver has not been changed since it was loaded'}
        >Restore</button>
      </div>
    </Section>
  )
}

function ArrayField({ id, p }) {
  const { updateParams } = useEdit()
  const group = useContext(Group)
  const mixed = isMixed(group, 'wiring')
  const count = Number(p.count) || 1
  const other = !mixed && (p.wiring === 'series-parallel' || p.wiring === 'custom')
  const on = useStore((s) => {
    if (group) return null
    const st = driverStatus(s.projectExtras.wiring, s.nodes).get(id)
    const shown = channelNames(s.projectExtras.wiring.channels)
    const names = (st?.channels || []).map((c) => shown[c] || c)
    return names.join(' and ')
  })
  const seg = (v, label) => (
    <button className={!mixed && p.wiring === v && count > 1 ? 'on' : ''} aria-pressed={!mixed && p.wiring === v}
      disabled={count < 2 && !group} onClick={() => updateParams(id, { wiring: v })}>{label}</button>
  )
  return (
    <>
      <div className="param-grid">
        <NumField id={id} field="count" value={p.count} label="Drivers" step="1" min="1" />
        <div className={`param-row seg-row${mixed ? ' mixed' : ''}`} title="How the drivers in this node are joined to each other">
          {seg('series', 'Series')}
          {seg('parallel', 'Parallel')}
        </div>
      </div>
      <div className="ts-hint">
        {other && <>{p.wiring === 'custom' ? 'Wired coil by coil' : 'Series-parallel'} — set in the Wiring window. </>}
        {p.dvc && !group && <>Dual voice coils, {p.wiring === 'custom' ? 'each wired by hand' : `in ${p.dvc.coils === 'one' ? 'one coil only' : p.dvc.coils}`}. </>}
        {!group && (on ? <>On <b>{on}</b>. </> : <>Not wired to a channel. </>)}
        Dual voice coils, other arrangements and the channels:{' '}
        <a href="#" onClick={(e) => { e.preventDefault(); useStore.getState().openWiring(group ? undefined : id) }}>Wiring window</a>.
      </div>
    </>
  )
}

function NodeWarnings({ node }) {
  const warns = useStore((s) => s.results?.validation?.warnings?.[node.id])
  const insert = useStore((s) => s.insertThroatChamber)
  if (!warns?.length) return null
  return (
    <div className="panel-section node-warnings">
      {warns.map((w, i) => {
        const face = node.type === 'driver' && /throat chamber/.test(w) ? (/^The front/.test(w) ? 'front' : 'rear') : null
        return (
          <div key={i} className="node-warning">
            <span className="warn-dot" /> {w}
            {face && <div><button onClick={() => insert(node.id, face)}>Insert a throat chamber</button></div>}
          </div>
        )
      })}
    </div>
  )
}

function TapsSection({ id, p, from }) {
  const group = useContext(Group)
  const { setTaps } = useEdit()
  const addProbe = useStore((s) => s.addProbe)
  const taps = p.taps || []
  if (isMixed(group, 'taps')) {
    return (
      <Sub id="taps" title="Taps" summary="differ">
        <div className="ts-hint">
          The selected nodes have different taps, so they are edited one at a
          time. Select a single node to change its taps.
        </div>
      </Sub>
    )
  }
  return (
    <Sub id={`taps`} title="Taps" summary={taps.length ? taps.map((t) => `${t.id} ${short(t.position)}`).join(' · ') : 'none'}>
      <div className="ts-hint" title="Points along the line where anything may join it — a driver, a port, another chamber. Each shows as a handle on the node's right side.">
        Points where something may join partway along, in cm from the {from} end.
      </div>
      {taps.map((t, i) => (
        <div className="param-row tap-row" key={t.id}>
          <label title={`Tap ${t.id}: its handle is tap:${t.id}`}>{t.id}</label>
          <ExprInput value={t.position} min={0} onCommit={(v) => setTaps(id, taps.map((x, k) => (k === i ? { ...x, position: v } : x)))} title={`cm from the ${from} end`} />
          <span className="unit">
            cm
            {!group && <button className="icon-btn" title="Add a pressure probe at this tap" onClick={() => addProbe({ kind: 'pressure', label: `${p.label || id} ${t.id}`, at: { node: id, handle: `tap:${t.id}` } })}>◎</button>}
            <button className="icon-btn" title="Remove this tap and anything joined to it" onClick={() => setTaps(id, taps.filter((x) => x.id !== t.id))}>✕</button>
          </span>
        </div>
      ))}
      <div className="drv-actions">
        <button onClick={() => {
          const tid = freshId('t', taps.map((t) => t.id))
          setTaps(id, [...taps, { id: tid, position: Math.round((Number(p.length) || 0) / 2) || 1 }])
        }}>+ Tap</button>
      </div>
    </Sub>
  )
}

function ThroatCalc({ id }) {
  const updateParams = useStore((s) => s.updateParams)
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const joined = edges
    .filter((e) => e.source === id || e.target === id)
    .map((e) => nodes.find((n) => n.id === (e.source === id ? e.target : e.source)))
    .find((n) => n?.type === 'driver')
  const dp = joined?.data.params || {}
  const [sd, setSd] = useState(Number(dp.Sd) * Math.max(1, Number(dp.count) || 1) || 500)
  const [depth, setDepth] = useState(60)
  const [shape, setShape] = useState('cone')
  const [xmax, setXmax] = useState(Number(dp.Xmax) || 15)
  const [gap, setGap] = useState(5)
  const factor = { cone: 1 / 3, curved: 0.45, flat: 0 }[shape]
  const litres = (sd * 1e-4) * ((depth * factor + xmax + gap) * 1e-3) * 1000
  const row = (label, v, set, unit) => (
    <div className="param-row">
      <label>{label}</label>
      <NumInput value={v} min="0" onCommit={set} />
      <span className="unit">{unit}</span>
    </div>
  )
  return (
    <Sub id="throatcalc" title="Throat chamber calculator" summary={`${litres.toFixed(2)} L trapped`}>
      <div className="ts-hint">The air trapped between a cone and a smaller opening in front of it.</div>
      <div className="param-grid">
        {row('Cone area', sd, setSd, 'cm²')}
        {row('Depth', depth, setDepth, 'mm')}
        {row('Excursion', xmax, setXmax, 'mm')}
        {row('Clearance', gap, setGap, 'mm')}
        <div className="param-row wide">
          <label>Cone shape</label>
          <select value={shape} onChange={(e) => setShape(e.target.value)}>
            <option value="cone">Straight cone (⅓ of depth)</option>
            <option value="curved">Curved cone (~0.45)</option>
            <option value="flat">Flat piston</option>
          </select>
        </div>
      </div>
      <div className="drv-actions" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', padding: '0 4px' }}>Trapped air <b className="node-readout">{litres.toFixed(2)} L</b></span>
        <button style={{ marginLeft: 'auto' }} onClick={() => updateParams(id, { volume: Number(litres.toFixed(3)) })}>Set as volume</button>
      </div>
    </Sub>
  )
}

function ChamberForm({ node }) {
  const p = node.data.params
  const id = node.id
  const group = useContext(Group)
  const r = useResolvedParams(id, node.type, p)
  return (
    <Section id="chamber" title={formTitle(group, node, 'Chamber')} color="var(--s2)" focus initial
      summary={group ? '' : `${short(r.volume)} L · ${short(r.length)} cm`}>
      <div className="param-grid">
        <LabelField id={id} p={p} />
        <NumField id={id} field="volume" value={p.volume} label="Volume" unit="L" above="0" />
        <NumField id={id} field="length" value={p.length} label="Length" unit="cm" above="0" />
        <SelectField id={id} field="shape" value={p.shape} options={[['rectangular', 'Rectangular'], ['cylindrical', 'Cylindrical']]} />
        <NumField id={id} field="stuffing" value={p.stuffing} label="Stuffing" unit="g/L" min="0" />
        <LeakSection id={id} p={p} />
      </div>
      <TapsSection id={id} p={p} from="in" />
      <ProbeSection id={id} p={p} />
      {!group && <ThroatCalc id={id} />}
      <div className="ts-hint">
        Typical QL: 5–10 for a leaky box or car door, 15+ for a well-sealed enclosure.
        {!anyMixed(group, 'length') && Number(r.length) > 0 && <> First standing wave at c/2L = {(344 / (2 * r.length / 100)).toFixed(0)} Hz.</>}
        {' '}An end with nothing joined to it is a closed wall.
      </div>
    </Section>
  )
}

function ProbeSection({ id, p }) {
  const { updateParams } = useEdit()
  const group = useContext(Group)
  const mixed = isMixed(group, 'probe')
  return (
    <Sub id="probe" title="Interior SPL probe" summary={mixed ? 'mixed' : p.probe ? `on · ${p.probePos ?? 100}%` : 'off'}>
      <label className="param-row" style={{ cursor: 'pointer' }}
        title="Report SPL inside this volume (virtual microphone). Shows on the Interior SPL chart tab.">
        <Check checked={!!p.probe} mixed={mixed} onChange={(e) => updateParams(id, { probe: e.target.checked })} />
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>SPL probe (mic inside)</span>
      </label>
      {p.probe && (
        <>
          <div className="param-row">
            <label title="Microphone station along the chamber's acoustic length: 0% = inlet, 100% = far wall. Irrelevant below the first standing wave (uniform pressure field), decisive near the axial modes.">
              Mic position
            </label>
            <input
              type="range" min="0" max="100" step="5"
              value={p.probePos ?? 100}
              onChange={(e) => updateParams(id, { probePos: parseFloat(e.target.value) })}
            />
            <span className="unit" style={{ minWidth: 34, textAlign: 'right' }}>{isMixed(group, 'probePos') ? MIXED : `${p.probePos ?? 100}%`}</span>
          </div>
          <div className="ts-hint">
            Uniform below c/2L (cabin-gain region); position matters at the standing-wave modes.
          </div>
        </>
      )}
    </Sub>
  )
}

function WaveguideForm({ node }) {
  const p = node.data.params
  const id = node.id
  const group = useContext(Group)
  const r = useResolvedParams(id, node.type, p)
  const vol = waveguideVolume(r.flare, r.S1 * 1e-4, r.S2 * 1e-4, r.length / 100) * 1000
  return (
    <Section id="waveguide" title={formTitle(group, node, 'Waveguide')} color="var(--s3)" focus initial
      summary={group ? '' : `${short(r.S1)}→${short(r.S2)} cm² · ${short(r.length)} cm`}>
      <div className="param-grid">
        <LabelField id={id} p={p} />
        <NumField id={id} field="S1" value={p.S1} label="S1 throat" unit="cm²" above="0" />
        <NumField id={id} field="S2" value={p.S2} label="S2 mouth" unit="cm²" above="0" />
        <NumField id={id} field="length" value={p.length} label="Length" unit="cm" above="0" />
        <NumField id={id} field="loss" value={p.loss} label="Wall loss ×" step="0.1" min="0" />
        <SelectField id={id} field="flare" value={p.flare} label="Flare" options={[
          ['conical', 'Conical'], ['exponential', 'Exponential'], ['parabolic', 'Parabolic'],
          ['hypex', 'Hyperbolic-exp (hypex)'], ['tractrix', 'Tractrix ≈'], ['lecleach', 'Le Cléac’h ≈'],
        ]} />
      </div>
      <Sub id="waveguide.ends" title="Ends" summary={`end corr. ×${short(p.ecFactor)}`}>
        <div className="param-grid">
          <NumField id={id} field="ecFactor" value={p.ecFactor} label="End corr. ×" step="0.05" min="0" />
        </div>
        <div className="ts-hint">
          End corrections come from what each end meets, so splitting a duct into
          several segments does not change it. An end with nothing connected
          radiates into half space; connect a Radiation node to it for another
          space, a closed end or an anechoic one.
        </div>
      </Sub>
      <TapsSection id={id} p={p} from="throat" />
      <div className="ts-hint">
        {!anyMixed(group, 'flare', 'S1', 'S2', 'length') && Number.isFinite(vol) && <>Internal volume <b className="node-readout">{vol.toFixed(2)} L</b>. </>}Set S1 = S2 for a straight port.
      </div>
    </Section>
  )
}

function PRForm({ node }) {
  const p = node.data.params
  const id = node.id
  const group = useContext(Group)
  const { updateParams } = useEdit()
  const [calcOpen, setCalcOpen] = useState(false)
  const [calcFs, setCalcFs] = useState(30)
  const r = useResolvedParams(id, node.type, p)
  const m = (r.Mmd + (r.addedMass || 0)) / 1000
  const fs = anyMixed(group, 'Mmd', 'Cms', 'addedMass') ? NaN : 1 / (2 * Math.PI * Math.sqrt(Math.max(m * (r.Cms / 1000), 1e-12)))
  return (
    <Section id="pr" title={formTitle(group, node, 'Passive radiator')} color="var(--s4)" focus initial
      summary={group ? '' : `Fs ${fs.toFixed(1)} Hz · ${short(r.count)}×`}>
      <div className="param-grid">
        <LabelField id={id} p={p} />
        <NumField id={id} field="Mmd" value={p.Mmd} unit="g" above="0" />
        <div onDoubleClick={() => setCalcOpen(!calcOpen)} title="Double-click to derive Cms from a target Fs" style={{ display: 'contents' }}>
          <NumField id={id} field="Cms" value={p.Cms} unit="mm/N" step="0.01" above="0" />
        </div>
        <NumField id={id} field="Rms" value={p.Rms} unit="kg/s" step="0.1" min="0" />
        <NumField id={id} field="Sd" value={p.Sd} unit="cm²" above="0" />
        <NumField id={id} field="addedMass" value={p.addedMass} label="Added mass" unit="g" min="0" />
        <NumField id={id} field="count" value={p.count} label="Units" step="1" min="1" />
      </div>
      {Number.isFinite(fs) && <>
      <Sub id="pr.tune" title="Tune to a resonance" summary={`now ${fs.toFixed(1)} Hz`} initial={calcOpen}>
        <div className="param-grid">
          <div className="param-row">
            <label>Target Fs</label>
            <NumInput value={calcFs} above="0" onCommit={setCalcFs} />
            <span className="unit">Hz</span>
          </div>
          <button onClick={() => {
            if (calcFs > 0) {
              const cms = 1 / (Math.pow(2 * Math.PI * calcFs, 2) * (r.Mmd / 1000)) * 1000
              updateParams(id, { Cms: Math.round(cms * 1000) / 1000 })
              setCalcOpen(false)
            }
          }} title="Cms = 1/((2πFs)²·Mmd)">Set Cms</button>
        </div>
      </Sub>
      <div className="ts-hint">Resonance as configured: <b className="node-readout">{fs.toFixed(1)} Hz</b></div>
      </>}
    </Section>
  )
}

function RadiationForm({ node }) {
  const p = node.data.params
  const id = node.id
  const SPACES = [
    ['free', 'Free space (4π sr)'], ['half', 'Half space (2π sr)'],
    ['quarter', 'Quarter space (π sr)'], ['eighth', 'Eighth space (π/2 sr)'],
    ['rigid', 'Rigid wall (reflective)'], ['anechoic', 'Anechoic (absorbing)'],
  ]
  return (
    <Section id="radiation" title={formTitle(useContext(Group), node, 'Radiation')} color="var(--s5)" focus initial
      summary={SPACES.find(([k]) => k === p.space)?.[1] ?? p.space ?? MIXED}>
      <div className="param-grid">
        <LabelField id={id} p={p} />
        <SelectField id={id} field="space" value={p.space} label="Boundary" options={SPACES} />
      </div>
      <div className="ts-hint">
        Applies circular-piston radiation impedance for the chosen solid angle.
        Rigid = perfect reflection; anechoic = ρc termination, no reflection.
      </div>
    </Section>
  )
}

const FORMS = { driver: DriverForm, chamber: ChamberForm, waveguide: WaveguideForm, pr: PRForm, radiation: RadiationForm }

function useSelectionGroup(key) {
  const ids = useMemo(() => (key ? key.split('|') : []), [key])
  const nodes = useStore((s) => s.nodes)
  const prev = useRef([])
  const now = nodes.filter((n) => ids.includes(n.id))
  const picked = now.length === prev.current.length && now.every((n, i) => n === prev.current[i]) ? prev.current : now
  prev.current = picked
  return useMemo(() => {
    if (picked.length < 2) return { group: null, node: null, kinds: [] }
    const kinds = [...new Set(picked.map((n) => n.type))]
    if (kinds.length > 1) return { group: null, node: null, kinds }
    const { params, mixed, locks } = mergeParams(picked)
    const last = picked[picked.length - 1]
    return {
      group: { ids: picked.map((n) => n.id), mixed },
      node: { id: last.id, type: last.type, data: { params, ...(locks ? { locks } : {}) } },
      kinds,
    }
  }, [picked])
}

export default function ParamPanel() {
  const node = useStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId))
  const selKey = useStore((s) => s.nodes.filter((n) => n.selected).map((n) => n.id).join('|'))
  const { group, node: merged, kinds } = useSelectionGroup(selKey)
  let body
  if (group) {
    const Form = FORMS[merged.type]
    body = (
      <Group.Provider value={group}>
        <Form node={merged} key={selKey} />
      </Group.Provider>
    )
  } else if (kinds.length > 1) {
    body = (
      <div className="ph-empty">
        {selKey.split('|').length} nodes of different kinds are selected
        ({kinds.map((k) => plural(k)).join(', ')}). Select nodes of one kind to
        edit them together.
      </div>
    )
  } else {
    const Form = node ? FORMS[node.type] : null
    body = (
      <>
        {node && <NodeWarnings node={node} key={`w_${node.id}`} />}
        {Form
          ? <Form node={node} key={node.id} />
          : <div className="ph-empty">
              Select an element on the canvas to edit it here.
            </div>}
      </>
    )
  }
  return (
    <div className="panel-scroll">
      <AmpSolver />
      {body}
      <SweepSection />
    </div>
  )
}

export const __internals = { round3 }
