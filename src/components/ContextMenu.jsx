import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { PANEL_META, MAIN_IDS, CHART_IDS, panelTitle } from '../panelMeta'
import { findNode, isOpen } from '../layout'
import { formatCombo } from '../keymap'
import { NODE_KINDS } from '../nodeKinds'
import { isSystemPath, parentOf } from '../workspace'
import { ItemList } from './MenuItem'

const EDGE_PAD = 6

function isTextField(el) {
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable
}

function offerable(ids, settings) {
  return ids.filter((id) => !PANEL_META[id].requires || settings[PANEL_META[id].requires])
}

export default function ContextMenu() {
  const store = useStore()
  const menu = store.contextMenu
  const close = store.closeContextMenu
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useEffect(() => {
    const suppress = (e) => { if (!isTextField(e.target)) e.preventDefault() }
    window.addEventListener('contextmenu', suppress, true)
    return () => window.removeEventListener('contextmenu', suppress, true)
  }, [])

  useLayoutEffect(() => {
    if (!menu) { setPos(null); return }
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const x = Math.max(EDGE_PAD, Math.min(menu.x, window.innerWidth - r.width - EDGE_PAD))
    const y = Math.max(EDGE_PAD, Math.min(menu.y, window.innerHeight - r.height - EDGE_PAD))
    setPos({ x, y })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const away = (e) => { if (!ref.current?.contains(e.target)) close() }
    const esc = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu, close])

  if (!menu) return null

  const { target } = menu
  const { settings, layout, layoutOps, maximized, bindings } = store

  const key = (id) => formatCombo(bindings[id]?.[0])

  const stackId = maximized ? null : target.stackId || null
  const stackNode = stackId ? findNode(layout, stackId) : null
  const stackPanels = stackNode?.type === 'stack' ? stackNode.panels : []

  const addViewItems = () => {
    const row = (id) => ({
      label: panelTitle(id),
      hint: isOpen(layout, id) ? 'move here' : '',
      onClick: () => { store.addViewToStack(id, stackId); close() },
    })
    const main = offerable(MAIN_IDS, settings).filter((id) => !stackPanels.includes(id))
    const charts = offerable(CHART_IDS, settings).filter((id) => !stackPanels.includes(id))
    const items = main.map(row)
    if (charts.length) {
      if (items.length) items.push({ label: '-' })
      items.push({ label: 'Charts', submenu: charts.map(row) })
    }
    return items.length ? items : [{ label: '(every view is already here)', disabled: true }]
  }

  const popoutItems = (here, front) => {
    const elsewhere = offerable([...MAIN_IDS, ...CHART_IDS], settings).filter((id) => !here.includes(id))
    const rowsFor = (act) => (id) => ({
      label: panelTitle(id),
      onClick: () => { act(id); close() },
    })
    const grouped = (row, empty) => {
      const main = elsewhere.filter((id) => MAIN_IDS.includes(id))
      const charts = elsewhere.filter((id) => CHART_IDS.includes(id))
      const out = main.map(row)
      if (charts.length) {
        if (out.length) out.push({ label: '-' })
        out.push({ label: 'Charts', submenu: charts.map(row) })
      }
      return out.length ? out : [{ label: empty, disabled: true }]
    }

    return [
      {
        label: 'Add View Here',
        submenu: grouped(rowsFor(store.addViewToPopout), '(every view is already here)'),
      },
      ...(here.length > 1 ? [{
        label: 'Show View',
        submenu: here.map((id) => ({
          label: panelTitle(id),
          checked: id === front,
          onClick: () => { store.setPopoutActive(id); store.focusPanel(id); close() },
        })),
      }] : []),
      { label: '-' },
      {
        label: 'Open a View in a New Tab',
        submenu: grouped(rowsFor(store.popOutPanel), '(every view is already open here)'),
      },
      {
        label: `Close “${panelTitle(front)}”`,
        hint: here.length === 1 ? 'closes this tab' : '',
        onClick: () => { close(); store.closeViewInPopout(front) },
      },
      { label: '-' },
      {
        label: here.length > 1 ? 'Return These Views to the Main Window' : 'Return This View to the Main Window',
        onClick: () => { close(); window.close() },
      },
    ]
  }

  const windowItems = () => {
    if (!stackNode) {
      const here = store.popoutIds
      return here.length ? popoutItems(here, store.popoutActive || here[0]) : []
    }
    return [
      { label: 'Add View Here', submenu: addViewItems() },
      { label: '-' },
      {
        label: `Open This Window in a New Tab (${stackPanels.length} view${stackPanels.length === 1 ? '' : 's'})`,
        onClick: () => { store.popOutStack(stackId); close() },
      },
      {
        label: 'Open a View in a New Tab',
        submenu: stackPanels.map((id) => ({
          label: panelTitle(id),
          onClick: () => { store.popOutPanel(id); close() },
        })),
      },
    ]
  }

  const workspaceItems = () => {
    const path = target.path || null
    const isFolder = target.entryKind === 'folder'
    const system = path ? isSystemPath(path) : false
    const selection = store.wsSelection.length ? store.wsSelection : (path ? [path] : [])
    const folder = !path ? '' : (isFolder ? path : parentOf(path))
    const clip = store.fileClipboard
    const many = selection.length > 1

    const newRows = [
      {
        label: 'New',
        submenu: [
          {
            label: 'Project…',
            onClick: () => { store.beginWsEdit('newFile', folder); close() },
          },
          {
            label: 'Folder…',
            onClick: () => { store.beginWsEdit('newFolder', folder); close() },
          },
        ],
      },
    ]

    if (!path) {
      return [
        ...newRows,
        { label: '-' },
        {
          label: 'Paste',
          hint: 'Ctrl+V',
          disabled: !clip,
          onClick: () => { store.pasteFiles(''); close() },
        },
        { label: '-' },
        { label: 'Collapse All', onClick: run(store.collapseAllWsFolders) },
        { label: 'Download Workspace…', onClick: run(store.downloadWorkspace) },
      ]
    }

    const openRows = target.entryKind === 'project' ? [
      {
        label: 'Open',
        onClick: () => { store.openFile(path); close() },
      },
      {
        label: 'Open in a New Tab',
        onClick: () => { store.openFile(path); store.popOutPanel('canvas'); close() },
      },
      { label: '-' },
    ] : []

    return [
      ...newRows,
      { label: '-' },
      ...openRows,
      {
        label: 'Cut',
        hint: 'Ctrl+X',
        disabled: system,
        onClick: () => { store.setFileClipboard(selection.filter((p) => !isSystemPath(p)), true); close() },
      },
      {
        label: 'Copy',
        hint: 'Ctrl+C',
        onClick: () => { store.setFileClipboard(selection, false); close() },
      },
      {
        label: 'Paste',
        hint: 'Ctrl+V',
        disabled: !clip,
        onClick: () => { store.pasteFiles(folder); close() },
      },
      { label: '-' },
      {
        label: 'Duplicate',
        disabled: many,
        onClick: () => { store.duplicateFile(path); close() },
      },
      {
        label: 'Copy Path',
        onClick: () => { navigator.clipboard?.writeText(path); close() },
      },
      { label: '-' },
      {
        label: 'Rename…',
        hint: 'F2',
        disabled: system || many,
        onClick: () => { store.beginWsEdit('rename', path); close() },
      },
      {
        label: many ? `Delete ${selection.length} Entries` : 'Delete',
        hint: 'Del',
        danger: true,
        onClick: () => {
          close()
          const what = many ? `${selection.length} entries` : `“${path}”`
          const extra = selection.some(isSystemPath)
            ? '\n\nThat includes app data, which is recreated empty the next time something needs it.'
            : ''
          if (!confirm(`Delete ${what}?${extra}`)) return
          for (const p of selection) store.deletePath(p)
          store.setWsSelection([])
        },
      },
    ]
  }

  const run = (fn) => () => { fn(); close() }

  const items = () => {
    const hasClip = !!store.clipboard?.nodes?.length
    const hasSel = store.nodes.some((n) => n.selected)
    const win = windowItems()
    const tail = win.length ? [{ label: '-' }, ...win] : []

    if (target.kind === 'node' || target.kind === 'pane') {
      const onNode = target.kind === 'node'
      const editRows = [
        { label: 'Cut', hint: key('edit.cut'), disabled: !hasSel, onClick: run(store.cutSelection) },
        { label: 'Copy', hint: key('edit.copy'), disabled: !hasSel, onClick: run(store.copySelection) },
        {
          label: 'Paste',
          hint: key('edit.paste'),
          disabled: !hasClip,
          onClick: () => { store.pasteClipboard(target.flowPos); close() },
        },
        { label: 'Duplicate', hint: key('edit.duplicate'), disabled: !hasSel, onClick: run(store.duplicateSelected) },
        ...(onNode ? [{ label: 'Replace with Copied', hint: key('edit.replace'), disabled: !hasClip, onClick: run(store.replaceSelection) }] : []),
        { label: '-' },
        { label: 'Delete', hint: key('edit.delete'), danger: true, disabled: !hasSel, onClick: run(store.deleteSelected) },
      ]
      if (onNode) return [...editRows, ...tail]
      return [
        ...editRows,
        { label: '-' },
        { label: 'Select All Nodes', hint: key('edit.selectAll'), onClick: run(store.selectAll) },
        {
          label: 'Add Node',
          submenu: NODE_KINDS.map((k) => ({
            label: k.name,
            onClick: () => { store.addNode(k.type, target.flowPos); close() },
          })),
        },
        ...tail,
      ]
    }

    if (target.kind === 'wsEntry' || target.kind === 'wsRoot') return workspaceItems()

    if (target.kind === 'popout') return popoutItems(target.ids || [], target.panelId)

    if (target.kind === 'edge') {
      return [{
        label: 'Delete Connection',
        danger: true,
        onClick: () => { store.onEdgesChange([{ id: target.edgeId, type: 'remove' }]); close() },
      }]
    }

    if (target.kind === 'tab') {
      const id = target.panelId
      const pinned = PANEL_META[id]?.closable === false
      const others = stackPanels.filter((p) => p !== id && PANEL_META[p]?.closable !== false)
      return [
        {
          label: `Open “${panelTitle(id)}” in a New Tab`,
          onClick: () => { store.popOutPanel(id); close() },
        },
        {
          label: maximized === id ? 'Restore Panel Sizes' : 'Maximize This View',
          hint: key('view.maximize'),
          onClick: () => { store.toggleMaximize(id); close() },
        },
        { label: '-' },
        {
          label: 'Close',
          disabled: pinned,
          hint: pinned ? 'the workspace' : '',
          onClick: () => { layoutOps.close(id); close() },
        },
        {
          label: 'Close Other Views',
          disabled: !others.length,
          onClick: () => { others.forEach((p) => layoutOps.close(p)); close() },
        },
        ...tail,
      ]
    }

    const front = stackNode?.active
    return [
      ...win,
      ...(win.length ? [{ label: '-' }] : []),
      {
        label: maximized ? 'Restore Panel Sizes' : 'Maximize This View',
        hint: key('view.maximize'),
        disabled: !front,
        onClick: () => { store.toggleMaximize(maximized || front); close() },
      },
      {
        label: 'Reset Layout',
        onClick: () => { layoutOps.reset(); close() },
      },
    ]
  }

  const side = menu.x > window.innerWidth / 2 ? 'left' : 'right'

  return (
    <div
      ref={ref}
      className="ctx-menu menu-dropdown"
      style={{
        left: pos ? pos.x : menu.x,
        top: pos ? pos.y : menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onClick={close}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ItemList items={items()} submenuSide={side} />
    </div>
  )
}

export const __internals = { isTextField, offerable }
