import { runLocal } from '../spice/run'

const WARM_NETLIST = 'warm\nV1 1 0 dc 0 ac 1\nR1 1 0 1\n.ac lin 1 1 1\n.end'

function buffers(vectors) {
  const out = []
  for (const v of vectors.values()) {
    if (v.re) out.push(v.re.buffer, v.im.buffer)
    else out.push(v.buffer)
  }
  return out
}

self.onmessage = async (e) => {
  const { tid, netlist, kind, warm } = e.data
  if (warm) {
    try { await runLocal(WARM_NETLIST, 'complex') } catch {  }
    self.postMessage({ warm: true })
    return
  }
  try {
    const { scale, vectors } = await runLocal(netlist, kind)
    self.postMessage({ tid, ok: true, scale, vectors }, buffers(vectors))
  } catch (err) {
    self.postMessage({ tid, ok: false, error: err.message, spiceErrors: err.spiceErrors || [] })
  }
}
