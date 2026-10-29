import { simulateProject } from './pipeline'
import { installRemoteRunner, isPoolMessage } from './remote'

installRemoteRunner()

self.onmessage = async (e) => {
  if (isPoolMessage(e.data)) return
  const { id, project } = e.data
  try {
    const { results, metrics, warnings } = await simulateProject(project)
    self.postMessage({ id, ok: true, results, metrics, warnings })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err.message,
      projectErrors: err.projectErrors || null,
    })
  }
}
