export const CHANNEL_COLORS = [
  ['#3f86d6', '#24578f'], ['#d9822b', '#8f5317'], ['#2f9e78', '#1c6a50'],
  ['#9466cc', '#5f3d8a'], ['#d1527a', '#8c3150'], ['#7d8792', '#4d555e'],
]

export const LOOSE = ['#9aa0aa', '#6b6e75']

export const colorsOf = (i) => (i >= 0 ? CHANNEL_COLORS[i % CHANNEL_COLORS.length] : LOOSE)
