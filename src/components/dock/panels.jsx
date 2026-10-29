import React from 'react'
import { PANEL_META, CHART_IDS } from '../../panelMeta'
import { useStore } from '../../store'
import FileBrowser from '../FileBrowser'
import FlowCanvas from '../FlowCanvas'
import ParamPanel from '../ParamPanel'
import VariablesPanel from '../VariablesPanel'
import ProbesPanel from '../ProbesPanel'
import VelocityPopup from '../VelocityPopup'
import { chartPanelComponent } from '../OutputPanel'
import { readOnlyWhenLocked } from '../Records'

function CanvasPanel() {
  const activeFile = useStore((s) => s.activeFile)
  if (!activeFile) {
    return (
      <div className="canvas-wrap">
        <div className="no-project">
          <h4>No project open</h4>
          <p>
            Every design lives in a file in your workspace. Open one from the
            Workspace panel, or start a new one.
          </p>
          <button className="primary" onClick={() => useStore.getState().newFile('')}>New project</button>
        </div>
      </div>
    )
  }
  return (
    <div className="canvas-wrap">
      <FlowCanvas />
      <VelocityPopup />
    </div>
  )
}

const COMPONENTS = {
  files: FileBrowser,
  canvas: CanvasPanel,
  params: readOnlyWhenLocked(ParamPanel),
  vars: readOnlyWhenLocked(VariablesPanel),
  probes: readOnlyWhenLocked(ProbesPanel),
  ...Object.fromEntries(CHART_IDS.map((id) => [id, chartPanelComponent(id)])),
}

export const PANELS = Object.fromEntries(
  Object.entries(PANEL_META).map(([id, meta]) => [id, { ...meta, component: COMPONENTS[id] }]),
)

export { PANEL_IDS, panelTitle } from '../../panelMeta'
