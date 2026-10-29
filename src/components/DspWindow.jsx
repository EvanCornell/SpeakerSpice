import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, isLocked } from '../store'
import NumInput from './NumInput'
import { LockNote } from './Records'
import PlotChart, { logTicks, tickText } from './PlotChart'
import { displayNames, channelNames } from '../nodeNames'
import { colorsOf } from '../channelColors'
import { fitLevels, fitFromZero, fitLog } from '../chartFit'
import { toolbarChannel } from '../schema/wires'
import {
  normalizeDsp, dspResponse, dspFilters, isFlat, PASS_SLOPES, PASS_LABELS, BAND_TYPES, GAINED, DEFAULT_DSP,
} from '../schema/dsp'

const F_LO = 10
const F_HI = 20000
const GAIN_MAX = 24
const CURVE_POINTS = 320
const BAND_COLORS = ['#e8915a', '#9a9a2e', '#2f9e4a', '#3f86d6', '#a052d6', '#e0435c', '#2fa7a0', '#c77d2b']
const CHARTS = [
  ['transfer', 'Transfer function'], ['response', 'Response'], ['excursion', 'Excursion'],
  ['velocity', 'Port velocity'], ['power', 'Power'], ['impedance', 'Impedance'],
]

const curveFreqs = (f0, f1) => Array.from({ length: CURVE_POINTS }, (_, i) => f0 * Math.pow(f1 / f0, i / (CURVE_POINTS - 1)))

function useSweep() {
  const f0 = useStore((s) => Number(s.settings?.fmin) || 10)
  const f1 = useStore((s) => Number(s.settings?.fmax) || 1000)
  return f1 > f0 ? [f0, f1] : [10, 1000]
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

const roundHz = (hz) => Number(hz.toPrecision(3))

const hzText = (hz) => (hz >= 1000 ? `${Number((hz / 1000).toPrecision(3))} kHz` : `${Number(hz.toPrecision(3))} Hz`)

const clone = (v) => JSON.parse(JSON.stringify(v))

export function dspSummary(d) {
  const parts = []
  if (d.hpf.on) parts.push(`HP ${roundHz(d.hpf.hz)}`)
  if (d.lpf.on) parts.push(`LP ${roundHz(d.lpf.hz)}`)
  if (d.lt.on) parts.push('LT')
  const bands = d.peq.filter((b) => b.on).length
  if (bands) parts.push(`${bands} EQ`)
  if (Number(d.gainDb)) parts.push(`${d.gainDb > 0 ? '+' : ''}${Number(d.gainDb.toFixed(1))} dB`)
  if (Number(d.delayMs) > 0) parts.push(`${Number(Number(d.delayMs).toFixed(2))} ms`)
  const what = parts.length ? parts.join(' · ') : 'flat'
  return d.on === false ? `off · ${what}` : what
}

const bandY = (b) => (GAINED.has(b.type) ? b.db : 0)

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function TransferChart({ channels, index, dsp, change, band, setBand, overlay, locked }) {
  const box = useRef(null)
  const { w, h } = useSize(box)
  const [hover, setHover] = useState(null)
  const [held, setHeld] = useState(null)
  const [F0, F1] = useSweep()
  const freqs = useMemo(() => curveFreqs(F0, F1), [F0, F1])
  const phase = overlay === 'phase'
  const output = useStore((s) => (overlay === 'output' ? s.results : null))
  const pad = { l: 40, r: overlay ? 44 : 14, t: 12, b: 24 }
  const pw = Math.max(1, w - pad.l - pad.r)
  const ph = Math.max(1, h - pad.t - pad.b)
  const X = (f) => pad.l + (Math.log(f / F0) / Math.log(F1 / F0)) * pw
  const Y = (db) => pad.t + ((DB_HI - clamp(db, DB_LO - 10, DB_HI + 10)) / (DB_HI - DB_LO)) * ph
  const fAt = (x) => F0 * Math.pow(F1 / F0, (x - pad.l) / pw)
  const dbAt = (y) => DB_HI - ((y - pad.t) / ph) * (DB_HI - DB_LO)

  const curves = useMemo(() => channels.map((c) => dspResponse(normalizeDsp(c.dsp), freqs)), [channels, freqs])
  const mine = useMemo(() => dspResponse(dsp, freqs), [dsp, freqs])
  const bandCurve = useMemo(() => {
    const b = dsp.peq.find((x) => x.id === band)
    return b ? dspResponse({ ...DEFAULT_DSP, peq: [{ ...b, on: true }] }, freqs, { pass: false }) : null
  }, [dsp, band, freqs])
  const fitted = useMemo(() => fitLevels(
    [...curves.map((c) => c.db), dsp.peq.filter((b) => b.hz >= F0 && b.hz <= F1).map(bandY)],
    { include: [0] },
  ), [curves, dsp, F0, F1])
  const [DB_LO, DB_HI] = held || fitted
  const out = useMemo(() => {
    if (!output?.freqs?.length) return null
    const pts = output.freqs.map((f, i) => [f, output.splCombined[i]]).filter(([f, v]) => f >= F0 * (1 - 1e-9) && f <= F1 * (1 + 1e-9) && Number.isFinite(v))
    if (!pts.length) return null
    const top = Math.ceil((Math.max(...pts.map((p) => p[1])) + 1.5) / 5) * 5
    return { pts, shift: top - DB_HI }
  }, [output, F0, F1, DB_HI])
  const path = (ys, yOf, wrap = false) => ys.map((v, i) => {
    const lift = i === 0 || (wrap && Math.abs(v - ys[i - 1]) > 180)
    return `${lift ? 'M' : 'L'}${X(freqs[i]).toFixed(1)} ${yOf(v).toFixed(1)}`
  }).join('')
  const Yp = (p) => pad.t + ((180 - p) / 360) * ph

  const drag = (e, apply) => {
    if (locked) return
    e.preventDefault()
    e.stopPropagation()
    const rect = box.current.getBoundingClientRect()
    const range = [DB_LO, DB_HI]
    setHeld(range)
    let first = true
    const move = (ev) => {
      const hz = roundHz(clamp(fAt(ev.clientX - rect.left), F0, F1))
      const db = Math.round(clamp(dbAt(ev.clientY - rect.top), Math.max(-GAIN_MAX, range[0]), Math.min(GAIN_MAX, range[1])) * 10) / 10
      const next = clone(dsp)
      apply(next, hz, db)
      change(next, first)
      first = false
    }
    const up = () => {
      setHeld(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const wheel = (e, b) => {
    if (locked) return
    const next = clone(dsp)
    const t = next.peq.find((x) => x.id === b.id)
    t.q = Number(clamp(t.q * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.1, 20).toPrecision(3))
    change(next, true)
  }

  const add = (e) => {
    if (locked || e.target.closest('.dsp-handle')) return
    const rect = box.current.getBoundingClientRect()
    const next = clone(dsp)
    const id = freshBandId(next.peq)
    next.peq.push({ id, on: true, type: 'peak', hz: roundHz(clamp(fAt(e.clientX - rect.left), F0, F1)), db: Math.round(clamp(dbAt(e.clientY - rect.top), -GAIN_MAX, GAIN_MAX) * 10) / 10, q: 2 })
    change(next, true)
    setBand(id)
  }

  const hpLevel = dsp.hpf.shape === 'linkwitz-riley' ? -6 : -3
  const lpLevel = dsp.lpf.shape === 'linkwitz-riley' ? -6 : -3
  const span = DB_HI - DB_LO
  const dbGrid = []
  for (let v = DB_LO; v <= DB_HI; v += span > 60 ? 10 : 5) dbGrid.push(v)
  const labelEvery = span > 30 ? 10 : 5
  const fGrid = []
  for (let e = Math.floor(Math.log10(F0)); e <= Math.ceil(Math.log10(F1)); e++) for (let m = 1; m < 10; m++) { const f = m * 10 ** e; if (f >= F0 * (1 - 1e-9) && f <= F1 * (1 + 1e-9)) fGrid.push(f) }
  return (
    <div className="dsp-plot" ref={box}
      onDoubleClick={add}
      onPointerMove={(e) => { const r = box.current.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top; setHover(x > pad.l && x < pad.l + pw && y > pad.t && y < pad.t + ph ? { f: fAt(x), db: dbAt(y) } : null) }}
      onPointerLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={h} className="dsp-svg">
          {fGrid.map((f) => <line key={`f${f}`} x1={X(f)} x2={X(f)} y1={pad.t} y2={pad.t + ph} className={/^[125]0*$/.test(String(f)) ? 'dsp-grid major' : 'dsp-grid'} />)}
          {dbGrid.map((v) => <line key={`d${v}`} x1={pad.l} x2={pad.l + pw} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'dsp-grid zero' : v % 10 === 0 ? 'dsp-grid major' : 'dsp-grid'} />)}
          {dbGrid.filter((v) => v % labelEvery === 0).map((v) => <text key={`t${v}`} x={pad.l - 6} y={Y(v) + 3.5} className="dsp-tick" textAnchor="end">{v === 0 ? '0 dB' : tickText(v)}</text>)}
          {logTicks(F0, F1).map((f) => <text key={`x${f}`} x={X(f)} y={pad.t + ph + 16} className="dsp-tick" textAnchor="middle">{tickText(f)}</text>)}
          {out && dbGrid.filter((v) => v % labelEvery === 0).map((v) => <text key={`o${v}`} x={pad.l + pw + 6} y={Y(v) + 3.5} className="dsp-tick output">{tickText(v + out.shift)}</text>)}
          {out && <text x={pad.l + pw + 6} y={pad.t - 2} className="dsp-tick output">SPL</text>}
          {phase && [-180, -90, 0, 90, 180].map((p) => <text key={`p${p}`} x={pad.l + pw + 6} y={Yp(p) + 3.5} className="dsp-tick phase">{`${p}°`}</text>)}
          <clipPath id="dsp-clip"><rect x={pad.l} y={pad.t} width={pw} height={ph} /></clipPath>
          <g clipPath="url(#dsp-clip)">
            {curves.map((c, i) => (i === index ? null : <path key={channels[i].id} d={path(c.db, Y)} stroke={colorsOf(i)[0]} className={`dsp-curve other${channels[i].dsp?.on === false ? ' off' : ''}`} />))}
            {bandCurve && <path d={path(bandCurve.db, Y)} className="dsp-curve band" />}
            {phase && <path d={path(mine.phase, Yp, true)} stroke={colorsOf(index)[0]} className="dsp-curve phase" />}
            {out && <path d={out.pts.map(([f, v], i) => `${i ? 'L' : 'M'}${X(f).toFixed(1)} ${Y(v - out.shift).toFixed(1)}`).join('')} className="dsp-curve output" />}
            <path d={path(mine.db, Y)} className={`dsp-curve mine${dsp.on === false ? ' off' : ''}`} />
          </g>
          {dsp.hpf.on && (
            <g className={`dsp-handle pass${dsp.hpf.hz < F0 || dsp.hpf.hz > F1 ? ' edge' : ''}`} transform={`translate(${X(clamp(dsp.hpf.hz, F0, F1))} ${Y(hpLevel)})`}
              onPointerDown={(e) => drag(e, (n, hz) => { n.hpf.hz = hz })}>
              <title>{`High-pass ${hzText(dsp.hpf.hz)} — drag to move`}</title>
              <circle r="9" /><text y="3.5" textAnchor="middle">H</text>
            </g>
          )}
          {dsp.lpf.on && (
            <g className={`dsp-handle pass${dsp.lpf.hz < F0 || dsp.lpf.hz > F1 ? ' edge' : ''}`} transform={`translate(${X(clamp(dsp.lpf.hz, F0, F1))} ${Y(lpLevel)})`}
              onPointerDown={(e) => drag(e, (n, hz) => { n.lpf.hz = hz })}>
              <title>{`Low-pass ${hzText(dsp.lpf.hz)} — drag to move`}</title>
              <circle r="9" /><text y="3.5" textAnchor="middle">L</text>
            </g>
          )}
          {dsp.peq.map((b, i) => (
            <g key={b.id} className={`dsp-handle${b.id === band ? ' sel' : ''}${b.on ? '' : ' off'}${b.hz < F0 || b.hz > F1 ? ' edge' : ''}`}
              transform={`translate(${X(clamp(b.hz, F0, F1))} ${Y(bandY(b))})`}
              onPointerDown={(e) => { setBand(b.id); drag(e, (n, hz, db) => { const t = n.peq.find((x) => x.id === b.id); t.hz = hz; if (GAINED.has(t.type)) t.db = db }) }}
              onWheel={(e) => wheel(e, b)}>
              <title>{`Band ${i + 1}: ${hzText(b.hz)}${GAINED.has(b.type) ? `, ${b.db} dB` : ''}, Q ${b.q} — drag to move, scroll for Q`}</title>
              <circle r="9" style={{ fill: BAND_COLORS[i % BAND_COLORS.length] }} />
              <text y="3.5" textAnchor="middle">{i + 1}</text>
            </g>
          ))}
        </svg>
      )}
      {hover && <div className="dsp-readout">{hzText(hover.f)} · {hover.db.toFixed(1)} dB</div>}
      {!dsp.peq.length && !locked && <div className="dsp-hint">Double-click to add an EQ band</div>}
    </div>
  )
}

function freshBandId(peq) {
  let i = peq.length + 1
  while (peq.some((b) => b.id === `b${i}`)) i++
  return `b${i}`
}

function ResultChart({ kind, channels, selected }) {
  const results = useStore((s) => s.results)
  const nodes = useStore((s) => s.nodes)
  const vThreshold = useStore((s) => Number(s.settings?.vThreshold) || 17)
  const names = useMemo(() => displayNames(nodes), [nodes])
  if (!results?.freqs?.length) return <div className="dsp-empty">No results yet.</div>
  const x = results.freqs
  const chIndex = new Map(channels.map((c, i) => [c.id, i]))
  const series = (i) => `var(--c${(i % 6) + 1})`
  let props
  if (kind === 'response') {
    const lines = [{ key: 'all', name: 'Combined', color: series(0), x, y: results.splCombined, width: 2 }]
    if (results.splDriver?.some((v) => v != null)) lines.push({ key: 'drv', name: 'Drivers', color: series(1), x, y: results.splDriver.map((v) => v ?? NaN) })
    Object.entries(results.splPorts || {}).forEach(([k, y], i) => lines.push({ key: k, name: names[k.split(':')[0]] || k, color: series(i + 2), x, y: y.map((v) => v ?? NaN) }))
    props = { title: 'SPL at 1 m', ylabel: 'dB', series: lines, yDomain: fitLevels(lines.map((l) => l.y), { span: 50, minSpan: 20 }) }
  } else if (kind === 'excursion') {
    const ids = Object.keys(results.excursionByDriver || {})
    props = {
      title: 'Cone excursion, peak', ylabel: 'mm',
      series: ids.map((id, i) => ({ key: id, name: names[id] || id, color: series(i), x, y: results.excursionByDriver[id] })),
      refs: ids.map((id, i) => ({ y: results.xmaxByDriver[id], label: ids.length > 1 ? `Xmax ${names[id] || id}` : 'Xmax', color: ids.length > 1 ? series(i) : 'var(--red)' })).filter((r) => r.y > 0),
      yDomain: fitFromZero(ids.map((id) => results.excursionByDriver[id]), ids.map((id) => results.xmaxByDriver[id])),
    }
  } else if (kind === 'velocity') {
    const ids = Object.keys(results.velocity || {})
    if (!ids.length) return <div className="dsp-empty">No ports or waveguides in this design.</div>
    props = {
      title: 'Port air velocity, peak', ylabel: 'm/s',
      series: ids.map((id, i) => ({ key: id, name: names[id] || id, color: series(i), x, y: results.velocity[id] })),
      refs: [{ y: vThreshold, label: `turbulence ~${vThreshold} m/s` }],
      yDomain: fitFromZero(ids.map((id) => results.velocity[id]), [vThreshold]),
    }
  } else if (kind === 'power') {
    const ids = Object.keys(results.powerByChannel || {})
    props = {
      title: 'Electrical power into the load, per channel', ylabel: 'W', logY: true,
      series: ids.map((id) => ({ key: id, name: results.powerByChannel[id].label, color: colorsOf(chIndex.get(id) ?? -1)[0], x, y: results.powerByChannel[id].values.map((v) => (v > 1e-9 ? v : NaN)) })),
      yDomain: fitLog(ids.map((id) => results.powerByChannel[id].values), 3),
    }
  } else {
    const ids = Object.keys(results.zinByChannel || {}).filter((id) => id === selected)
    if (!ids.length) return <div className="dsp-empty">This channel has no results yet.</div>
    if (results.zinByChannel[ids[0]].loaded === false) return <div className="dsp-empty">Nothing is wired to this channel.</div>
    props = {
      title: `Impedance ${results.zinByChannel[ids[0]].label} sees`, ylabel: 'Ω',
      series: ids.map((id) => ({ key: id, name: results.zinByChannel[id].label, color: colorsOf(chIndex.get(id) ?? -1)[0], x, y: results.zinByChannel[id].mag })),
      yDomain: fitFromZero(ids.map((id) => results.zinByChannel[id].mag)),
    }
  }
  return <div className="dsp-result"><PlotChart logX xunit="frequency, Hz" {...props} /></div>
}

function OnOff({ on, label, onChange }) {
  return (
    <button className={`dsp-onoff${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      {label} {on ? 'ON' : 'OFF'}
    </button>
  )
}

function FreqSlider({ hz, onChange, disabled }) {
  const sliding = useRef(false)
  const pos = Math.round((Math.log(clamp(hz, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO)) * 1000)
  return (
    <input type="range" className="dsp-slider" min="0" max="1000" value={pos} disabled={disabled}
      onPointerDown={() => { sliding.current = false }}
      onChange={(e) => { onChange(roundHz(F_LO * Math.pow(F_HI / F_LO, Number(e.target.value) / 1000)), !sliding.current); sliding.current = true }} />
  )
}

function PassBlock({ name, f, set }) {
  return (
    <div className={`dsp-block${f.on ? '' : ' dim'}`}>
      <div className="dsp-block-head">
        <OnOff on={f.on} label={name} onChange={(on) => set({ on })} />
        <span className="dsp-block-note">{name === 'HPF' ? 'High-pass' : 'Low-pass'}</span>
      </div>
      <div className="dsp-fields">
        <label>Type</label>
        <select value={f.shape} onChange={(e) => set({ shape: e.target.value, slope: (PASS_SLOPES[e.target.value].find((s) => s >= f.slope) ?? 24) })}>
          {Object.keys(PASS_SLOPES).map((k) => <option key={k} value={k}>{PASS_LABELS[k]}</option>)}
        </select>
        <label>Slope</label>
        <select value={f.slope} onChange={(e) => set({ slope: Number(e.target.value) })}>
          {PASS_SLOPES[f.shape].map((s) => <option key={s} value={s}>{s} dB/oct</option>)}
        </select>
        <label>Frequency</label>
        <span className="dsp-num"><NumInput value={f.hz} above="0" step="1" onCommit={(hz) => set({ hz })} /><span>Hz</span></span>
      </div>
      <FreqSlider hz={f.hz} onChange={(hz, u) => set({ hz }, u)} />
    </div>
  )
}

function BandRow({ b, i, sel, select, set, remove }) {
  const gained = GAINED.has(b.type)
  return (
    <div className={`dsp-band${sel ? ' sel' : ''}${b.on ? '' : ' off'}`} onPointerDown={select}>
      <button className="dsp-band-num" style={{ background: BAND_COLORS[i % BAND_COLORS.length] }}
        title={b.on ? 'Bypass this band' : 'Switch this band on'} aria-pressed={b.on} onClick={() => set({ on: !b.on })}>{i + 1}</button>
      <select value={b.type} aria-label="Band type" onChange={(e) => set({ type: e.target.value })}>
        {BAND_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <span className="dsp-num"><NumInput value={b.hz} above="0" step="1" aria-label="Frequency" onCommit={(hz) => set({ hz })} /><span>Hz</span></span>
      <span className="dsp-num">{gained
        ? <><NumInput value={b.db} min={-GAIN_MAX} max={GAIN_MAX} step="0.5" aria-label="Gain" onCommit={(db) => set({ db })} /><span>dB</span></>
        : <span className="dsp-na">—</span>}</span>
      <span className="dsp-num"><NumInput value={b.q} above="0" step="0.1" aria-label="Q" onCommit={(q) => set({ q })} /><span>Q</span></span>
      <button className="dsp-flat" disabled={!gained || !b.db} title="Set this band's gain to 0 dB" onClick={() => set({ db: 0 })}>Flat</button>
      <button className="icon-btn" aria-label={`Remove band ${i + 1}`} title="Remove this band" onClick={remove}>✕</button>
    </div>
  )
}

function Controls({ ch, channels, dsp, change, band, setBand }) {
  const edit = (fn, undoable = true) => { const n = clone(dsp); fn(n); change(n, undoable) }
  const others = channels.filter((c) => c.id !== ch.id)
  return (
    <div className="dsp-controls">
      <div className="dsp-block">
        <div className="dsp-block-head">
          <OnOff on={dsp.on !== false} label="DSP" onChange={(on) => edit((n) => { n.on = on })} />
          <span className="dsp-block-note">{dsp.on === false ? 'Bypassed · settings kept' : 'Output'}</span>
        </div>
        <div className="dsp-fields">
          <label>Gain</label>
          <span className="dsp-num"><NumInput value={dsp.gainDb} min={-60} max={24} step="0.5" onCommit={(v) => edit((n) => { n.gainDb = v })} /><span>dB</span></span>
          <label>Delay</label>
          <span className="dsp-num" title={`${(Number(dsp.delayMs) * 34.3).toFixed(1)} cm of path at 343 m/s`}>
            <NumInput value={dsp.delayMs} min="0" max="100" step="0.1" onCommit={(v) => edit((n) => { n.delayMs = v })} /><span>ms</span>
          </span>
        </div>
        <input type="range" className="dsp-slider" min="-30" max="12" step="0.5" value={clamp(dsp.gainDb, -30, 12)}
          aria-label="Gain" onChange={(e) => edit((n) => { n.gainDb = Number(e.target.value) }, false)}
          onPointerDown={() => change(clone(dsp), true)} />
        <div className="dsp-toggles">
          <button className={`dsp-pill${dsp.mute ? ' warn' : ''}`} aria-pressed={dsp.mute} onClick={() => edit((n) => { n.mute = !n.mute })}>Mute</button>
          <button className={`dsp-pill${dsp.invert ? ' on' : ''}`} aria-pressed={dsp.invert} title="Invert polarity" onClick={() => edit((n) => { n.invert = !n.invert })}>Ø Invert</button>
        </div>
      </div>
      <PassBlock name="HPF" f={dsp.hpf} set={(p, u) => edit((n) => { Object.assign(n.hpf, p) }, u)} />
      <PassBlock name="LPF" f={dsp.lpf} set={(p, u) => edit((n) => { Object.assign(n.lpf, p) }, u)} />
      <div className={`dsp-block${dsp.lt.on ? '' : ' dim'}`}>
        <div className="dsp-block-head">
          <OnOff on={dsp.lt.on} label="LT" onChange={(on) => edit((n) => { n.lt.on = on })} />
          <span className="dsp-block-note" title="Moves a sealed box's resonance: from its own f0 and Q0 to a target fp and Qp">Linkwitz transform</span>
        </div>
        <div className="dsp-fields four">
          <label>f0</label><span className="dsp-num"><NumInput value={dsp.lt.f0} above="0" onCommit={(v) => edit((n) => { n.lt.f0 = v })} /><span>Hz</span></span>
          <label>Q0</label><span className="dsp-num"><NumInput value={dsp.lt.q0} above="0" step="0.05" onCommit={(v) => edit((n) => { n.lt.q0 = v })} /></span>
          <label>fp</label><span className="dsp-num"><NumInput value={dsp.lt.fp} above="0" onCommit={(v) => edit((n) => { n.lt.fp = v })} /><span>Hz</span></span>
          <label>Qp</label><span className="dsp-num"><NumInput value={dsp.lt.qp} above="0" step="0.05" onCommit={(v) => edit((n) => { n.lt.qp = v })} /></span>
        </div>
      </div>
      <div className="dsp-block">
        <div className="dsp-block-head">
          <span className="dsp-block-title">Parametric EQ</span>
          <span className="dsp-block-note">{dsp.peq.length ? `${dsp.peq.length} band${dsp.peq.length > 1 ? 's' : ''}` : 'none'}</span>
        </div>
        {dsp.peq.length > 0 && <div className="dsp-band-head"><span /><span>Type</span><span>Freq</span><span>Gain</span><span>Q</span></div>}
        {dsp.peq.map((b, i) => (
          <BandRow key={b.id} b={b} i={i} sel={b.id === band} select={() => setBand(b.id)}
            set={(p) => edit((n) => { Object.assign(n.peq.find((x) => x.id === b.id), p) })}
            remove={() => { edit((n) => { n.peq = n.peq.filter((x) => x.id !== b.id) }); if (band === b.id) setBand(null) }} />
        ))}
        <button className="dsp-add" onClick={() => {
          const id = freshBandId(dsp.peq)
          const used = dsp.peq.map((b) => b.hz)
          const hz = [50, 100, 40, 63, 80, 125, 30, 160].find((f) => !used.includes(f)) ?? 100
          edit((n) => { n.peq.push({ id, on: true, type: 'peak', hz, db: 0, q: 2 }) })
          setBand(id)
        }}>+ Add band</button>
      </div>
      <div className="dsp-foot">
        {others.length > 0 && (
          <select value="" aria-label="Copy to channel" onChange={(e) => {
            const st = useStore.getState()
            const to = e.target.value === '*' ? others.map((c) => c.id) : [e.target.value]
            to.forEach((id, k) => st.setChannelDsp(id, clone(dsp), k === 0))
          }}>
            <option value="" disabled>Copy to…</option>
            {others.map((c) => <option key={c.id} value={c.id}>{channelNames(channels)[c.id]}</option>)}
            {others.length > 1 && <option value="*">Every other channel</option>}
          </select>
        )}
        <button disabled={isFlat(dsp) && !dsp.peq.length} onClick={() => { change(clone(DEFAULT_DSP), true); setBand(null) }}>Reset channel</button>
      </div>
    </div>
  )
}

export default function DspWindow() {
  const open = useStore((s) => s.dspOpen)
  const wiring = useStore((s) => s.projectExtras.wiring)
  const chosen = useStore((s) => s.dspChannel)
  const locked = useStore((s) => isLocked(s))
  const [chart, setChart] = useState('transfer')
  const [overlay, setOverlay] = useState(null)
  const [band, setBand] = useState(null)
  if (!open || !wiring) return null
  const channels = wiring.channels || []
  const ch = channels.find((c) => c.id === chosen) || toolbarChannel(wiring) || channels[0]
  if (!ch) return null
  const index = channels.indexOf(ch)
  const shown = channelNames(channels)
  const dsp = normalizeDsp(ch.dsp)
  const st = useStore.getState
  const change = (next, undoable) => st().setChannelDsp(ch.id, next, undoable)

  return (
    <div className="td-window dsp-window">
      <LockNote />
      <div className="dsp-card">
      <div className="dsp-channels" role="tablist" aria-label="Channels">
        {channels.map((c, i) => {
          const d = normalizeDsp(c.dsp)
          const set = (patch) => st().setChannelDsp(c.id, { ...d, ...patch })
          return (
            <div key={c.id} role="tab" aria-selected={c === ch} className={`dsp-ch${c === ch ? ' sel' : ''}${d.mute ? ' muted' : ''}${d.on === false ? ' bypassed' : ''}`}
              onClick={() => { st().setDspChannel(c.id); setBand(null) }}>
              <span className="dsp-ch-bar" style={{ background: colorsOf(i)[0] }} />
              <span className="dsp-ch-name">{shown[c.id]}</span>
              <span className="dsp-ch-sum">{dspSummary(d)}</span>
              <span className="dsp-ch-btns">
                <button className={`dsp-mini power${d.on === false ? '' : ' live'}`} title={d.on === false ? 'DSP off — turn on' : 'DSP on — turn off, keeping its settings'} aria-pressed={d.on !== false} disabled={locked} onClick={(e) => { e.stopPropagation(); set({ on: d.on === false }) }}>⏻</button>
                <button className={`dsp-mini${d.mute ? ' warn' : ''}`} title="Mute" aria-pressed={d.mute} disabled={locked} onClick={(e) => { e.stopPropagation(); set({ mute: !d.mute }) }}>M</button>
                <button className={`dsp-mini${d.invert ? ' on' : ''}`} title="Invert polarity" aria-pressed={d.invert} disabled={locked} onClick={(e) => { e.stopPropagation(); set({ invert: !d.invert }) }}>Ø</button>
              </span>
            </div>
          )
        })}
        <button className="dsp-ch add" disabled={locked} title="Add a channel" onClick={() => { const id = st().addChannel(); if (id) st().setDspChannel(id) }}>+ Channel</button>
      </div>
      <div className="dsp-body">
        <div className="dsp-main">
          <div className="dsp-charts" role="tablist" aria-label="Chart">
            {CHARTS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={chart === k} className={chart === k ? 'on' : ''} onClick={() => setChart(k)}>{l}</button>
            ))}
            <span className="dsp-charts-gap" />
            {chart === 'transfer' && (
              <span className="dsp-overlay" role="group" aria-label="Overlay">
                <span>Overlay</span>
                {[['output', 'Output'], ['phase', 'Phase']].map(([k, l]) => (
                  <button key={k} aria-pressed={overlay === k} className={overlay === k ? 'on' : ''}
                    title={k === 'output' ? 'The simulated response, SPL at 1 m, on its own scale at the right' : 'The processing\'s phase, on a scale at the right'}
                    onClick={() => setOverlay(overlay === k ? null : k)}>{l}</button>
                ))}
              </span>
            )}
          </div>
          {chart === 'transfer'
            ? <TransferChart channels={channels} index={index} dsp={dsp} change={change} band={band} setBand={setBand} overlay={overlay} locked={locked} />
            : <ResultChart kind={chart} channels={channels} selected={ch.id} />}
          {chart === 'transfer' && dspFilters(dsp).length + dsp.peq.length > 0 && (
            <div className="dsp-legend">Drag a numbered point to move a band; scroll over it for Q. Drag H or L to move a crossover.</div>
          )}
        </div>
        <fieldset className="dsp-side" disabled={locked}>
          <div className="dsp-side-head">
            <span className="dsp-ch-bar" style={{ background: colorsOf(index)[0] }} />
            {shown[ch.id]}
          </div>
          <Controls ch={ch} channels={channels} dsp={dsp} change={change} band={band} setBand={setBand} />
        </fieldset>
      </div>
      </div>
    </div>
  )
}
