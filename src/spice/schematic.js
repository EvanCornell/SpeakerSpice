const ELEMENTS = {
  R: { type: 'r_v', inputs: ['A'], outputs: ['B'] },
  C: { type: 'c_v', inputs: ['A'], outputs: ['B'] },
  L: { type: 'l_v', inputs: ['A'], outputs: ['B'] },
  V: { type: 'v', inputs: ['+'], outputs: ['-'] },
  I: { type: 'i', inputs: ['+'], outputs: ['-'] },
  E: { type: 'VCVS', outputs: ['+', '-'], inputs: ['c+', 'c-'], order: ['+', '-', 'c+', 'c-'] },
  G: { type: 'VCCS', outputs: ['+', '-'], inputs: ['c+', 'c-'], order: ['+', '-', 'c+', 'c-'] },
  F: { type: 'CCCS', inputs: ['+'], outputs: ['-'] },
  H: { type: 'CCVS', inputs: ['+'], outputs: ['-'] },
  B: { type: 'B source', inputs: ['+'], outputs: ['-'] },
  T: { type: 'T line', inputs: ['1+', '1-'], outputs: ['2+', '2-'], order: ['1+', '1-', '2+', '2-'] },
}

function short(text) {
  const v = Number(text)
  return Number.isFinite(v) && /^[-+.\deE]+$/.test(text) ? String(Number(v.toPrecision(4))) : text
}

function valueOf(letter, rest) {
  let v
  if (letter === 'T') {
    v = rest.map((t) => t.replace(/^(\w+)=(.*)$/, (_, k, x) => `${k}=${short(x)}`)).join(' ')
  } else if (letter === 'F' || letter === 'H') {
    v = `${short(rest[1] || '')} × i(${rest[0] || '?'})`
  } else if (letter === 'B') {
    v = rest.join(' ')
  } else {
    v = rest.map(short).join(' ')
  }
  return v.length > 48 ? `${v.slice(0, 47)}…` : v
}

export function netlistToYosys(netlist) {
  const cells = {}
  const nets = new Map()
  let nextNet = 2
  let grounds = 0
  let elements = 0
  const netOf = (node) => {
    const key = node.toLowerCase()
    if (key === '0' || key === 'gnd') {
      const n = nextNet++
      cells[`gnd${++grounds}`] = { type: 'gnd', port_directions: { A: 'input' }, connections: { A: [n] } }
      return n
    }
    if (!nets.has(key)) nets.set(key, nextNet++)
    return nets.get(key)
  }
  const lines = netlist.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\s;.*$/, '').trim()
    if (!line || line[0] === '*' || line[0] === '.' || line[0] === '+') continue
    const tokens = line.split(/\s+/)
    const name = tokens[0]
    const letter = name[0].toUpperCase()
    const spec = ELEMENTS[letter] || { type: letter, inputs: ['A'], outputs: ['B'] }
    const order = spec.order || [...spec.inputs, ...spec.outputs]
    const nodes = tokens.slice(1, 1 + order.length)
    if (nodes.length < order.length) continue
    const port_directions = {}
    const connections = {}
    order.forEach((port, k) => {
      port_directions[port] = spec.inputs.includes(port) ? 'input' : 'output'
      connections[port] = [netOf(nodes[k])]
    })
    const value = valueOf(letter, tokens.slice(1 + order.length))
    const boxed = !['r_v', 'c_v', 'l_v', 'v', 'i'].includes(spec.type)
    cells[name] = {
      type: boxed ? `${name} ${spec.type}: ${value}` : spec.type,
      port_directions,
      connections,
      attributes: { value },
    }
    elements++
  }
  return { modules: { circuit: { ports: {}, cells } }, elements }
}

export async function netlistToSvg(netlist, lib) {
  const { modules, elements } = netlistToYosys(netlist)
  if (!elements) throw new Error('The netlist has no elements to draw.')
  const svg = await lib.render(lib.skin, { modules })
  if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('The circuit could not be laid out.')
  return svg
}
