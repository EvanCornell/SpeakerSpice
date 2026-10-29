const QES_TYPICAL = 0.4

export function nominalFloor(re, qes) {
  if (!(re > 0)) return 0
  const q = Number(qes) > 0 ? Math.min(1, Math.max(0.15, Number(qes))) : QES_TYPICAL
  return re / Math.min(0.8, 0.67 + 0.25 * q)
}

const POW_SLACK = 1.36

export function estimateNominal(re, qes) {
  const low = nominalFloor(re, qes)
  if (!(low > 0)) return 0
  for (let k = Math.floor(Math.log2(low / POW_SLACK)) - 1; ; k++) {
    const pow = 2 ** k
    if (low <= pow * POW_SLACK) return pow
    const odd = 1.5 * pow
    if ((odd === 6 || odd === 12) && low <= odd) return odd
  }
}

export function nominalOf(p) {
  const z = Number(p?.Znom)
  return z > 0 ? z : estimateNominal(Number(p?.Re), p?.Qes)
}

function coilShare(p) {
  const coils = p.dvc?.coils
  if (coils === 'parallel') return 1 / 4
  if (coils === 'one') return 1 / 2
  return 1
}

export function driverNominal(p) {
  const one = nominalOf(p) * coilShare(p)
  const n = Math.max(1, Math.round(Number(p.count) || 1))
  if (p.wiring === 'series') return one * n
  if (p.wiring === 'series-parallel') {
    const r = Math.round(Math.sqrt(n))
    return r * r === n && r > 1 ? one : one / n
  }
  return one / n
}

export const fmtOhms = (z) => String(Number(z.toPrecision(3)))
