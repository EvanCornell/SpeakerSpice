import React, { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { useStore } from '../store'
import { displayName } from '../nodeNames'

export default function VelocityPopup() {
  const nodeId = useStore((s) => s.velocityPopupNodeId)
  const setVelocityPopup = useStore((s) => s.setVelocityPopup)
  const node = useStore((s) => s.nodes.find((n) => n.id === s.velocityPopupNodeId))
  const name = useStore((s) => displayName(s.nodes, s.velocityPopupNodeId))
  const results = useStore((s) => s.results)
  const vThreshold = useStore((s) => s.settings.vThreshold)
  const settings = useStore((s) => s.settings)

  const data = useMemo(() => {
    const arr = results?.velocity?.[nodeId]
    if (!arr) return []
    return results.freqs.map((f, i) => ({ f, v: arr[i] }))
  }, [results, nodeId])

  if (!nodeId || !node) return null
  const ticks = [10, 20, 30, 50, 100, 200, 500, 1000].filter((t) => t >= settings.fmin && t <= settings.fmax)

  return (
    <div className="vel-popup">
      <div className="vp-head">
        <b>Port velocity — {name}</b>
        <button onClick={() => setVelocityPopup(null)}>✕</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--line-2)" />
            <XAxis dataKey="f" type="number" scale="log" domain={[settings.fmin, settings.fmax]}
              ticks={ticks} tick={{ fill: 'var(--text-2)', fontSize: 10 }} stroke="var(--grid)" />
            <YAxis tick={{ fill: 'var(--text-2)', fontSize: 10 }} stroke="var(--grid)" width={40}
              label={{ value: 'm/s (peak)', angle: -90, position: 'insideLeft', fill: 'var(--text-3)', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: 'var(--raised)', border: '1px solid var(--line-2)', borderRadius: 10 }}
              labelFormatter={(v) => `${v.toFixed(1)} Hz`} formatter={(v) => [`${v.toFixed(2)} m/s`, 'velocity']}
              isAnimationActive={false} />
            <ReferenceLine y={vThreshold} stroke="var(--red)" strokeDasharray="6 4"
              label={{ value: `turbulence ~${vThreshold} m/s`, fill: 'var(--red)', fontSize: 10, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="v" stroke="var(--c3)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
