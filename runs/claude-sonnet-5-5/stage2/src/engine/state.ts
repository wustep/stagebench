import { MODELS, PIANO_TYPES, softReleaseAvailable, stringResAvailable, timbresFor, type PianoType, type Timbre } from '../audio/library/catalog'

/**
 * Canonical Phase 2 instrument state: the Piano section (two layers) and the Layer Effects section.
 * Pure data + pure reducers. The panel (`panelBindings.ts`) and the audio engine both follow this state;
 * neither owns it.
 */

export type LayerId = 'A' | 'B'
export const LAYER_IDS: readonly LayerId[] = ['A', 'B']
export const otherLayer = (id: LayerId): LayerId => (id === 'A' ? 'B' : 'A')

export type KbTouch = 'Heavy' | 'Medium' | 'Light'
export const KB_TOUCH_ORDER: readonly KbTouch[] = ['Medium', 'Light', 'Heavy'] // panel order
export type Level3 = 0 | 1 | 2 | 3

// type lists are in the order of the panel selector LEDs / option arrays
export const MOD1_TYPES = ['Ring Mod', 'Tremolo', 'A-Pan', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_TYPES = ['Small', 'JC', 'Twin', 'To Rotary', 'LP24 Filter', 'HP24 Filter', 'EQ only'] as const
export const DELAY_FILTERS = ['LP', 'BP', 'HP', 'Off'] as const
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export type Mod1Type = (typeof MOD1_TYPES)[number]
export type Mod2Type = (typeof MOD2_TYPES)[number]
export type AmpType = (typeof AMP_TYPES)[number]
export type DelayFilter = (typeof DELAY_FILTERS)[number]
export type ReverbType = (typeof REVERB_TYPES)[number]
export type ReverbTone = 'neutral' | 'bright' | 'dark'

export interface PianoLayerState {
  enabled: boolean
  /** fader position 0..1 */
  level: number
  /** octave shift in octaves, -1..+1 (±12 semitones) */
  octave: -1 | 0 | 1
  type: PianoType
  /** selected model index per type */
  models: Record<PianoType, number>
  sustPed: boolean
  pitchStick: boolean
  kbTouch: KbTouch
  dynComp: Level3
  timbre: Timbre
  unison: Level3
  softRelease: boolean
  stringRes: boolean
}

export interface Mod1State {
  on: boolean
  type: Mod1Type
  rate: number
  amount: number
}
export interface Mod2State {
  on: boolean
  type: Mod2Type
  rate: number
  amount: number
}
export interface DelayState {
  on: boolean
  tempo: number
  feedback: number
  dryWet: number
  filter: DelayFilter
  pingPong: boolean
}
export interface AmpState {
  on: boolean
  type: AmpType
  drive: number
  freq: number
  bass: number
  mid: number
  treble: number
}
export interface CompState {
  on: boolean
  amount: number
  fast: boolean
}
export interface ReverbState {
  on: boolean
  type: ReverbType
  dryWet: number
  tone: ReverbTone
}
export interface LayerFx {
  mod1: Mod1State
  mod2: Mod2State
  delay: DelayState
  amp: AmpState
  comp: CompState
  reverb: ReverbState
}
export type FxUnit = keyof LayerFx
export type GlobalUnit = 'delay' | 'comp' | 'reverb'
export const GLOBAL_UNITS: readonly GlobalUnit[] = ['delay', 'comp', 'reverb']

export interface RotaryState {
  fast: boolean
  drive: number
}

export interface EngineState {
  pianoOn: boolean
  master: number
  /** focused piano layer (targets the Piano section controls) */
  focus: LayerId
  layers: Record<LayerId, PianoLayerState>
  /** layer effects */
  effectsOn: boolean
  /** which section's effects are focused: only the piano chains exist in Phase 2 */
  fxFocus: LayerId
  group: boolean
  globals: Record<GlobalUnit, boolean>
  fx: Record<LayerId, LayerFx>
  rotary: RotaryState
  /** pitch stick position, -1..+1 */
  pitchBend: number
}

const zeroModels = (): Record<PianoType, number> => ({ Grand: 0, Upright: 0, Electric: 0, Clav: 0, Digital: 0, Misc: 0 })

export const defaultLayer = (type: PianoType, level: number, enabled: boolean): PianoLayerState => ({
  enabled,
  level,
  octave: 0,
  type,
  models: zeroModels(),
  sustPed: true,
  pitchStick: true,
  kbTouch: 'Medium',
  dynComp: 0,
  timbre: 'Off',
  unison: 0,
  softRelease: false,
  stringRes: false,
})

export const defaultFx = (): LayerFx => ({
  mod1: { on: false, type: 'A-Pan', rate: 0.3, amount: 0.55 },
  mod2: { on: false, type: 'Chorus', rate: 0.75, amount: 0.4 },
  delay: { on: false, tempo: 0.35, feedback: 0.45, dryWet: 0.4, filter: 'Off', pingPong: false },
  amp: { on: false, type: 'EQ only', drive: 0.3, freq: 0.55, bass: 0.5, mid: 0.5, treble: 0.5 },
  comp: { on: false, amount: 0.6, fast: false },
  reverb: { on: false, type: 'Hall', dryWet: 0.4, tone: 'neutral' },
})

export const defaultState = (): EngineState => ({
  pianoOn: true,
  master: 0.72,
  focus: 'A',
  layers: { A: defaultLayer('Grand', 0.95, true), B: defaultLayer('Electric', 0.5, false) },
  effectsOn: true,
  fxFocus: 'A',
  group: false,
  globals: { delay: false, comp: false, reverb: false },
  fx: { A: defaultFx(), B: defaultFx() },
  rotary: { fast: false, drive: 0.25 },
  pitchBend: 0,
})

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))

// --- gestures on the layer buttons (manual p. 23) ------------------------------------------------------
export type LayerGesture = 'tap' | 'both' | 'shift' | 'hold'

const enabledCount = (s: EngineState) => LAYER_IDS.filter((l) => s.layers[l].enabled).length

/**
 * tap   : press a layer button. A disabled layer replaces the sole active layer (toggle from one to the other);
 *         with both active it just takes focus.
 * both  : both buttons pressed together (or Shift+press): the layer is added and focused.
 * shift : accessibility path for "both": Shift+press adds an inactive layer, or removes an active one (while two are on).
 * hold  : holding the button turns that layer off (the last active layer cannot be turned off).
 */
export function pressLayer(s: EngineState, layer: LayerId, gesture: LayerGesture): EngineState {
  const other = otherLayer(layer)
  const enabled = s.layers[layer].enabled
  const layers = { ...s.layers }
  let focus = s.focus
  const set = (id: LayerId, on: boolean) => (layers[id] = { ...layers[id], enabled: on })
  switch (gesture) {
    case 'both':
      set(layer, true)
      focus = layer
      break
    case 'shift':
      if (!enabled) {
        set(layer, true)
        focus = layer
      } else if (layers[other].enabled) {
        set(layer, false)
        focus = other
      }
      break
    case 'hold':
      if (enabled && layers[other].enabled) {
        set(layer, false)
        focus = other
      }
      break
    case 'tap':
      if (!enabled) {
        if (layers[other].enabled && enabledCount(s) === 1) set(other, false)
        set(layer, true)
      }
      focus = layer
      break
  }
  return { ...s, layers, focus, fxFocus: focus }
}

// --- focused-layer edits (Piano section controls) -----------------------------------------------------
const shallowSame = (a: object, b: object): boolean => {
  const ka = Object.keys(a) as Array<keyof typeof a>
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], (b as typeof a)[k]) || (typeof a[k] === 'object' && a[k] !== null && JSON.stringify(a[k]) === JSON.stringify((b as typeof a)[k])))
}

const editFocused = (s: EngineState, patch: (l: PianoLayerState) => PianoLayerState): EngineState => {
  const before = s.layers[s.focus]
  const after = patch(before)
  return shallowSame(before, after) ? s : { ...s, layers: { ...s.layers, [s.focus]: after } }
}

/** effective flags after a type change: unavailable features are switched off, not silently kept */
const normalize = (l: PianoLayerState): PianoLayerState => {
  const timbres = timbresFor(l.type)
  return {
    ...l,
    timbre: timbres.includes(l.timbre) ? l.timbre : 'Off',
    softRelease: softReleaseAvailable(l.type) ? l.softRelease : false,
    stringRes: stringResAvailable(l.type) ? l.stringRes : false,
  }
}

export const setType = (s: EngineState, type: PianoType): EngineState => editFocused(s, (l) => normalize({ ...l, type }))
export const cycleType = (s: EngineState): EngineState => {
  const i = PIANO_TYPES.indexOf(s.layers[s.focus].type)
  return setType(s, PIANO_TYPES[(i + 1) % PIANO_TYPES.length])
}
/** the model dial is an endless 32-detent encoder: the model is the detent modulo the number of models */
export const setModelFromDetent = (s: EngineState, detent: number): EngineState =>
  editFocused(s, (l) => ({ ...l, models: { ...l.models, [l.type]: ((detent % MODELS[l.type].length) + MODELS[l.type].length) % MODELS[l.type].length } }))
export const setKbTouch = (s: EngineState, v: KbTouch): EngineState => editFocused(s, (l) => ({ ...l, kbTouch: v }))
export const setDynComp = (s: EngineState, v: number): EngineState => editFocused(s, (l) => ({ ...l, dynComp: clampInt(v, 0, 3) as Level3 }))
export const setUnison = (s: EngineState, v: number): EngineState => editFocused(s, (l) => ({ ...l, unison: clampInt(v, 0, 3) as Level3 }))
export const setTimbre = (s: EngineState, v: Timbre): EngineState => editFocused(s, (l) => (timbresFor(l.type).includes(v) ? { ...l, timbre: v } : l))
export const cycleTimbre = (s: EngineState): EngineState =>
  editFocused(s, (l) => {
    const options = timbresFor(l.type)
    return { ...l, timbre: options[(options.indexOf(l.timbre) + 1) % options.length] }
  })
export const setSoftRelease = (s: EngineState, on: boolean): EngineState => editFocused(s, (l) => (softReleaseAvailable(l.type) ? { ...l, softRelease: on } : l))
export const setStringRes = (s: EngineState, on: boolean): EngineState => editFocused(s, (l) => (stringResAvailable(l.type) ? { ...l, stringRes: on } : l))
/** the ACOUSTICS button steps through Off → Soft release → String res → both (only combinations the type supports) */
export const cycleAcoustics = (s: EngineState): EngineState =>
  editFocused(s, (l) => {
    const combos: Array<[boolean, boolean]> = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ].filter(([soft, res]) => (!soft || softReleaseAvailable(l.type)) && (!res || stringResAvailable(l.type))) as Array<[boolean, boolean]>
    const i = combos.findIndex(([soft, res]) => soft === l.softRelease && res === l.stringRes)
    const [softRelease, stringRes] = combos[(i + 1) % combos.length]
    return { ...l, softRelease, stringRes }
  })
export const setSustPed = (s: EngineState, on: boolean): EngineState => editFocused(s, (l) => ({ ...l, sustPed: on }))
export const setPitchStickRouting = (s: EngineState, on: boolean): EngineState => editFocused(s, (l) => ({ ...l, pitchStick: on }))
export const shiftOctave = (s: EngineState, delta: 1 | -1): EngineState =>
  editFocused(s, (l) => ({ ...l, octave: clampInt(l.octave + delta, -1, 1) as -1 | 0 | 1 }))
export const setLevel = (s: EngineState, layer: LayerId, v: number): EngineState =>
  s.layers[layer].level === clamp01(v) ? s : { ...s, layers: { ...s.layers, [layer]: { ...s.layers[layer], level: clamp01(v) } } }
export const setPianoOn = (s: EngineState, on: boolean): EngineState => (s.pianoOn === on ? s : { ...s, pianoOn: on })
export const setMaster = (s: EngineState, v: number): EngineState => (s.master === clamp01(v) ? s : { ...s, master: clamp01(v) })
export const setPitchBend = (s: EngineState, v: number): EngineState => {
  const bend = Math.min(1, Math.max(-1, v))
  return s.pitchBend === bend ? s : { ...s, pitchBend: bend }
}

// --- effects ---------------------------------------------------------------------------------------------
/** layers an edit of `unit` reaches: group mode shares every unit across both layers; global units reach all layers */
export function fxTargets(s: EngineState, unit: FxUnit): LayerId[] {
  if (s.group) return [...LAYER_IDS]
  if ((unit === 'delay' || unit === 'comp' || unit === 'reverb') && s.globals[unit]) return [...LAYER_IDS]
  return [s.fxFocus]
}

export function editFx<U extends FxUnit>(s: EngineState, unit: U, patch: Partial<LayerFx[U]>): EngineState {
  const fx = { ...s.fx }
  let changed = false
  for (const id of fxTargets(s, unit)) {
    const before = fx[id][unit]
    const after = { ...before, ...patch }
    if (shallowSame(before, after)) continue
    changed = true
    fx[id] = { ...fx[id], [unit]: after }
  }
  return changed ? { ...s, fx } : s
}

export const setEffectsOn = (s: EngineState, on: boolean): EngineState => (s.effectsOn === on ? s : { ...s, effectsOn: on })

/** entering group mode copies the focused chain to every layer of the group (manual p. 48) */
export function setGroup(s: EngineState, on: boolean): EngineState {
  if (on === s.group) return s
  if (!on) return { ...s, group: false }
  const source = s.fx[s.fxFocus]
  const fx = { ...s.fx }
  for (const id of LAYER_IDS) fx[id] = structuredClone(source)
  return { ...s, group: true, fx }
}

/** entering global mode copies that unit from the focused layer to every layer */
export function setGlobal(s: EngineState, unit: GlobalUnit, on: boolean): EngineState {
  if (on === s.globals[unit]) return s
  const globals = { ...s.globals, [unit]: on }
  if (!on) return { ...s, globals }
  const fx = { ...s.fx }
  for (const id of LAYER_IDS) fx[id] = { ...fx[id], [unit]: structuredClone(s.fx[s.fxFocus][unit]) }
  return { ...s, globals, fx }
}

/** the Piano FX FOCUS button: first press focuses the piano effects, further presses swap A/B (layer mode) */
export function pressPianoFxFocus(s: EngineState): EngineState {
  if (s.group) return s
  return { ...s, fxFocus: otherLayer(s.fxFocus) }
}

export const setRotary = (s: EngineState, patch: Partial<RotaryState>): EngineState => {
  const rotary = { ...s.rotary, ...patch }
  return shallowSame(s.rotary, rotary) ? s : { ...s, rotary }
}

/** the focused layer's effects (what the panel knobs show) */
export const focusedFx = (s: EngineState): LayerFx => s.fx[s.fxFocus]
export const focusedLayer = (s: EngineState): PianoLayerState => s.layers[s.focus]

// --- store --------------------------------------------------------------------------------------------------
export interface EngineStore {
  get(): EngineState
  update(fn: (s: EngineState) => EngineState): void
  subscribe(listener: () => void): () => void
  listenerCount(): number
}

export function createEngineStore(initial: EngineState = defaultState()): EngineStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    update(fn) {
      const next = fn(state)
      if (next === state) return
      state = next
      for (const l of Array.from(listeners)) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    listenerCount: () => listeners.size,
  }
}
