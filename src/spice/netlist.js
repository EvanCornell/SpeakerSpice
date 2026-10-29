export const DC_TIE = 1e-3

export function fmt(v) {
  if (!Number.isFinite(v)) throw new Error(`non-finite netlist value ${v}`)
  return Number(v.toPrecision(12)).toString()
}

export function createNetlist(title) {
  const lines = [`* ${String(title).replace(/[\r\n]+/g, ' ')}`]
  const counters = {}
  let nodes = 0
  return {
    lines,
    node() {
      nodes += 1
      return `n${nodes}`
    },
    add(letter, pins, value, note) {
      counters[letter] = (counters[letter] || 0) + 1
      const name = `${letter}${counters[letter]}`
      lines.push(`${name} ${pins.join(' ')} ${value}${note ? ` ; ${String(note).replace(/[\r\n]+/g, ' ')}` : ''}`)
      return name
    },
    comment(text) {
      lines.push(`* ${String(text).replace(/[\r\n]+/g, ' ')}`)
    },
    text() {
      return lines.join('\n')
    },
  }
}

export function resistor(nl, a, b, R, note) {
  return nl.add('R', [a, b], fmt(R), note)
}

export function sense(nl, a, note, to) {
  const mid = nl.node()
  const out = to || nl.node()
  const name = nl.add('V', [a, mid], 'DC 0', note)
  resistor(nl, mid, out, DC_TIE)
  return { name, out }
}
