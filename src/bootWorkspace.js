import { readStoredWorkspace } from './utils/folder'

let preloaded = null

export async function preloadWorkspace() {
  preloaded = await readStoredWorkspace()
}

export function preloadedWorkspace() {
  return preloaded
}
