import React, { useState } from 'react'

export const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i

export function readNumber(text, { min, max, above, integer, allowEmpty, validate } = {}) {
  const t = String(text).trim()
  if (!t) return allowEmpty ? { ok: true, value: null } : { ok: false, error: 'Enter a number' }
  if (!NUMBER.test(t)) return { ok: false, error: 'Not a number' }
  const v = parseFloat(t)
  if (!Number.isFinite(v)) return { ok: false, error: 'Not a number' }
  if (integer && !Number.isInteger(v)) return { ok: false, error: 'Must be a whole number' }
  if (min != null && min !== '' && v < Number(min)) return { ok: false, error: `Must be at least ${min}` }
  if (above != null && above !== '' && !(v > Number(above))) return { ok: false, error: `Must be more than ${above}` }
  if (max != null && max !== '' && v > Number(max)) return { ok: false, error: `Must be at most ${max}` }
  const why = validate?.(v)
  if (why) return { ok: false, error: why }
  return { ok: true, value: v }
}

export function useDraft({ value, read, onCommit, format = (v) => (v == null ? '' : String(v)) }) {
  const [draft, setText] = useState(null)
  const r = draft == null ? null : read(draft)
  const error = r && !r.ok ? r.error : null
  const apply = () => {
    if (draft == null) return true
    if (!r.ok) return false
    if (r.value !== value) onCommit(r.value)
    setText(null)
    return true
  }
  const onChange = (e) => setText(e.target.value)
  const onBlur = () => { if (!apply()) setText(null) }
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply() }
    else if (e.key === 'Escape' && draft != null) { e.preventDefault(); e.stopPropagation(); setText(null) }
  }
  return { text: draft ?? format(value), editing: draft != null, error, setText, onChange, onBlur, onKeyDown }
}

export default function NumInput({ value, onCommit, min, max, above, integer, allowEmpty, validate, format, step, className, title, ...rest }) {
  const limits = { min, max, above, integer, allowEmpty, validate }
  const read = (t) => readNumber(t, limits)
  const d = useDraft({ value, onCommit, format, read })
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      className={`num${d.error ? ' invalid' : ''}${className ? ` ${className}` : ''}`}
      value={d.text}
      title={d.error || title || ''}
      aria-invalid={d.error ? true : undefined}
      onChange={d.onChange}
      onBlur={d.onBlur}
      onKeyDown={(e) => {
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !rest.readOnly) {
          e.preventDefault()
          if (value == null && !d.editing) return
          const base = readNumber(d.text, { allowEmpty: false })
          const from = base.ok ? base.value : Number(value) || 0
          const delta = (Number(step) || 1) * (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)
          const next = Number((from + delta).toPrecision(12))
          const r = readNumber(String(next), limits)
          if (!r.ok) return
          d.setText(null)
          if (r.value !== value) onCommit(r.value)
          return
        }
        d.onKeyDown(e)
      }}
    />
  )
}

export function readNumberList(text, limits = {}) {
  const parts = String(text).split(/[\s,;]+/).filter(Boolean)
  if (!parts.length) return { ok: false, error: 'Enter at least one number' }
  const value = []
  for (const part of parts) {
    const r = readNumber(part, limits)
    if (!r.ok) return { ok: false, error: `${part}: ${r.error}` }
    value.push(r.value)
  }
  return { ok: true, value }
}

const listText = (list) => list.join(', ')

export function ListInput({ value, onCommit, min, above, title, ...rest }) {
  const commitList = (list) => { if (list.join() !== value.join()) onCommit(list) }
  const readList = (t) => readNumberList(t, { min, above })
  const d = useDraft({ value, onCommit: commitList, format: listText, read: readList })
  return (
    <input
      {...rest}
      type="text"
      spellCheck={false}
      autoComplete="off"
      className={d.error ? 'invalid' : ''}
      value={d.text}
      title={d.error || title || ''}
      aria-invalid={d.error ? true : undefined}
      onChange={d.onChange}
      onBlur={d.onBlur}
      onKeyDown={d.onKeyDown}
    />
  )
}
