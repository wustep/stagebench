import { FUNCTIONAL_CONTROL_IDS } from './functional'
import { INVENTORY, type Inventory } from './inventory'
import type { ControlDef, LedDef, RangeDef } from './types'

type Listener = () => void

/** How an LED is shown: steadily lit, dark, or blinking. */
export type LedMode = 'on' | 'off' | 'blink'

/**
 * Presentation state of the panel hardware: where each knob, fader, drawbar, and wheel
 * sits, which indicator position each button is on, and what is physically held down.
 *
 * This store is deliberately a dead end. It holds no reference to the audio engine, the
 * note lifecycle, MIDI, or storage, so by itself moving a panel control cannot change
 * anything but how the panel looks. Decorative controls stop here.
 *
 * Functional controls (Phase 2: Piano, Layer Effects, Rotary, Master Level) are watched from
 * outside by the binder in src/state, which gives their movements meaning and writes the
 * canonical state back as positions, LED modes, and value texts. The store still knows
 * nothing about sound: `isFunctional` is a label, and the setters below only change the look.
 */
export class HardwareStore {
  private readonly inventory: Inventory
  private values = new Map<string, number>()
  private pressed = new Set<string>()
  private presses = new Map<string, number>()
  private listeners = new Set<Listener>()
  private version = 0
  private readonly functional: ReadonlySet<string>
  private ledModes = new Map<string, LedMode>()
  private latched = new Set<string>()
  private valueTexts = new Map<string, string>()
  private batching = 0
  private pendingEmit = false

  constructor(inventory: Inventory = INVENTORY, functional: Iterable<string> = FUNCTIONAL_CONTROL_IDS) {
    this.inventory = inventory
    this.functional = new Set(functional)
    this.reset()
  }

  /** Back to the initial positions, which mirror the reference photo. */
  reset(): void {
    this.values = new Map(this.inventory.controls.map((control) => [control.id, control.initial]))
    this.pressed = new Set()
    this.presses = new Map()
    this.ledModes = new Map()
    this.latched = new Set()
    this.valueTexts = new Map()
    this.emit()
  }

  /** True for a control whose movement is given meaning outside this store. */
  isFunctional(id: string): boolean {
    return this.functional.has(id)
  }

  /** Run several changes and notify listeners once at the end. */
  batch(change: () => void): void {
    this.batching += 1
    try {
      change()
    } finally {
      this.batching -= 1
      if (this.batching === 0 && this.pendingEmit) {
        this.pendingEmit = false
        this.emit()
      }
    }
  }

  /** Put a button's indicator on a given position without counting a press. */
  setStep(id: string, step: number): void {
    const control = this.def(id)
    if (control.kind !== 'button' || control.steps === 0) return
    const next = Math.min(control.steps - 1, Math.max(0, Math.round(step)))
    if (next === this.values.get(id)) return
    this.values.set(id, next)
    this.emit()
  }

  /** Override how an LED is shown; null returns it to its own binding. */
  setLed(ledId: string, mode: LedMode | null): void {
    if ((this.ledModes.get(ledId) ?? null) === mode) return
    if (mode === null) this.ledModes.delete(ledId)
    else this.ledModes.set(ledId, mode)
    this.emit()
  }

  getLedMode(led: LedDef): LedMode {
    const override = this.ledModes.get(led.id)
    if (override) return override
    if (led.binding.type === 'static') return led.binding.lit ? 'on' : 'off'
    return led.binding.on.includes(this.getValue(led.binding.control)) ? 'on' : 'off'
  }

  /** Show a momentary button as latched (the Shift buttons). */
  setLatched(id: string, latched: boolean): void {
    if (this.latched.has(id) === latched) return
    if (latched) this.latched.add(id)
    else this.latched.delete(id)
    this.emit()
  }

  isLatched(id: string): boolean {
    return this.latched.has(id)
  }

  /** Human-readable value of a functional control, in its real unit; null clears it. */
  setValueText(id: string, text: string | null): void {
    if ((this.valueTexts.get(id) ?? null) === text) return
    if (text === null) this.valueTexts.delete(id)
    else this.valueTexts.set(id, text)
    this.emit()
  }

  getValueText(id: string): string | undefined {
    return this.valueTexts.get(id)
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  /** Monotonic counter, bumped on every change. */
  getVersion = (): number => this.version

  def(id: string): ControlDef {
    const control = this.inventory.controlById.get(id)
    if (!control) throw new Error(`Unknown control ${id}`)
    return control
  }

  /** Button: indicator position. Everything else: the control's position on its own scale. */
  getValue(id: string): number {
    return this.values.get(id) ?? 0
  }

  isPressed(id: string): boolean {
    return this.pressed.has(id)
  }

  /** How many times a button has been pressed and released. */
  getPressCount(id: string): number {
    return this.presses.get(id) ?? 0
  }

  setValue(id: string, value: number): void {
    const control = this.def(id)
    if (control.kind === 'button') return
    const next = normalize(control, value)
    if (next === this.values.get(id)) return
    this.values.set(id, next)
    this.emit()
  }

  /** Move by a signed amount on the control's own scale. */
  nudge(id: string, amount: number): void {
    const control = this.def(id)
    if (control.kind === 'button') return
    this.setValue(id, this.getValue(id) + amount)
  }

  press(id: string): void {
    const control = this.def(id)
    if (control.kind !== 'button' || this.pressed.has(id)) return
    this.pressed.add(id)
    this.emit()
  }

  /**
   * Lets go of a button. With `commit`, the press counts: the press counter goes up and
   * the indicator moves to its next position. Without it (pointer slid off, focus lost),
   * the cap just comes back up.
   */
  release(id: string, commit: boolean): void {
    const control = this.def(id)
    if (control.kind !== 'button') return
    const wasPressed = this.pressed.delete(id)
    if (commit) {
      this.presses.set(id, this.getPressCount(id) + 1)
      if (control.steps > 0) this.values.set(id, (this.getValue(id) + 1) % control.steps)
    }
    if (wasPressed || commit) this.emit()
  }

  /** A full press and release. */
  activate(id: string): void {
    this.press(id)
    this.release(id, true)
  }

  isLedLit(led: LedDef): boolean {
    return this.getLedMode(led) !== 'off'
  }

  /** Plain snapshot of every position, for tests and debugging. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values)
  }

  private emit(): void {
    if (this.batching > 0) {
      this.pendingEmit = true
      return
    }
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

/** Clamp (or wrap, for endless dials) and snap to the control's step. */
export function normalize(control: RangeDef, value: number): number {
  const { min, max, step } = control
  let next = Math.round((value - min) / step) * step + min
  if (control.wrap) {
    const span = max - min + step
    next = ((((next - min) % span) + span) % span) + min
  } else {
    next = Math.min(max, Math.max(min, next))
  }
  return Math.round(next * 1e4) / 1e4
}

/** 0..1 position of a ranged control along its travel. */
export function fraction(control: RangeDef, value: number): number {
  return (value - control.min) / (control.max - control.min)
}

/** Human-readable value for aria-valuetext. */
export function valueText(control: RangeDef, value: number): string {
  switch (control.kind) {
    case 'drawbar':
      return `${value} of ${control.max}`
    case 'fader':
      return `${Math.round(value)} percent`
    case 'encoder':
      return `detent ${value + 1} of ${control.max + 1}`
    case 'wheel':
      return `${Math.round(value)} of ${control.max}`
    case 'stick':
      return value === 0 ? 'centre' : `${value > 0 ? 'up' : 'down'} ${Math.abs(Math.round(value))} percent`
    default: {
      const rounded = Math.round(value * 10) / 10
      return control.unit ? `${rounded} ${control.unit}` : String(rounded)
    }
  }
}
