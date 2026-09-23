import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import type { ControlState, HardwareStore, IndicatorState } from '../model/hardwareStore'

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

/** Sound-state indicator for an LED (Phase 2 bindings), undefined when none is set. */
export function useIndicator(ledId: string): IndicatorState | undefined {
  const store = useHardwareStore()
  const subscribe = useCallback((cb: () => void) => store.subscribe(`led:${ledId}`, cb), [store, ledId])
  const get = useCallback(() => store.indicator(ledId), [store, ledId])
  return useSyncExternalStore(subscribe, get, get)
}

/** The binding's description of a functional control (undefined = decorative). */
export function useDescription(id: string): string | undefined {
  const store = useHardwareStore()
  const subscribe = useCallback((cb: () => void) => store.subscribe('binding', cb), [store])
  const get = useCallback(() => store.describe(id), [store, id])
  return useSyncExternalStore(subscribe, get, get)
}
