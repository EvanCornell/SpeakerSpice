import React, { useEffect, useRef, useState } from 'react'
import { useStore, SCHEMA_VERSION, SNAPSHOT_LIMIT } from '../store'
import { readSnapshots } from '../workspace'
import { supportsFolders } from '../utils/folder'
import { connectFolderWithPrompt, disconnectFolderWithPrompt } from '../utils/folderPrompts'
import { isOpen } from '../layout'
import { PANEL_META, PANEL_IDS, MAIN_IDS, CHART_IDS } from '../panelMeta'
import { exportCSV, exportSchematicPNG, exportMetricsTxt, exportCircuitSVG } from '../utils/export'
import { formatCombo } from '../keymap'
import { ItemList } from './MenuItem'
import { RecordsBar } from './Records'

function Menu({ title, items, open, onOpen, onHover }) {
  return (
    <div className="menu-root">
      <button
        className={`menu-title ${open ? 'open' : ''}`}
        onClick={(e) => { e.stopPropagation(); onOpen() }}
        onMouseEnter={onHover}
      >{title}</button>
      {open && (
        <div className="menu-dropdown">
          <ItemList items={items} />
        </div>
      )}
    </div>
  )
}

function ProjectTitle() {
  const name = useStore((s) => s.projectName)
  const open = useStore((s) => !!s.activeFile)
  const busy = useStore((s) => s.simBusy)
  const failed = useStore((s) => !!s.simError || !!s.results?.validation?.errors?.length)
  const empty = useStore((s) => !s.nodes.length)
  if (!open) return null
  const state = failed ? 'error' : busy ? 'busy' : empty ? 'none' : 'ok'
  const tip = { error: 'The project cannot be simulated — see the message below the bar', busy: 'Simulating…', none: 'Nothing to simulate yet', ok: 'Result is up to date' }[state]
  return (
    <div className="mb-project" title={tip}>
      <span className={`mb-dot ${state}`} />
      <span className="mb-name">{name || 'Untitled'}</span>
    </div>
  )
}

function TimeDomainTab({ onHover }) {
  const open = useStore((s) => s.tdOpen)
  const job = useStore((s) => s.tdJob)
  const waiting = useStore((s) => s.tdQueue.filter((j) => j.status === 'queued').length)
  return (
    <button
      className={`menu-title mb-td${open ? ' on' : ''}`}
      onClick={(e) => { e.stopPropagation(); const st = useStore.getState(); if (open) st.closeTimeDomain(); else st.openTimeDomain() }}
      onMouseEnter={onHover}
      title={open ? 'Back to the editor (Alt+T)' : 'Time-domain runs, distortion and driver nonlinearity (Alt+T)'}
    >
      Time Domain
      {job?.runId && <span className="mb-td-progress">{Math.round(job.fraction * 100)}%{waiting ? ` +${waiting}` : ''}</span>}
    </button>
  )
}

function WiringTab({ onHover }) {
  const open = useStore((s) => s.wiringOpen)
  return (
    <button
      className={`menu-title mb-td${open ? ' on' : ''}`}
      onClick={(e) => { e.stopPropagation(); const st = useStore.getState(); if (open) st.closeWiring(); else st.openWiring() }}
      onMouseEnter={onHover}
      title={open ? 'Back to the editor (Alt+W)' : 'Channels, and how the drivers are wired to them (Alt+W)'}
    >
      Wiring
    </button>
  )
}

function DspTab({ onHover }) {
  const open = useStore((s) => s.dspOpen)
  return (
    <button
      className={`menu-title mb-td${open ? ' on' : ''}`}
      onClick={(e) => { e.stopPropagation(); const st = useStore.getState(); if (open) st.closeDsp(); else st.openDsp() }}
      onMouseEnter={onHover}
      title={open ? 'Back to the editor (Alt+D)' : 'Gain, delay, polarity, crossovers and EQ for each channel (Alt+D)'}
    >
      DSP
    </button>
  )
}

export default function MenuBar() {
  const store = useStore()
  const [open, setOpen] = useState(null)
  const fileRef = useRef(null)
  const workspaceRef = useRef(null)
  const barRef = useRef(null)
  const { settings, updateSettings, layout, layoutOps, layoutPresets, poppedOut, bindings } = store
  const snapshots = readSnapshots(store.workspace)

  const key = (id) => formatCombo(bindings[id]?.[0])

  const panelItem = (id) => ({
    label: PANEL_META[id].title,
    checked: isOpen(layout, id) || poppedOut.includes(id),
    hint: poppedOut.includes(id) ? 'in a tab' : '',
    disabled: PANEL_META[id].closable === false
      || (PANEL_META[id].requires && !settings[PANEL_META[id].requires]),
    onClick: () => (poppedOut.includes(id) ? store.popOutPanel(id) : layoutOps.toggle(id)),
  })

  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!barRef.current?.contains(e.target)) setOpen(null) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc) }
  }, [open])

  const onLoadFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const proj = JSON.parse(reader.result)
        if (proj.kind === 'workspace') {
          alert('That is a workspace, not a project. Use File ▸ Import Workspace… to open it.')
          return
        }
        if (Number(proj.schemaVersion) > SCHEMA_VERSION) {
          if (!confirm(`This file was saved by a newer SpeakerSpice (schema v${proj.schemaVersion}); this build reads up to v${SCHEMA_VERSION}. Anything it does not understand may be lost. Load anyway?`)) return
        }
        store.importProject(proj, file.name)
      } catch {
        alert('Could not parse that file as a SpeakerSpice project.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const onLoadWorkspace = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!confirm('Importing replaces the workspace in this browser, including every project in it. Download the current one first if you have not.')) return
    const result = await store.importWorkspaceFile(file)
    if (!result.ok) alert(result.error)
    else if (result.skipped?.length) alert(`Imported. These files could not be read and were skipped:\n\n${result.skipped.join('\n')}`)
  }

  const savePreset = () => {
    const name = prompt('Save the current window arrangement as:', `Layout ${layoutPresets.length + 1}`)
    if (name?.trim()) store.saveLayoutPreset(name.trim())
  }

  const MENUS = [
    ['File', [
      {
        label: 'New Project',
        hint: key('project.new'),
        onClick: () => store.newFile(''),
      },
      { label: '-' },
      { label: 'Export Project as JSON…', hint: key('project.save'), onClick: store.saveProjectJSON },
      {
        label: 'Import Project JSON…',
        onClick: () => fileRef.current?.click(),
      },
      { label: '-' },
      {
        label: 'Download Workspace…',
        onClick: () => store.downloadWorkspace(),
      },
      {
        label: 'Import Workspace…',
        onClick: () => workspaceRef.current?.click(),
      },
      ...(supportsFolders() ? [{
        label: store.folderStatus === 'off' ? 'Keep Workspace in a Folder…' : `Stop Saving to “${store.folderName}”`,
        onClick: () => (store.folderStatus === 'off' ? connectFolderWithPrompt() : disconnectFolderWithPrompt()),
      }] : []),
      { label: '-' },
      {
        label: 'Export',
        submenu: [
          {
            label: 'Response data (CSV)',
            onClick: () => exportCSV(store.results, store.nodes, store.projectName),
          },
          {
            label: 'Schematic (PNG)',
            onClick: () => exportSchematicPNG(store.projectName),
          },
          {
            label: 'Circuit diagram (SVG)',
            onClick: () => exportCircuitSVG(store.serialize()).catch((err) => alert(`Could not draw the circuit: ${err.message}`)),
          },
          {
            label: 'Metrics summary (TXT)',
            onClick: () => exportMetricsTxt(store.metrics, settings, store.projectName),
          },
        ],
      },
    ]],

    ['Edit', [
      { label: 'Undo', hint: key('edit.undo'), disabled: !store.history.length, onClick: store.undo },
      { label: 'Redo', hint: key('edit.redo'), disabled: !store.future.length, onClick: store.redo },
      { label: '-' },
      { label: 'Duplicate Selection', hint: key('edit.duplicate'), onClick: store.duplicateSelected },
      { label: 'Replace Selection with Copied', hint: key('edit.replace'), disabled: !store.clipboard?.nodes?.length, onClick: store.replaceSelection },
      { label: 'Select All Nodes', hint: key('edit.selectAll'), onClick: store.selectAll },
      { label: 'Delete Selection', hint: key('edit.delete'), danger: true, onClick: store.deleteSelected },
    ]],

    ['View', [
      ...MAIN_IDS.map(panelItem),
      { label: '-' },
      { label: 'Charts', submenu: CHART_IDS.map(panelItem) },
      { label: '-' },
      {
        label: 'Open Focused Panel in New Tab',
        hint: key('view.popout'),
        onClick: () => store.popOutPanel(store.focusedPanel),
      },
      {
        label: 'Open in New Tab',
        submenu: PANEL_IDS
          .filter((id) => !PANEL_META[id].requires || settings[PANEL_META[id].requires])
          .map((id) => ({
            label: PANEL_META[id].title,
            checked: poppedOut.includes(id),
            onClick: () => store.popOutPanel(id),
          })),
      },
      { label: '-' },
      {
        label: store.maximized ? 'Restore Panel Sizes' : 'Maximize Focused Panel',
        hint: key('view.maximize'),
        onClick: () => store.toggleMaximize(store.maximized ? store.maximized : store.focusedPanel),
      },
      { label: '-' },
      {
        label: 'Reset Layout',
        onClick: () => layoutOps.reset(),
      },
      { label: 'Save Layout As…', onClick: savePreset },
      {
        label: 'Apply Saved Layout',
        disabled: !layoutPresets.length,
        submenu: layoutPresets.length
          ? layoutPresets.map((p) => ({
            label: p.name,
            onClick: () => store.applyLayoutPreset(p.name),
          }))
          : [{ label: '(none saved)', disabled: true }],
      },
      {
        label: 'Delete Saved Layout',
        disabled: !layoutPresets.length,
        submenu: layoutPresets.length
          ? layoutPresets.map((p) => ({
            label: p.name,
            danger: true,
            onClick: () => store.deleteLayoutPreset(p.name),
          }))
          : [{ label: '(none saved)', disabled: true }],
      },
    ]],

    ['Simulate', [
      {
        label: 'Mask chamber resonances',
        checked: settings.masking,
        onClick: () => updateSettings({ masking: !settings.masking }),
      },
      {
        label: 'Unwrap phase',
        checked: settings.unwrapPhase,
        onClick: () => updateSettings({ unwrapPhase: !settings.unwrapPhase }),
      },
      { label: '-' },
      {
        label: 'Take Snapshot',
        hint: key('sim.snapshot'),
        disabled: snapshots.length >= SNAPSHOT_LIMIT || !store.results?.ok,
        onClick: store.takeSnapshot,
      },
      {
        label: 'Clear All Snapshots',
        disabled: !snapshots.length,
        onClick: () => snapshots.forEach((s) => store.removeSnapshot(s.id)),
      },
      { label: '-' },
      { label: 'Recompute Now', hint: key('sim.recompute'), onClick: store.recomputeNow },
    ]],

    ['Tools', [
      {
        label: 'Driver Database…',
        onClick: () => store.setShowDriverDB(true),
      },
      {
        label: 'T/S Parameter Solver…',
        onClick: () => store.setShowTSCalc(true),
      },
      { label: '-' },
      {
        label: 'Time Domain Runs',
        hint: key('view.timedomain'),
        onClick: () => store.openTimeDomain(),
      },
      {
        label: 'Driver Nonlinearity (Bl, Kms, Le)',
        onClick: () => store.openTimeDomain('nonlinear'),
      },
    ]],

    ['Help', [
      {
        label: 'Keyboard Shortcuts…',
        hint: key('view.settings'),
        onClick: () => store.setShowSettings(true, 'keyboard'),
      },
      {
        label: 'About SpeakerSpice',
        onClick: () => alert(
          'SpeakerSpice — open-source loudspeaker design.\n\n'
          + 'Every design is an electro-acoustic circuit, solved in the browser\n'
          + 'by ngspice.\n\n'
          + 'View ▸ Reset Layout restores the default workspace.',
        ),
      },
    ]],
  ]

  return (
    <div className="menubar" ref={barRef} onClick={() => setOpen(null)}>
      <span className="logo">Speaker<span>Spice</span></span>
      {MENUS.map(([title, items]) => (
        <React.Fragment key={title}>
          <Menu
            title={title}
            items={items}
            open={open === title}
            onOpen={() => setOpen(open === title ? null : title)}
            onHover={() => { if (open) setOpen(title) }}
          />
          {title === 'Simulate' && <TimeDomainTab onHover={() => { if (open) setOpen(null) }} />}
          {title === 'Simulate' && <WiringTab onHover={() => { if (open) setOpen(null) }} />}
          {title === 'Simulate' && <DspTab onHover={() => { if (open) setOpen(null) }} />}
        </React.Fragment>
      ))}
      <button
        className="menu-title"
        onClick={(e) => { e.stopPropagation(); setOpen(null); store.setShowSettings(true) }}
        onMouseEnter={() => { if (open) setOpen(null) }}
      >Settings</button>
      <ProjectTitle />
      <RecordsBar />
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onLoadFile} />
      <input ref={workspaceRef} type="file" accept=".zip,.json,application/zip,application/json" style={{ display: 'none' }} onChange={onLoadWorkspace} />

    </div>
  )
}
