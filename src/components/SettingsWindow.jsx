import React, { useEffect, useState } from 'react'
import { THEMES } from '../theme'
import { useStore } from '../store'
import NumInput from './NumInput'
import { TOOLBAR_ITEMS, TOOLBAR_GROUPS, ALL_ITEM_IDS } from '../toolbarItems'
import { COMMANDS, COMMAND_GROUPS, DEFAULT_BINDINGS, comboFromEvent, formatCombo } from '../keymap'

const card = {
  background: 'var(--panel-2)', border: 'none',
  borderRadius: 14, padding: 14, marginBottom: 10, maxWidth: 580,
}
const h = { margin: '0 0 10px', fontSize: 13, fontWeight: 500 }
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '5px 8px', marginBottom: 8,
  background: 'var(--field)', color: 'var(--text)',
  border: '1px solid transparent', borderRadius: 8, fontSize: 13,
}
const btn = {
  padding: '5px 12px', borderRadius: 8, border: '1px solid transparent',
  background: 'var(--btn)', color: 'var(--text)', cursor: 'pointer', fontSize: 12,
}
const okStyle = { color: 'var(--green)', fontSize: 12, margin: '4px 0 8px' }
const dim = { color: 'var(--text-3)', fontSize: 12, lineHeight: 1.5 }

function ApplicationSection() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const row = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }
  return (
    <>
      <div style={card}>
        <h4 style={h}>Appearance</h4>
        <div className="seg" role="radiogroup" aria-label="Appearance">
          {THEMES.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={theme === k} className={theme === k ? 'on' : ''}
              onClick={() => setTheme(k)}>{label}</button>
          ))}
        </div>
      </div>
      <div style={card}>
        <h4 style={h}>Simulation</h4>
        <label style={row}>
          Frequency sweep
          <NumInput
            above="0" style={{ ...inputStyle, width: 80, marginBottom: 0 }}
            value={settings.fmin}
            validate={(v) => (v < settings.fmax ? null : 'Must be below the end frequency')}
            onCommit={(v) => updateSettings({ fmin: v })}
          />
          to
          <NumInput
            style={{ ...inputStyle, width: 80, marginBottom: 0 }}
            value={settings.fmax} above={settings.fmin}
            onCommit={(v) => updateSettings({ fmax: v })}
          /> Hz
        </label>
        <label style={{ ...row, cursor: 'pointer', marginBottom: 0 }}>
          <input type="checkbox" checked={!!settings.masking}
            onChange={(e) => updateSettings({ masking: e.target.checked })} />
          Mask chamber resonances
        </label>
        <div style={{ ...dim, marginTop: 6 }}>
          Masking switches chambers to lumped compliances, hiding the standing-wave
          peaks at n·c/2L so the underlying alignment is easier to read.
        </div>
      </div>
      <div style={card}>
        <h4 style={h}>Charts</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
          Port velocity warning threshold
          <NumInput
            style={{ ...inputStyle, width: 80, marginBottom: 0 }}
            value={settings.vThreshold} above="0"
            onCommit={(v) => updateSettings({ vThreshold: v })}
          /> m/s
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!settings.unwrapPhase}
            onChange={(e) => updateSettings({ unwrapPhase: e.target.checked })} />
          Unwrap phase in the Phase &amp; Group Delay chart
        </label>
      </div>
    </>
  )
}

function QuickBarSection() {
  const toolbar = useStore((s) => s.toolbar)
  const toggleToolbarItem = useStore((s) => s.toggleToolbarItem)
  const moveToolbarItem = useStore((s) => s.moveToolbarItem)
  const resetToolbar = useStore((s) => s.resetToolbar)

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px',
    borderRadius: 8, fontSize: 13,
  }

  return (
    <>
      <div style={card}>
        <h4 style={h}>Quick bar contents</h4>
        <div style={{ ...dim, marginBottom: 12 }}>
          Choose what appears in the strip under the menu bar and in what order.
          Shown items are listed first, in bar order — use ▲ ▼ to rearrange them.
        </div>

        {TOOLBAR_GROUPS.map(([group, groupLabel]) => {
          const shown = toolbar.filter((id) => TOOLBAR_ITEMS[id].group === group)
          const hidden = ALL_ITEM_IDS.filter((id) => TOOLBAR_ITEMS[id].group === group && !toolbar.includes(id))
          return (
            <div key={group} style={{ marginBottom: 14 }}>
              <div style={{ ...dim, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10.5, marginBottom: 4 }}>
                {groupLabel}
              </div>
              {shown.map((id) => (
                <div key={id} style={rowStyle}>
                  <input type="checkbox" checked onChange={() => toggleToolbarItem(id)} />
                  <span style={{ flex: 1 }}>{TOOLBAR_ITEMS[id].label}</span>
                  <button style={{ ...btn, padding: '2px 7px' }} title="Move earlier"
                    disabled={toolbar.indexOf(id) === 0}
                    onClick={() => moveToolbarItem(id, -1)}>▲</button>
                  <button style={{ ...btn, padding: '2px 7px' }} title="Move later"
                    disabled={toolbar.indexOf(id) === toolbar.length - 1}
                    onClick={() => moveToolbarItem(id, 1)}>▼</button>
                </div>
              ))}
              {hidden.map((id) => (
                <div key={id} style={{ ...rowStyle, color: 'var(--text-3)' }}>
                  <input type="checkbox" checked={false} onChange={() => toggleToolbarItem(id)} />
                  <span style={{ flex: 1 }}>{TOOLBAR_ITEMS[id].label}</span>
                </div>
              ))}
            </div>
          )
        })}

        <button style={btn} onClick={resetToolbar}>Restore defaults</button>
      </div>
    </>
  )
}

function ComboChip({ combo, onRemove, onClick }) {
  return (
    <span className="key-chip" onClick={onClick} title="Click to replace this shortcut">
      <kbd>{formatCombo(combo)}</kbd>
      <span className="kc-x" title="Remove this shortcut"
        onClick={(e) => { e.stopPropagation(); onRemove() }}>✕</span>
    </span>
  )
}

function KeyboardSection() {
  const bindings = useStore((s) => s.bindings)
  const assignBinding = useStore((s) => s.assignBinding)
  const removeBinding = useStore((s) => s.removeBinding)
  const resetBindings = useStore((s) => s.resetBindings)
  const [recording, setRecording] = useState(null)
  const [note, setNote] = useState(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      const combo = comboFromEvent(e)
      if (!combo) return
      if (recording.replacing) removeBinding(recording.id, recording.replacing)
      const stolen = assignBinding(recording.id, combo)
      setNote(stolen
        ? `${formatCombo(combo)} was taken from “${COMMANDS[stolen].label}”.`
        : null)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, assignBinding, removeBinding])

  const isDefault = (id) => {
    const def = DEFAULT_BINDINGS[id] || []
    const cur = bindings[id] || []
    return cur.length === def.length && cur.every((c, i) => c === def[i])
  }

  return (
    <>
      <div style={{ ...card, maxWidth: 640 }}>
        <h4 style={h}>Keyboard shortcuts</h4>
        <div style={{ ...dim, marginBottom: 4 }}>
          Click a shortcut to replace it, or <b>+</b> to add a second one to the
          same command. Assigning a combo that is already in use takes it from
          the other command. Escape cancels while recording.
        </div>
        <div style={{ ...dim, marginBottom: 12 }}>
          Shortcuts marked <i>editor</i> only fire while the Node Editor has
          focus, which is what lets bare letters place components without
          getting in the way of typing elsewhere.
        </div>
        {note && <div style={{ ...okStyle, marginBottom: 8 }}>{note}</div>}

        {COMMAND_GROUPS.map(([group, ids]) => (
          <div key={group} style={{ marginBottom: 14 }}>
            <div style={{ ...dim, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10.5, marginBottom: 4 }}>
              {group}
            </div>
            {ids.map((id) => (
              <div key={id} className="key-row">
                <span className="kr-label">
                  {COMMANDS[id].label}
                  {COMMANDS[id].scope === 'canvas' && <span className="kr-scope">editor</span>}
                </span>
                <span className="kr-combos">
                  {(bindings[id] || []).map((combo) => (
                    <ComboChip
                      key={combo}
                      combo={combo}
                      onRemove={() => removeBinding(id, combo)}
                      onClick={() => { setNote(null); setRecording({ id, replacing: combo }) }}
                    />
                  ))}
                  {recording?.id === id && <span className="key-chip recording"><kbd>press keys…</kbd></span>}
                  {!recording && (
                    <button className="kr-add" title="Add another shortcut"
                      onClick={() => { setNote(null); setRecording({ id, replacing: null }) }}>+</button>
                  )}
                  {!isDefault(id) && <span className="kr-changed" title="Changed from the default">•</span>}
                </span>
              </div>
            ))}
          </div>
        ))}

        <button style={btn} onClick={() => { setNote(null); resetBindings() }}>Restore defaults</button>
      </div>
    </>
  )
}

const SECTIONS = [
  ['keyboard', 'Keyboard', KeyboardSection],
  ['quickbar', 'Quick bar', QuickBarSection],
  ['app', 'Application', ApplicationSection],
]

export default function SettingsWindow() {
  const show = useStore((s) => s.showSettings)
  const setShow = useStore((s) => s.setShowSettings)
  const section = useStore((s) => s.settingsSection)
  const setSection = useStore((s) => s.setSettingsSection)
  const [drag, setDrag] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!show) return
    const esc = (e) => { if (e.key === 'Escape') setShow(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [show, setShow])

  useEffect(() => { if (show) setDrag({ x: 0, y: 0 }) }, [show])

  const onTitleDown = (e) => {
    if (e.target.closest('button')) return
    const x0 = e.clientX - drag.x
    const y0 = e.clientY - drag.y
    const move = (ev) => setDrag({ x: ev.clientX - x0, y: ev.clientY - y0 })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!show) return null
  const Active = SECTIONS.find(([k]) => k === section)?.[2] || KeyboardSection

  return (
    <div className="float-backdrop" onMouseDown={() => setShow(false)}>
      <div
        className="float-window"
        style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="fw-title" onMouseDown={onTitleDown}>
          <span>Settings</span>
          <button className="fw-close" title="Close (Esc)" onClick={() => setShow(false)}>✕</button>
        </div>
        <div className="fw-body">
          <div className="fw-nav">
            {SECTIONS.map(([k, title]) => (
              <div key={k} className={`fw-nav-item ${section === k ? 'active' : ''}`}
                onClick={() => setSection(k)}>{title}</div>
            ))}
          </div>
          <div className="fw-content">
            <Active />
          </div>
        </div>
      </div>
    </div>
  )
}
