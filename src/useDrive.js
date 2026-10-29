import { useMemo } from 'react'
import { useStore } from './store'
import { channelDrive } from './schema/extras'

export function useDrive(id) {
  const wiring = useStore((s) => s.projectExtras.wiring)
  const nodes = useStore((s) => s.nodes)
  const params = useStore((s) => s.projectExtras.params)
  return useMemo(() => channelDrive(wiring, nodes, params, id), [wiring, nodes, params, id])
}
