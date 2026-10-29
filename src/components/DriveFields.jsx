import React from 'react'
import NumInput from './NumInput'

const tidy = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)

export default function DriveFields({ drive, onSet, rg, onRg }) {
  const linked = 'Voltage, impedance and power are linked by P = V²/Z — edit any one.'
  return (
    <div className="param-grid">
      <div className="param-row">
        <label title={linked}>Voltage</label>
        <NumInput min="0" step="0.01" value={tidy(drive.volts)} onCommit={(v) => onSet('voltage', v)} />
        <span className="unit">V</span>
      </div>
      <div className="param-row">
        <label title={linked}>Impedance</label>
        <NumInput above="0" value={tidy(drive.ohms)} onCommit={(v) => onSet('impedance', v)} />
        <span className="unit">Ω</span>
      </div>
      <div className="param-row">
        <label title={linked}>Power</label>
        <NumInput min="0" value={tidy(drive.watts)} onCommit={(v) => onSet('power', v)} />
        <span className="unit">W</span>
      </div>
      <div className="param-row">
        <label title="Amplifier output resistance plus cable, in series with the load.">Rg</label>
        <NumInput step="0.01" min="0" value={tidy(Number(rg) || 0)} onCommit={onRg} />
        <span className="unit">Ω</span>
      </div>
    </div>
  )
}
