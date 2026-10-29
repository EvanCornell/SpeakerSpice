export const SIGNAL_TYPES = ['sine', 'burst', 'sweep', 'noise']

export function normalizeSignal(sig) {
  const s = { type: 'sine', ...sig }
  if (!SIGNAL_TYPES.includes(s.type)) throw new Error(`unknown signal "${s.type}"`)
  if (s.type === 'sine') return { fade: 2, hz: 40, ...s }
  if (s.type === 'burst') return { cycles: 6.5, hz: 40, ...s }
  if (s.type === 'sweep') return { f1: 10, f2: 500, length: 1, ...s }
  return { f1: 10, f2: 500, length: 1, seed: 1, ...s }
}

export function sweepFade(sig) {
  return Math.min(3 / sig.f2, sig.length / 10)
}

export function signalLength(sig) {
  if (sig.type === 'sine') return Infinity
  if (sig.type === 'burst') return sig.cycles / sig.hz
  return sig.length
}

export function signalFunction(sig, fs = 48000) {
  const w = 2 * Math.PI * (sig.hz || 0)
  if (sig.type === 'sine') {
    const tf = sig.fade / sig.hz
    return (t) => (t < 0 ? 0 : Math.sin(w * t) * (t < tf ? 0.5 * (1 - Math.cos((Math.PI * t) / tf)) : 1))
  }
  if (sig.type === 'burst') {
    const T = sig.cycles / sig.hz
    return (t) => (t < 0 || t >= T ? 0 : Math.sin(w * t) * 0.5 * (1 - Math.cos((2 * Math.PI * t) / T)))
  }
  if (sig.type === 'sweep') {
    const L = Math.log(sig.f2 / sig.f1)
    const k = (2 * Math.PI * sig.f1 * sig.length) / L
    const tf = sweepFade(sig)
    const t0 = sig.length - tf
    return (t) => (t < 0 || t >= sig.length ? 0
      : Math.sin(k * (Math.exp((t * L) / sig.length) - 1)) * (t > t0 ? 0.5 * (1 + Math.cos((Math.PI * (t - t0)) / tf)) : 1))
  }
  const samples = pinkNoise(sig, fs)
  return (t) => {
    const x = t * fs
    const i = Math.floor(x)
    if (i < 0 || i >= samples.length - 1) return 0
    return samples[i] + (samples[i + 1] - samples[i]) * (x - i)
  }
}

export function signalExpression(sig, amp) {
  const n = (v) => Number(v).toPrecision(12)
  const w = n(2 * Math.PI * sig.hz)
  if (sig.type === 'sine') {
    const tf = n(sig.fade / sig.hz)
    return `${n(amp)}*sin(${w}*time)*(time<${tf}?0.5*(1-cos(${n(Math.PI)}*time/${tf})):1)`
  }
  if (sig.type === 'burst') {
    const T = n(sig.cycles / sig.hz)
    return `(time<${T}?${n(amp)}*sin(${w}*time)*0.5*(1-cos(${n(2 * Math.PI)}*time/${T})):0)`
  }
  if (sig.type === 'sweep') {
    const L = Math.log(sig.f2 / sig.f1)
    const tf = sweepFade(sig)
    const t0 = sig.length - tf
    return `(time<${n(sig.length)}?${n(amp)}*sin(${n((2 * Math.PI * sig.f1 * sig.length) / L)}*(exp(time*${n(L / sig.length)})-1))`
      + `*(time>${n(t0)}?0.5*(1+cos(${n(Math.PI / tf)}*(time-${n(t0)}))):1):0)`
  }
  throw new Error('noise has no expression; use signalPoints')
}

export function signalPoints(sig, amp, fs) {
  const f = signalFunction(sig, fs)
  const n = Math.ceil(signalLength(sig) * fs)
  const out = []
  out.push(0, 0)
  for (let i = 1; i <= n; i++) out.push(i / fs, amp * f(i / fs))
  out.push((n + 1) / fs, 0)
  return out
}

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pinkNoise(sig, fs) {
  const n = nextPow2(Math.ceil(sig.length * fs))
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const rand = rng(sig.seed || 1)
  for (let k = 1; k < n / 2; k++) {
    const f = (k * fs) / n
    if (f < sig.f1 || f > sig.f2) continue
    const a = 1 / Math.sqrt(f)
    const ph = 2 * Math.PI * rand()
    re[k] = a * Math.cos(ph); im[k] = a * Math.sin(ph)
    re[n - k] = re[k]; im[n - k] = -im[k]
  }
  fft(re, im, true)
  const len = Math.ceil(sig.length * fs)
  const out = re.slice(0, len)
  let e = 0
  for (const v of out) e += v * v
  const rms = Math.sqrt(e / Math.max(len, 1)) || 1
  const fade = Math.min(Math.round(0.01 * fs), Math.floor(len / 4))
  for (let i = 0; i < len; i++) {
    let g = 1 / rms
    if (i < fade) g *= i / fade
    if (len - 1 - i < fade) g *= (len - 1 - i) / fade
    out[i] *= g
  }
  return out
}

export function nextPow2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

export function fft(re, im, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

export function irfft(re, im) {
  const half = re.length - 1
  const n = half * 2
  const R = new Float64Array(n)
  const I = new Float64Array(n)
  for (let k = 0; k <= half; k++) { R[k] = re[k]; I[k] = im[k] }
  I[0] = 0; I[half] = 0
  for (let k = 1; k < half; k++) { R[n - k] = re[k]; I[n - k] = -im[k] }
  fft(R, I, true)
  return R
}

export function rfft(x, n = nextPow2(x.length)) {
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < Math.min(x.length, n); i++) re[i] = x[i]
  fft(re, im)
  return { re: re.slice(0, n / 2 + 1), im: im.slice(0, n / 2 + 1) }
}

export function harmonics(x, fs, f, count, periods) {
  const len = Math.min(x.length, Math.round((periods * fs) / f))
  const start = x.length - len
  const out = []
  for (let n = 1; n <= count; n++) {
    const w = (2 * Math.PI * n * f) / fs
    let c = 0
    let s = 0
    for (let i = 0; i < len; i++) {
      c += x[start + i] * Math.cos(w * (start + i))
      s += x[start + i] * Math.sin(w * (start + i))
    }
    out.push({ n, hz: n * f, amp: (2 * Math.hypot(c, s)) / len, phase: Math.atan2(-s, c) })
  }
  return out
}

export function thd(h) {
  const f = h[0]?.amp || 0
  if (!(f > 0)) return 0
  let e = 0
  for (let i = 1; i < h.length; i++) e += h[i].amp * h[i].amp
  return Math.sqrt(e) / f
}

export function decimate(t, ys, max) {
  if (t.length <= max) return { t: Array.from(t), ys: ys.map((y) => Array.from(y)) }
  const buckets = Math.floor(max / 2)
  const size = t.length / buckets
  const outT = []
  const outY = ys.map(() => [])
  for (let b = 0; b < buckets; b++) {
    const i0 = Math.floor(b * size)
    const i1 = Math.min(t.length, Math.floor((b + 1) * size))
    let lo = i0
    let hi = i0
    const y0 = ys[0]
    for (let i = i0; i < i1; i++) { if (y0[i] < y0[lo]) lo = i; if (y0[i] > y0[hi]) hi = i }
    for (const i of lo === hi ? [lo] : lo < hi ? [lo, hi] : [hi, lo]) {
      outT.push(t[i])
      ys.forEach((y, k) => outY[k].push(y[i]))
    }
  }
  return { t: outT, ys: outY }
}
