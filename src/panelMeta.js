export const PANEL_META = {
  files: {
    title: 'Workspace',
    group: 'main',
    closable: true,
    dock: { edge: 'left' },
  },
  canvas: {
    title: 'Node Editor',
    group: 'main',
    closable: false,
    dock: { edge: 'right' },
  },
  params: {
    title: 'Parameters',
    group: 'main',
    closable: true,
    dock: { edge: 'right' },
  },
  vars: {
    title: 'Project Parameters',
    group: 'main',
    closable: true,
    dock: { nextTo: 'params', zone: 'center', edge: 'right' },
  },
  probes: {
    title: 'Probes',
    group: 'main',
    closable: true,
    dock: { nextTo: 'params', zone: 'center', edge: 'right' },
  },

  spl: { title: 'SPL Response', group: 'charts' },
  zin: { title: 'Impedance', group: 'charts' },
  exc: { title: 'Cone Excursion', group: 'charts' },
  vel: { title: 'Port Velocity', group: 'charts' },
  int: { title: 'Interior SPL', group: 'charts' },
  pfl: { title: 'Probe Flow & Velocity', group: 'charts' },
  pow: { title: 'Acoustic Power', group: 'charts' },
  eff: { title: 'Efficiency', group: 'charts' },
  pe: { title: 'Electrical Power', group: 'charts' },
  ph: { title: 'Phase & Group Delay', group: 'charts' },
}

export const PANEL_IDS = Object.keys(PANEL_META)

export const CHART_IDS = PANEL_IDS.filter((id) => PANEL_META[id].group === 'charts')
export const MAIN_IDS = PANEL_IDS.filter((id) => PANEL_META[id].group === 'main')

for (const id of CHART_IDS) {
  PANEL_META[id].closable = true
  PANEL_META[id].dock = { nextToAny: CHART_IDS, zone: 'center', edge: 'bottom' }
}

export const panelTitle = (id) => PANEL_META[id]?.title || id
