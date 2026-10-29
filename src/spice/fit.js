export function atomZ(atom, q) {
  if (atom.kind === 'corner') {
    const d = q * q + atom.q0 * atom.q0
    return { re: (q * q) / d, im: (q * atom.q0) / d }
  }
  const L = 1 / (atom.Q * atom.q0)
  const C = atom.Q / atom.q0
  const yRe = 1
  const yIm = q * C - 1 / (q * L)
  const d = yRe * yRe + yIm * yIm
  return { re: yRe / d, im: -yIm / d }
}

export function nnls(A, b, maxIter = 500) {
  const m = A.length
  const n = A[0].length
  const x = new Array(n).fill(0)
  const passive = new Array(n).fill(false)
  const gradient = () => {
    const r = b.map((bi, i) => bi - A[i].reduce((s, a, j) => s + a * x[j], 0))
    const w = new Array(n).fill(0)
    for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) w[j] += A[i][j] * r[i]
    return w
  }
  const solveFree = (P) => {
    const k = P.length
    const M = Array.from({ length: k }, () => new Array(k + 1).fill(0))
    for (let a = 0; a < k; a++) {
      for (let c = 0; c < k; c++) {
        let s = 0
        for (let i = 0; i < m; i++) s += A[i][P[a]] * A[i][P[c]]
        M[a][c] = s
      }
      let s = 0
      for (let i = 0; i < m; i++) s += A[i][P[a]] * b[i]
      M[a][k] = s
    }
    for (let a = 0; a < k; a++) M[a][a] += 1e-14 * (M[a][a] || 1)
    for (let c = 0; c < k; c++) {
      let p = c
      for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
      ;[M[c], M[p]] = [M[p], M[c]]
      for (let r = c + 1; r < k; r++) {
        const f = M[r][c] / M[c][c]
        for (let t = c; t <= k; t++) M[r][t] -= f * M[c][t]
      }
    }
    const z = new Array(k).fill(0)
    for (let r = k - 1; r >= 0; r--) {
      let s = M[r][k]
      for (let t = r + 1; t < k; t++) s -= M[r][t] * z[t]
      z[r] = s / M[r][r]
    }
    const full = new Array(n).fill(0)
    P.forEach((j, a) => { full[j] = z[a] })
    return full
  }
  for (let iter = 0; iter < maxIter; iter++) {
    const w = gradient()
    let best = -1
    let bestW = 1e-12 * Math.max(1, ...w.map(Math.abs))
    for (let j = 0; j < n; j++) if (!passive[j] && w[j] > bestW) { bestW = w[j]; best = j }
    if (best < 0) break
    passive[best] = true
    for (let inner = 0; inner < maxIter; inner++) {
      const P = []
      for (let j = 0; j < n; j++) if (passive[j]) P.push(j)
      const z = solveFree(P)
      if (P.every((j) => z[j] > 0)) { for (let j = 0; j < n; j++) x[j] = z[j]; break }
      let alpha = Infinity
      for (const j of P) {
        if (z[j] <= 0) alpha = Math.min(alpha, x[j] / (x[j] - z[j]))
      }
      for (let j = 0; j < n; j++) x[j] += alpha * (z[j] - x[j])
      for (const j of P) if (x[j] <= 1e-15) { passive[j] = false; x[j] = 0 }
    }
  }
  return x
}

export function fitAtoms(atoms, samples, componentwise = false) {
  const A = []
  const b = []
  for (const s of samples) {
    const mag = Math.max(Math.hypot(s.z.re, s.z.im), 1e-300)
    const sRe = (s.w ?? 1) / (componentwise ? Math.max(Math.abs(s.z.re), 1e-6 * mag) : mag)
    const sIm = (s.w ?? 1) / (componentwise ? Math.max(Math.abs(s.z.im), 1e-6 * mag) : mag)
    const row = atoms.map((a) => atomZ(a, s.q))
    A.push(row.map((z) => z.re * sRe)); b.push(s.z.re * sRe)
    A.push(row.map((z) => z.im * sIm)); b.push(s.z.im * sIm)
  }
  const x = nnls(A, b)
  return atoms.map((a, j) => ({ ...a, weight: x[j] })).filter((a) => a.weight > 0)
}

export function fitZ(fit, q) {
  let re = 0
  let im = 0
  for (const a of fit) {
    const z = atomZ(a, q)
    re += a.weight * z.re
    im += a.weight * z.im
  }
  return { re, im }
}

export function logspace(lo, hi, n) {
  const a = Math.log(lo)
  const b = Math.log(hi)
  return Array.from({ length: n }, (_, i) => Math.exp(a + ((b - a) * i) / (n - 1)))
}

const fractionalCache = new Map()

export function fitFractional(alpha, qMax = 1e4, perDecade = 3) {
  const key = `${alpha}|${qMax}|${perDecade}`
  if (fractionalCache.has(key)) return fractionalCache.get(key)
  const above = Math.min(6, Math.max(1, 0.5 / Math.max(1 - alpha, 0.05)))
  const decades = Math.log10(qMax) + 1 + above
  const atoms = logspace(0.1, qMax * Math.pow(10, above), Math.ceil(decades * perDecade) + 1).map((q0) => ({ kind: 'corner', q0 }))
  const samples = logspace(1, qMax, 160).map((q) => {
    const mag = Math.pow(q, alpha)
    const ph = (alpha * Math.PI) / 2
    return { q, z: { re: mag * Math.cos(ph), im: mag * Math.sin(ph) } }
  })
  const fit = fitAtoms(atoms, samples)
  fractionalCache.set(key, fit)
  return fit
}
