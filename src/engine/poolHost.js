import { createPool, poolSize } from './pool.js'

let pool = null

function spawnEngine() {
  return new Worker(new URL('./spiceWorker.js', import.meta.url), { type: 'module' })
}

export function getPool() {
  if (!pool) {
    pool = createPool({ spawn: spawnEngine, size: poolSize() })
  }
  return pool
}

function buffers(vectors) {
  const out = []
  for (const v of vectors.values()) {
    if (v.re) out.push(v.re.buffer, v.im.buffer)
    else out.push(v.buffer)
  }
  return out
}

export function relay(worker, data, lane) {
  if (data?.type !== 'spice') return false
  getPool().run(data.netlist, data.kind, lane).then(
    (r) => { try { worker.postMessage({ type: 'spice-reply', rid: data.rid, ok: true, scale: r.scale, vectors: r.vectors }, buffers(r.vectors)) } catch {  } },
    (err) => { try { worker.postMessage({ type: 'spice-reply', rid: data.rid, ok: false, error: err.message, spiceErrors: err.spiceErrors || [] }) } catch {  } },
  )
  return true
}

export function cancelLane(lane) {
  if (pool) pool.cancel(lane)
}
