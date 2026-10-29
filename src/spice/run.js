let enginePromise = null
let queue = Promise.resolve()
let runner = null
let threads = 1

export function setRunner(fn) {
  runner = fn
}

export function setThreads(n) {
  threads = Math.max(1, Math.floor(Number(n) || 1))
}

export function threadCount() {
  return threads
}

function engine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { Simulation } = await import('eecircuit-engine')
      const sim = new Simulation()
      await sim.start()
      return sim
    })()
    enginePromise.catch(() => { enginePromise = null })
  }
  return enginePromise
}

export function isFatal(line) {
  return /error|singular matrix|not parsed|failed|timestep too small|aborted/i.test(line) && !/^\s*note:/i.test(line)
}

export function runLocal(netlist, kind) {
  const job = queue.then(async () => {
    const sim = await engine()
    let res
    try {
      sim.setNetList(netlist)
      res = await sim.runSim()
    } catch (err) {
      enginePromise = null
      throw new Error(`SPICE stopped: ${err.message || err}`)
    }
    const messages = sim.getError() || []
    const fatal = messages.filter(isFatal)
    if (fatal.length || !res || res.numPoints < 1 || res.dataType !== kind) {
      const err = new Error(`SPICE could not solve this circuit: ${(fatal[0] || messages[0] || 'no result').trim()}`)
      err.spiceErrors = messages
      throw err
    }
    const vectors = new Map()
    let scale = []
    for (const d of res.data) {
      if (d.type === 'frequency' || d.type === 'time') {
        scale = d.values.map((v) => (typeof v === 'number' ? v : v.real))
        continue
      }
      vectors.set(d.name.toLowerCase(), kind === 'complex'
        ? { re: Float64Array.from(d.values, (v) => v.real), im: Float64Array.from(d.values, (v) => v.img) }
        : Float64Array.from(d.values, (v) => (typeof v === 'number' ? v : v.real)))
    }
    return { scale, vectors }
  })
  queue = job.catch(() => {})
  return job
}

function runRaw(netlist, kind) {
  return runner ? runner(netlist, kind) : runLocal(netlist, kind)
}

function lookup(vectors) {
  return (name) => {
    const v = vectors.get(name.toLowerCase())
    if (!v) throw new Error(`SPICE result has no vector ${name}`)
    return v
  }
}

export async function runNetlist(netlist) {
  const { scale, vectors } = await runRaw(netlist, 'complex')
  return { freqs: scale, names: [...vectors.keys()], vec: lookup(vectors) }
}

export async function runTransient(netlist) {
  let { scale, vectors } = await runRaw(netlist, 'real')
  if (scale.length && scale[0] > 0) {
    scale = [0, ...scale]
    const padded = new Map()
    for (const [name, v] of vectors) {
      const a = new Float64Array(v.length + 1)
      a.set(v, 1)
      padded.set(name, a)
    }
    vectors = padded
  }
  return { time: scale, names: [...vectors.keys()], vec: lookup(vectors) }
}
