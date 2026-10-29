const OLD_PREFIX = 'acousim:'

const NEW_PREFIX = 'speakerspice:'

export const LEGACY_SYSTEM_FOLDER = '.acousim'

export const LEGACY_PROJECT_EXT = '.acousim'

export const LEGACY_DB_NAME = 'acousim'

export function migrateStorage(storage = globalThis.localStorage) {
  if (!storage) return 0
  let moved = 0
  try {
    const keys = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(OLD_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      const target = NEW_PREFIX + k.slice(OLD_PREFIX.length)
      const value = storage.getItem(k)
      storage.removeItem(k)
      if (storage.getItem(target) != null) continue
      try {
        storage.setItem(target, value)
        moved++
      } catch {
        try { storage.setItem(k, value) } catch {  }
      }
    }
  } catch {  }
  return moved
}

export function modernPath(path, systemFolder, projectExt) {
  if (path === LEGACY_SYSTEM_FOLDER) return systemFolder
  if (path.startsWith(`${LEGACY_SYSTEM_FOLDER}/`)) return systemFolder + path.slice(LEGACY_SYSTEM_FOLDER.length)
  if (path.endsWith(LEGACY_PROJECT_EXT)) return path.slice(0, -LEGACY_PROJECT_EXT.length) + projectExt
  return path
}

export function stripLegacySuffix(name) {
  return name.replace(/\.acousim(\.json)?$/i, '')
}
