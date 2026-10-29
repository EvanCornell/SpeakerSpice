import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { isPopout } from '../popout'
import {
  buildTree, isSystemPath, parentOf, baseName, joinPath, timeAgo, isDownloadStale,
  PROJECT_EXT,
} from '../workspace'
import { supportsFolders } from '../utils/folder'
import { connectFolderWithPrompt, disconnectFolderWithPrompt } from '../utils/folderPrompts'

const ROW_DRAG_TYPE = 'application/speakerspice-path'

function Chevron({ open, onToggle }) {
  return (
    <svg className={`ws-chevron toggle ${open ? 'open' : ''}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
      onClick={(e) => { e.stopPropagation(); onToggle() }}>
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RowIcon({ kind }) {
  return <span className={`ws-sq ${kind}`} aria-hidden="true" />
}

function flatten(nodes, expanded, depth = 0) {
  const out = []
  for (const node of nodes) {
    const open = node.kind === 'folder' && expanded.includes(node.path)
    out.push({ node, depth, open })
    if (open) out.push(...flatten(node.children, expanded, depth + 1))
  }
  return out
}

function NameEditor({ value, error, onCommit, onCancel }) {
  const ref = useRef(null)
  const [text, setText] = useState(value)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
  }, [])

  return (
    <div className="ws-editor">
      <input
        ref={ref}
        className={`ws-edit-input ${error ? 'bad' : ''}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(text)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') onCommit(text)
          else if (e.key === 'Escape') onCancel()
        }}
      />
      {error && <div className="ws-edit-error">{error}</div>}
    </div>
  )
}

export default function FileBrowser() {
  const workspace = useStore((s) => s.workspace)
  const activeFile = useStore((s) => s.activeFile)
  const selection = useStore((s) => s.wsSelection)
  const expanded = useStore((s) => s.wsExpanded)
  const edit = useStore((s) => s.wsEdit)
  const clip = useStore((s) => s.fileClipboard)
  const folderStatus = useStore((s) => s.folderStatus)
  const folderName = useStore((s) => s.folderName)
  const folderError = useStore((s) => s.folderError)
  const folderSaved = useStore((s) => s.folderSaved)

  const [error, setError] = useState(null)
  const [editError, setEditError] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const fileInput = useRef(null)
  const treeRef = useRef(null)

  const rows = useMemo(() => flatten(buildTree(workspace), expanded), [workspace, expanded])

  const focused = selection[selection.length - 1] || activeFile
  const picked = selection[selection.length - 1]

  const select = (path, e) => {
    const st = useStore.getState()
    let next = [path]
    if (e.ctrlKey || e.metaKey) {
      next = selection.includes(path) ? selection.filter((p) => p !== path) : [...selection, path]
    } else if (e.shiftKey && focused && rows.some((r) => r.node.path === focused) && rows.some((r) => r.node.path === path)) {
      const from = rows.findIndex((r) => r.node.path === focused)
      const to = rows.findIndex((r) => r.node.path === path)
      next = rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.node.path)
    } else if (selection.length === 1 && selection[0] === path) {
      const parent = workspace.files[path] ? parentOf(path) : ''
      next = parent ? [parent] : []
    }
    st.setWsSelection(next)
    return next
  }

  const activate = (node, open, e) => {
    const st = useStore.getState()
    if (node.kind === 'folder' && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
      st.toggleWsFolder(node.path, !open)
      st.setWsSelection(open ? [] : [node.path])
      return
    }
    select(node.path, e)
    if (node.kind !== 'folder' && node.entry.kind === 'project') st.openFile(node.path)
  }

  const targetFolder = () => {
    if (!picked) return ''
    if (workspace.files[picked]) return parentOf(picked)
    return picked
  }

  const deleteSelection = () => {
    const paths = selection.length ? selection : (focused ? [focused] : [])
    if (!paths.length) return
    const extra = paths.some(isSystemPath)
      ? '\n\nThat includes app data, which is recreated empty the next time something needs it.'
      : ''
    const what = paths.length === 1 ? `“${paths[0]}”` : `${paths.length} entries`
    if (!confirm(`Delete ${what}?${extra}`)) return
    const st = useStore.getState()
    for (const p of paths) st.deletePath(p)
    st.setWsSelection([])
    setError(null)
  }

  const commitEdit = (name) => {
    const st = useStore.getState()
    if (!edit) return
    if (edit.mode === 'rename') {
      const current = baseName(edit.path)
      if (!name.trim() || name === current) { st.endWsEdit(); setEditError(null); return }
      const to = joinPath(parentOf(edit.path), name.trim())
      if (!st.renamePath(edit.path, to)) {
        setEditError(`“${name.trim()}” is not a usable name here, or already exists.`)
        return
      }
      st.setWsSelection([to])
    } else {
      const result = st.createWsEntry(edit.mode, edit.path, name)
      if (!result.ok) { setEditError(result.error); return }
    }
    setEditError(null)
    st.endWsEdit()
  }

  const cancelEdit = () => { setEditError(null); useStore.getState().endWsEdit() }

  const onKeyDown = (e) => {
    const st = useStore.getState()
    const i = rows.findIndex((r) => r.node.path === focused)
    const row = i === -1 ? null : rows[i]

    const moveTo = (next) => {
      const r = rows[next]
      if (r) st.setWsSelection([r.node.path])
    }

    switch (e.key) {
      case 'ArrowDown': moveTo(i + 1); break
      case 'ArrowUp': moveTo(i === -1 ? rows.length - 1 : i - 1); break
      case 'ArrowRight':
        if (row?.node.kind === 'folder' && !row.open) st.toggleWsFolder(row.node.path, true)
        else moveTo(i + 1)
        break
      case 'ArrowLeft':
        if (row?.node.kind === 'folder' && row.open) st.toggleWsFolder(row.node.path, false)
        else if (row) {
          const up = parentOf(row.node.path)
          if (up) st.setWsSelection([up])
        }
        break
      case 'Enter': if (row?.node.kind === 'folder') st.toggleWsFolder(row.node.path); else if (row?.node.entry.kind === 'project') st.openFile(row.node.path); break
      case 'F2': if (row && !isSystemPath(row.node.path)) st.beginWsEdit('rename', row.node.path); break
      case 'Delete': case 'Backspace': deleteSelection(); break
      case 'Escape': st.setWsSelection([]); break
      case 'c': case 'C':
        if (!(e.ctrlKey || e.metaKey)) return
        st.setFileClipboard(selection.length ? selection : (focused ? [focused] : []), false)
        break
      case 'x': case 'X':
        if (!(e.ctrlKey || e.metaKey)) return
        st.setFileClipboard((selection.length ? selection : (focused ? [focused] : [])).filter((p) => !isSystemPath(p)), true)
        break
      case 'v': case 'V':
        if (!(e.ctrlKey || e.metaKey)) return
        st.pasteFiles(targetFolder())
        break
      default: return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const onContextMenu = (e, node) => {
    e.preventDefault()
    e.stopPropagation()
    const st = useStore.getState()
    if (node && !selection.includes(node.path)) st.setWsSelection([node.path])
    if (!node) st.setWsSelection([])
    st.openContextMenu(e.clientX, e.clientY, node
      ? { kind: 'wsEntry', path: node.path, entryKind: node.kind === 'folder' ? 'folder' : node.entry.kind }
      : { kind: 'wsRoot' })
  }

  const onDragOver = (e, folder) => {
    if (!e.dataTransfer.types.includes(ROW_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(folder === null ? '' : folder)
  }

  const onDrop = (e, folder) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const from = e.dataTransfer.getData(ROW_DRAG_TYPE)
    if (from) useStore.getState().moveFile(from, folder)
  }

  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!confirm(`Replace “${workspace.name}” with the contents of “${file.name}”? Every project in this browser is replaced.`)) return
    const result = await useStore.getState().importWorkspaceFile(file)
    if (!result.ok) { setError(result.error); return }
    setError(result.skipped?.length
      ? `Imported. ${result.skipped.length} file${result.skipped.length === 1 ? '' : 's'} could not be read and were skipped: ${result.skipped.join(', ')}`
      : null)
  }

  const connectFolder = async () => {
    setError(null)
    const result = await connectFolderWithPrompt()
    if (result.error) setError(result.error)
  }

  const renderRow = (row) => {
    const { node, depth, open } = row
    const folder = node.kind === 'folder'
    const path = node.path
    const renaming = edit?.mode === 'rename' && edit.path === path
    const cut = clip?.cut && clip.paths.some((p) => path === p || path.startsWith(`${p}/`))

    const classes = [
      'ws-row',
      folder ? 'folder' : 'file',
      selection.includes(path) ? 'selected' : '',
      path === activeFile ? 'active' : '',
      folder && activeFile?.startsWith(`${path}/`) ? 'holds-active' : '',
      folder && workspace.files[picked] && parentOf(picked) === path ? 'selected' : '',
      isSystemPath(path) ? 'system' : '',
      dropTarget === path ? 'drop' : '',
      cut ? 'cut' : '',
    ].filter(Boolean).join(' ')

    return (
      <div
        key={path}
        className={classes}
        style={{ paddingLeft: 4 + depth * 12 }}
        draggable={!renaming && !isSystemPath(path)}
        onDragStart={(e) => {
          e.dataTransfer.setData(ROW_DRAG_TYPE, path)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={folder ? (e) => onDragOver(e, path) : undefined}
        onDragLeave={folder ? () => setDropTarget(null) : undefined}
        onDrop={folder ? (e) => onDrop(e, path) : undefined}
        onClick={(e) => { if (!renaming) activate(node, open, e) }}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {Array.from({ length: depth }, (_, k) => (
          <span key={k} className="ws-guide" style={{ left: 9 + k * 12 }} />
        ))}
        {folder ? <Chevron open={open} onToggle={() => useStore.getState().toggleWsFolder(path)} /> : <span className="ws-chevron" />}
        <RowIcon kind={folder ? 'folder' : node.entry.kind} />
        {renaming
          ? <NameEditor value={baseName(path)} error={editError} onCommit={commitEdit} onCancel={cancelEdit} />
          : <>
            <span className="ws-name">{node.name}</span>
            {!folder && <span className="ws-meta">{node.entry.kind === 'project'
              ? `${(node.entry.data?.nodes || []).length}`
              : `${(node.entry.data || []).length}`}</span>}
          </>}
      </div>
    )
  }

  const newEditor = edit && edit.mode !== 'rename'
    ? (() => {
      const depth = edit.path ? edit.path.split('/').length : 0
      return (
        <div className="ws-row editing" style={{ paddingLeft: 4 + depth * 12 }}>
          <span className="ws-chevron" />
          <RowIcon kind={edit.mode === 'newFolder' ? 'folder' : 'project'} />
          <NameEditor
            value={edit.mode === 'newFolder' ? '' : `Untitled${PROJECT_EXT}`}
            error={editError}
            onCommit={commitEdit}
            onCancel={cancelEdit}
          />
        </div>
      )
    })()
    : null

  const insertAfter = edit && edit.mode !== 'rename' && edit.path
    ? rows.findIndex((r) => r.node.path === edit.path)
    : -1

  const now = Date.now()
  const stale = isDownloadStale(workspace, now)

  return (
    <div className="ws-explorer">
      <input
        ref={fileInput}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        style={{ display: 'none' }}
        onChange={onImportFile}
      />

      <div className="ws-header">
        <input
          className="ws-title"
          value={workspace.name}
          title="Workspace name — used for the downloaded file"
          onChange={(e) => useStore.getState().setWorkspaceName(e.target.value)}
        />
        <div className="ws-tools">
          <button title="New Project" onClick={() => useStore.getState().beginWsEdit('newFile', targetFolder())}>🗋</button>
          <button title="New Folder" onClick={() => useStore.getState().beginWsEdit('newFolder', targetFolder())}>🗀</button>
          <button title="Collapse All" onClick={() => useStore.getState().collapseAllWsFolders()}>⌄</button>
          {supportsFolders() && folderStatus === 'off' && !isPopout() && (
            <button title="Keep this workspace in a folder…" onClick={connectFolder}>🗁</button>
          )}
          <button title="Download workspace" onClick={() => useStore.getState().downloadWorkspace()}>⭳</button>
          <button title="Import workspace…" onClick={() => fileInput.current?.click()}>⭱</button>
        </div>
      </div>

      {error && <div className="ws-error">{error}</div>}

      <div
        className={`ws-tree ${dropTarget === '' ? 'drop' : ''}`}
        ref={treeRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => onContextMenu(e, null)}
        onDragOver={(e) => onDragOver(e, null)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => onDrop(e, '')}
        onClick={(e) => { if (e.target === treeRef.current) useStore.getState().setWsSelection([]) }}
      >
        {insertAfter === -1 && newEditor}
        {rows.map((row, i) => (
          <React.Fragment key={row.node.path}>
            {renderRow(row)}
            {i === insertAfter && newEditor}
          </React.Fragment>
        ))}
      </div>

      {folderStatus === 'off' ? (
        <button
          className={`ws-status ${stale ? 'stale' : ''}`}
          title="Download this workspace as a file"
          onClick={() => useStore.getState().downloadWorkspace()}
        >
          <span className="wss-dot" />
          <span className="wss-text">
            {workspace.downloaded ? `Downloaded ${timeAgo(workspace.downloaded, now)}` : 'Never downloaded'}
          </span>
          <span className="wss-cta">Download</span>
        </button>
      ) : (
        <button
          className={`ws-status folder ${folderStatus}`}
          disabled={isPopout()}
          title={folderError || `Saved to the folder “${folderName}” as you work`}
          onClick={folderStatus === 'locked'
            ? () => useStore.getState().reconnectWorkspaceFolder()
            : disconnectFolderWithPrompt}
        >
          <span className="wss-dot" />
          <span className="wss-text">
            {folderStatus === 'locked' && `${folderName} — needs permission`}
            {folderStatus === 'error' && `${folderName} — not fully saved`}
            {folderStatus === 'connected'
              && `${folderName}${folderSaved ? ` — saved ${timeAgo(folderSaved, now)}` : ''}`}
          </span>
          <span className="wss-cta">{folderStatus === 'locked' ? 'Reconnect' : 'Disconnect'}</span>
        </button>
      )}
    </div>
  )
}
