/**
 * Presentation state for every decorative panel control. Values are numbers:
 * knobs/faders/drawbars/wheels hold their position, toggles hold 0/1, selects hold an
 * option index, radios hold 1 for the lit member, momentary buttons hold 1 while pressed.
 * Changing this state changes nothing else: no audio, no program state.
 */
import { CONTROLS, CONTROL_BY_ID, initialValue, type ControlSpec } from '../hardware/controls'
import { createStore, type Store } from './store'

export interface HardwareState {
  values: Readonly<Record<string, number>>
  /** Momentary/visual press feedback for buttons. */
  pressed: Readonly<Record<string, boolean>>
}

export function initialHardwareState(): HardwareState {
  const values: Record<string, number> = {}
  for (const spec of CONTROLS) values[spec.id] = initialValue(spec)
  return { values, pressed: {} }
}

export type HardwareStore = Store<HardwareState> & {
  setValue(id: string, value: number): void
  nudge(id: string, direction: 1 | -1, multiplier?: number): void
  press(id: string): void
  release(id: string): void
  activate(id: string): void
  reset(): void
}

export function clampValue(spec: ControlSpec, value: number): number {
  if (spec.kind === 'button') {
    if (spec.mode === 'select') {
      const n = spec.options?.length ?? 1
      return ((Math.round(value) % n) + n) % n
    }
    return value ? 1 : 0
  }
  if (spec.wrap) {
    const span = spec.max - spec.min + spec.step
    const v = ((value - spec.min) % span + span) % span + spec.min
    return Math.round(v / spec.step) * spec.step
  }
  const v = Math.min(spec.max, Math.max(spec.min, value))
  return Math.round(v / spec.step) * spec.step
}

export function createHardwareStore(): HardwareStore {
  const base = createStore<HardwareState>(initialHardwareState())
  const setValue = (id: string, value: number) => {
    const spec = CONTROL_BY_ID.get(id)
    if (!spec) return
    const next = clampValue(spec, value)
    base.set((s) => (s.values[id] === next ? s : { ...s, values: { ...s.values, [id]: next } }))
  }
  const store: HardwareStore = {
    ...base,
    setValue,
    nudge(id, direction, multiplier = 1) {
      const spec = CONTROL_BY_ID.get(id)
      if (!spec) return
      const current = base.get().values[id] ?? 0
      if (spec.kind === 'button') {
        if (spec.mode === 'select') setValue(id, current + direction)
        return
      }
      setValue(id, current + direction * spec.step * multiplier)
    },
    press(id) {
      const spec = CONTROL_BY_ID.get(id)
      if (!spec || spec.kind !== 'button') return
      base.set((s) => ({ ...s, pressed: { ...s.pressed, [id]: true } }))
      if (spec.mode === 'momentary') setValue(id, 1)
    },
    release(id) {
      const spec = CONTROL_BY_ID.get(id)
      if (!spec || spec.kind !== 'button') return
      base.set((s) => {
        if (!s.pressed[id]) return s
        const pressed = { ...s.pressed }
        delete pressed[id]
        return { ...s, pressed }
      })
      if (spec.mode === 'momentary') setValue(id, 0)
    },
    /** A full click: toggles, cycles a selector, or lights a radio member. */
    activate(id) {
      const spec = CONTROL_BY_ID.get(id)
      if (!spec || spec.kind !== 'button') return
      const current = base.get().values[id] ?? 0
      if (spec.mode === 'toggle') setValue(id, current ? 0 : 1)
      else if (spec.mode === 'select') setValue(id, current + 1)
      else if (spec.mode === 'radio') {
        base.set((s) => {
          const values = { ...s.values }
          for (const c of CONTROLS) {
            if (c.kind === 'button' && c.mode === 'radio' && c.radioGroup === spec.radioGroup) values[c.id] = c.id === id ? 1 : 0
          }
          return { ...s, values }
        })
      }
    },
    reset() {
      base.set(initialHardwareState())
    },
  }
  return store
}
