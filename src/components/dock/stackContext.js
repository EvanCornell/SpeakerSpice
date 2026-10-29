import { createContext, useContext } from 'react'

export const StackContext = createContext(null)

export function useStackId() {
  return useContext(StackContext)
}
