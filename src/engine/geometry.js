export const RHO = 1.184

export const C_AIR = 344

export function areaProfile(flare, S1, S2, L) {
  const r1 = Math.sqrt(S1 / Math.PI)
  const r2 = Math.sqrt(S2 / Math.PI)
  switch (flare) {
    case 'conical':
      return (x) => {
        const r = r1 + ((r2 - r1) * x) / L
        return Math.PI * r * r
      }
    case 'parabolic':
      return (x) => S1 + ((S2 - S1) * x) / L
    case 'exponential': {
      const m = Math.log(S2 / S1) / L
      return (x) => S1 * Math.exp(m * x)
    }
    case 'hypex':
    case 'tractrix':
    case 'lecleach': {
      const T = flare === 'hypex' ? 0.7 : flare === 'tractrix' ? 0.5 : 0.6
      const A = Math.sqrt(S2 / S1)
      if (A <= 1) {
        const m = Math.log(S2 / S1) / L
        return (x) => S1 * Math.exp(m * x)
      }
      const u = (A + Math.sqrt(Math.max(A * A - 1 + T * T, 0))) / (1 + T)
      const kk = Math.log(u) / L
      return (x) => {
        const f = Math.cosh(kk * x) + T * Math.sinh(kk * x)
        return S1 * f * f
      }
    }
    default:
      return () => S1
  }
}

export function waveguideVolume(flare, S1, S2, L, N = 200) {
  const prof = areaProfile(flare, S1, S2, L)
  const dx = L / N
  let v = 0
  for (let i = 0; i < N; i++) v += prof((i + 0.5) * dx) * dx
  return v
}

export function flareCutoff(flare, S1, S2, L) {
  if (S2 <= S1 * 1.0001) return null
  if (flare === 'conical' || flare === 'parabolic') return null
  const m = Math.log(S2 / S1) / L
  return (m * C_AIR) / (4 * Math.PI)
}

export function endCorrectionLength(S, factor) {
  return factor * Math.sqrt(S / Math.PI)
}

export function junctionCorrection(Sself, Sother) {
  if (!(Sself > 0) || !(Sother > 0)) return 0
  const small = Math.min(Sself, Sother)
  const large = Math.max(Sself, Sother)
  const a = Math.sqrt(small / Math.PI)
  const dl = 0.85 * a * (1 - 1.25 * Math.sqrt(small / large))
  if (!(dl > 0)) return 0
  return dl * (Sself / small)
}
