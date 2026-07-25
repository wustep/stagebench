import { CONTROLS, control, type ControlSpec } from '../model/controls'
import { pianoType, timbreOptionsFor } from '../audio/pianoTypes'
import type { LayerId, PianoTypeId } from '../audio/settings'

/**
 * Normalised state for the whole control deck.
 *
 * `values` is what the panel shows. The Piano and Layer Effects controls are *focus scoped*: the
 * hardware has one set of knobs that edits whichever layer has focus, so this store keeps one
 * bank of those values per layer and swaps them when focus changes. Group mode writes to both
 * piano layers at once, and a unit switched to Global writes to every layer, exactly as the
 * effects spec describes.
 *
 * Controls outside those two sections are still presentation state only: nothing reads them
 * except the renderers that draw knob angles, fader positions and indicator LEDs.
 */
export type HardwareValues = Readonly<Record<string, number>>

export type GlobalUnitId = 'delay' | 'compressor' | 'reverb'

export const GLOBAL_UNIT_BY_CONTROL: Readonly<Record<string, GlobalUnitId>> = {
  'fx.delay.on': 'delay',
  'fx.comp.on': 'compressor',
  'fx.reverb.on': 'reverb',
}

/** Every control the Piano/Effects panel edits per layer rather than per instrument. */
export const LAYER_SCOPED_IDS: readonly string[] = CONTROLS.filter(
  (spec) =>
    (spec.id.startsWith('fx.') &&
      !['fx.section-on', 'fx.shift', 'fx.focus.organ', 'fx.focus.piano', 'fx.focus.synth'].includes(spec.id)) ||
    [
      'piano.type',
      'piano.model',
      'piano.timbre',
      'piano.acoustics',
      'piano.unison',
      'piano.kb-touch',
      'piano.dyn-comp',
      'piano.sustped',
    ].includes(spec.id),
).map((spec) => spec.id)

const LAYER_SCOPED = new Set(LAYER_SCOPED_IDS)

export function isLayerScoped(id: string): boolean {
  return LAYER_SCOPED.has(id)
}

/** Controls that belong to a globally-switchable unit, so a global write reaches every layer. */
export function globalUnitOf(id: string): GlobalUnitId | null {
  if (id.startsWith('fx.delay.')) return 'delay'
  if (id.startsWith('fx.comp.')) return 'compressor'
  if (id.startsWith('fx.reverb.')) return 'reverb'
  return null
}

export const PIANO_LAYERS: readonly LayerId[] = ['a', 'b']

/** Octave shift travel for the piano layers: ±12 semitones (piano spec, architecture). */
export const OCTAVE_LIMIT = 12

export interface DeckState {
  /** What the panel currently displays — the focused layer's view of the scoped controls. */
  readonly values: HardwareValues
  /** Stored per-layer values of the focus-scoped controls. */
  readonly banks: Readonly<Record<LayerId, HardwareValues>>
  readonly focus: LayerId
  /** Piano group mode: both piano layers share one effect setting. */
  readonly group: boolean
  readonly globals: Readonly<Record<GlobalUnitId, boolean>>
  readonly octaves: Readonly<Record<LayerId, number>>
  /** Timestamp of the last delay tap, for tap tempo. */
  readonly lastTapAt: number | null
}

export function initialHardwareValues(): HardwareValues {
  const values: Record<string, number> = {}
  for (const spec of CONTROLS) values[spec.id] = spec.initial
  return values
}

function scopedSlice(values: HardwareValues): HardwareValues {
  const slice: Record<string, number> = {}
  for (const id of LAYER_SCOPED_IDS) slice[id] = values[id]
  return slice
}

export function initialDeckState(): DeckState {
  const values = initialHardwareValues()
  // Both layers power up holding the same piano and effect settings until one is edited.
  return {
    values,
    banks: { a: scopedSlice(values), b: scopedSlice(values) },
    focus: 'a',
    group: false,
    globals: { delay: false, compressor: false, reverb: false },
    octaves: { a: 0, b: 0 },
    lastTapAt: null,
  }
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
export function activatedValue(spec: ControlSpec, currentValue: number, optionCount?: number): number {
  if (spec.options) {
    const count = Math.max(1, Math.min(optionCount ?? spec.options.length, spec.options.length))
    return (Math.round(currentValue) + 1) % count
  }
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
  | { type: 'activate'; id: string; at?: number }
  | { type: 'nudge'; id: string; steps: number }
  | { type: 'focus'; layer: LayerId }
  | { type: 'reset' }

const TAP_MIN_MS = 120
const TAP_MAX_MS = 2000

/** Tap tempo: the interval between two taps becomes the delay time, as a 0–10 knob value. */
export function tapTempoValue(previousAt: number | null, at: number, min = 0.06, max = 1.1): number | null {
  if (previousAt === null) return null
  const intervalMs = at - previousAt
  if (intervalMs < TAP_MIN_MS || intervalMs > TAP_MAX_MS) return null
  const clamped = Math.min(max, Math.max(min, intervalMs / 1000))
  return ((clamped - min) / (max - min)) * 10
}

function withValue(state: DeckState, id: string, value: number): DeckState {
  if (state.values[id] === value) return state
  const values = { ...state.values, [id]: value }
  if (!isLayerScoped(id)) return { ...state, values }

  const unit = globalUnitOf(id)
  const globalOn = unit ? state.globals[unit] : false
  // Group mode and global mode both write the change into every piano layer's bank.
  const writeAll = state.group || globalOn
  const banks = { ...state.banks }
  banks[state.focus] = { ...banks[state.focus], [id]: value }
  if (writeAll) {
    for (const layer of PIANO_LAYERS) banks[layer] = { ...banks[layer], [id]: value }
  }
  return { ...state, values, banks }
}

function focusLayer(state: DeckState, layer: LayerId): DeckState {
  if (layer === state.focus) return state
  const banks = { ...state.banks, [state.focus]: scopedSlice(state.values) }
  const values = { ...state.values, ...banks[layer] }
  return { ...state, focus: layer, banks, values }
}

/**
 * Timbre only offers Dyno 1 / Dyno 2 on electric piano types, so the button wraps after four
 * options on an acoustic type — the panel and the engine agree about which options exist.
 */
function timbreOptionCount(values: HardwareValues): number {
  return timbreOptionsFor(layerTypeId(values)).length
}

/**
 * Keep the piano selection inside what the selected type actually offers: a timbre a type change
 * has made unavailable (Dyno on a grand) falls back to Off, and the MODEL dial stops at the last
 * model this type has instead of counting up through positions that select nothing.
 */
function reconcilePianoSelection(state: DeckState): DeckState {
  let next = state
  const count = timbreOptionCount(next.values)
  if (Math.round(next.values['piano.timbre'] ?? 0) >= count) next = withValue(next, 'piano.timbre', 0)
  const models = pianoType(layerTypeId(next.values)).models.length
  const model = Math.round(next.values['piano.model'] ?? 0)
  if (model > models - 1) next = withValue(next, 'piano.model', models - 1)
  return next
}

export function deckReducer(state: DeckState, action: HardwareAction): DeckState {
  switch (action.type) {
    case 'reset':
      return initialDeckState()
    case 'focus':
      return focusLayer(state, action.layer)
    case 'set': {
      const spec = control(action.id)
      return reconcilePianoSelection(withValue(state, action.id, clampToSpec(spec, action.value)))
    }
    case 'nudge': {
      const spec = control(action.id)
      const value = nudgeValue(spec, state.values[action.id] ?? spec.initial, action.steps)
      return reconcilePianoSelection(withValue(state, action.id, value))
    }
    case 'activate': {
      const spec = control(action.id)
      const shifted = (state.values['fx.shift'] ?? 0) >= 0.5

      // Shift functions printed on the panel: GROUP under the Piano FX Focus button and GLOBAL
      // under the Delay, Comp and Reverb On buttons (manual p. 48).
      if (shifted && action.id === 'fx.focus.piano') {
        return { ...withValue(state, 'fx.shift', 0), group: !state.group }
      }
      if (shifted && GLOBAL_UNIT_BY_CONTROL[action.id]) {
        const unit = GLOBAL_UNIT_BY_CONTROL[action.id]
        const next = {
          ...withValue(state, 'fx.shift', 0),
          globals: { ...state.globals, [unit]: !state.globals[unit] },
        }
        if (state.globals[unit]) return next
        // Switching a unit to global immediately shares the focused layer's setting.
        const banks = { ...next.banks }
        for (const layer of PIANO_LAYERS) {
          const shared: Record<string, number> = { ...banks[layer] }
          for (const id of LAYER_SCOPED_IDS) if (globalUnitOf(id) === unit) shared[id] = next.values[id]
          banks[layer] = shared
        }
        return { ...next, banks }
      }

      if (action.id === 'piano.octave-down' || action.id === 'piano.octave-up') {
        const direction = action.id === 'piano.octave-up' ? 1 : -1
        const current = state.octaves[state.focus]
        const next = Math.max(-OCTAVE_LIMIT, Math.min(OCTAVE_LIMIT, current + direction * 12))
        return { ...state, octaves: { ...state.octaves, [state.focus]: next } }
      }

      if (action.id === 'fx.delay.tap') {
        const at = action.at ?? 0
        const tempo = tapTempoValue(state.lastTapAt, at)
        const tapped =
          tempo === null ? state : withValue(state, 'fx.delay.tempo', clampToSpec(control('fx.delay.tempo'), tempo))
        return { ...tapped, lastTapAt: at }
      }

      // The FX Focus Piano button moves the layer focus, so the panel always edits the layer
      // whose effects it is showing (effects spec: focus follows layer focus).
      if (action.id === 'fx.focus.piano') {
        const next = focusLayer(state, state.focus === 'a' ? 'b' : 'a')
        return withValue(next, 'fx.focus.piano', next.focus === 'a' ? 0 : 1)
      }
      if (action.id === 'piano.a.on' || action.id === 'piano.b.on') {
        const layer: LayerId = action.id === 'piano.a.on' ? 'a' : 'b'
        const value = activatedValue(spec, state.values[action.id] ?? spec.initial)
        // Turning a layer on gives it focus, which is what moves the effect focus with it.
        const focused = value >= 0.5 ? focusLayer(state, layer) : state
        const next = withValue(focused, action.id, value)
        return value >= 0.5 ? withValue(next, 'fx.focus.piano', layer === 'a' ? 0 : 1) : next
      }

      const optionCount = action.id === 'piano.timbre' ? timbreOptionCount(state.values) : undefined
      const value = activatedValue(spec, state.values[action.id] ?? spec.initial, optionCount)
      return reconcilePianoSelection(withValue(state, action.id, value))
    }
  }
}

/** Fraction of travel, 0..1, used to draw knob angles, fader caps and drawbar heights. */
export function normalisedPosition(spec: ControlSpec, value: number): number {
  if (spec.max === spec.min) return 0
  return (value - spec.min) / (spec.max - spec.min)
}

/** The piano type a set of values selects, used by the display, the reducer and the engine. */
export function layerTypeId(values: HardwareValues): PianoTypeId {
  const spec = control('piano.type')
  const index = Math.round(values['piano.type'] ?? 0)
  const label = spec.options?.[index] ?? 'Grand'
  // `pianoType` throws on an unknown id, which keeps a typo from silently selecting a grand.
  return pianoType(label.toLowerCase() as PianoTypeId).id
}
