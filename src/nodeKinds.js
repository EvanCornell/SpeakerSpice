export const NODE_KINDS = [
  { type: 'driver', color: 'var(--s1)', name: 'Driver', desc: 'Loudspeaker motor system with T/S parameters, amplifier coupling and array options.' },
  { type: 'chamber', color: 'var(--s2)', name: 'Chamber', desc: 'Enclosed air volume modeled as a transmission line — standing waves included.' },
  { type: 'waveguide', color: 'var(--s3)', name: 'Waveguide Segment', short: 'Waveguide', desc: 'Duct, port or horn segment. Straight port when S1 = S2. Unconnected mouth = open end; cap with a Rigid wall Radiation node to close it.' },
  { type: 'pr', color: 'var(--s4)', name: 'Passive Radiator', short: 'Passive radiator', desc: 'Drone cone: mass-loaded membrane, tunable with added mass.' },
  { type: 'radiation', color: 'var(--s5)', name: 'Radiation Termination', short: 'Radiation', desc: 'What an opening radiates into: 4π/2π/π/π⁄2 space, rigid wall, or anechoic.' },
]

export const NODE_DRAG_TYPE = 'application/speakerspice-node'
