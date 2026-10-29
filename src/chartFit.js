const finite = (lists) => lists.flat().filter((v) => Number.isFinite(v))

export function fitLevels(lists, { span = 48, minSpan = 18, step = 5, include = [] } = {}) {
  const vs = finite([...lists, include])
  if (!vs.length) return [-minSpan, 0]
  const top = Math.max(...vs)
  const bottom = Math.min(...vs)
  let hi = Math.ceil((top + 1.5) / step) * step
  let lo = Math.floor(Math.max(bottom - 1.5, hi - span) / step) * step
  while (hi - lo < minSpan) {
    hi += step
    if (hi - lo < minSpan) lo -= step
  }
  return [lo, hi]
}

export function fitFromZero(lists, refs = [], reach = 2) {
  const vs = finite(lists)
  let top = vs.length ? Math.max(...vs) : 0
  for (const r of refs) if (Number.isFinite(r) && r > top && r <= reach * top) top = r
  return [0, top > 0 ? top * 1.08 : 1]
}

export function fitLog(lists, decades = 4) {
  const vs = finite(lists).filter((v) => v > 0)
  if (!vs.length) return [0.1, 1]
  const top = Math.max(...vs)
  const lo = Math.max(Math.min(...vs), top / 10 ** decades)
  return [lo / 1.3, top * 1.3]
}
