import { useStore } from '../store'

export function connectFolderWithPrompt() {
  return useStore.getState().connectWorkspaceFolder(
    (info) => confirm(`“${info.name}” already holds a workspace — ${info.files} file${info.files === 1 ? '' : 's'}. `
      + 'Open it? The workspace currently in this browser is replaced.'),
  )
}

export async function disconnectFolderWithPrompt() {
  const name = useStore.getState().folderName
  if (!confirm(`Stop saving to “${name}”? The folder keeps everything already in it, and the workspace stays in this browser.`)) {
    return false
  }
  await useStore.getState().disconnectWorkspaceFolder()
  return true
}
