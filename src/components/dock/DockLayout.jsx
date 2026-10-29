import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { PANELS, panelTitle } from './panels'
import { StackContext } from './stackContext'

const UNDER_TABS = (id) => id === 'canvas' || PANELS[id]?.group === 'charts'

const DRAG_MIME = 'application/speakerspice-panel'
const MIN_PX = 90
const EDGE_FRACTION = 0.28

const isPanelDrag = (e) => !!e.dataTransfer?.types?.includes(DRAG_MIME)

const endPanelDrag = () => {
  const s = useStore.getState()
  if (s.draggingPanel) s.setDraggingPanel(null)
}

function PanelBody({ id }) {
  const def = PANELS[id]
  if (!def) return null
  const Component = def.component
  return <Component />
}

function DockStack({ node }) {
  const layoutOps = useStore((s) => s.layoutOps)
  const dragging = useStore((s) => s.draggingPanel)
  const focused = useStore((s) => s.focusedPanel)
  const maximized = useStore((s) => s.maximized)
  const [zone, setZone] = useState(null)
  const [tabDrop, setTabDrop] = useState(null)
  const bodyRef = useRef(null)

  const active = node.panels.includes(node.active) ? node.active : node.panels[0]
  const hasFocus = node.panels.includes(focused)

  const zoneAt = (e) => {
    const r = bodyRef.current?.getBoundingClientRect()
    if (!r) return 'center'
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const edges = [
      ['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy],
    ].filter(([, d]) => d < EDGE_FRACTION).sort((a, b) => a[1] - b[1])
    return edges.length ? edges[0][0] : 'center'
  }

  const onBodyDragOver = (e) => {
    if (!dragging || !isPanelDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setZone(zoneAt(e))
  }

  const onBodyDrop = (e) => {
    if (!dragging || !isPanelDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    layoutOps.dock(dragging, node.id, zoneAt(e))
    setZone(null)
    endPanelDrag()
  }

  const onContextMenu = (e, panelId = null) => {
    e.preventDefault()
    e.stopPropagation()
    const st = useStore.getState()
    if (active) st.focusPanel(active)
    st.openContextMenu(e.clientX, e.clientY, panelId
      ? { kind: 'tab', stackId: node.id, panelId }
      : { kind: 'stack', stackId: node.id })
  }

  return (
    <StackContext.Provider value={node.id}>
    <div
      className={`dock-stack ${hasFocus ? 'focused' : ''}`}
      style={{ flex: `${node.size} 1 0%` }}
      onMouseDownCapture={() => active && useStore.getState().focusPanel(active)}
    >
      <div className="dock-tabs" onContextMenu={onContextMenu}>
        <div className="dock-tabscroll">
        {node.panels.map((pid, idx) => (
          <div
            key={pid}
            className={`dock-tab ${pid === active ? 'active' : ''} ${tabDrop === idx ? 'dropping' : ''}`}
            draggable
            title={panelTitle(pid)}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, pid)
              e.dataTransfer.effectAllowed = 'move'
              useStore.getState().setDraggingPanel(pid)
            }}
            onDragEnd={() => { endPanelDrag(); setTabDrop(null) }}
            onDragOver={(e) => {
              if (!dragging || !isPanelDrag(e)) return
              e.preventDefault(); e.stopPropagation(); setTabDrop(idx)
            }}
            onDragLeave={() => setTabDrop(null)}
            onDrop={(e) => {
              if (!dragging || !isPanelDrag(e)) return
              e.preventDefault(); e.stopPropagation()
              setTabDrop(null)
              layoutOps.dropOnTab(dragging, node.id, idx)
              endPanelDrag()
            }}
            onClick={() => { layoutOps.activate(node.id, pid); useStore.getState().focusPanel(pid) }}
            onDoubleClick={() => useStore.getState().toggleMaximize(pid)}
            onContextMenu={(e) => onContextMenu(e, pid)}
          >
            <span className="dt-title">{panelTitle(pid)}</span>
            {PANELS[pid]?.closable !== false && (
              <span className="dt-x" title="Close panel"
                onClick={(e) => { e.stopPropagation(); layoutOps.close(pid) }}>✕</span>
            )}
          </div>
        ))}
        </div>
        <button
          className="dock-chrome-btn"
          title="Open this panel in a new browser tab"
          onClick={() => useStore.getState().popOutPanel(active)}
        >⧉</button>
        <button
          className="dock-chrome-btn"
          title={maximized ? 'Restore layout' : 'Maximize this panel'}
          onClick={() => useStore.getState().toggleMaximize(active)}
        >{maximized ? '❐' : '⛶'}</button>
      </div>

      <div
        ref={bodyRef}
        className="dock-body"
        onDragOver={onBodyDragOver}
        onDragLeave={() => setZone(null)}
        onDrop={onBodyDrop}
        onContextMenu={onContextMenu}
      >
        {node.panels.map((pid) => (
          <div key={pid} className={`dock-panel${UNDER_TABS(pid) ? ' under' : ''}`} style={{ display: pid === active ? 'flex' : 'none' }}>
            <PanelBody id={pid} />
          </div>
        ))}
        {dragging && zone && <div className={`drop-hint zone-${zone}`} />}
      </div>
    </div>
    </StackContext.Provider>
  )
}

function Splitter({ parentId, index, dir, containerRef }) {
  const layoutOps = useStore((s) => s.layoutOps)

  const onDown = useCallback((e) => {
    e.preventDefault()
    const el = containerRef.current
    if (!el) return
    const a = el.children[index * 2]
    const b = el.children[index * 2 + 2]
    if (!a || !b) return
    const horiz = dir === 'row'
    const pxA0 = horiz ? a.offsetWidth : a.offsetHeight
    const pxB0 = horiz ? b.offsetWidth : b.offsetHeight
    const total = pxA0 + pxB0
    const start = horiz ? e.clientX : e.clientY
    const wA = parseFloat(a.style.flexGrow) || 1
    const wB = parseFloat(b.style.flexGrow) || 1
    const wTotal = wA + wB

    const onMove = (ev) => {
      const d = (horiz ? ev.clientX : ev.clientY) - start
      const pxA = Math.max(MIN_PX, Math.min(total - MIN_PX, pxA0 + d))
      const ratio = pxA / total
      layoutOps.resize(parentId, index, wTotal * ratio, wTotal * (1 - ratio))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [parentId, index, dir, containerRef, layoutOps])

  return <div className={`dock-splitter ${dir}`} onMouseDown={onDown} />
}

function DockNode({ node }) {
  const ref = useRef(null)
  if (node.type === 'stack') return <DockStack node={node} />
  return (
    <div ref={ref} className={`dock-split ${node.dir}`} style={{ flex: `${node.size} 1 0%` }}>
      {node.children.map((child, i) => (
        <React.Fragment key={child.id}>
          <DockNode node={child} />
          {i < node.children.length - 1 && (
            <Splitter parentId={node.id} index={i} dir={node.dir} containerRef={ref} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

function EdgeDrops() {
  const dragging = useStore((s) => s.draggingPanel)
  const layoutOps = useStore((s) => s.layoutOps)
  const [hot, setHot] = useState(null)
  if (!dragging) return null
  return (
    <>
      {['left', 'right', 'top', 'bottom'].map((edge) => (
        <div
          key={edge}
          className={`edge-drop ${edge} ${hot === edge ? 'hot' : ''}`}
          onDragOver={(e) => {
            if (!isPanelDrag(e)) return
            e.preventDefault(); e.stopPropagation(); setHot(edge)
          }}
          onDragLeave={() => setHot(null)}
          onDrop={(e) => {
            if (!isPanelDrag(e)) return
            e.preventDefault(); e.stopPropagation()
            setHot(null)
            layoutOps.dockEdge(dragging, edge)
            endPanelDrag()
          }}
        />
      ))}
    </>
  )
}

export default function DockLayout() {
  const layout = useStore((s) => s.layout)
  const maximized = useStore((s) => s.maximized)

  useEffect(() => {
    const clear = () => endPanelDrag()
    window.addEventListener('drop', clear)
    window.addEventListener('dragend', clear)
    return () => {
      window.removeEventListener('drop', clear)
      window.removeEventListener('dragend', clear)
    }
  }, [])

  if (maximized && PANELS[maximized]) {
    return (
      <div className="dock-root">
        <div className="dock-stack focused" style={{ flex: '1 1 0%' }}>
          <div className="dock-tabs">
            <div className="dock-tabscroll">
              <div className="dock-tab active">
                <span className="dt-title">{panelTitle(maximized)}</span>
              </div>
            </div>
            <button className="dock-chrome-btn" title="Restore layout"
              onClick={() => useStore.getState().toggleMaximize(maximized)}>❐</button>
          </div>
          <div className="dock-body">
            <div className="dock-panel" style={{ display: 'flex' }}>
              <PanelBody id={maximized} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!layout) return <div className="dock-root" />
  return (
    <div className="dock-root">
      <DockNode node={layout} />
      <EdgeDrops />
    </div>
  )
}

export const __internals = { isPanelDrag, endPanelDrag }
