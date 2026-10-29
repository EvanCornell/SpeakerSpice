import React, { useState } from 'react'
import { useStore } from '../store'
import { readDrivers, DRIVERS_PATH } from '../workspace'
import { useBackdropDismiss } from '../utils/backdrop'

export default function SaveDriverPrompt() {
  const id = useStore((s) => s.saveDriverFor)
  const setSaveDriverFor = useStore((s) => s.setSaveDriverFor)
  const saveDriverAsCustom = useStore((s) => s.saveDriverAsCustom)
  const node = useStore((s) => s.nodes.find((n) => n.id === s.saveDriverFor))
  const workspace = useStore((s) => s.workspace)
  const [name, setName] = useState(null)

  const dismiss = useBackdropDismiss(() => setSaveDriverFor(null))
  if (!id || !node) return null

  const value = name ?? node.data.params.label ?? ''
  const trimmed = value.trim()
  const existing = readDrivers(workspace).some((d) => d.model === trimmed)

  const save = () => {
    if (!trimmed) return
    saveDriverAsCustom(id, trimmed)
    setSaveDriverFor(null)
  }

  return (
    <div className="modal-backdrop" {...dismiss}>
      <div className="modal sdp">
        <h3>Save driver to library</h3>
        <p className="sdp-lead">
          Stored in this workspace as <code>{DRIVERS_PATH}</code>, and listed
          under <b>Custom</b> in the database.
        </p>
        <div className="param-row">
          <label>Name</label>
          <input
            autoFocus
            value={value}
            placeholder="e.g. Dayton UM12-22"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setSaveDriverFor(null)
            }}
          />
          <span className="unit" />
        </div>
        {existing && (
          <div className="sdp-note">
            The library already has a driver called <b>{trimmed}</b>. Saving
            replaces it.
          </div>
        )}
        <div className="close-row">
          <button onClick={() => setSaveDriverFor(null)}>Cancel</button>
          <button className="primary" disabled={!trimmed} onClick={save}>
            {existing ? 'Replace' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
