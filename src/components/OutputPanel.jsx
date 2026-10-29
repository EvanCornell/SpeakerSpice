import React, { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, ReferenceArea,
} from 'recharts'
import { useStore } from '../store'
import { readSnapshots } from '../workspace'
import NumInput from './NumInput'
import { displayName } from '../nodeNames'
import { minorTicks } from './PlotChart'

const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)']
const GRID = 'var(--grid)'
const TICK = { fill: 'var(--text-3)', fontSize: 10.5 }
const PLOT_TOP = 8
const PLOT_BOTTOM = 34

const TICKS = [10, 15, 20, 30, 40, 50, 70, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000]

const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d))

function BaseChart({ chartId, data, lines, yLabel, yDomain, y2Label, y2Domain, refLines = [], refAreas = [], keyLines = lines, toggles, children }) {
  const settings = useStore((s) => s.settings)
  const xZoom = useStore((s) => s.xZoom[chartId])
  const setXZoom = useStore((s) => s.setXZoom)
  const [dragL, setDragL] = useState(null)
  const [dragR, setDragR] = useState(null)
  const wrapRef = useRef(null)
  const lastLabel = useRef(null)
  const stateRef = useRef({})
  const xDomain = xZoom || [settings.fmin, settings.fmax]
  const [cover, setCover] = useState({ px: 0, h: 0 })

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      const top = r.top + PLOT_TOP
      const h = r.height - PLOT_TOP - PLOT_BOTTOM
      let bottom = top
      for (const o of (el.parentElement || el).querySelectorAll('.plot-left, .plot-controls')) {
        const b = o.getBoundingClientRect()
        if (b.height > 0) bottom = Math.max(bottom, b.bottom)
      }
      const px = Math.max(0, bottom + 6 - top)
      setCover((c) => (Math.abs(c.px - px) < 1 && Math.abs(c.h - h) < 1 ? c : { px, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const o of (el.parentElement || el).querySelectorAll('.plot-left, .plot-controls')) ro.observe(o)
    return () => ro.disconnect()
  }, [lines, keyLines, toggles])
  const shownY = useMemo(() => {
    if (!yDomain?.fit || !isFinite(yDomain[0]) || !isFinite(yDomain[1]) || !(cover.h > 0)) return yDomain
    const r = Math.min(cover.px, cover.h * 0.45)
    const [lo, hi] = yDomain
    return [lo, hi + ((hi - lo) * r) / (cover.h - r)]
  }, [yDomain, cover])

  const yBounds = useMemo(() => {
    if (Array.isArray(shownY) && isFinite(shownY[0]) && isFinite(shownY[1])) return shownY
    let lo = Infinity, hi = -Infinity
    const keys = lines.filter((l) => (l.yAxisId || 'left') === 'left').map((l) => l.dataKey)
    for (const r of data) for (const k of keys) {
      const val = r[k]
      if (val != null && isFinite(val)) { if (val < lo) lo = val; if (val > hi) hi = val }
    }
    return isFinite(lo) && hi > lo ? [lo, hi] : [0, 1]
  }, [shownY, data, lines])
  stateRef.current = { xDomain, chartId, full: [settings.fmin, settings.fmax], yBounds }

  const setManualY = (lo, hi) => {
    const st = useStore.getState()
    const cur = st.settings.yScales || {}
    const r4 = (v) => Number(v.toPrecision(4))
    st.updateSettings({ yScales: { ...cur, [chartId]: { mode: 'manual', min: r4(lo), max: r4(hi) } } })
  }
  const resetAll = () => {
    const st = useStore.getState()
    st.setXZoom(chartId, null)
    const cur = st.settings.yScales || {}
    st.updateSettings({ yScales: { ...cur, [chartId]: { mode: 'fit', min: '', max: '' } } })
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fracs = (clientX, clientY) => {
      const rect = el.getBoundingClientRect()
      const left = 52, right = 30, top = 10, bottom = 48
      return [
        Math.min(Math.max((clientX - rect.left - left) / (rect.width - left - right), 0), 1),
        Math.min(Math.max(1 - (clientY - rect.top - top) / (rect.height - top - bottom), 0), 1),
      ]
    }
    const onWheel = (e) => {
      e.preventDefault()
      const { xDomain: [x0, x1], full, yBounds: [y0, y1] } = stateRef.current
      const [fx, fy] = fracs(e.clientX, e.clientY)
      const factor = Math.pow(1.18, e.deltaY / 100)
      const l0 = Math.log(x0), l1 = Math.log(x1)
      const lc = lastLabel.current != null && lastLabel.current >= x0 && lastLabel.current <= x1
        ? Math.log(lastLabel.current)
        : l0 + fx * (l1 - l0)
      let n0 = lc - (lc - l0) * factor
      let n1 = lc + (l1 - lc) * factor
      const f0 = Math.log(Math.max(full[0], 1)), f1 = Math.log(full[1])
      n0 = Math.max(n0, f0)
      n1 = Math.min(n1, f1)
      if (n1 - n0 < Math.log(1.15)) return
      const isFull = n0 - f0 < 1e-6 && f1 - n1 < 1e-6
      if (isFull) { resetAll(); return }
      useStore.getState().setXZoom(stateRef.current.chartId, [Math.exp(n0), Math.exp(n1)])
      const cy = y0 + fy * (y1 - y0)
      const ny0 = cy - (cy - y0) * factor
      const ny1 = cy + (y1 - cy) * factor
      if (ny1 - ny0 > 1e-9) setManualY(ny0, ny1)
    }
    const onPointerDown = (e) => {
      if (!(e.shiftKey || e.button === 1)) return
      e.preventDefault()
      e.stopPropagation()
      const start = { px: e.clientX, py: e.clientY, dom: [...stateRef.current.xDomain], yb: [...stateRef.current.yBounds] }
      const rect = el.getBoundingClientRect()
      const innerW = rect.width - 82
      const innerH = rect.height - 58
      const move = (ev) => {
        const [x0, x1] = start.dom
        const { full } = stateRef.current
        const l0 = Math.log(x0), l1 = Math.log(x1)
        const f0 = Math.log(Math.max(full[0], 1)), f1 = Math.log(full[1])
        let d = (-(ev.clientX - start.px) / innerW) * (l1 - l0)
        d = Math.max(f0 - l0, Math.min(f1 - l1, d))
        useStore.getState().setXZoom(stateRef.current.chartId, [Math.exp(l0 + d), Math.exp(l1 + d)])
        const [y0, y1] = start.yb
        const dy = ((ev.clientY - start.py) / innerH) * (y1 - y0)
        setManualY(y0 + dy, y1 + dy)
      }
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown, { capture: true })
    }
  }, [])
  const ticks = useMemo(() => {
    const t = TICKS.filter((v) => v >= xDomain[0] && v <= xDomain[1])
    return t.length >= 3 ? t : undefined
  }, [xDomain[0], xDomain[1]])
  const minorFreqs = useMemo(() => minorTicks(ticks || [], xDomain[0], xDomain[1], true), [ticks, xDomain[0], xDomain[1]])
  const hasY2 = lines.some((l) => l.yAxisId === 'right')
  const commitZoom = () => {
    if (dragL != null && dragR != null) {
      const a = Math.min(dragL, dragR)
      const b = Math.max(dragL, dragR)
      if (b / a > 1.05) setXZoom(chartId, [a, b])
    }
    setDragL(null)
    setDragR(null)
  }
  return (
    <div ref={wrapRef} className="plot-body">
    {(toggles || keyLines.length > 1) && (
      <div className="plot-left">
        {toggles}
        {keyLines.length > 1 && (
          <div className="plot-key">
            {keyLines.map((l) => (
              <span key={l.dataKey} className="plot-key-item">
                <span className="ct-swatch" style={{ borderTopColor: l.color, borderTopStyle: l.dash ? 'dashed' : 'solid' }} />{l.name}
              </span>
            ))}
          </div>
        )}
      </div>
    )}
    {xZoom && (
      <button
        className="zoom-reset"
        title="Reset zoom (or double-click the chart). Wheel = zoom both axes, shift+drag = pan."
        onClick={resetAll}
      >⟲ {fmt(xZoom[0], 0)}–{fmt(xZoom[1], 0)} Hz</button>
    )}
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data} margin={{ top: PLOT_TOP, right: hasY2 ? 8 : 20, bottom: 4, left: 0 }}
        onMouseDown={(e) => { if (e && e.activeLabel != null) setDragL(e.activeLabel) }}
        onMouseMove={(e) => { if (e && e.activeLabel != null) { lastLabel.current = e.activeLabel; if (dragL != null) setDragR(e.activeLabel) } }}
        onMouseUp={commitZoom}
        onMouseLeave={() => { setDragL(null); setDragR(null) }}
        onDoubleClick={resetAll}
        style={{ userSelect: 'none' }}
      >
        <defs>
          <linearGradient id={`fill_${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--c1)" stopOpacity="var(--fill-top)" style={{ stopOpacity: 'var(--fill-top)' }} />
            <stop offset="1" stopColor="var(--c1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line-2)" vertical={true} />
        {minorFreqs.map((f) => <ReferenceLine key={`m${f}`} yAxisId="left" x={f} stroke={GRID} strokeWidth={1} ifOverflow="hidden" />)}
        <XAxis
          dataKey="f" type="number" scale="log" allowDataOverflow
          domain={xDomain}
          ticks={ticks} tick={TICK}
          stroke={GRID} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : Math.round(v * 10) / 10)}
        />
        <YAxis
          yAxisId="left" domain={shownY || ['auto', 'auto']} allowDataOverflow
          tick={TICK} stroke={GRID} tickLine={false} axisLine={false} width={44} tickFormatter={yTick}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-3)', fontSize: 10.5 } : undefined}
        />
        {hasY2 && (
          <YAxis
            yAxisId="right" orientation="right" domain={y2Domain || ['auto', 'auto']}
            tick={TICK} stroke={GRID} tickLine={false} axisLine={false} width={44} tickFormatter={yTick}
            label={y2Label ? { value: y2Label, angle: 90, position: 'insideRight', fill: 'var(--text-3)', fontSize: 10.5 } : undefined}
          />
        )}
        <Tooltip
          contentStyle={{ background: 'var(--raised)', border: '1px solid var(--line-2)', borderRadius: 10 }}
          labelStyle={{ color: 'var(--text)' }}
          cursor={{ stroke: 'var(--line-2)' }}
          labelFormatter={(v) => `${fmt(v)} Hz`}
          formatter={(v) => fmt(v, 2)}
          isAnimationActive={false}
        />
        {refAreas}
        {lines.filter((l) => l.area).map((l) => (
          <Area
            key={`area_${l.dataKey}`} yAxisId={l.yAxisId || 'left'} type="monotone" dataKey={l.dataKey}
            stroke="none" fill={`url(#fill_${chartId})`} baseValue={Array.isArray(shownY) && isFinite(shownY[0]) ? shownY[0] : 'dataMin'}
            legendType="none" tooltipType="none" isAnimationActive={false} connectNulls={false} activeDot={false}
          />
        ))}
        {lines.map((l) => (
          <Line
            key={l.dataKey} yAxisId={l.yAxisId || 'left'}
            type="monotone" dataKey={l.dataKey} name={l.name}
            stroke={l.color} strokeWidth={l.width || 2}
            strokeDasharray={l.dash} dot={false} isAnimationActive={false}
            connectNulls={false}
          />
        ))}
        {refLines}
        {dragL != null && dragR != null && (
          <ReferenceArea yAxisId="left" x1={dragL} x2={dragR} fill="var(--accent)" fillOpacity={0.15} />
        )}
        {children}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  )
}

function useFitData(chartId, data) {
  const z = useStore((s) => s.xZoom[chartId])
  return useMemo(() => (z ? data.filter((r) => r.f >= z[0] && r.f <= z[1]) : data), [data, z])
}

function useYScale(id, fitDomain) {
  const ys = useStore((s) => s.settings.yScales?.[id]) || { mode: 'fit', min: '', max: '' }
  const updateSettings = useStore((s) => s.updateSettings)
  const setYs = (patch) => {
    const cur = useStore.getState().settings.yScales || {}
    updateSettings({ yScales: { ...cur, [id]: { ...ys, ...patch } } })
  }
  let domain = ['auto', 'auto']
  if (ys.mode === 'fit' && fitDomain) domain = Object.assign([...fitDomain], { fit: true })
  else if (ys.mode === 'manual' && ys.min !== '' && ys.max !== '') {
    const lo = parseFloat(ys.min); const hi = parseFloat(ys.max)
    if (isFinite(lo) && isFinite(hi) && hi > lo) domain = [lo, hi]
  }
  const control = (
    <>
      {ys.mode === 'manual' && (
        <label title="Y-axis bounds">
          <NumInput placeholder="min" value={ys.min} allowEmpty
            validate={(v) => (ys.max === '' || v < parseFloat(ys.max) ? null : 'Must be below the maximum')}
            onCommit={(v) => setYs({ min: v ?? '' })} />
          –
          <NumInput placeholder="max" value={ys.max} allowEmpty
            validate={(v) => (ys.min === '' || v > parseFloat(ys.min) ? null : 'Must be above the minimum')}
            onCommit={(v) => setYs({ max: v ?? '' })} />
        </label>
      )}
      <div className="seg" role="radiogroup" aria-label="Y-axis scale"
        title="Y-axis scale: Fit = zoom to the useful range, Full = entire data range, Manual = your own bounds">
        {[['fit', 'Fit'], ['auto', 'Full'], ['manual', 'Manual']].map(([k, label]) => (
          <button key={k} role="radio" aria-checked={ys.mode === k} className={ys.mode === k ? 'on' : ''}
            onClick={() => setYs({ mode: k })}>{label}</button>
        ))}
      </div>
    </>
  )
  return [domain, control]
}

const round5 = (v, up) => (up ? Math.ceil(v / 5) * 5 : Math.floor(v / 5) * 5) + 0
function fitDb(rows, keys, windowDb = 45) {
  let peak = -Infinity
  for (const r of rows) for (const k of keys) { const v = r[k]; if (v != null && v > peak) peak = v }
  if (!isFinite(peak)) return null
  return [round5(peak - windowDb, false), round5(peak + 4, true)]
}
function fitLinear(rows, keys, floor = 0, atLeast = 0) {
  let hi = -Infinity
  for (const r of rows) for (const k of keys) { const v = r[k]; if (v != null && v > hi) hi = v }
  if (!isFinite(hi)) return null
  return [floor, Math.max(hi * 1.08, atLeast)]
}

function useChartData(keys) {
  const results = useStore((s) => s.results)
  const snapshots = useStore((s) => readSnapshots(s.workspace))
  return useMemo(() => {
    if (!results || !results.ok) return { data: [], portIds: [] }
    const n = results.freqs.length
    const portIds = Object.keys(results.splPorts || {})
    const rows = new Array(n)
    for (let i = 0; i < n; i++) {
      const row = { f: results.freqs[i] }
      if (keys.includes('spl')) {
        row.combined = results.splCombined[i]
        row.driver = results.splDriver[i]
        portIds.forEach((pid, k) => { row[`port_${pid}`] = results.splPorts[pid][i] })
      }
      if (keys.includes('zin')) {
        row.zmag = results.zinMag[i]; row.zphase = results.zinPhase[i]
        for (const [cid, z] of Object.entries(results.zinByChannel || {})) row[`zch_${cid}`] = z.mag[i]
      }
      if (keys.includes('exc')) {
        row.exc = results.excursion[i]
        for (const [did, arr] of Object.entries(results.excursionByDriver || {})) {
          row[`exc_${did}`] = arr[i]
          const xm = results.xmaxByDriver?.[did]
          if (xm > 0) row[`excr_${did}`] = (arr[i] / xm) * 100
        }
        if (results.excursionRatio) row.excr = results.excursionRatio[i] * 100
      }
      if (keys.includes('vel')) {
        for (const [wid, arr] of Object.entries(results.velocity || {})) row[`vel_${wid}`] = arr[i]
      }
      if (keys.includes('int')) {
        for (const [cid, arr] of Object.entries(results.splInterior || {})) row[`int_${cid}`] = arr[i]
      }
      if (keys.includes('pfl')) {
        for (const [pid, p] of Object.entries(results.probeFlow || {})) {
          row[`pfl_${pid}`] = p.kind === 'flow' ? p.values[i] * 1000 : p.values[i]
        }
      }
      if (keys.includes('pow')) row.pow = results.power[i] > 0 ? 10 * Math.log10(results.power[i]) : null
      if (keys.includes('pe')) { row.peW = results.peReal?.[i]; row.peVA = results.peApparent?.[i] }
      if (keys.includes('eff')) {
        const pe = results.peReal?.[i]
        row.eff = pe > 1e-9 && results.power[i] >= 0 ? (results.power[i] / pe) * 100 : null
      }
      if (keys.includes('ph')) { row.phase = results.phase[i]; row.phaseU = results.phaseUnwrapped[i]; row.gd = results.groupDelay[i] }
      rows[i] = row
    }
    snapshots.forEach((s, si) => {
      const map = { spl: 'splCombined', zin: 'zinMag', exc: 'excursion', pow: 'power', ph: 'groupDelay' }
      for (const key of keys) {
        const src = s[map[key]]
        if (!src) continue
        for (let i = 0; i < n; i++) {
          const f = results.freqs[i]
          const idx = nearestIdx(s.freqs, f)
          let v = src[idx]
          if (key === 'pow') v = v > 0 ? 10 * Math.log10(v) : null
          rows[i][`snap${si}_${key}`] = v
          if (key === 'exc' && s.excursionRatio) {
            rows[i][`snap${si}_excr`] = s.excursionRatio[nearestIdx(s.freqs, f)] * 100
          }
        }
      }
    })
    return { data: rows, portIds }
  }, [results, snapshots, keys.join()])
}

function yTick(v) {
  if (!Number.isFinite(v) || v === 0) return v
  return Math.abs(v) >= 100 ? Math.round(v) : Number(v.toPrecision(3))
}

function nearestIdx(arr, f) {
  let lo = 0, hi = arr.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < f) lo = mid; else hi = mid
  }
  return Math.abs(arr[lo] - f) < Math.abs(arr[hi] - f) ? lo : hi
}

function snapLines(snapshots, key) {
  return snapshots.map((s, si) => ({
    dataKey: `snap${si}_${key}`, name: `⧉ ${s.label}`, color: s.color, width: 1.5, dash: '6 3',
  }))
}

function SPLTab() {
  const { data, portIds } = useChartData(['spl'])
  const nodes = useStore((s) => s.nodes)
  const snapshots = useStore((s) => readSnapshots(s.workspace))
  const [show, setShow] = useState({ driver: true, ports: true, combined: true })
  const lines = []
  if (show.combined) lines.push({ dataKey: 'combined', name: 'Combined', color: SERIES[0], width: 2.2, area: true })
  if (show.driver) lines.push({ dataKey: 'driver', name: 'Driver direct', color: SERIES[1] })
  if (show.ports) portIds.forEach((pid, i) => {
    const [id, end] = pid.split(':')
    const name = `${displayName(nodes, id)}${end ? ` (${end})` : ''}`
    lines.push({ dataKey: `port_${pid}`, name, color: SERIES[(i + 2) % SERIES.length] })
  })
  lines.push(...snapLines(snapshots, 'spl'))
  const fitData = useFitData('spl', data)
  const [yDomain, yControl] = useYScale('spl', fitDb(fitData, lines.map((l) => l.dataKey)))
  return (
    <>
      <div className="plot-controls">
        {yControl}
      </div>
      <BaseChart chartId="spl" data={data} lines={lines} yLabel="SPL dB @ 1m" yDomain={yDomain}
        keyLines={show.ports && portIds.length > 1 ? lines.filter((l) => l.dataKey.startsWith('port_')) : []}
        toggles={<>
          {[['combined', 'Combined', SERIES[0]], ['driver', 'Driver', SERIES[1]], ['ports', 'Ports', SERIES[2]]].map(([k, label, color]) => (
            <button key={k} className={`chip-toggle${show[k] ? ' on' : ''}`} aria-pressed={show[k]}
              onClick={() => setShow({ ...show, [k]: !show[k] })}>
              <span className="ct-swatch" style={{ borderTopColor: color }} />{label}
            </button>
          ))}
          {snapshots.map((sn) => (
            <span key={sn.id} className="chip-toggle on dashed" title={sn.project ? `Snapshot from ${sn.project}` : 'Snapshot'}>
              <span className="ct-swatch" style={{ borderTopColor: sn.color }} />{sn.label}
            </span>
          ))}
        </>} />
    </>
  )
}

function ImpedanceTab() {
  const { data } = useChartData(['zin'])
  const snapshots = useStore((s) => readSnapshots(s.workspace))
  const metrics = useStore((s) => s.metrics)
  const channels = useStore((s) => s.results?.zinByChannel) || {}
  const ids = Object.keys(channels).filter((c) => channels[c].loaded !== false)
  const lines = ids.length > 1
    ? [
        ...ids.map((cid, i) => ({ dataKey: `zch_${cid}`, name: `|Z| ${channels[cid].label || cid}`, color: SERIES[i % SERIES.length], width: i ? 1.5 : 2.5 })),
        ...snapLines(snapshots, 'zin'),
      ]
    : [
        { dataKey: 'zmag', name: '|Z| Ω', color: SERIES[0], width: 2.5 },
        { dataKey: 'zphase', name: 'Phase °', color: SERIES[2], yAxisId: 'right' },
        ...snapLines(snapshots, 'zin'),
      ]
  const refLines = (metrics?.zPeaks || []).map((p, i) => (
    <ReferenceLine key={i} yAxisId="left" x={p.f} stroke="var(--text-3)" strokeDasharray="3 3"
      label={{ value: `F${i + 1} ${p.f.toFixed(1)}`, fill: 'var(--text-2)', fontSize: 10, position: 'insideBottomLeft' }} />
  ))
  const fitData = useFitData('zin', data)
  const [yDomain, yControl] = useYScale('zin', fitLinear(fitData, [...(ids.length > 1 ? ids.map((c) => `zch_${c}`) : ['zmag']), ...snapshots.map((_, i) => `snap${i}_zin`)]))
  return (
    <>
      <div className="plot-controls">{yControl}</div>
      <BaseChart chartId="zin" data={data} lines={lines} yLabel="|Z| Ω" yDomain={yDomain} y2Label="Phase °" y2Domain={[-90, 90]} refLines={refLines} />
    </>
  )
}

function ExcursionTab() {
  const { data } = useChartData(['exc'])
  const snapshots = useStore((s) => readSnapshots(s.workspace))
  const nodes = useStore((s) => s.nodes)
  const results = useStore((s) => s.results)
  const xmaxByDriver = results?.xmaxByDriver || {}
  const driverIds = Object.keys(results?.excursionByDriver || {})
  const multi = driverIds.length > 1
  const labelOf = (id) => displayName(nodes, id)
  const limits = [...new Set(driverIds.map((id) => xmaxByDriver[id]).filter((v) => v > 0))].sort((a, b) => a - b)
  const fallbackXmax = nodes.find((n) => n.type === 'driver')?.data.params.Xmax
  const xmaxes = limits.length ? limits : (fallbackXmax > 0 ? [fallbackXmax] : [])
  const mixed = xmaxes.length > 1
  const [unit, setUnit] = useState(null)
  const pct = (unit ?? (mixed ? '%' : 'mm')) === '%'

  const seriesKey = (id) => (pct ? `excr_${id}` : `exc_${id}`)
  const lines = multi
    ? [
      ...driverIds.map((id, i) => ({
        dataKey: seriesKey(id), name: labelOf(id), color: SERIES[i % SERIES.length], width: 2,
      })),
      ...snapLines(snapshots, pct ? 'excr' : 'exc'),
    ]
    : [
      { dataKey: pct ? 'excr' : 'exc', name: pct ? '% of Xmax' : 'Excursion mm (peak)', color: SERIES[0], width: 2.5 },
      ...snapLines(snapshots, pct ? 'excr' : 'exc'),
    ]

  const nameFor = (xm) => (mixed
    ? `Xmax ${xm} mm — ${driverIds.filter((id) => xmaxByDriver[id] === xm).map(labelOf).join(', ')}`
    : `Xmax ${xm} mm`)
  const refLines = pct
    ? [
      <ReferenceLine key="xmax100" yAxisId="left" y={100} stroke="var(--red)" strokeDasharray="6 4"
        label={{ value: 'Xmax', fill: 'var(--red)', fontSize: 10, position: 'insideTopRight' }} />,
    ]
    : xmaxes.map((xm) => (
      <ReferenceLine key={`xmax${xm}`} yAxisId="left" y={xm} stroke="var(--red)" strokeDasharray="6 4"
        label={{ value: nameFor(xm), fill: 'var(--red)', fontSize: 10, position: 'insideTopRight' }} />
    ))
  const ceiling = pct ? 100 : xmaxes[0]
  const refAreas = ceiling ? [
    <ReferenceArea key="over" yAxisId="left" y1={ceiling} y2={ceiling * 3} fill="var(--red)" fillOpacity={0.07} />,
  ] : []

  const fitData = useFitData('exc', data)
  const fitKeys = multi ? driverIds.map(seriesKey) : [pct ? 'excr' : 'exc']
  const [yDomain, yControl] = useYScale(pct ? 'excPct' : 'exc',
    fitLinear(fitData, fitKeys, 0, ceiling ? ceiling * 1.25 : 0))
  return (
    <>
      <div className="plot-controls">
        <label title="Millimetres of cone travel, or each driver's travel as a percentage of its own Xmax">Units
          <select value={pct ? '%' : 'mm'} onChange={(e) => setUnit(e.target.value)} style={{ width: 88 }}>
            <option value="mm">mm</option>
            <option value="%">% Xmax</option>
          </select>
        </label>
        {yControl}
      </div>
      <BaseChart chartId="exc" data={data} lines={lines} yLabel={pct ? '% of Xmax' : 'mm'}
        yDomain={yDomain} refLines={refLines} refAreas={refAreas} />
    </>
  )
}

function VelocityTab() {
  const { data } = useChartData(['vel'])
  const nodes = useStore((s) => s.nodes)
  const results = useStore((s) => s.results)
  const vThreshold = useStore((s) => s.settings.vThreshold)
  const updateSettings = useStore((s) => s.updateSettings)
  const wgs = Object.keys(results?.velocity || {})
  const lines = wgs.map((wid, i) => {
    return { dataKey: `vel_${wid}`, name: displayName(nodes, wid), color: SERIES[i % SERIES.length] }
  })
  const fitData = useFitData('vel', data)
  const [yDomain, yControl] = useYScale('vel', fitLinear(fitData, lines.map((l) => l.dataKey), 0, vThreshold * 1.25))
  return (
    <>
      <div className="plot-controls">
        <label title="Approximate turbulence (chuffing) onset velocity">Threshold
          <NumInput value={vThreshold} above="0" onCommit={(v) => updateSettings({ vThreshold: v })} /> m/s
        </label>
        {yControl}
      </div>
      <BaseChart chartId="vel" data={data} lines={lines} yLabel="m/s (peak)" yDomain={yDomain} refLines={[
        <ReferenceLine key="th" yAxisId="left" y={vThreshold} stroke="var(--red)" strokeDasharray="6 4"
          label={{ value: `turbulence ~${vThreshold} m/s`, fill: 'var(--red)', fontSize: 10, position: 'insideTopRight' }} />,
      ]} />
    </>
  )
}

function InteriorTab() {
  const { data } = useChartData(['int'])
  const nodes = useStore((s) => s.nodes)
  const results = useStore((s) => s.results)
  const probes = useStore((s) => s.projectExtras.probes) || []
  const chambers = Object.keys(results?.splInterior || {})
  const lines = chambers.map((cid, i) => ({ dataKey: `int_${cid}`, name: probeName(cid, probes, nodes), color: SERIES[i % SERIES.length] }))
  const fitData = useFitData('int', data)
  const [yDomain, yControl] = useYScale('int', fitDb(fitData, lines.map((l) => l.dataKey)))
  if (!chambers.length) {
    return (
      <div style={{ padding: '24px 16px', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.6 }}>
        No pressure probes. Select a Chamber node and enable
        <b> “SPL probe (mic inside)”</b>, or add a pressure probe anywhere from
        the Probes panel, to plot the sound pressure level there — e.g. at the
        listening position in a car cabin. A probe is a virtual microphone: it
        never changes the simulation itself.
      </div>
    )
  }
  return (
    <>
      <div className="plot-controls">
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          dB SPL inside the volume (no 1 m convention — point pressure at the mic station)
        </span>
        {yControl}
      </div>
      <BaseChart chartId="int" data={data} lines={lines} yLabel="dB SPL (interior)" yDomain={yDomain} />
    </>
  )
}

function probeName(key, probes, nodes) {
  if (nodes.some((nn) => nn.id === key)) return displayName(nodes, key)
  const p = probes.find((x) => x.id === key)
  if (!p) return key
  if (p.label) return p.label
  const on = displayName(nodes, p.at?.node)
  return p.at?.position != null ? `${on} @ ${p.at.position} cm` : `${on} ${p.at?.handle}`
}

function ProbeFlowTab() {
  const { data } = useChartData(['pfl'])
  const nodes = useStore((s) => s.nodes)
  const results = useStore((s) => s.results)
  const probes = useStore((s) => s.projectExtras.probes) || []
  const flows = Object.entries(results?.probeFlow || {})
  const lines = flows.map(([pid, p], i) => ({
    dataKey: `pfl_${pid}`,
    name: `${probeName(pid, probes, nodes)} (${p.kind === 'flow' ? 'L/s' : 'm/s'})`,
    color: SERIES[i % SERIES.length],
    ...(p.kind === 'flow' ? { yAxisId: 'right' } : {}),
  }))
  const fitData = useFitData('pfl', data)
  const [yDomain, yControl] = useYScale('pfl', fitLinear(fitData, lines.filter((l) => !l.yAxisId).map((l) => l.dataKey)))
  if (!flows.length) {
    return (
      <div style={{ padding: '24px 16px', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.6 }}>
        No flow or velocity probes. Add one from the Probes panel to plot the
        air moving through any handle, tap or point along a line.
      </div>
    )
  }
  const hasFlow = lines.some((l) => l.yAxisId)
  return (
    <>
      <div className="plot-controls">
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>peak values</span>
        {yControl}
      </div>
      <BaseChart chartId="pfl" data={data} lines={lines} yLabel="m/s (peak)" yDomain={yDomain} {...(hasFlow ? { y2Label: 'L/s (peak)', y2Domain: ['auto', 'auto'] } : {})} />
    </>
  )
}

function PowerTab() {
  const { data } = useChartData(['pow'])
  const snapshots = useStore((s) => readSnapshots(s.workspace))
  const lines = [{ dataKey: 'pow', name: 'Radiated power dBW', color: SERIES[0], width: 2.5 }, ...snapLines(snapshots, 'pow')]
  const fitData = useFitData('pow', data)
  const [yDomain, yControl] = useYScale('pow', fitDb(fitData, lines.map((l) => l.dataKey)))
  return (
    <>
      <div className="plot-controls">{yControl}</div>
      <BaseChart chartId="pow" data={data} lines={lines} yLabel="dBW" yDomain={yDomain} />
    </>
  )
}

function EfficiencyTab() {
  const { data } = useChartData(['eff'])
  const lines = [{ dataKey: 'eff', name: 'Efficiency %', color: SERIES[1], width: 2.5 }]
  const fitData = useFitData('eff', data)
  const [yDomain, yControl] = useYScale('eff', fitLinear(fitData, ['eff']))
  return (
    <>
      <div className="plot-controls">{yControl}</div>
      <BaseChart chartId="eff" data={data} lines={lines} yLabel="acoustic / electrical %" yDomain={yDomain} />
    </>
  )
}

function ElecPowerTab() {
  const { data } = useChartData(['pe'])
  const lines = [
    { dataKey: 'peVA', name: 'Apparent (VA) — amp must source', color: SERIES[2], width: 2 },
    { dataKey: 'peW', name: 'Real (W) — dissipated + converted', color: SERIES[0], width: 2.5 },
  ]
  const fitData = useFitData('pe', data)
  const [yDomain, yControl] = useYScale('pe', fitLinear(fitData, ['peW', 'peVA']))
  return (
    <>
      <div className="plot-controls">{yControl}</div>
      <BaseChart chartId="pe" data={data} lines={lines} yLabel="W / VA" yDomain={yDomain} />
    </>
  )
}

function PhaseTab() {
  const { data } = useChartData(['ph'])
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const off = settings.delayOffset || 0
  const adj = useMemo(() => data.map((r) => ({
    ...r,
    gdAdj: r.gd != null ? r.gd - off : null,
    phaseSel: settings.unwrapPhase ? r.phaseU : r.phase,
  })), [data, off, settings.unwrapPhase])
  const lines = [
    { dataKey: 'phaseSel', name: 'Phase °', color: SERIES[0], width: 2 },
    { dataKey: 'gdAdj', name: 'Group delay ms', color: SERIES[2], yAxisId: 'right', width: 2 },
  ]
  const [yDomain, yControl] = useYScale('ph', null)
  return (
    <>
      <div className="plot-controls">
        <label><input type="checkbox" checked={settings.unwrapPhase} onChange={(e) => updateSettings({ unwrapPhase: e.target.checked })} />unwrap</label>
        <label>Delay offset <NumInput step="0.5" value={off} onCommit={(v) => updateSettings({ delayOffset: v })} /> ms</label>
        {yControl}
      </div>
      <BaseChart chartId="ph" data={adj} lines={lines} yLabel="deg" yDomain={yDomain} y2Label="ms" />
    </>
  )
}

function ChartPanel({ children }) {
  return (
    <div className="results-panel">
      <div className="plot-area">{children}</div>
    </div>
  )
}

export const CHART_PANELS = {
  spl: SPLTab,
  zin: ImpedanceTab,
  exc: ExcursionTab,
  vel: VelocityTab,
  int: InteriorTab,
  pfl: ProbeFlowTab,
  pow: PowerTab,
  eff: EfficiencyTab,
  pe: ElecPowerTab,
  ph: PhaseTab,
}

export function chartPanelComponent(id) {
  const Chart = CHART_PANELS[id]
  if (!Chart) return null
  const Wrapped = () => <ChartPanel><Chart /></ChartPanel>
  Wrapped.displayName = `ChartPanel(${id})`
  return Wrapped
}

export const __internals = { fmt, round5, fitDb, fitLinear, nearestIdx, snapLines, yTick }
