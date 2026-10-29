import { prepareProject } from './pipeline'
import { installRemoteRunner, isPoolMessage } from './remote'
import { setThreads } from '../spice/run'
import { linearResponses, transientAnalysis, distortionAnalysis, levelRun } from '../spice/timedomain'

installRemoteRunner()

self.onmessage = async (e) => {
  if (isPoolMessage(e.data)) return
  const { id, kind, project, opts, mode, threads } = e.data
  setThreads(threads || 1)
  const progress = (fraction, message) => self.postMessage({ id, type: 'progress', fraction, message })
  try {
    const { project: p, warnings } = prepareProject(project)
    let result
    if (kind === 'linear') result = await linearResponses(p, opts, progress)
    else if (kind === 'transient') result = await transientAnalysis(p, opts, progress)
    else if (kind === 'distortion') result = await distortionAnalysis(p, mode, opts, progress)
    else if (kind === 'level') result = await levelRun(p, opts, progress)
    else throw new Error(`unknown time-domain job "${kind}"`)
    self.postMessage({ id, type: 'done', kind, mode, result, warnings })
  } catch (err) {
    self.postMessage({ id, type: 'error', error: err.message, projectErrors: err.projectErrors || null })
  }
}
