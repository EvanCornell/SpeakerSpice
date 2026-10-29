import React from 'react'
import { useStore } from '../store'
import ExprInput, { shortNum } from './ExprInput'
import { useDraft } from './NumInput'
import { useParamValues } from '../useResolved'
import { isValidParamName } from '../schema/params'
import { freshId } from '../schema/extras'

const NAME_RULE = 'A name is letters, digits and _, starting with a letter, and not a function or constant name'

const readName = (t) => (isValidParamName(t.trim()) ? { ok: true, value: t.trim() } : { ok: false, error: NAME_RULE })

function NameInput({ name, stored, onCommit }) {
  const d = useDraft({ value: name, onCommit, read: readName })
  const bad = d.editing ? d.error : (stored ? null : NAME_RULE)
  return (
    <input
      className={`vars-name${bad ? ' invalid' : ''}`}
      value={d.text}
      spellCheck={false}
      autoComplete="off"
      title={bad || 'Name'}
      onChange={d.onChange}
      onBlur={d.onBlur}
      onKeyDown={d.onKeyDown}
    />
  )
}

export default function VariablesPanel() {
  const params = useStore((s) => s.projectExtras.params) || []
  const setExtra = useStore((s) => s.setExtra)
  const { values, errors } = useParamValues()
  const edit = (i, change, live) => setExtra('params', params.map((p, k) => (k === i ? { ...p, ...change } : p)), !live)
  return (
    <div className="panel-scroll">
      <div className="panel-section">
        <h4>Project parameters</h4>
        <div className="ts-hint">
          Define a value once and use it by name in any numeric field — type
          <code> Vb / 2</code> into a chamber's volume, for example. Functions:
          sqrt, min, max, abs, log, log10, exp, pow, round, floor, ceil; constants pi and e.
        </div>
        <div className="vars-table">
          {params.map((p, i) => {
            const nameOk = isValidParamName(p.name)
            return (
              <div className="vars-row" key={i}>
                <NameInput name={p.name} stored={nameOk} onCommit={(name) => edit(i, { name })} />
                <span className="vars-eq">=</span>
                <ExprInput value={p.value} onCommit={(v) => edit(i, { value: v })} />
                <span className="vars-val" title="Resolved value">{p.name in values ? shortNum(values[p.name]) : '?'}</span>
                <input className="vars-note" value={p.note || ''} placeholder="note" onChange={(e) => edit(i, { note: e.target.value || undefined }, true)} />
                <button className="icon-btn" title="Remove" onClick={() => setExtra('params', params.filter((_, k) => k !== i))}>✕</button>
              </div>
            )
          })}
        </div>
        <button onClick={() => setExtra('params', [...params, { name: freshId('p', params.map((p) => p.name)), value: 1 }])}>+ Parameter</button>
        {errors.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {errors.map((e, i) => <div key={i} className="node-warning"><span className="warn-dot" /> {e}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}
