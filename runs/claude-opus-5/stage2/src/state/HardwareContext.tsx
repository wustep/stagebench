import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'
import { control, controlValueText, type ControlSpec } from '../model/controls'
import type { LayerId } from '../audio/settings'
import {
  deckReducer,
  initialDeckState,
  normalisedPosition,
  type DeckState,
  type GlobalUnitId,
  type HardwareValues,
} from './hardware'

interface HardwareApi {
  readonly values: HardwareValues
  readonly deck: DeckState
  setValue(id: string, value: number): void
  activate(id: string): void
  nudge(id: string, steps: number): void
  focusLayer(layer: LayerId): void
  reset(): void
}

const HardwareContext = createContext<HardwareApi | null>(null)

export function HardwareProvider({ children }: { children: ReactNode }) {
  const [deck, dispatch] = useReducer(deckReducer, undefined, initialDeckState)

  const api = useMemo<HardwareApi>(
    () => ({
      values: deck.values,
      deck,
      setValue: (id, value) => dispatch({ type: 'set', id, value }),
      // `at` carries the wall clock the press happened at, which is what tap tempo measures.
      activate: (id) => dispatch({ type: 'activate', id, at: Date.now() }),
      nudge: (id, steps) => dispatch({ type: 'nudge', id, steps }),
      focusLayer: (layer) => dispatch({ type: 'focus', layer }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [deck],
  )

  return <HardwareContext.Provider value={api}>{children}</HardwareContext.Provider>
}

export function useHardware(): HardwareApi {
  const api = useContext(HardwareContext)
  if (!api) throw new Error('useHardware must be used inside a HardwareProvider')
  return api
}

export function useDeck(): DeckState {
  return useHardware().deck
}

export function useGlobalUnit(unit: GlobalUnitId): boolean {
  return useHardware().deck.globals[unit]
}

export interface ControlHandle {
  readonly spec: ControlSpec
  readonly value: number
  readonly position: number
  readonly valueText: string
  set(value: number): void
  activate(): void
  nudge(steps: number): void
}

export function useControl(id: string): ControlHandle {
  const api = useHardware()
  const spec = control(id)
  const value = api.values[id] ?? spec.initial
  const { setValue, activate, nudge } = api
  const set = useCallback((next: number) => setValue(id, next), [id, setValue])
  const activateControl = useCallback(() => activate(id), [activate, id])
  const nudgeControl = useCallback((steps: number) => nudge(id, steps), [id, nudge])
  return {
    spec,
    value,
    position: normalisedPosition(spec, value),
    valueText: controlValueText(spec, value),
    set,
    activate: activateControl,
    nudge: nudgeControl,
  }
}
