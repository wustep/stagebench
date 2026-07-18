import { useSyncExternalStore } from 'react'
import { CONTROLS } from '../hardware/controls'

/**
 * Presentation-state store for every decorative panel control.
 *
 * Phase 1 honesty contract: writing to this store changes ONLY what the
 * surface shows (knob angle, LED, fader cap position). It never touches the
 * audio engine, the note lifecycle, or any system state.
 */

export interface HardwareState {
  values: Record<string, number>
  /** Incremented each time a control is "pressed"/moved — used to flash momentary buttons. */
  presses: Record<string, number>
}

const initialValues: Record<string, number> = {}
for (const c of CONTROLS) initialValues[c.id] = c.defaultValue

let state: HardwareState = { values: initialValues, presses: {} }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getHardwareState(): HardwareState {
  return state
}

export function getControlValue(id: string): number {
  return state.values[id] ?? 0
}

export function getControlPresses(id: string): number {
  return state.presses[id] ?? 0
}

export function setControlValue(id: string, value: number) {
  state = { ...state, values: { ...state.values, [id]: value }, presses: { ...state.presses, [id]: (state.presses[id] ?? 0) + 1 } }
  emit()
}

export function subscribeHardware(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test hook: reset all presentation state to defaults. */
export function resetHardwareStore() {
  const values: Record<string, number> = {}
  for (const c of CONTROLS) values[c.id] = c.defaultValue
  state = { values, presses: {} }
  emit()
}

export function useHardwareState(): HardwareState {
  return useSyncExternalStore(subscribeHardware, getHardwareState)
}
