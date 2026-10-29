import { evalCurve, curveHasContent } from '../engine/nonlinear.js'

const SAMPLES = 160

export function curveSpan(xmax) {
  return Math.max(4 * (Number(xmax) || 0), 20)
}

export function pwlOf(f, span, x) {
  const pts = []
  const n = (v) => Number(v).toPrecision(8)
  pts.push(n(-1e6), n(f(-span)))
  for (let i = 0; i <= SAMPLES; i++) {
    const xm = -span + (2 * span * i) / SAMPLES
    pts.push(n(xm), n(f(xm)))
  }
  pts.push(n(1e6), n(f(span)))
  return `pwl(${x}*1000,${pts.join(',')})`
}

export function stiffnessRatio(nl, xmax) {
  if (curveHasContent(nl?.Kms)) return (x) => evalCurve(nl.Kms, x, xmax)
  if (curveHasContent(nl?.Cms)) return (x) => 1 / evalCurve(nl.Cms, x, xmax)
  return null
}

export function ratioOf(curve, xmax) {
  return curveHasContent(curve) ? (x) => evalCurve(curve, x, xmax) : null
}

export function slopeOf(f) {
  const h = 0.05
  return (x) => ((f(x + h) - f(x - h)) / (2 * h)) * 1000
}
