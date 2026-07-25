import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { control, controlValueText, type ControlSpec } from '../model/controls'
import type { LayerId } from '../audio/settings'
import {
  deckReducer,
  initialDeckState,
  isMorphDestination,
  morphedValues,
  normalisedPosition,
  type DeckState,
  type GlobalUnitId,
  type HardwareValues,
} from './hardware'
import { browserSnapshotStore, readLiveSlots, writeLiveSlots, type SnapshotStore } from './program'

interface HardwareApi {
  readonly values: HardwareValues
  /**
   * What the panel *shows*: the stored values with every active morph interpolated in, so an
   * assigned knob really moves under the wheel (programs spec, `morph.indicators`).
   */
  readonly displayValues: HardwareValues
  readonly deck: DeckState
  setValue(id: string, value: number): void
  activate(id: string): void
  nudge(id: string, steps: number): void
  focusLayer(layer: LayerId): void
  /** Virtual Control Pedal, 0–1. Also driven by MIDI CC 11. */
  setPedal(value: number): void
  reset(): void
}

const HardwareContext = createContext<HardwareApi | null>(null)

export interface HardwareProviderProps {
  children: ReactNode
  /**
   * Storage boundary for the Live slots. `undefined` uses `localStorage` when it exists; `null`
   * disables persistence entirely, which is what the hermetic component tests pass.
   */
  store?: SnapshotStore | null
}

export function HardwareProvider({ children, store }: HardwareProviderProps) {
  const [deck, dispatch] = useReducer(deckReducer, undefined, initialDeckState)
  const storeRef = useRef<SnapshotStore | null>(store === undefined ? browserSnapshotStore() : store)
  storeRef.current = store === undefined ? storeRef.current : store
  const restored = useRef(false)

  // Live slots auto-store every edit and survive a reload (programs spec, `acceptance`).
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const slots = readLiveSlots(storeRef.current)
    if (slots.some((slot) => slot !== null)) dispatch({ type: 'live-restore', slots })
  }, [])

  useEffect(() => {
    if (!restored.current) return
    writeLiveSlots(storeRef.current, deck.live)
  }, [deck.live])

  const display = useMemo(() => morphedValues(deck), [deck])

  const api = useMemo<HardwareApi>(
    () => ({
      values: deck.values,
      displayValues: display,
      deck,
      setValue: (id, value) => dispatch({ type: 'set', id, value }),
      // `at` carries the wall clock the press happened at, which is what tap tempo measures.
      activate: (id) => dispatch({ type: 'activate', id, at: Date.now() }),
      nudge: (id, steps) => dispatch({ type: 'nudge', id, steps }),
      focusLayer: (layer) => dispatch({ type: 'focus', layer }),
      setPedal: (value) => dispatch({ type: 'pedal', value }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [deck, display],
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
  /** The value the panel shows, which is the morphed value while a morph source is up. */
  readonly value: number
  /** The stored value, before any morph. Moving the control edits this one. */
  readonly storedValue: number
  readonly position: number
  readonly valueText: string
  /** True when a morph source has this control assigned, which lights its green morph LED. */
  readonly morphed: boolean
  set(value: number): void
  activate(): void
  nudge(steps: number): void
}

export function useControl(id: string): ControlHandle {
  const api = useHardware()
  const spec = control(id)
  const storedValue = api.values[id] ?? spec.initial
  const value = api.displayValues[id] ?? storedValue
  const { setValue, activate, nudge } = api
  const set = useCallback((next: number) => setValue(id, next), [id, setValue])
  const activateControl = useCallback(() => activate(id), [activate, id])
  const nudgeControl = useCallback((steps: number) => nudge(id, steps), [id, nudge])
  const assigned =
    isMorphDestination(id) &&
    (api.deck.morphs.wheel[id] !== undefined || api.deck.morphs.pedal[id] !== undefined)
  return {
    spec,
    value,
    storedValue,
    position: normalisedPosition(spec, value),
    valueText: controlValueText(spec, value),
    morphed: assigned,
    set,
    activate: activateControl,
    nudge: nudgeControl,
  }
}
