import { setRunner, setThreads } from '../spice/run.js'

export function installRemoteRunner(scope = self) {
  const pending = new Map()
  let rid = 0
  scope.addEventListener('message', (e) => {
    const d = e.data
    if (d?.type === 'threads') { setThreads(d.n); return }
    if (d?.type !== 'spice-reply') return
    const p = pending.get(d.rid)
    if (!p) return
    pending.delete(d.rid)
    if (d.ok) p.resolve({ scale: d.scale, vectors: d.vectors })
    else {
      const err = new Error(d.error)
      err.spiceErrors = d.spiceErrors || []
      p.reject(err)
    }
  })
  setRunner((netlist, kind) => new Promise((resolve, reject) => {
    const id = ++rid
    pending.set(id, { resolve, reject })
    scope.postMessage({ type: 'spice', rid: id, netlist, kind })
  }))
}

export function isPoolMessage(data) {
  return data?.type === 'spice-reply' || data?.type === 'threads'
}
