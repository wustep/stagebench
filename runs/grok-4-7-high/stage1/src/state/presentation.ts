import { useSyncExternalStore } from 'react'
import { HARDWARE_CONTROLS, getControl, type HardwareControl } from '../model/hardware'

/**
 * Presentation state for the panel. Phase 1 writes never leave this store:
 * knobs, faders, drawbars, wheels, and buttons change what the surface shows
 * and nothing in the audio graph.
 */
export class PresentationStore {
  private readonly values = new Map<string, number>()
  private readonly toggles = new Map<string, boolean>()
  private readonly pressed = new Map<string, boolean>()
  private readonly cycles = new Map<string, number>()
  private readonly listeners = new Set<() => void>()

  constructor() {
    for (const control of HARDWARE_CONTROLS) {
      if (control.type === 'button') this.toggles.set(control.id, false)
      else this.values.set(control.id, control.initial ?? control.min ?? 0)
      if (control.cycleLabels) this.cycles.set(control.id, 0)
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  getValue(id: string): number {
    return this.values.get(id) ?? 0
  }

  getToggle(id: string): boolean {
    return this.toggles.get(id) ?? false
  }

  getPressed(id: string): boolean {
    return this.pressed.get(id) ?? false
  }

  getCycle(id: string): number {
    return this.cycles.get(id) ?? 0
  }

  setValue(id: string, raw: number) {
    const control = getControl(id)
    const min = control.min ?? 0
    const max = control.max ?? 127
    const value = Math.round(Math.min(max, Math.max(min, raw)))
    if (this.values.get(id) === value) return
    this.values.set(id, value)
    this.emit()
  }

  press(id: string) {
    if (this.pressed.get(id)) return
    this.pressed.set(id, true)
    this.emit()
  }

  release(id: string) {
    if (!this.pressed.get(id)) return
    this.pressed.set(id, false)
    this.emit()
  }

  toggle(id: string) {
    this.toggles.set(id, !this.getToggle(id))
    this.emit()
  }

  cycle(id: string) {
    const control = getControl(id)
    const count = control.cycleLabels?.length ?? 0
    if (count === 0) return
    this.cycles.set(id, (this.getCycle(id) + 1) % count)
    this.emit()
  }
}

export function usePresentationValue(store: PresentationStore, id: string): number {
  return useSyncExternalStore(store.subscribe, () => store.getValue(id))
}

export function usePresentationToggle(store: PresentationStore, id: string): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getToggle(id))
}

export function usePresentationPressed(store: PresentationStore, id: string): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getPressed(id))
}

export function usePresentationCycle(store: PresentationStore, id: string): number {
  return useSyncExternalStore(store.subscribe, () => store.getCycle(id))
}

export type { HardwareControl }
