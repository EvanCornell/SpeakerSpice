import { toPng } from 'html-to-image'
import { workspaceToEntries, workspaceFilename } from '../workspace'
import { createZip } from './zip'
import { prepareProject } from '../engine/pipeline'
import { compileProject } from '../spice/compile'
import { netlistToSvg } from '../spice/schematic'
import { displayName } from '../nodeNames'

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function exportProjectJSON(proj) {
  download(`${proj.name || 'speakerspice-project'}.speakerspice.json`, JSON.stringify(proj, null, 2), 'application/json')
}

export async function exportCircuitSVG(proj) {
  const [lib, skin] = await Promise.all([import('netlistsvg'), import('netlistsvg/lib/analog.svg?raw')])
  const { project } = prepareProject(proj)
  const sweep = (project.analyses || []).find((a) => a.type === 'ac') || { fmin: 10, fmax: 1000, npts: 512 }
  const { netlist } = compileProject(project, sweep)
  const svg = await netlistToSvg(netlist, { render: lib.render || lib.default.render, skin: skin.default })
  download(`${proj.name || 'speakerspice-project'} circuit.svg`, svg, 'image/svg+xml')
}

export async function exportWorkspaceZip(ws) {
  download(workspaceFilename(ws), await createZip(workspaceToEntries(ws)), 'application/zip')
}

export function exportCSV(results, nodes, projectName) {
  if (!results || !results.ok) return
  const cols = [
    ['Frequency (Hz)', (i) => results.freqs[i]],
    ['SPL Combined (dB)', (i) => results.splCombined[i]],
    ['SPL Driver (dB)', (i) => results.splDriver[i]],
  ]
  for (const [pid, arr] of Object.entries(results.splPorts || {})) {
    const label = displayName(nodes, pid)
    cols.push([`SPL ${label} (dB)`, (i) => arr[i]])
  }
  cols.push(
    ['Zin magnitude (ohm)', (i) => results.zinMag[i]],
    ['Zin phase (deg)', (i) => results.zinPhase[i]],
    ['Excursion (mm pk)', (i) => results.excursion[i]],
  )
  for (const [wid, arr] of Object.entries(results.velocity || {})) {
    const label = displayName(nodes, wid)
    cols.push([`Velocity ${label} (m/s pk)`, (i) => arr[i]])
  }
  for (const [cid, arr] of Object.entries(results.splInterior || {})) {
    const label = displayName(nodes, cid)
    cols.push([`Interior SPL ${label} (dB)`, (i) => arr[i]])
  }
  cols.push(
    ['Acoustic power (W)', (i) => results.power[i]],
    ['Electrical power real (W)', (i) => results.peReal?.[i]],
    ['Electrical power apparent (VA)', (i) => results.peApparent?.[i]],
    ['Efficiency (%)', (i) => (results.peReal?.[i] > 1e-9 ? (results.power[i] / results.peReal[i]) * 100 : null)],
    ['Phase (deg)', (i) => results.phaseUnwrapped[i]],
    ['Group delay (ms)', (i) => results.groupDelay[i]],
  )
  const lines = [cols.map(([h]) => `"${h}"`).join(',')]
  for (let i = 0; i < results.freqs.length; i++) {
    lines.push(cols.map(([, fn]) => {
      const v = fn(i)
      return v == null || !isFinite(v) ? '' : Number(v).toPrecision(7)
    }).join(','))
  }
  download(`${projectName}-data.csv`, lines.join('\n'), 'text/csv')
}

export async function exportSchematicPNG(projectName) {
  const el = document.querySelector('.react-flow__viewport')?.closest('.react-flow')
  if (!el) return
  const dataUrl = await toPng(el, {
    backgroundColor: '#0d1117',
    filter: (n) => !(n.classList?.contains('react-flow__minimap') || n.classList?.contains('react-flow__controls')),
    pixelRatio: 2,
  })
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${projectName}-schematic.png`
  a.click()
}

export function exportMetricsTxt(metrics, settings, projectName) {
  if (!metrics) return
  const l = []
  l.push(`SpeakerSpice — key metrics for "${projectName}"`)
  l.push(`Generated ${new Date().toISOString()}`)
  l.push(`Drive: ${settings.voltage?.toFixed(2)} V into ${settings.impedance} Ω nominal (${settings.power?.toFixed(1)} W)`)
  l.push('')
  const row = (k, v) => l.push(`${k.padEnd(28)} ${v}`)
  row('F3 (-3 dB)', metrics.f3 ? `${metrics.f3.toFixed(1)} Hz` : 'n/a')
  row('F10 (-10 dB)', metrics.f10 ? `${metrics.f10.toFixed(1)} Hz` : 'n/a')
  row('Fb (tuning)', metrics.fb ? `${metrics.fb.toFixed(1)} Hz (${metrics.fbZ?.toFixed(1)} ohm min)` : 'n/a')
  row('Qtc (sealed)', metrics.qtc ? metrics.qtc.toFixed(2) : 'n/a')
  ;(metrics.zPeaks || []).forEach((p, i) => row(`Impedance peak F${i + 1}`, `${p.f.toFixed(1)} Hz, ${p.v.toFixed(1)} ohm`))
  row('Passband level', `${metrics.passband?.toFixed(1)} dB`)
  row('Peak SPL', `${metrics.peakSPL?.toFixed(1)} dB @ 1 m`)
  row('-3 dB bandwidth', metrics.bwHz ? `${metrics.bwHz.toFixed(0)} Hz (${metrics.bwOct.toFixed(2)} octaves)` : 'n/a')
  row('Max excursion', metrics.xPeak ? `${metrics.xPeak.toFixed(2)} mm pk @ ${metrics.xPeakF?.toFixed(1)} Hz` : 'n/a')
  row('Excursion @ Fb', metrics.xAtFb != null ? `${metrics.xAtFb.toFixed(2)} mm` : 'n/a')
  row('Excursion @ F3', metrics.xAtF3 != null ? `${metrics.xAtF3.toFixed(2)} mm` : 'n/a')
  row('Max power before Xmax', metrics.maxPower ? `${metrics.maxPower.toFixed(0)} W (${metrics.vMax.toFixed(1)} V)` : 'n/a')
  download(`${projectName}-metrics.txt`, l.join('\n'), 'text/plain')
}

export const __internals = { download }
