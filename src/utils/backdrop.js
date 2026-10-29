import { useRef } from 'react'

export function useBackdropDismiss(close) {
  const armed = useRef(false)
  return {
    onMouseDown: (e) => { armed.current = e.target === e.currentTarget },
    onMouseUp: (e) => {
      const hit = armed.current && e.target === e.currentTarget
      armed.current = false
      if (hit) close()
    },
  }
}
