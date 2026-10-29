import { RHO, C_AIR } from '../engine/geometry.js'

export { RHO, C_AIR }

export const MU = 1.81e-5
export const KAPPA = 0.0257
export const CP = 1005
export const GAMMA = 1.4

export const SOLID_ANGLE = {
  free: 4 * Math.PI, half: 2 * Math.PI, quarter: Math.PI, eighth: Math.PI / 2,
}

export function perimeter(S, shape = 'round') {
  if (shape === 'rectangular') return 4 * Math.sqrt(S)
  return 2 * Math.sqrt(Math.PI * S)
}

export function viscousCoeff(S, P) {
  return (P * Math.sqrt(RHO * MU)) / (S * S)
}

export function thermalCoeff(P) {
  return ((GAMMA - 1) * P) / (RHO * C_AIR * C_AIR) * Math.sqrt(KAPPA / (RHO * CP))
}

export function flowResistivity(gPerL) {
  if (!(gPerL > 0)) return 0
  const d = 20e-6
  return 27.3 * Math.pow(gPerL / 1380, 1.53) * (MU / (d * d))
}

export function stuffedSoundSpeed(gPerL) {
  return C_AIR * (1 - 0.155 * Math.min(Math.max(gPerL || 0, 0) / 8, 1))
}

export function driverSI(p) {
  const n = Math.max(1, Math.round(p.count || 1))
  let s = 1, par = 1
  if (p.wiring === 'series') s = n
  else if (p.wiring === 'parallel') par = n
  else if (p.wiring === 'series-parallel') {
    const r = Math.round(Math.sqrt(n))
    if (r * r === n && r > 1) { s = r; par = r } else { par = n }
  }
  const Sd = (p.Sd || 500) * 1e-4
  const Mms = (p.Mms || 100) * 1e-3
  const Cms = (p.Cms || 0.2) * 1e-3
  return {
    n, s, par,
    Re: ((p.Re || 4) * s) / par,
    Le: (((p.Le || 1) * 1e-3) * s) / par,
    LeExp: p.LeExp ?? 1,
    Bl: (p.Bl || 15) * s,
    Sd: Sd * n,
    Mms: Mms * n,
    Cms: Cms / n,
    Rms: (p.Rms || 3) * n,
    Xmax: (p.Xmax || 10) * 1e-3,
  }
}

export function besselJ1(x) {
  const ax = Math.abs(x)
  if (ax < 8) {
    const y = x * x
    const p1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.48260 + y * -30.16036606)))))
    const p2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))))
    return p1 / p2
  }
  const z = 8 / ax
  const y = z * z
  const xx = ax - 2.356194491
  const p1 = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)))
  const p2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)))
  const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2)
  return x < 0 ? -ans : ans
}

export function besselJ0(x) {
  const ax = Math.abs(x)
  if (ax < 8) {
    const y = x * x
    const p1 = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))))
    const p2 = 57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))))
    return p1 / p2
  }
  const z = 8 / ax
  const y = z * z
  const xx = ax - 0.785398164
  const p1 = 1.0 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)))
  const p2 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 + y * -0.934935152e-7)))
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2)
}

export function struveH1(x) {
  if (x === 0) return 0
  const ax = Math.abs(x)
  return 2 / Math.PI - besselJ0(ax)
    + (16 / Math.PI - 5) * (Math.sin(ax) / ax)
    + (12 - 36 / Math.PI) * ((1 - Math.cos(ax)) / (ax * ax))
}

export function pistonImpedance(S, w) {
  const x = 2 * (w / C_AIR) * Math.sqrt(S / Math.PI)
  const small = x < 1e-3
  const R1 = small ? x * x / 8 : 1 - (2 * besselJ1(x)) / x
  const X1 = small ? (4 / (3 * Math.PI)) * x / 2 : (2 * struveH1(x)) / x
  const z0 = (RHO * C_AIR) / S
  return { re: z0 * R1, im: z0 * X1 }
}
