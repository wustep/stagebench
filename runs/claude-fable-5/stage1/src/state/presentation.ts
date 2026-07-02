import { useSyncExternalStore } from 'react'
import { getControl, HARDWARE_CONTROLS } from '../model/hardware'

/**
 * Presentation-only state for the decorative panel hardware.
 *
 * Phase 1 honesty contract: this store holds the *visual* position/lit state
 * of every panel control and nothing else. It has no connection to the audio
 * engine, no canonical instrument state, and nothing reads it to fake
 * unimplemented behavior.
 */
export interface PresentationState {
  values: Readonly<Record<string, number>>
  toggles: Readonly<Record<string, boolean>>
}

type Listener = () => void

export class PresentationStore {
  private state: PresentationState
  private listeners = new Set<Listener>()

  constructor() {
    const values: Record<string, number> = {}
    const toggles: Record<string, boolean> = {}
    for (const control of HARDWARE_CONTROLS) {
      if (control.type === 'button') toggles[control.id] = false
      else values[control.id] = control.initial ?? 0
    }
    this.state = { values, toggles }
  }

  getState = (): PresentationState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  setValue(id: string, value: number): void {
    const control = getControl(id)
    const min = control.min ?? 0
    const max = control.max ?? 127
    const clamped = Math.min(max, Math.max(min, Math.round(value)))
    if (this.state.values[id] === clamped) return
    this.state = { ...this.state, values: { ...this.state.values, [id]: clamped } }
    this.emit()
  }

  toggle(id: string): void {
    const current = this.state.toggles[id] ?? false
    this.state = { ...this.state, toggles: { ...this.state.toggles, [id]: !current } }
    this.emit()
  }
}

export function usePresentationValue(store: PresentationStore, id: string): number {
  return useSyncExternalStore(store.subscribe, () => store.getState().values[id] ?? 0)
}

export function usePresentationToggle(store: PresentationStore, id: string): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getState().toggles[id] ?? false)
}
