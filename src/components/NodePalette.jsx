import React from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import { NODE_KINDS, NODE_DRAG_TYPE } from '../nodeKinds'
import { useStore, isLocked } from '../store'
import { formatCombo } from '../keymap'

function onDragStart(e, type) {
  e.dataTransfer.setData(NODE_DRAG_TYPE, type)
  e.dataTransfer.effectAllowed = 'move'
}

export default function NodePalette() {
  const bindings = useStore((s) => s.bindings)
  const locked = useStore(isLocked)
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  return (
    <>
    <div className="np-dock" onContextMenu={(e) => e.stopPropagation()}>
      {NODE_KINDS.map((it) => {
        const key = bindings[`add.${it.type}`]?.[0]
        return (
          <div
            key={it.type}
            className={`np-cube${locked ? ' off' : ''}`}
            draggable={!locked}
            title={`${it.desc}${key ? `\n\nDrag onto the canvas, or press ${formatCombo(key)} to add one at the pointer.` : ''}`}
            onDragStart={(e) => onDragStart(e, it.type)}
          >
            <span className="np-chip" style={{ background: it.color }} />
            <span className="np-name">{it.short || it.name}</span>
            {key && <span className="np-key">{formatCombo(key)}</span>}
          </div>
        )
      })}
    </div>
    <div className="np-zoom" onContextMenu={(e) => e.stopPropagation()}>
      <button title="Zoom out" onClick={() => zoomOut({ duration: 150 })}>−</button>
      <span className="np-pct" title="Zoom">{Math.round(zoom * 100)}%</span>
      <button title="Zoom in" onClick={() => zoomIn({ duration: 150 })}>+</button>
      <button title="Fit the whole graph in view" onClick={() => fitView({ duration: 200, padding: 0.15 })}>⤢</button>
    </div>
    </>
  )
}
