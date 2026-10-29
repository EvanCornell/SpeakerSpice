import React from 'react'
import { NUMBER, useDraft } from './NumInput'
import { evaluateExpression, isExpression } from '../schema/params'
import { useParamValues } from '../useResolved'

export const shortNum = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '—')

export function readTyped(text, values) {
  const t = text.trim()
  if (!t) return { ok: false, error: 'empty' }
  if (NUMBER.test(t)) return { ok: true, value: parseFloat(t) }
  const r = evaluateExpression(t, values)
  if (r.error) return { ok: false, error: r.error }
  return { ok: true, value: t }
}

export default function ExprInput({ value, onCommit, step, min, above, placeholder, disabled, title }) {
  const { values } = useParamValues()
  const read = (t) => {
    const r = readTyped(t, values)
    if (r.ok && typeof r.value === 'number' && min != null && r.value < Number(min)) return { ok: false, error: `Must be at least ${min}` }
    if (r.ok && typeof r.value === 'number' && above != null && !(r.value > Number(above))) return { ok: false, error: `Must be more than ${above}` }
    return r.error === 'empty' ? { ok: false, error: 'Enter a number or an expression' } : r
  }
  const d = useDraft({ value, read, onCommit })
  const expr = isExpression(value)
  const resolved = expr ? evaluateExpression(value, values) : null
  return (
    <span className="expr-input">
      <input
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        className={d.error ? 'invalid' : ''}
        value={d.text}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={d.error ? true : undefined}
        title={d.error || title || 'A number, or an expression over the project parameters, e.g. Vb / 2'}
        onChange={d.onChange}
        onBlur={d.onBlur}
        onKeyDown={(e) => {
          if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || isExpression(value)) { d.onKeyDown(e); return }
          e.preventDefault()
          if (value == null || value === '') return
          const delta = (Number(step) || 1) * (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)
          const next = Number((Number(value || 0) + delta).toPrecision(12))
          if ((min != null && next < Number(min)) || (above != null && !(next > Number(above)))) return
          d.setText(null)
          onCommit(next)
        }}
      />
      {expr && <span className="expr-value" title={resolved.error || ''}>= {resolved.error ? '?' : shortNum(resolved.value)}</span>}
    </span>
  )
}
