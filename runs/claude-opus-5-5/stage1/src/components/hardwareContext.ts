import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import type { ControlState, HardwareStore } from '../model/hardwareStore'

export const HardwareContext = createContext<HardwareStore | null>(null)

export function useHardwareStore(): HardwareStore {
  const store = useContext(HardwareContext)
  if (!store) throw new Error('HardwareContext missing')
  return store
}

const NONE: ControlState = { value: 0, pressed: false }

export function useControlState(id: string | undefined): ControlState {
  const store = useHardwareStore()
  const subscribe = useCallback((cb: () => void) => (id ? store.subscribe(id, cb) : () => undefined), [store, id])
  const get = useCallback(() => (id ? (store.get(id) ?? NONE) : NONE), [store, id])
  return useSyncExternalStore(subscribe, get, get)
}
