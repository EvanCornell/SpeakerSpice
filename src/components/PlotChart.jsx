import React, { useMemo, useRef, useState } from 'react'
import { decimate } from '../spice/dsp'

const MAX_POINTS = 1200

const VW = 1000
const VH = 300

export function niceTicks(lo, hi, count = 6) {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(12)))
  return out
}

export function logTicks(lo, hi) {
  const out = []
  for (let e = Math.floor(Math.log10(Math.max(lo, 1e-12))); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e)
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v)
    }
  }
  return out
}

export function tickText(v) {
  if (!Number.isFinite(v)) return ''
  const s = Math.abs(v) >= 1000 ? `${Number((v / 1000).toPrecision(3))}k` : String(Number(Number(v).toPrecision(3)))
  return s.replace('-', '−')
}

export function minorTicks(ticks, lo, hi, log) {
  const out = []
  const has = (v) => ticks.some((t) => Math.abs(t - v) <= Math.abs(v) * 1e-9)
  if (log) {
    if (!(lo > 0 && hi > lo)) return out
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (let m = 1; m <= 9; m++) {
        const v = m * Math.pow(10, e)
        if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9) && !has(v)) out.push(v)
      }
    }
    return out
  }
  if (ticks.length < 2) return out
  const step = ticks[1] - ticks[0]
  for (let v = ticks[0] - step / 2; v <= hi + 1e-9 * Math.abs(step); v += step) if (v >= lo - 1e-9 * Math.abs(step)) out.push(Number(v.toPrecision(12)))
  return out
}

function yRange(series, xr, logY) {
  let lo = Infinity
  let hi = -Infinity
  for (const s of series) {
    for (let i = 0; i < s.x.length; i++) {
      const v = s.y[i]
      if (!Number.isFinite(v) || s.x[i] < xr[0] || s.x[i] > xr[1] || (logY && v <= 0)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1]
}

export function resolveY(given, data, logY) {
  const one = (g, fallback) => {
    if (typeof g === 'number' && Number.isFinite(g)) return g
    const m = typeof g === 'string' && g.match(/^data(Max|Min)\s*([+-])\s*([\d.]+)$/)
    if (m) return (m[1] === 'Max' ? data[1] : data[0]) + (m[2] === '+' ? 1 : -1) * Number(m[3])
    return fallback
  }
  let [lo, hi] = data
  if (logY) return [one(given?.[0], lo / 1.3), one(given?.[1], hi * 1.3)]
  if (hi - lo < 1e-12) { const d = Math.abs(hi) * 0.1 || 1; lo -= d; hi += d }
  const pad = (hi - lo) * 0.08
  return [one(given?.[0], lo - pad), one(given?.[1], hi + pad)]
}

function nearest(xs, x) {
  if (!xs.length) return -1
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x) lo = mid; else hi = mid
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi
}

export default function PlotChart({ title, xunit, ylabel, y2label, series, xDomain, yDomain, logX = false, logY = false, refs = [], yTicks, legend = true, height }) {
  const plotRef = useRef(null)
  const [hover, setHover] = useState(null)
  const model = useMemo(() => {
    const drawn = series.filter((s) => s.x?.length)
    let x0 = Infinity
    let x1 = -Infinity
    for (const s of drawn) {
      for (const v of s.x) if (Number.isFinite(v) && (!logX || v > 0)) { if (v < x0) x0 = v; if (v > x1) x1 = v }
    }
    if (xDomain) [x0, x1] = xDomain
    if (!(x1 > x0)) { x0 = logX ? 1 : 0; x1 = logX ? 10 : 1 }
    const left = drawn.filter((s) => !s.right)
    const right = drawn.filter((s) => s.right)
    const [y0, y1] = resolveY(yDomain, yRange(left.length ? left : drawn, [x0, x1], logY), logY)
    const [r0, r1] = right.length ? resolveY(undefined, yRange(right, [x0, x1], false), false) : [0, 1]
    const lx0 = Math.log10(x0)
    const lx1 = Math.log10(x1)
    const ly0 = Math.log10(Math.max(y0, 1e-12))
    const ly1 = Math.log10(Math.max(y1, 1e-12))
    const X = (v) => (logX ? (Math.log10(v) - lx0) / (lx1 - lx0) : (v - x0) / (x1 - x0)) * VW
    const Y = (v) => (1 - (logY ? (Math.log10(Math.max(v, 1e-12)) - ly0) / (ly1 - ly0) : (v - y0) / (y1 - y0))) * VH
    const Y2 = (v) => (1 - (v - r0) / (r1 - r0)) * VH
    const lines = drawn.map((s) => {
      const toY = s.right ? Y2 : Y
      const { t, ys } = s.x.length > MAX_POINTS ? decimate(s.x, [s.y], MAX_POINTS) : { t: s.x, ys: [s.y] }
      let d = ''
      let pen = false
      for (let i = 0; i < t.length; i++) {
        const v = ys[0][i]
        if (!Number.isFinite(v) || !Number.isFinite(t[i]) || (logY && !s.right && v <= 0) || (logX && t[i] <= 0)) { pen = false; continue }
        const py = Math.max(-VH, Math.min(2 * VH, toY(v)))
        d += `${pen ? 'L' : 'M'}${X(t[i]).toFixed(1)} ${py.toFixed(1)}`
        pen = true
      }
      const dots = s.marker
        ? t.map((x, i) => ({ x: X(x) / VW, y: toY(ys[0][i]) / VH })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        : null
      return { ...s, d, dots }
    })
    const xt = (logX ? logTicks(x0, x1) : niceTicks(x0, x1, 8)).map((v) => ({ v, pos: X(v) / VW }))
    const yt = yTicks
      ? yTicks.map((t) => ({ v: t.y, label: t.label, pos: Y(t.y) / VH }))
      : (logY ? logTicks(y0, y1) : niceTicks(y0, y1, 5)).map((v) => ({ v, label: tickText(v), pos: Y(v) / VH }))
    const grid = xt.map((t) => `M${(t.pos * VW).toFixed(1)} 0V${VH}`).join('') + yt.map((t) => `M0 ${(t.pos * VH).toFixed(1)}H${VW}`).join('')
    const xm = minorTicks(xt.map((t) => t.v), x0, x1, logX).map((v) => X(v) / VW)
    const ym = minorTicks(yt.map((t) => t.v), Math.min(y0, y1), Math.max(y0, y1), logY).map((v) => Y(v) / VH)
    const gridMinor = xm.map((f) => `M${(f * VW).toFixed(1)} 0V${VH}`).join('') + ym.map((f) => `M0 ${(f * VH).toFixed(1)}H${VW}`).join('')
    const rl = refs.filter((r) => Number.isFinite(r.y) && r.y >= Math.min(y0, y1) && r.y <= Math.max(y0, y1)).map((r) => ({ ...r, pos: Y(r.y) / VH }))
    const y2t = right.length ? niceTicks(r0, r1, 5).map((v) => ({ v, label: tickText(v), pos: Y2(v) / VH })) : null
    return { lines, xt, yt, y2t, grid, gridMinor, rl, x0, x1, logX }
  }, [series, xDomain, yDomain, logX, logY, refs, yTicks])

  const onMove = (e) => {
    const r = plotRef.current.getBoundingClientRect()
    const f = (e.clientX - r.left) / r.width
    if (f < 0 || f > 1) { setHover(null); return }
    const x = model.logX ? Math.pow(10, Math.log10(model.x0) + f * (Math.log10(model.x1) - Math.log10(model.x0))) : model.x0 + f * (model.x1 - model.x0)
    setHover({ f, x, fy: (e.clientY - r.top) / r.height })
  }
  const readings = hover ? model.lines.map((s) => {
    const i = nearest(s.x, hover.x)
    return i < 0 ? null : { name: s.name, color: s.color, dash: s.dash, v: s.y[i], at: s.x[i] }
  }).filter((r) => r && Number.isFinite(r.v)) : []
  const shownLegend = legend ? model.lines.filter((s) => s.legend !== false && s.name) : []
  return (
    <div className="pc" style={height ? { height } : undefined}>
      {(title || xunit || ylabel) && (
        <div className="pc-head">
          {title && <span className="pc-title">{title}</span>}
          {(ylabel || y2label) && <span className="pc-yunit">{[ylabel, y2label].filter(Boolean).join(' · ')}</span>}
          <span className="pc-xunit">{xunit}</span>
        </div>
      )}
      <div className={`pc-body${model.y2t ? ' two' : ''}`}>
        <div className="pc-y">
          {model.yt.map((t) => <span key={t.v} style={{ top: `${t.pos * 100}%` }}>{t.label}</span>)}
        </div>
        <div className="pc-plot" ref={plotRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
            <path d={model.gridMinor} className="pc-grid minor" />
            <path d={model.grid} className="pc-grid" />
            {model.rl.map((r, i) => (
              <path key={`r${i}`} d={`M0 ${(r.pos * VH).toFixed(1)}H${VW}`} stroke={r.color || 'var(--red)'} strokeDasharray="5 4" className="pc-ref" />
            ))}
            {model.lines.map((s) => (
              <path key={s.key} d={s.d} stroke={s.color} strokeWidth={s.width || 1.5} strokeDasharray={s.dash ? (s.dash === true ? '5 3' : s.dash) : undefined}
                className="pc-line" />
            ))}
            {hover && <path d={`M${(hover.f * VW).toFixed(1)} 0V${VH}`} className="pc-guide" />}
          </svg>
          {model.lines.filter((s) => s.dots).map((s) => s.dots.map((p, i) => (
            <span key={`${s.key}${i}`} className="pc-dot" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: s.color }} />
          )))}
          {model.rl.filter((r) => r.label).map((r, i) => (
            <span key={`rl${i}`} className="pc-reflabel" style={{ top: `${r.pos * 100}%`, color: r.color || 'var(--red)' }}>{r.label}</span>
          ))}
          {hover && readings.length > 0 && (
            <div className={`pc-tip${hover.f > 0.6 ? ' left' : ''}`} style={{ left: `${hover.f * 100}%`, top: `${Math.min(Math.max(hover.fy, 0.05), 0.7) * 100}%` }}>
              <div className="pc-tip-x">{tickText(readings[0].at)} {xunit?.replace(/^time, /, '') || ''}</div>
              {readings.slice(0, 8).map((r, i) => (
                <div key={i}><i style={{ borderColor: r.color, borderStyle: r.dash ? 'dashed' : 'solid' }} />{r.name || 'Value'}<b>{tickText(r.v)}</b></div>
              ))}
            </div>
          )}
        </div>
        <div className="pc-y right">
          {model.y2t && model.y2t.map((t) => <span key={t.v} style={{ top: `${t.pos * 100}%` }}>{t.label}</span>)}
        </div>
        <div />
        <div className="pc-x">
          {model.xt.map((t) => <span key={t.v} style={{ left: `${t.pos * 100}%` }}>{tickText(t.v)}</span>)}
        </div>
        <div />
      </div>
      {shownLegend.length > 0 && (
        <div className="pc-legend">
          {shownLegend.map((s) => (
            <span key={s.key}><i style={{ borderColor: s.color, borderStyle: s.dash ? 'dashed' : 'solid' }} />{s.name}</span>
          ))}
        </div>
      )}
    </div>
  )
}
