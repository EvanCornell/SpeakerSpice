function localMaxima(freqs, vals, minProminence = 1) {
  const peaks = []
  for (let i = 2; i < vals.length - 2; i++) {
    if (vals[i] > vals[i - 1] && vals[i] >= vals[i + 1]) {
      let lo = vals[i]
      for (let j = Math.max(0, i - 40); j < Math.min(vals.length, i + 40); j++) lo = Math.min(lo, vals[j])
      if (vals[i] - lo >= minProminence) peaks.push({ f: freqs[i], v: vals[i], i })
    }
  }
  const merged = []
  for (const p of peaks) {
    const last = merged[merged.length - 1]
    if (last && p.f / last.f < 1.05) {
      if (p.v > last.v) merged[merged.length - 1] = p
    } else merged.push(p)
  }
  return merged
}

export function computeMetrics(res, settings) {
  if (!res || !res.ok || !res.freqs.length) return null
  const { freqs, splCombined, zinMag, excursion, excursionRatio, excursionByDriver } = res
  const n = freqs.length
  const m = {}

  const sorted = [...splCombined].filter((v) => isFinite(v)).sort((a, b) => b - a)
  const pass = sorted[Math.floor(sorted.length * 0.15)] ?? 0
  m.passband = pass
  m.peakSPL = sorted[0] ?? 0

  const findFx = (drop) => {
    const target = pass - drop
    for (let i = 0; i < n; i++) {
      if (splCombined[i] >= target) {
        if (i === 0) return freqs[0]
        const a = splCombined[i - 1]
        const b = splCombined[i]
        const t = (target - a) / (b - a)
        return freqs[i - 1] + t * (freqs[i] - freqs[i - 1])
      }
    }
    return null
  }
  m.f3 = findFx(3)
  m.f10 = findFx(10)

  let fHi = null
  for (let i = n - 1; i >= 0; i--) {
    if (splCombined[i] >= pass - 3) { fHi = freqs[i]; break }
  }
  if (m.f3 && fHi && fHi > m.f3) {
    m.bwHz = fHi - m.f3
    m.bwOct = Math.log2(fHi / m.f3)
  }

  const zPeaks = localMaxima(freqs, zinMag, Math.max(1, Math.max(...zinMag) * 0.05))
  m.zPeaks = zPeaks.slice(0, 5)
  if (zPeaks.length >= 2) {
    const [p1, p2] = zPeaks
    let minV = Infinity, minF = null
    for (let i = p1.i; i <= p2.i; i++) {
      if (zinMag[i] < minV) { minV = zinMag[i]; minF = freqs[i] }
    }
    m.fb = minF
    m.fbZ = minV
  } else if (zPeaks.length === 1) {
    const pk = zPeaks[0]
    m.fc = pk.f
    if (m.f3) {
      const u = Math.pow(m.f3 / pk.f, 2)
      const d = 2 * u * u - Math.pow(1 - u, 2)
      if (d > 0 && u > 0.1 && u < 10) m.qtc = Math.sqrt(u / d)
    }
  }

  let xPk = 0, xPkF = null
  for (let i = 0; i < n; i++) {
    if (excursion[i] > xPk) { xPk = excursion[i]; xPkF = freqs[i] }
  }
  m.xPeak = xPk
  m.xPeakF = xPkF
  const atFreq = (f) => {
    if (!f) return null
    let best = 0, bd = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(Math.log(freqs[i] / f))
      if (d < bd) { bd = d; best = i }
    }
    return excursion[best]
  }
  m.xAtFb = atFreq(m.fb)
  m.xAtF3 = atFreq(m.f3)

  let rPk = 0, rPkF = null
  if (excursionRatio) {
    for (let i = 0; i < n; i++) {
      if (excursionRatio[i] > rPk) { rPk = excursionRatio[i]; rPkF = freqs[i] }
    }
  }
  if (rPk > 0) {
    m.xRatioPeak = rPk
    m.xRatioPeakF = rPkF
    if (excursionByDriver && res.xmaxByDriver) {
      const at = freqs.indexOf(rPkF)
      let worst = null, worstR = 0
      for (const [id, arr] of Object.entries(excursionByDriver)) {
        const xm = res.xmaxByDriver[id]
        if (!(xm > 0) || at < 0) continue
        const r = arr[at] / xm
        if (r > worstR) { worstR = r; worst = id }
      }
      m.xLimitDriver = worst
    }
  }

  const vNow = settings.voltage || 2.83
  const vMax = rPk > 0 ? vNow / rPk : null
  if (vMax) {
    const zMin = Math.min(...zinMag.filter((v) => v > 0.1))
    m.maxPower = (vMax * vMax) / zMin
    m.vMax = vMax
  }
  return m
}

export const __internals = { localMaxima }
