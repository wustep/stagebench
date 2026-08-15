import { useSyncExternalStore } from 'react'
import { getAllControls } from './instrument'
import type { ControlSpec, ControlValue } from './types'

/**
 * Normalized presentation-state store for the instrument surface.
 *
 * The store holds a shallow map of control id -> presentation value. Moving a
 * control updates *only* this map — nothing reads it to drive audio or system
 * state in Phase 1. The keybed's note/sustain activity is deliberately kept in
 * a separate note-lifecycle engine, not here.
 *
 * Backed by useSyncExternalStore so a change both re-renders the affected
 * surface and is trivially observable in tests.
 */

export type HardwareState = Readonly<Record<string, ControlValue>>

function defaultState(): HardwareState {
  const state: Record<string, ControlValue> = {}
  for (const control of getAllControls()) {
    if ('defaultValue' in control && control.defaultValue !== undefined) {
      state[control.id] = control.defaultValue
    } else if (control.kind === 'button' || control.kind === 'momentary') {
      state[control.id] = control.defaultValue ?? false
    } else if (control.kind === 'drawbar') {
      state[control.id] = control.defaultValue ?? 0
    } else if (control.kind === 'stick') {
      state[control.id] = 0.5 // centered
    } else if (control.kind === 'oled') {
      state[control.id] = control.text ?? ''
    } else {
      state[control.id] = 0
    }
  }
  return state
}

class HardwareStore {
  private state: HardwareState = defaultState()
  private listeners = new Set<() => void>()

  getSnapshot = (): HardwareState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Restore every control to its declared default (used between tests). */
  reset(): void {
    this.state = defaultState()
    for (const listener of this.listeners) listener()
  }

  get(id: string): ControlValue {
    return this.state[id]
  }

  /** Update presentation state for one control. Fires listeners if changed. */
  set(id: string, value: ControlValue): void {
    const spec = this.spec(id)
    const normalized = this.normalize(spec, value)
    if (!Object.is(this.state[id], normalized)) {
      this.state = { ...this.state, [id]: normalized }
      for (const listener of this.listeners) listener()
    }
  }

  private spec(id: string): ControlSpec {
    const control = getAllControls().find((candidate) => candidate.id === id)
    if (!control) throw new Error(`Unknown hardware control id: ${id}`)
    return control
  }

  private normalize(spec: ControlSpec, value: ControlValue): ControlValue {
    if (spec.kind === 'button' || spec.kind === 'momentary') {
      return typeof value === 'boolean' ? value : Boolean(value)
    }
    if (typeof value !== 'number') return 0
    if (spec.kind === 'drawbar') {
      return Math.max(0, Math.min(8, Math.round(value)))
    }
    if (spec.kind === 'knob') {
      if (spec.steps && spec.steps > 0) {
        const snapped = Math.round(value * spec.steps) / spec.steps
        return Math.max(0, Math.min(1, snapped))
      }
      return Math.max(0, Math.min(1, value))
    }
    if (spec.kind === 'fader') {
      if (spec.segments && spec.segments > 0) {
        return Math.max(0, Math.min(spec.segments - 1, Math.round(value * (spec.segments - 1))))
      }
      return Math.max(0, Math.min(1, value))
    }
    if (spec.kind === 'wheel' || spec.kind === 'stick') {
      return Math.max(0, Math.min(1, value))
    }
    if (spec.kind === 'graph') {
      return Math.max(0, Math.min(spec.segments, Math.round(value * spec.segments)))
    }
    if (spec.kind === 'encoder') {
      return value
    }
    return value
  }
}

export const hardwareStore = new HardwareStore()

/** React hook: read the whole normalized surface state (stable snapshot). */
export function useHardwareState(): HardwareState {
  return useSyncExternalStore(hardwareStore.subscribe, hardwareStore.getSnapshot)
}