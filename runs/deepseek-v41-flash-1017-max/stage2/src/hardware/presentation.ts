import { ALL_CONTROLS, findControl } from './catalog'
import { isNumeric, isSelector, type ControlSpec } from './types'

/**
 * Presentation state for the panel.
 *
 * This store is the *entire* effect of every decorative control in Phase 1: moving a
 * knob writes here and nothing else reads it except the control that renders it. No
 * module in the audio path is reachable from this store, which is what makes the
 * "moves but does nothing" claim true rather than merely stated.
 */
export type PresentationValue = number | boolean

export interface PresentationState {
  values: Record<string, PresentationValue>
  /** Momentary buttons currently held, keyed by control id. */
  pressed: Record<string, boolean>
  /** Where the most recent change came from, for the audit trail. */
  lastChange: { id: string; value: PresentationValue; source: 'pointer' | 'keyboard' | 'api' } | null
}

export type PresentationListener = (state: PresentationState) => void

/**
 * Optional sink for controls that Phase 2 made functional.
 *
 * A panel control still writes its presentation state (so the knob turns and the LED
 * lights), and additionally reports the normalized value here. `App` forwards those to the
 * Piano or Layer Effects store. Controls that are not functional are not in the handler's
 * map at all, so the Phase 1 "presentation only" guarantee still holds for them by
 * construction.
 */
export interface PresentationSink {
  onControlChange(id: string, value: PresentationValue): void
}

export interface PresentationStore {
  getState(): PresentationState
  value(id: string): PresentationValue | undefined
  /** Clamped and snapped for numeric controls; clamped and in-range for selectors. */
  set(id: string, value: PresentationValue, source?: 'pointer' | 'keyboard' | 'api'): void
  /** Installs (or clears) the functional-control sink. */
  setSink(sink: PresentationSink | null): void
  /** Relative nudge used by arrow keys and wheel gestures. */
  nudge(id: string, delta: number, source?: 'pointer' | 'keyboard'): void
  setPressed(id: string, pressed: boolean): void
  /** Returns a spring-loaded control (the pitch stick) to its rest value. */
  releaseSpring(id: string): void
  reset(): void
  subscribe(listener: PresentationListener): () => void
}

function initialValue(control: ControlSpec): PresentationValue {
  if (isNumeric(control)) return control.value
  if (isSelector(control)) return control.value
  return control.value === 1
}

function initialValues(): Record<string, PresentationValue> {
  const values: Record<string, PresentationValue> = {}
  for (const control of ALL_CONTROLS) values[control.id] = initialValue(control)
  return values
}

export function normalizeValue(control: ControlSpec, raw: PresentationValue): PresentationValue {
  if (isNumeric(control)) {
    const n = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? control.max : control.min) : Number(raw)
    if (!Number.isFinite(n)) return control.min
    const stepped = Math.round((n - control.min) / control.step) * control.step + control.min
    const clamped = Math.min(control.max, Math.max(control.min, stepped))
    // Kill float dust so values compare exactly in tests and LED ladders.
    return Math.round(clamped * 1e6) / 1e6
  }
  if (isSelector(control)) {
    const index = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(index)) return 0
    return Math.min(control.options.length - 1, Math.max(0, Math.round(index)))
  }
  return Boolean(raw)
}

export function createPresentationStore(initial?: Record<string, PresentationValue>): PresentationStore {
  let state: PresentationState = {
    values: { ...initialValues(), ...initial },
    pressed: {},
    lastChange: null,
  }
  const listeners = new Set<PresentationListener>()
  let sink: PresentationSink | null = null

  /**
   * Tells the sink about a change, unless the change itself came from the sink (an `api`
   * write used to mirror real state back into the panel). That guard is what stops a
   * control's own echo from re-entering the audio state and fighting the player.
   */
  function notify(id: string, value: PresentationValue, source: 'pointer' | 'keyboard' | 'api'): void {
    if (!sink || source === 'api') return
    sink.onControlChange(id, value)
  }

  function publish(next: PresentationState): void {
    state = next
    for (const listener of listeners) listener(state)
  }

  function set(id: string, value: PresentationValue, source: 'pointer' | 'keyboard' | 'api' = 'pointer'): void {
    const control = findControl(id)
    if (!control) return
    const normalized = normalizeValue(control, value)
    if (state.values[id] === normalized) {
      if (state.lastChange?.id !== id || state.lastChange.value !== normalized) {
        publish({ ...state, lastChange: { id, value: normalized, source } })
      }
      return
    }
    publish({
      values: { ...state.values, [id]: normalized },
      pressed: state.pressed,
      lastChange: { id, value: normalized, source },
    })
    notify(id, normalized, source)
  }

  function nudge(id: string, delta: number, source: 'pointer' | 'keyboard' = 'keyboard'): void {
    const control = findControl(id)
    if (!control) return
    if (isNumeric(control)) {
      const current = Number(state.values[id] ?? control.value)
      set(id, current + delta * control.step, source)
      return
    }
    if (isSelector(control)) {
      const current = Number(state.values[id] ?? control.value)
      set(id, current + Math.sign(delta), source)
      return
    }
    // A toggle is not a range: nudging it is a no-op.
  }

  /** The pitch stick springs back to rest when released. */
  function releaseSpring(id: string): void {
    const control = findControl(id)
    if (!control || !isNumeric(control) || !control.spring) return
    set(id, control.restValue ?? 0, 'api')
  }

  return {
    getState: () => state,
    value: (id) => state.values[id],
    set,
    setSink(next) {
      sink = next
    },
    nudge,
    setPressed(id, pressed) {
      if (state.pressed[id] === pressed) return
      publish({
        values: state.values,
        pressed: { ...state.pressed, [id]: pressed },
        lastChange: state.lastChange,
      })
    },
    releaseSpring,
    reset() {
      publish({ values: initialValues(), pressed: {}, lastChange: null })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
