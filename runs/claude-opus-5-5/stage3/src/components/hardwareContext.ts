import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import type { ControlState, HardwareStore, IndicatorState, MorphRange } from '../model/hardwareStore'

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

/** Why a control is unsupported (undefined = functional or not listed). */
export function useUnsupported(id: string): string | undefined {
  const store = useHardwareStore()
  const subscribe = useCallback((cb: () => void) => store.subscribe('binding', cb), [store])
  const get = useCallback(() => store.unsupported(id), [store, id])
  return useSyncExternalStore(subscribe, get, get)
}

/** The binding's accessible value text for a control (re-read when its state or page changes). */
export function useValueText(id: string): string | undefined {
  const store = useHardwareStore()
  const subscribe = useCallback(
    (cb: () => void) => {
      const a = store.subscribe(`text:${id}`, cb)
      const b = store.subscribe(id, cb)
      return () => {
        a()
        b()
      }
    },
    [store, id],
  )
  const get = useCallback(() => store.valueText(id), [store, id])
  return useSyncExternalStore(subscribe, get, get)
}

/** The morph range shown on a level/drawbar graph. */
export function useMorphRange(ownerId: string): MorphRange | undefined {
  const store = useHardwareStore()
  const subscribe = useCallback((cb: () => void) => store.subscribe(`range:${ownerId}`, cb), [store, ownerId])
  const get = useCallback(() => store.morphRange(ownerId), [store, ownerId])
  return useSyncExternalStore(subscribe, get, get)
}
