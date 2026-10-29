import { splitAc, mergeAc } from '../spice/split.js'

export const LANES = ['live', 'td']

export const RESERVE = 1

export function poolSize(nav = globalThis.navigator) {
  return Math.max(1, Math.floor(Number(nav?.hardwareConcurrency) || 4))
}

function cancelled() {
  const err = new Error('Cancelled')
  err.name = 'Cancelled'
  return err
}

export function createPool({ spawn, size }) {
  const workers = []
  const queue = []
  const active = { live: 0, td: 0 }
  let nextId = 0
  const limit = (lane) => (lane === 'live' ? size + RESERVE : size)

  const add = () => {
    const entry = { w: spawn(), task: null, warm: false }
    entry.w.onmessage = (e) => {
      entry.warm = true
      if (e.data?.warm) { dispatch(); return }
      const t = entry.task
      if (!t || t.id !== e.data.tid) return
      entry.task = null
      active[t.lane]--
      if (e.data.ok) t.resolve({ scale: e.data.scale, vectors: e.data.vectors })
      else {
        const err = new Error(e.data.error)
        err.spiceErrors = e.data.spiceErrors || []
        t.reject(err)
      }
      dispatch()
    }
    entry.w.onerror = () => {
      drop(entry)
      const t = entry.task
      if (t) {
        active[t.lane]--
        entry.task = null
        if (t.retried) t.reject(new Error('A simulation thread stopped unexpectedly, twice, on the same run'))
        else { t.retried = true; queue.unshift(t) }
      }
      dispatch()
    }
    workers.push(entry)
    return entry
  }

  const drop = (entry) => {
    const i = workers.indexOf(entry)
    if (i >= 0) workers.splice(i, 1)
    try { entry.w.terminate() } catch {  }
  }

  const idle = () => workers.find((e) => !e.task && e.warm) || workers.find((e) => !e.task) || null

  const dispatch = () => {
    for (;;) {
      let placed = false
      for (const lane of LANES) {
        if (lane === 'td' && active.td >= size) continue
        const i = queue.findIndex((t) => t.lane === lane)
        if (i < 0) continue
        let entry = idle()
        if (!entry && workers.length < limit(lane)) entry = add()
        if (!entry) continue
        const [t] = queue.splice(i, 1)
        entry.task = t
        active[lane]++
        entry.w.postMessage({ tid: t.id, netlist: t.netlist, kind: t.kind })
        placed = true
        break
      }
      if (!placed) return
    }
  }

  const submit = (netlist, kind, lane) => new Promise((resolve, reject) => {
    queue.push({ id: ++nextId, netlist, kind, lane, resolve, reject })
    dispatch()
  })

  const pieces = (lane) => {
    if (lane === 'live') return Math.max(1, workers.filter((e) => !e.task && e.warm).length)
    const queued = queue.filter((t) => t.lane === 'td').length
    return Math.max(1, size - active.td - queued)
  }

  const run = async (netlist, kind, lane = 'td') => {
    warm(size)
    const parts = kind === 'complex' ? splitAc(netlist, pieces(lane)) : [netlist]
    const results = await Promise.all(parts.map((p) => submit(p, kind, lane)))
    return mergeAc(results)
  }

  const warm = (n = size) => {
    while (workers.length < Math.min(n, size)) add().w.postMessage({ warm: true })
  }

  const cancel = (lane) => {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].lane === lane) queue.splice(i, 1)[0].reject(cancelled())
    }
    for (const entry of workers.filter((e) => e.task?.lane === lane)) {
      drop(entry)
      entry.task.reject(cancelled())
      entry.task = null
    }
    active[lane] = 0
    dispatch()
  }

  const stats = () => ({ size, workers: workers.length, busy: workers.filter((e) => e.task).length, queued: queue.length })

  return { run, warm, cancel, stats, size }
}
