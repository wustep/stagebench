// Normalized presentation state for every visible panel control. It only drives how the
// controls themselves look (LEDs, cap positions, knob angles, pressed caps). No audio,
// program, or display code reads it: in Phase 1 every panel control is decorative.
import type { ControlDef } from './panelTypes'

export interface ControlState {
  /** Buttons: index into `states`. Knobs/faders/drawbars/wheels: value. Encoders: detent count. */
  value: number
  pressed: boolean
}

export type HardwareState = Readonly<Record<string, ControlState>>

export type HardwareAction =
  | { type: 'press'; id: string }
  | { type: 'release'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'set'; id: string; value: number }
  | { type: 'step'; id: string; delta: number }
  | { type: 'reset' }

export function controlRange(control: ControlDef): { min: number; max: number } | null {
  switch (control.kind) {
    case 'button':
      return { min: 0, max: control.states.length - 1 }
    case 'encoder':
      return null
    default:
      return { min: control.min, max: control.max }
  }
}

export function initialValue(control: ControlDef): number {
  switch (control.kind) {
    case 'knob':
    case 'fader':
    case 'drawbar':
    case 'mod-wheel':
      return control.initial
    default:
      return 0
  }
}

export function initialHardwareState(controls: readonly ControlDef[]): HardwareState {
  const state: Record<string, ControlState> = {}
  for (const c of controls) state[c.id] = { value: initialValue(c), pressed: false }
  return state
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function reduceHardware(controls: ReadonlyMap<string, ControlDef>, state: HardwareState, action: HardwareAction): HardwareState {
  if (action.type === 'reset') return initialHardwareState([...controls.values()])
  const control = controls.get(action.id)
  const prev = state[action.id]
  if (!control || !prev) return state
  let next: ControlState = prev
  switch (action.type) {
    case 'press':
      next = { ...prev, pressed: true }
      break
    case 'release':
      next = { ...prev, pressed: false }
      // Spring-loaded pitch stick returns to centre when let go.
      if (control.kind === 'pitch-stick') next = { ...next, value: 0 }
      break
    case 'activate':
      if (control.kind === 'button' && control.states.length > 1) next = { ...prev, value: (prev.value + 1) % control.states.length }
      break
    case 'set':
    case 'step': {
      const raw = action.type === 'set' ? action.value : prev.value + action.delta
      const range = controlRange(control)
      const value = range ? clamp(Math.round(raw), range.min, range.max) : Math.round(raw)
      next = { ...prev, value }
      break
    }
  }
  if (next === prev || (next.value === prev.value && next.pressed === prev.pressed)) return state
  return { ...state, [action.id]: next }
}

type Listener = () => void

/** Tiny external store so each control re-renders only when its own state changes. */
export class HardwareStore {
  private state: HardwareState
  private readonly byId: ReadonlyMap<string, ControlDef>
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly anyListeners = new Set<Listener>()

  constructor(controls: readonly ControlDef[]) {
    this.byId = new Map(controls.map((c) => [c.id, c]))
    this.state = initialHardwareState(controls)
  }

  getState(): HardwareState {
    return this.state
  }

  get(id: string): ControlState | undefined {
    return this.state[id]
  }

  control(id: string): ControlDef | undefined {
    return this.byId.get(id)
  }

  /** LED ids currently lit by a button's presentation state. */
  litLeds(id: string): readonly string[] {
    const control = this.byId.get(id)
    const s = this.state[id]
    if (!control || control.kind !== 'button' || !s) return []
    return control.states[s.value] ?? []
  }

  dispatch = (action: HardwareAction): void => {
    const prev = this.state
    const next = reduceHardware(this.byId, prev, action)
    if (next === prev) return
    this.state = next
    const changed = action.type === 'reset' ? [...this.byId.keys()] : [action.id]
    for (const id of changed) this.listeners.get(id)?.forEach((l) => l())
    this.anyListeners.forEach((l) => l())
  }

  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id)
    if (!set) {
      set = new Set()
      this.listeners.set(id, set)
    }
    set.add(listener)
    return () => set.delete(listener)
  }

  subscribeAll(listener: Listener): () => void {
    this.anyListeners.add(listener)
    return () => this.anyListeners.delete(listener)
  }
}
