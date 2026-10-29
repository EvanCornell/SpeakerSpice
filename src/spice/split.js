import { decadeStep } from './compile.js'

export const MIN_POINTS = 16

const num = (v) => Number(Number(v).toPrecision(15)).toString()

export function acLine(netlist) {
  const m = /^\.ac\s+(lin|dec)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/im.exec(netlist)
  if (!m) return null
  const [line, scale, n, fstart, fstop] = m
  const v = [n, fstart, fstop].map(Number)
  if (v.some((x) => !Number.isFinite(x)) || v[0] < 1 || v[1] <= 0) return null
  return { line, scale: scale.toLowerCase(), n: Math.round(v[0]), fstart: v[1], fstop: v[2] }
}

export function acCount(ac) {
  if (ac.scale === 'lin') return ac.n
  if (!(ac.fstop > ac.fstart)) return 1
  return Math.round(ac.n * Math.log10(ac.fstop / ac.fstart)) + 1
}

export function splitAc(netlist, parts) {
  const ac = acLine(netlist)
  if (!ac) return [netlist]
  const total = acCount(ac)
  const k = Math.min(Math.floor(parts) || 1, Math.floor(total / MIN_POINTS))
  if (k <= 1) return [netlist]
  const out = []
  for (let j = 0; j < k; j++) {
    const i0 = Math.round((j * total) / k)
    const i1 = Math.round(((j + 1) * total) / k) - 1
    let line
    if (ac.scale === 'lin') {
      const df = total > 1 ? (ac.fstop - ac.fstart) / (total - 1) : 0
      const hi = j === k - 1 ? ac.fstop : ac.fstart + i1 * df
      line = `.ac lin ${i1 - i0 + 1} ${num(ac.fstart + i0 * df)} ${num(hi)}`
    } else {
      const lo = j === 0 ? num(ac.fstart) : decadeStep(ac.fstart, ac.n, i0)
      line = `.ac dec ${ac.n} ${lo} ${j === k - 1 ? num(ac.fstop) : decadeStep(ac.fstart, ac.n, i1, true)}`
    }
    out.push(netlist.replace(ac.line, line))
  }
  return out
}

export function mergeAc(parts) {
  if (parts.length === 1) return parts[0]
  const scale = parts.flatMap((p) => Array.from(p.scale))
  const vectors = new Map()
  for (const name of parts[0].vectors.keys()) {
    const first = parts[0].vectors.get(name)
    const join = (pick) => {
      const arr = new Float64Array(scale.length)
      let at = 0
      for (const p of parts) {
        const a = pick(p.vectors.get(name))
        arr.set(a, at)
        at += a.length
      }
      return arr
    }
    vectors.set(name, first.re ? { re: join((v) => v.re), im: join((v) => v.im) } : join((v) => v))
  }
  return { scale, vectors }
}
