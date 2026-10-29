export const THEMES = [
  ['system', 'Match the system'],
  ['dark', 'Dark'],
  ['light', 'Light'],
]

const THEME_KEY = 'speakerspice:theme'

export function loadTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (THEMES.some(([k]) => k === v)) return v
  } catch {  }
  return 'system'
}

export function applyTheme(theme, root = globalThis.document?.documentElement) {
  if (!root) return
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme
  else delete root.dataset.theme
}

export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme) } catch {  }
  applyTheme(theme)
}
