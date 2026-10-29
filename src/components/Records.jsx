import React from 'react'
import { useStore, isLocked } from '../store'
import { recordName } from '../records'
import { useDraft } from './NumInput'

const readName = (text) => ({ ok: true, value: text.trim() })

function RecordName({ disabled }) {
  const records = useStore((s) => s.records)
  const nav = useStore((s) => s.recordNav)
  const id = records?.ids?.[nav.selected]
  const given = (id && records?.names?.[id]) || ''
  const commit = (v) => { useStore.getState().recordRename(v) }
  const d = useDraft({ value: given, read: readName, onCommit: commit })
  return (
    <input className="rec-name" value={d.text} onChange={d.onChange} onBlur={d.onBlur} onKeyDown={d.onKeyDown} disabled={disabled} placeholder={recordName(records, nav.selected)} spellCheck={false}
      title="Name this record; leave it empty to go by its number" aria-label="Record name" />
  )
}

export function RecordsBar() {
  const nav = useStore((s) => s.recordNav)
  const error = useStore((s) => s.recordError)
  const activeFile = useStore((s) => s.activeFile)
  const st = useStore.getState
  const last = nav.selected === nav.count - 1
  const off = nav.busy || !activeFile
  return (
    <div className={`mb-records${isLocked({ recordNav: nav }) && !nav.busy ? ' locked' : ''}`}
      title={error ? `The last record action failed: ${error}` : 'Records: numbered save states of this project'}>
      <button className="tb-icon" title="Previous record" disabled={off || nav.selected === 0}
        onClick={() => st().recordStep(-1)}>◀</button>
      <span className="rec-num">Record <b>{nav.selected + 1}</b> of {nav.count}</span>
      <button className="tb-icon" title="Next record" disabled={off || last}
        onClick={() => st().recordStep(1)}>▶</button>
      <RecordName disabled={off} />
      <span className="rec-sep" />
      <button className="rec-btn" disabled={off} onClick={() => st().recordAdd()}
        title="Add a record at the end, starting as a copy of this one">Add</button>
      <button className="rec-btn" disabled={off || nav.count <= 1}
        onClick={() => { if (confirm(`Delete record ${nav.selected + 1}? This cannot be undone.`)) st().recordDelete() }}
        title={nav.count <= 1 ? 'A project keeps at least one record' : 'Delete this record'}>Delete</button>
      {!last && (
        <button className={`rec-btn${nav.editing ? ' on' : ''}`} disabled={off}
          onClick={() => st().setRecordEditing(!nav.editing)}
          title={nav.editing ? 'Lock this record again' : 'This is an earlier record, so it is read-only. Edit it.'}>
          {nav.editing ? 'Editing' : 'Edit'}
        </button>
      )}
    </div>
  )
}

export function LockNote() {
  const nav = useStore((s) => s.recordNav)
  if (!isLocked({ recordNav: nav }) || nav.busy) return null
  return (
    <div className="rec-lock-note">
      <span>Record {nav.selected + 1} of {nav.count} is read-only.</span>
      <button className="rec-btn" onClick={() => useStore.getState().setRecordEditing(true)}>Edit</button>
    </div>
  )
}

export function readOnlyWhenLocked(Panel) {
  function Locked(props) {
    const locked = useStore((s) => isLocked(s))
    return (
      <>
        <LockNote />
        <fieldset className="rec-fieldset" disabled={locked}>
          <Panel {...props} />
        </fieldset>
      </>
    )
  }
  Locked.displayName = `ReadOnly(${Panel.displayName || Panel.name || 'Panel'})`
  return Locked
}
