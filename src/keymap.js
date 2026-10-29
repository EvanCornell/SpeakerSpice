export const IS_MAC = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')

const NODE_TYPES = [
  ['driver', 'Driver'],
  ['chamber', 'Chamber'],
  ['waveguide', 'Waveguide Segment'],
  ['pr', 'Passive Radiator'],
  ['radiation', 'Radiation Termination'],
]

export const COMMANDS = {
  'edit.undo': {
    label: 'Undo',
    group: 'Edit',
    scope: 'global',
    run: (s) => s.undo(),
  },
  'edit.redo': {
    label: 'Redo',
    group: 'Edit',
    scope: 'global',
    run: (s) => s.redo(),
  },
  'edit.cut': {
    label: 'Cut nodes',
    group: 'Edit',
    scope: 'canvas',
    run: (s) => s.cutSelection(),
  },
  'edit.copy': {
    label: 'Copy nodes',
    group: 'Edit',
    scope: 'canvas',
    run: (s) => s.copySelection(),
  },
  'edit.paste': {
    label: 'Paste nodes',
    group: 'Edit',
    scope: 'canvas',
    run: (s) => s.pasteClipboard(),
  },
  'edit.replace': {
    label: 'Replace with copied node',
    group: 'Edit',
    scope: 'canvas',
    run: (s) => s.replaceSelection(),
  },
  'edit.duplicate': {
    label: 'Duplicate selection',
    group: 'Edit',
    scope: 'canvas',
    run: (s) => s.duplicateSelected(),
  },
  'edit.selectAll': {
    label: 'Select all nodes',
    group: 'Edit',
    scope: 'canvas',
    run: (s) => s.selectAll(),
  },
  'edit.delete': {
    label: 'Delete selection',
    group: 'Edit',
    scope: 'canvas',
    run: (s) => s.deleteSelected(),
  },

  ...Object.fromEntries(NODE_TYPES.map(([type, label]) => [
    `add.${type}`,
    {
      label: `Add ${label}`,
      group: 'Add node',
      scope: 'canvas',
      run: (s) => s.addNodeAtCursor(type),
    },
  ])),

  'drive.up': {
    label: 'Drive +1 V',
    group: 'Drive level',
    scope: 'global',
    run: (s) => s.nudgeVoltage(1),
  },
  'drive.down': {
    label: 'Drive −1 V',
    group: 'Drive level',
    scope: 'global',
    run: (s) => s.nudgeVoltage(-1),
  },
  'drive.upFine': {
    label: 'Drive +0.1 V',
    group: 'Drive level',
    scope: 'global',
    run: (s) => s.nudgeVoltage(0.1),
  },
  'drive.downFine': {
    label: 'Drive −0.1 V',
    group: 'Drive level',
    scope: 'global',
    run: (s) => s.nudgeVoltage(-0.1),
  },

  'project.new': {
    label: 'New project',
    group: 'Project',
    scope: 'global',
    run: (s) => s.newFile(''),
  },
  'project.save': {
    label: 'Export project as JSON',
    group: 'Project',
    scope: 'global',
    run: (s) => s.saveProjectJSON(),
  },
  'sim.snapshot': {
    label: 'Take snapshot',
    group: 'Simulate',
    scope: 'global',
    run: (s) => s.takeSnapshot(),
  },
  'sim.mask': {
    label: 'Toggle resonance masking',
    group: 'Simulate',
    scope: 'global',
    run: (s) => s.updateSettings({ masking: !s.settings.masking }),
  },
  'sim.recompute': {
    label: 'Recompute now',
    group: 'Simulate',
    scope: 'global',
    run: (s) => s.recomputeNow(),
  },

  'view.settings': {
    label: 'Open settings',
    group: 'View',
    scope: 'global',
    run: (s) => s.setShowSettings(true),
  },
  'view.maximize': {
    label: 'Maximize / restore panel',
    group: 'View',
    scope: 'global',
    run: (s) => s.toggleMaximize(s.maximized || s.focusedPanel),
  },
  'view.timedomain': {
    label: 'Time domain & distortion',
    group: 'View',
    scope: 'global',
    run: (s) => (s.tdOpen ? s.closeTimeDomain() : s.openTimeDomain()),
  },
  'view.wiring': {
    label: 'Wiring',
    group: 'View',
    scope: 'global',
    run: (s) => (s.wiringOpen ? s.closeWiring() : s.openWiring()),
  },
  'view.dsp': {
    label: 'DSP',
    group: 'View',
    scope: 'global',
    run: (s) => (s.dspOpen ? s.closeDsp() : s.openDsp()),
  },
  'view.popout': {
    label: 'Open focused panel in a new tab',
    group: 'View',
    scope: 'global',
    run: (s) => s.popOutPanel(s.focusedPanel),
  },
}

export const COMMAND_IDS = Object.keys(COMMANDS)

export const COMMAND_GROUPS = COMMAND_IDS.reduce((acc, id) => {
  const g = COMMANDS[id].group
  if (!acc.some(([name]) => name === g)) acc.push([g, []])
  acc.find(([name]) => name === g)[1].push(id)
  return acc
}, [])

export const DEFAULT_BINDINGS = {
  'edit.undo': ['mod+z'],
  'edit.redo': ['mod+shift+z', 'mod+y'],
  'edit.cut': ['mod+x'],
  'edit.copy': ['mod+c'],
  'edit.paste': ['mod+v'],
  'edit.replace': ['mod+shift+v'],
  'edit.duplicate': ['mod+d'],
  'edit.selectAll': ['mod+a'],
  'edit.delete': ['delete', 'backspace'],

  'add.driver': ['d'],
  'add.chamber': ['c'],
  'add.waveguide': ['w'],
  'add.pr': ['p'],
  'add.radiation': ['r'],

  'drive.up': ['alt+up'],
  'drive.down': ['alt+down'],
  'drive.upFine': ['alt+shift+up'],
  'drive.downFine': ['alt+shift+down'],

  'project.new': ['mod+n'],
  'project.save': ['mod+s'],

  'sim.snapshot': ['alt+s'],
  'sim.mask': ['alt+m'],
  'sim.recompute': ['mod+enter'],

  'view.settings': ['mod+,'],
  'view.maximize': ['alt+enter'],
  'view.popout': ['alt+o'],
  'view.timedomain': ['alt+t'],
  'view.wiring': ['alt+w'],
  'view.dsp': ['alt+d'],
}

const CODE_MAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  Space: 'space', Enter: 'enter', NumpadEnter: 'enter', Escape: 'esc',
  Backspace: 'backspace', Delete: 'delete', Tab: 'tab',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  NumpadAdd: '=', NumpadSubtract: '-',
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

export function keyFromEvent(e) {
  if (MODIFIER_KEYS.has(e.key)) return null
  const c = e.code || ''
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(c)) return c.slice(5)
  if (/^Numpad[0-9]$/.test(c)) return `num${c.slice(6)}`
  if (/^F\d{1,2}$/.test(c)) return c.toLowerCase()
  if (CODE_MAP[c]) return CODE_MAP[c]
  return e.key && e.key.length === 1 ? e.key.toLowerCase() : null
}

export function comboFromEvent(e) {
  const key = keyFromEvent(e)
  if (!key) return null
  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

const DISPLAY = {
  mod: IS_MAC ? '⌘' : 'Ctrl',
  alt: IS_MAC ? '⌥' : 'Alt',
  shift: IS_MAC ? '⇧' : 'Shift',
  up: '↑', down: '↓', left: '←', right: '→',
  enter: 'Enter', esc: 'Esc', space: 'Space', tab: 'Tab',
  delete: 'Del', backspace: 'Backspace',
  pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End',
}

export function formatCombo(combo) {
  if (!combo) return ''
  const parts = combo.split('+').map((p) => DISPLAY[p] || (p.length === 1 ? p.toUpperCase() : p))
  return IS_MAC ? parts.join('') : parts.join('+')
}

export const KEYMAP_KEY = 'speakerspice:keymap'

export function loadBindings() {
  let overrides = {}
  try {
    const raw = JSON.parse(localStorage.getItem(KEYMAP_KEY))
    if (raw && typeof raw === 'object') overrides = raw
  } catch {  }
  const out = {}
  for (const id of COMMAND_IDS) {
    const v = overrides[id]
    out[id] = Array.isArray(v) ? v.filter((c) => typeof c === 'string') : [...(DEFAULT_BINDINGS[id] || [])]
  }
  return out
}

export function saveBindings(bindings) {
  const diff = {}
  for (const id of COMMAND_IDS) {
    const def = DEFAULT_BINDINGS[id] || []
    const cur = bindings[id] || []
    if (cur.length !== def.length || cur.some((c, i) => c !== def[i])) diff[id] = cur
  }
  try {
    if (Object.keys(diff).length) localStorage.setItem(KEYMAP_KEY, JSON.stringify(diff))
    else localStorage.removeItem(KEYMAP_KEY)
  } catch {  }
}

export function findConflict(bindings, combo, exceptId) {
  const scope = COMMANDS[exceptId]?.scope
  for (const id of COMMAND_IDS) {
    if (id === exceptId) continue
    if (!bindings[id]?.includes(combo)) continue
    if (COMMANDS[id].scope === scope || scope === 'global' || COMMANDS[id].scope === 'global') return id
  }
  return null
}

export function resolve(bindings, combo, focusedPanel) {
  let fallback = null
  for (const id of COMMAND_IDS) {
    if (!bindings[id]?.includes(combo)) continue
    const scope = COMMANDS[id].scope
    if (scope === 'canvas') {
      if (focusedPanel === 'canvas') return id
    } else if (!fallback) fallback = id
  }
  return fallback
}
