import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactFlow, { Background, MiniMap, useReactFlow, ReactFlowProvider, ConnectionMode } from 'reactflow'
import { useStore, isLocked } from '../store'
import { nodeTypes } from './nodes'
import { useStackId } from './dock/stackContext'
import { distance, marqueeRect, nodesInMarquee, MARQUEE_THRESHOLD } from '../selection'
import { NODE_DRAG_TYPE } from '../nodeKinds'
import NodePalette from './NodePalette'

const MINIMAP_COLORS = { driver: 'var(--s1)', chamber: 'var(--s2)', waveguide: 'var(--s3)', pr: 'var(--s4)', radiation: 'var(--s5)' }

function isValidConnection(conn) {
  return conn.source !== conn.target
}

function swallowNextContextMenu() {
  const eat = (e) => { e.preventDefault(); e.stopPropagation() }
  window.addEventListener('contextmenu', eat, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('contextmenu', eat, true), 0)
}

const ALERT_MS = 5000

function CanvasAlert() {
  const alert = useStore((s) => s.canvasAlert)
  useEffect(() => {
    if (!alert) return undefined
    const t = setTimeout(() => {
      if (useStore.getState().canvasAlert === alert) useStore.getState().showCanvasAlert(null)
    }, ALERT_MS)
    return () => clearTimeout(t)
  }, [alert])
  if (!alert) return null
  return (
    <div className="canvas-alert" role="alert" key={alert.at} onClick={() => useStore.getState().showCanvasAlert(null)}>
      {alert.text}
    </div>
  )
}

function CanvasInner() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const onNodesChange = useStore((s) => s.onNodesChange)
  const onEdgesChange = useStore((s) => s.onEdgesChange)
  const onConnect = useStore((s) => s.onConnect)
  const addNode = useStore((s) => s.addNode)
  const setSelected = useStore((s) => s.setSelected)
  const locked = useStore(isLocked)
  const { screenToFlowPosition } = useReactFlow()
  const stackId = useStackId()
  const wrapper = useRef(null)
  const pointer = useRef(null)
  const [marquee, setMarquee] = useState(null)
  const lasso = useRef(null)

  useEffect(() => {
    const dropPoint = () => {
      const rect = wrapper.current?.getBoundingClientRect()
      if (!rect) return null
      const p = pointer.current
      const inside = p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom
      return screenToFlowPosition(inside ? p : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    }
    useStore.setState({ _flowApi: { dropPoint } })
    return () => useStore.setState({ _flowApi: null })
  }, [screenToFlowPosition])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    const type = e.dataTransfer.getData(NODE_DRAG_TYPE)
    if (!type) return
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNode(type, pos)
    useStore.getState().focusPanel('canvas')
  }, [screenToFlowPosition, addNode])

  const onRightDown = (e) => {
    if (e.button !== 2) return
    if (e.target?.closest?.('.react-flow__node, .react-flow__edge')) return
    const rect = wrapper.current?.getBoundingClientRect()
    if (!rect) return
    const start = { x: e.clientX, y: e.clientY }
    lasso.current = { start, startFlow: screenToFlowPosition(start), rect, moved: false, additive: e.shiftKey }

    const onMove = (ev) => {
      const d = lasso.current
      if (!d) return
      const here = { x: ev.clientX, y: ev.clientY }
      if (!d.moved && distance(d.start, here) < MARQUEE_THRESHOLD) return
      d.moved = true
      setMarquee(marqueeRect(
        { x: d.start.x - d.rect.left, y: d.start.y - d.rect.top },
        { x: here.x - d.rect.left, y: here.y - d.rect.top },
      ))
    }
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const d = lasso.current
      lasso.current = null
      setMarquee(null)
      const st = useStore.getState()
      if (!d?.moved) {
        if (d?.held) st.openContextMenu(d.held.x, d.held.y, d.held.target)
        return
      }
      swallowNextContextMenu()
      const rect = marqueeRect(d.startFlow, screenToFlowPosition({ x: ev.clientX, y: ev.clientY }))
      st.setSelection(nodesInMarquee(st.nodes, rect), d.additive)
      st.focusPanel('canvas')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const openMenu = (e, target) => {
    e.preventDefault()
    e.stopPropagation()
    const st = useStore.getState()
    st.focusPanel('canvas')
    const full = {
      ...target,
      stackId,
      flowPos: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
    }
    if (lasso.current) {
      lasso.current.held = { x: e.clientX, y: e.clientY, target: full }
      return
    }
    st.openContextMenu(e.clientX, e.clientY, full)
  }

  return (
    <div
      ref={wrapper}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY } }}
      onPointerLeave={() => { pointer.current = null }}
      onMouseDown={onRightDown}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        onDrop={onDrop}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onNodeClick={(_, n) => setSelected(n.id)}
        onNodeContextMenu={(e, n) => {
          if (!n.selected) useStore.getState().setSelection([n.id])
          else setSelected(n.id)
          openMenu(e, { kind: 'node', nodeId: n.id })
        }}
        onEdgeContextMenu={(e, ed) => openMenu(e, { kind: 'edge', edgeId: ed.id })}
        onPaneContextMenu={(e) => openMenu(e, { kind: 'pane' })}
        onPaneClick={() => setSelected(null)}
        deleteKeyCode={null}
        panOnDrag={[0, 1]}
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionKeyCode="Shift"
        selectionOnDrag={false}
        fitView
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--canvas-dot)" gap={20} size={1.2} />
        <MiniMap
          position="top-right"
          pannable zoomable
          style={{ width: 150, height: 96 }}
          nodeColor={(n) => MINIMAP_COLORS[n.type] || 'var(--text-3)'}
          nodeBorderRadius={4}
          maskColor="transparent"
        />
      </ReactFlow>
      <NodePalette />
      <CanvasAlert />
      {marquee && (
        <div
          className="rf-marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
    </div>
  )
}

export default function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

export const __internals = { isValidConnection }
