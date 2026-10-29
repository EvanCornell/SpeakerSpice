import React, { useEffect } from 'react'
import { useStore } from '../store'
import { popoutPanelId, popoutPanelIds } from '../popout'
import { panelTitle } from '../panelMeta'
import { PANELS } from './dock/panels'
import ContextMenu from './ContextMenu'

export default function PopoutView() {
  const held = useStore((s) => s.popoutIds)
  const stored = useStore((s) => s.popoutActive)
  const ids = held.filter((id) => PANELS[id]?.component)
  const active = ids.includes(stored) ? stored : (ids.includes(popoutPanelId()) ? popoutPanelId() : ids[0])
  const projectName = useStore((s) => s.projectName)
  const results = useStore((s) => s.results)

  const onContextMenu = (e) => {
    e.preventDefault()
    useStore.getState().openContextMenu(e.clientX, e.clientY, { kind: 'popout', ids, panelId: active })
  }

  useEffect(() => {
    document.title = `${active ? panelTitle(active) : 'Panel'} — ${projectName || 'SpeakerSpice'}`
  }, [active, projectName])

  if (!ids.length) {
    return (
      <div className="popout">
        <div className="popout-title"><span>Unknown panel</span></div>
        <div className="popout-body" style={{ padding: 24, color: 'var(--text-3)' }}>
          No panel named “{popoutPanelIds().join(', ') || '?'}”. Open one from the View menu in the main SpeakerSpice window.
        </div>
      </div>
    )
  }

  return (
    <div className="popout" onContextMenu={onContextMenu}>
      <div className="popout-title">
        <span className="pt-name">{panelTitle(active)}</span>
        <span className="pt-project">{projectName}</span>
        {!results && <span className="pt-wait">waiting for the main SpeakerSpice window…</span>}
      </div>
      {ids.length > 1 && (
        <div className="popout-tabs">
          {ids.map((id) => (
            <button
              key={id}
              className={`popout-tab ${id === active ? 'active' : ''}`}
              onClick={() => { useStore.getState().setPopoutActive(id); useStore.getState().focusPanel(id) }}
            >
              {panelTitle(id)}
              <span
                className="dt-x"
                title="Close this view — it goes back to the main window"
                onClick={(e) => { e.stopPropagation(); useStore.getState().closeViewInPopout(id) }}
              >✕</span>
            </button>
          ))}
        </div>
      )}
      <div className="popout-body">
        {ids.map((id) => {
          const Component = PANELS[id].component
          return (
            <div key={id} className="dock-panel" style={{ display: id === active ? 'flex' : 'none' }}>
              <Component />
            </div>
          )
        })}
      </div>
      <ContextMenu />
    </div>
  )
}
