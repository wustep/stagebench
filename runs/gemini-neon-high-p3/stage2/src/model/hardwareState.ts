import { PANEL_CONTROLS, PANEL_CONTROL_BY_ID, type PanelControlSpec } from './controls'

export type HardwarePresentationState = Readonly<Record<string, number>>

export type HardwareAction =
  | { readonly type: 'set'; readonly id: string; readonly value: number }
  | { readonly type: 'step'; readonly id: string; readonly delta: number }
  | { readonly type: 'activate'; readonly id: string }
  | { readonly type: 'reset' }

function clampAndStep(spec: PanelControlSpec, raw: number): number {
  const clamped = Math.max(spec.min, Math.min(spec.max, raw))
  const stepped = Math.round((clamped - spec.min) / spec.step) * spec.step + spec.min
  return Math.max(spec.min, Math.min(spec.max, stepped))
}

export function createInitialHardwareState(): HardwarePresentationState {
  const state: Record<string, number> = {}
  for (const control of PANEL_CONTROLS) {
    state[control.id] = control.defaultValue
  }
  return state
}

/**
 * Pure presentation-only hardware state reducer.
 * Phase 1 contract: panel controls move, toggle, or cycle their visual state
 * accessibly, and NEVER alter audio parameters, program engines, or effects.
 */
export function hardwareStateReducer(
  state: HardwarePresentationState,
  action: HardwareAction,
): HardwarePresentationState {
  if (action.type === 'reset') {
    return createInitialHardwareState()
  }

  const spec = PANEL_CONTROL_BY_ID[action.id]
  if (!spec) return state
  const current = state[spec.id] ?? spec.defaultValue

  if (action.type === 'set') {
    const next = clampAndStep(spec, action.value)
    if (next === current) return state
    return { ...state, [spec.id]: next }
  }

  if (action.type === 'step') {
    const next = clampAndStep(spec, current + action.delta * spec.step)
    if (next === current) return state
    return { ...state, [spec.id]: next }
  }

  if (action.type === 'activate') {
    if (spec.kind === 'button') {
      const span = spec.max - spec.min + 1
      const next = spec.min + ((current - spec.min + 1) % span)
      return { ...state, [spec.id]: next }
    }
    // Activating a slider/knob/drawbar/wheel steps forward, wrapping at max
    const next = current + spec.step > spec.max ? spec.min : current + spec.step
    return { ...state, [spec.id]: next }
  }

  return state
}

export function formatControlValueText(spec: PanelControlSpec, value: number): string {
  if (spec.options && spec.options[value] !== undefined) {
    return spec.options[value]
  }
  if (spec.kind === 'button') {
    return value > 0 ? 'On' : 'Off'
  }
  if (spec.kind === 'drawbar') {
    return `${value} / 8`
  }
  if (spec.id === 'perf-pitch-stick') {
    if (value === 0) return 'Center'
    return value > 0 ? `+${value}%` : `${value}%`
  }
  return `${value}%`
}
