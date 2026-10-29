import { migrateProject } from '../schema/migrate.js'
import { resolveProject } from '../schema/params.js'
import { validateProject } from '../schema/validate.js'
import { computeMetrics } from './metrics.js'
import { compileProject } from '../spice/compile.js'
import { runNetlist } from '../spice/run.js'
import { adaptResults } from '../spice/adapt.js'

const MAX_NPTS = 8192

function projectError(reasons) {
  const err = new Error(reasons.join('; '))
  err.projectErrors = reasons
  return err
}

async function runSpice(project, warnings) {
  const analysis = (project.analyses || []).find((a) => a.type === 'ac')
  const npts = Math.min(analysis.npts || 512, MAX_NPTS)
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const { netlist, map } = compileProject(project, { ...analysis, npts })
  const raw = await runNetlist(netlist)
  const results = adaptResults(raw, map)
  results.validation = { warnings, errors: [] }
  results.elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
  const volts = map.channels[0]?.volts ?? 2.83
  const metrics = computeMetrics(results, { voltage: volts })
  return { results, metrics, netlist }
}

export function prepareProject(input) {
  const { project, errors: exprErrors } = resolveProject(migrateProject(input))
  const { errors, warnings } = validateProject(project)
  const blocking = [...exprErrors, ...errors]
  if (blocking.length) throw projectError(blocking)
  return { project, warnings }
}

export async function simulateProject(input) {
  const { project, warnings } = prepareProject(input)
  try {
    const { results, metrics, netlist } = await runSpice(project, warnings)
    return { results, metrics, warnings, netlist }
  } catch (err) {
    throw projectError([err.message])
  }
}
