import React, { useEffect } from 'react'
import { useStore, SCHEMA_VERSION } from './store'
import MenuBar from './components/MenuBar'
import Toolbar from './components/Toolbar'
import DockLayout from './components/dock/DockLayout'
import DriverDB from './components/DriverDB'
import TSCalc from './components/TSCalc'
import SaveDriverPrompt from './components/SaveDriverPrompt'
import SettingsWindow from './components/SettingsWindow'
import PopoutView from './components/PopoutView'
import WorkspacePrompt from './components/WorkspacePrompt'
import ContextMenu from './components/ContextMenu'
import TimeDomainWindow from './components/TimeDomainWindow'
import WiringWindow from './components/WiringWindow'
import DspWindow from './components/DspWindow'
import { isPopout } from './popout'
import { COMMANDS, comboFromEvent, resolve } from './keymap'

const DEMO = {
  schemaVersion: SCHEMA_VERSION,
  name: 'Ported box example',
  nodes: [
    { id: 'drv1', type: 'driver', position: { x: 260, y: 40 }, params: { label: 'Driver' } },
    { id: 'rad1', type: 'radiation', position: { x: 520, y: 40 }, params: { space: 'half', label: 'Front radiation' } },
    { id: 'ch1', type: 'chamber', position: { x: 40, y: 170 }, params: { volume: 60, length: 50, label: 'Box 60 L' } },
    { id: 'wg1', type: 'waveguide', position: { x: 40, y: 330 }, params: { S1: 100, S2: 100, length: 25, flare: 'conical', label: 'Port' } },
    { id: 'rad2', type: 'radiation', position: { x: 40, y: 500 }, params: { space: 'half', label: 'Port radiation' } },
  ],
  edges: [
    { id: 'e1', source: 'drv1', sourceHandle: 'front', target: 'rad1', targetHandle: 'in' },
    { id: 'e2', source: 'drv1', sourceHandle: 'rear', target: 'ch1', targetHandle: 'in' },
    { id: 'e3', source: 'ch1', sourceHandle: 'out', target: 'wg1', targetHandle: 'throat' },
    { id: 'e4', source: 'wg1', sourceHandle: 'mouth', target: 'rad2', targetHandle: 'in' },
  ],
}

function SimErrorBanner() {
  const simError = useStore((s) => s.simError)
  if (!simError) return null
  return <div className="err-banner">{simError}</div>
}

function ErrorBanner() {
  const errors = useStore((s) => s.results?.validation?.errors)
  if (!errors || !errors.length) return null
  return <div className="err-banner">{errors.join(' · ')}</div>
}

export default function App() {
  const loadSerialized = useStore((s) => s.loadSerialized)
  const tdOpen = useStore((s) => s.tdOpen)
  const wiringOpen = useStore((s) => s.wiringOpen)
  const dspOpen = useStore((s) => s.dspOpen)

  useEffect(() => {
    if (isPopout()) return
    const st = useStore.getState()
    const entry = st.activeFile ? st.workspace.files[st.activeFile] : null
    if (!entry) return
    const project = entry.data
    if (project?.nodes?.length) loadSerialized(project)
    else loadSerialized({ ...DEMO, name: project?.name || DEMO.name })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) return

      const combo = comboFromEvent(e)
      if (!combo) return
      const st = useStore.getState()
      const id = resolve(st.bindings, combo, st.focusedPanel)
      if (!id) return
      e.preventDefault()
      COMMANDS[id].run(st)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (isPopout()) return <PopoutView />

  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <SimErrorBanner />
      <ErrorBanner />
      <div className="dock-host" style={tdOpen || wiringOpen || dspOpen ? { display: 'none' } : undefined}><DockLayout /></div>
      {tdOpen && <TimeDomainWindow />}
      {wiringOpen && <WiringWindow />}
      {dspOpen && <DspWindow />}
      <DriverDB />
      <TSCalc />
      <SaveDriverPrompt />
      <SettingsWindow />
      <WorkspacePrompt />
      <ContextMenu />
    </div>
  )
}
