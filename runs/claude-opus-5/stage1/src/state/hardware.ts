import { CONTROLS, control, type ControlSpec } from '../model/controls'

/**
 * Normalised presentation state for the whole control deck: control id -> current value.
 *
 * This store is deliberately inert. Nothing reads it except the renderers that draw knob angles,
 * fader positions and indicator LEDs. No audio path, program state or display text is derived
 * from it, which is what the Phase 1 honesty contract requires of decorative controls.
 */
export type HardwareValues = Readonly<Record<string, number>>

export function initialHardwareValues(): HardwareValues {
  const values: Record<string, number> = {}
  for (const spec of CONTROLS) values[spec.id] = spec.initial
  return values
}

export function clampToSpec(spec: ControlSpec, value: number): number {
  if (Number.isNaN(value)) return spec.initial
  const stepped = spec.step > 0 ? Math.round(value / spec.step) * spec.step : value
  const clamped = Math.min(spec.max, Math.max(spec.min, stepped))
  // Guard against float dust from the step quantisation (0.30000000000000004 and friends).
  return Math.round(clamped * 1e6) / 1e6
}

/**
 * The value a control takes when it is pressed / activated.
 * - option buttons advance through their printed indicator options and wrap;
 * - toggle buttons flip;
 * - momentary buttons return to 0 (they carry no latched state);
 * - continuous controls are unchanged by a press.
 */
export function activatedValue(spec: ControlSpec, currentValue: number): number {
  if (spec.options) return (Math.round(currentValue) + 1) % spec.options.length
  if (spec.toggle) return currentValue >= 0.5 ? 0 : 1
  if (spec.momentary) return 0
  return currentValue
}

export function nudgeValue(spec: ControlSpec, currentValue: number, steps: number): number {
  if (spec.options) {
    const count = spec.options.length
    return (Math.round(currentValue) + ((steps % count) + count)) % count
  }
  if (spec.toggle || spec.momentary) return steps > 0 ? 1 : 0
  return clampToSpec(spec, currentValue + steps * spec.step)
}

export type HardwareAction =
  | { type: 'set'; id: string; value: number }
  | { type: 'activate'; id: string }
  | { type: 'nudge'; id: string; steps: number }
  | { type: 'reset' }

export function hardwareReducer(state: HardwareValues, action: HardwareAction): HardwareValues {
  switch (action.type) {
    case 'reset':
      return initialHardwareValues()
    case 'set': {
      const spec = control(action.id)
      const value = clampToSpec(spec, action.value)
      if (state[action.id] === value) return state
      return { ...state, [action.id]: value }
    }
    case 'activate': {
      const spec = control(action.id)
      const value = activatedValue(spec, state[action.id] ?? spec.initial)
      if (state[action.id] === value) return state
      return { ...state, [action.id]: value }
    }
    case 'nudge': {
      const spec = control(action.id)
      const value = nudgeValue(spec, state[action.id] ?? spec.initial, action.steps)
      if (state[action.id] === value) return state
      return { ...state, [action.id]: value }
    }
  }
}

/** Fraction of travel, 0..1, used to draw knob angles, fader caps and drawbar heights. */
export function normalisedPosition(spec: ControlSpec, value: number): number {
  if (spec.max === spec.min) return 0
  return (value - spec.min) / (spec.max - spec.min)
}
