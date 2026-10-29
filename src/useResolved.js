import { useMemo } from 'react'
import { useStore } from './store'
import { evaluateParams, resolveNodeParams } from './schema/params'

export function useParamValues() {
  const params = useStore((s) => s.projectExtras?.params)
  return useMemo(() => evaluateParams(params || []), [params])
}

export function useResolvedParams(id, type, params) {
  const { values } = useParamValues()
  return useMemo(() => resolveNodeParams({ id, type, params }, values), [id, type, params, values])
}
