const PANEL_PATH = 'panel'
export const SYNC_CHANNEL = 'speakerspice-sync'

export const SHARED_KEYS = [
  'nodes', 'edges', 'projectName', 'settings', 'projectExtras', 'workspace', 'activeFile',
  'results', 'metrics',
  'selectedNodeId', 'velocityPopupNodeId', 'simError', 'xZoom', 'clipboard',
  'folderStatus', 'folderName', 'folderError', 'folderSaved',
  'recordNav',
]

export const SIM_INPUT_KEYS = ['nodes', 'edges', 'settings', 'projectExtras']

export function popoutPanelIds() {
  if (typeof window === 'undefined') return []
  if (!window.location.pathname.endsWith(`/${PANEL_PATH}`)) return []
  const raw = new URLSearchParams(window.location.search).get('id')
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
}

export function popoutPanelId() {
  const ids = popoutPanelIds()
  if (!ids.length) return null
  const active = new URLSearchParams(window.location.search).get('active')
  return ids.includes(active) ? active : ids[0]
}

export const isPopout = () => popoutPanelId() != null

export function openPanelWindow(id) {
  const w = window.open(`${PANEL_PATH}?id=${encodeURIComponent(id)}`, `speakerspice-panel-${id}`)
  w?.focus()
  return w
}

export function openPanelGroupWindow(ids, active) {
  if (!ids.length) return null
  const front = ids.includes(active) ? active : ids[0]
  const query = `id=${encodeURIComponent(ids.join(','))}&active=${encodeURIComponent(front)}`
  const name = `speakerspice-group-${[...ids].sort().join('-')}`
  const w = window.open(`${PANEL_PATH}?${query}`, name)
  w?.focus()
  return w
}

export const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(SYNC_CHANNEL)
  : null
