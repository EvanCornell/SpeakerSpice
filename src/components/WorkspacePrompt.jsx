import React from 'react'
import { useStore } from '../store'
import { supportsFolders } from '../utils/folder'
import { connectFolderWithPrompt } from '../utils/folderPrompts'

export default function WorkspacePrompt() {
  const show = useStore((s) => s.workspacePrompt)
  const name = useStore((s) => s.workspace.name)
  const canUseFolder = supportsFolders()
  if (!show) return null

  const choose = () => useStore.getState().chooseWorkspaceStorage('browser')

  const chooseFolder = async () => {
    const result = await connectFolderWithPrompt()
    if (result.error) alert(result.error)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wsp" style={{ maxWidth: 520, minWidth: 420 }}>
        <h3>Where should your work be kept?</h3>
        <p className="wsp-lead">
          SpeakerSpice keeps your projects in a <b>workspace</b> — a set of files and
          folders you can download, edit and bring back. Starting in <b>{name}</b>.
        </p>

        {canUseFolder ? (
          <button className="wsp-option chosen" onClick={chooseFolder}>
            <span className="wsp-dot" />
            <span className="wsp-body">
              <span className="wsp-title">A folder on this computer</span>
              <span className="wsp-desc">
                Real files written straight to a folder you pick, saved as you
                work. Yours to back up, sync and keep in version control — and a
                folder that already holds a workspace opens instead.
              </span>
            </span>
          </button>
        ) : (
          <div className="wsp-option disabled">
            <span className="wsp-dot" />
            <span className="wsp-body">
              <span className="wsp-title">A folder on this computer <em>— not in this browser</em></span>
              <span className="wsp-desc">
                Chrome and Edge can write straight to a folder you pick. This
                browser cannot yet.
              </span>
            </span>
          </div>
        )}

        <button className="wsp-option" onClick={choose}>
          <span className="wsp-dot" />
          <span className="wsp-body">
            <span className="wsp-title">This browser</span>
            <span className="wsp-desc">
              Available now, on this machine, in this browser. It is not permanent
              storage: clearing site data removes it. Download your workspace
              regularly — the panel tells you how long it has been.
            </span>
          </span>
        </button>

        <div className="close-row">
          <button onClick={choose}>Skip for now</button>
          <button className="primary" onClick={canUseFolder ? chooseFolder : choose}>
            {canUseFolder ? 'Choose a folder…' : 'Use this browser'}
          </button>
        </div>
      </div>
    </div>
  )
}
