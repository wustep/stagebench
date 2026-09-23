import { useSyncExternalStore } from 'react'
import { HARDWARE_CONTROLS, getControl, type HardwareControl } from '../model/hardware'

/**
 * Presentation state for the panel. A listener may mirror piano, effect, and
 * master writes into the audio engine. Organ, Synth, and Program controls have
 * no listener effect and stay decorative. `decorative` on the hardware catalog
 * stays true for the Phase 1 inventory test.
 */
export type PanelAction = 'before-toggle' | 'toggle' | 'value' | 'cycle' | 'pulse'

export class PresentationStore {
  private readonly values = new Map<string, number>()
  private readonly toggles = new Map<string, boolean>()
  private readonly pressed = new Map<string, boolean>()
  private readonly cycles = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private panel: ((action: PanelAction, id: string) => boolean | void) | null = null
  private depth = 0

  constructor() {
    for (const control of HARDWARE_CONTROLS) {
      if (control.type === 'button') this.toggles.set(control.id, control.initialToggle ?? false)
      else this.values.set(control.id, control.initial ?? control.min ?? 0)
      if (control.cycleLabels) this.cycles.set(control.id, control.cycleInitial ?? 0)
    }
  }

  /** Returns true from `before-toggle` to skip the default latch flip. */
  setPanelListener(listener: ((action: PanelAction, id: string) => boolean | void) | null) {
    this.panel = listener
    return () => {
      if (this.panel === listener) this.panel = null
    }
  }

  private notify(action: PanelAction, id: string): boolean {
    if (!this.panel || this.depth > 0) return false
    this.depth += 1
    try {
      return this.panel(action, id) === true
    } finally {
      this.depth -= 1
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
    this.notify('value', id)
  }

  /** Update a knob without feeding the audio listener (focus recall). */
  presentValue(id: string, raw: number) {
    const control = getControl(id)
    const min = control.min ?? 0
    const max = control.max ?? 127
    const value = Math.round(Math.min(max, Math.max(min, raw)))
    if (this.values.get(id) === value) return
    this.values.set(id, value)
    this.emit()
  }

  presentToggle(id: string, value: boolean) {
    if (this.toggles.get(id) === value) return
    this.toggles.set(id, value)
    this.emit()
  }

  presentCycle(id: string, index: number) {
    const control = getControl(id)
    const count = control.cycleLabels?.length ?? 0
    if (count === 0) return
    const next = ((index % count) + count) % count
    if (this.cycles.get(id) === next) return
    this.cycles.set(id, next)
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
    if (this.notify('before-toggle', id)) return
    this.toggles.set(id, !this.getToggle(id))
    this.emit()
    this.notify('toggle', id)
  }

  cycle(id: string) {
    const control = getControl(id)
    const count = control.cycleLabels?.length ?? 0
    if (count === 0) return
    this.cycles.set(id, (this.getCycle(id) + 1) % count)
    this.emit()
    this.notify('cycle', id)
  }

  pulse(id: string) {
    this.notify('pulse', id)
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
