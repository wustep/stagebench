// Normalized presentation state for every visible panel control (LEDs, cap positions, knob
// angles, pressed caps). Unsupported (spec-excluded) controls only ever change this state.
// Functional controls are routed through an attached ControlBinding, which turns their actions into
// canonical sound state and writes the resulting presentation back with sync() — including LED
// indicators and the morph ranges shown on level/drawbar LED graphs.
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

export type IndicatorState = 'on' | 'off' | 'flash'

/** Functional-control hook: may consume an action, and observes continuous value changes. */
export interface ControlBinding {
  /** Handle the action entirely (return true) — e.g. a functional button press. */
  intercept(action: HardwareAction, store: HardwareStore): boolean
  /** A bound control's value changed through the normal reducer. */
  observe(id: string, value: number, delta: number, store: HardwareStore): void
  /** Accessible description of a functional control, or undefined when decorative. */
  describe(id: string): string | undefined
  /** Why a non-functional control is unsupported (spec clause), if listed. */
  unsupported?(id: string): string | undefined
  /** Accessible value text for a functional control (e.g. an OLED dial's parameter). */
  valueText?(id: string): string | undefined
}

/** A morph range shown on a level/drawbar LED graph: base value → morph end value. */
export type MorphRange = readonly [number, number]

/** Tiny external store so each control re-renders only when its own state changes. */
export class HardwareStore {
  private state: HardwareState
  private readonly byId: ReadonlyMap<string, ControlDef>
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly anyListeners = new Set<Listener>()
  private binding: ControlBinding | null = null
  private indicatorState: Record<string, IndicatorState> = {}
  private ranges: Record<string, MorphRange> = {}

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
    if (this.binding?.intercept(action, this)) return
    const prev = this.state
    const next = reduceHardware(this.byId, prev, action)
    if (next === prev) return
    this.state = next
    const changed = action.type === 'reset' ? [...this.byId.keys()] : [action.id]
    for (const id of changed) this.listeners.get(id)?.forEach((l) => l())
    this.anyListeners.forEach((l) => l())
    if (this.binding && action.type !== 'reset') {
      const before = prev[action.id]?.value ?? 0
      const after = next[action.id]?.value ?? 0
      const delta = action.type === 'step' ? action.delta : after - before
      if (after !== before || action.type === 'step') this.binding.observe(action.id, after, delta, this)
    }
  }

  attach(binding: ControlBinding | null): void {
    this.binding = binding
    // Descriptions depend on the binding.
    this.listeners.get('binding')?.forEach((l) => l())
  }

  describe(id: string): string | undefined {
    return this.binding?.describe(id)
  }

  unsupported(id: string): string | undefined {
    return this.binding?.unsupported?.(id)
  }

  valueText(id: string): string | undefined {
    return this.binding?.valueText?.(id)
  }

  morphRange(ownerId: string): MorphRange | undefined {
    return this.ranges[ownerId]
  }

  /** Replace the morph ranges shown on LED graphs (owner control id → [base, end]). */
  syncRanges(ranges: Readonly<Record<string, MorphRange>>): void {
    const changed = new Set<string>()
    for (const id of Object.keys(this.ranges)) if (!(id in ranges)) changed.add(id)
    for (const [id, r] of Object.entries(ranges)) {
      const prev = this.ranges[id]
      if (!prev || prev[0] !== r[0] || prev[1] !== r[1]) changed.add(id)
    }
    if (!changed.size) return
    this.ranges = { ...ranges }
    for (const id of changed) this.listeners.get(`range:${id}`)?.forEach((l) => l())
  }

  /** Notify controls whose value text may have changed (OLED dial pages). */
  touch(ids: readonly string[]): void {
    for (const id of ids) this.listeners.get(`text:${id}`)?.forEach((l) => l())
  }

  /** Write presentation values for functional controls (from canonical sound state). */
  sync(values: Readonly<Record<string, number>>, indicators?: Readonly<Record<string, IndicatorState>>): void {
    const changed: string[] = []
    let state = this.state
    for (const [id, value] of Object.entries(values)) {
      const prev = state[id]
      if (!prev || prev.value === value) continue
      state = { ...state, [id]: { ...prev, value } }
      changed.push(id)
    }
    this.state = state
    const ledChanged: string[] = []
    if (indicators) {
      for (const [id, v] of Object.entries(indicators)) {
        if (this.indicatorState[id] !== v) ledChanged.push(id)
      }
      if (ledChanged.length) this.indicatorState = { ...this.indicatorState, ...indicators }
    }
    for (const id of changed) this.listeners.get(id)?.forEach((l) => l())
    for (const id of ledChanged) this.listeners.get(`led:${id}`)?.forEach((l) => l())
    if (changed.length) this.anyListeners.forEach((l) => l())
  }

  /** Mark a control pressed/unpressed without any other effect (functional buttons). */
  setPressed(id: string, pressed: boolean): void {
    const prev = this.state[id]
    if (!prev || prev.pressed === pressed) return
    this.state = { ...this.state, [id]: { ...prev, pressed } }
    this.listeners.get(id)?.forEach((l) => l())
    this.anyListeners.forEach((l) => l())
  }

  indicator(ledId: string): IndicatorState | undefined {
    return this.indicatorState[ledId]
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
