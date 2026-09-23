// Canonical Phase 2 sound state: the Piano section (two layers) and the Layer Effects section
// (a chain per piano layer, focus/group/global targeting, the shared Rotary) plus Master Level.
// Pure data and pure update functions — the panel bindings write it, the audio engine reads it.
import { modelsOfType, PIANO_TYPES, type KbTouch, type PianoType, type Timbre } from '../audio/instruments'
import type { Mod1Type, Mod2Type, ModState } from '../audio/fx/modulation'

export type LayerId = 'A' | 'B'
export const LAYERS: readonly LayerId[] = ['A', 'B']

export interface PianoLayerState {
  enabled: boolean
  /** 0…127 layer level fader. */
  level: number
  /** Octave shift in octaves (manual: ±12 semitones → -1…+1). */
  octave: number
  type: PianoType
  /** Selected model index for every type (the model dial selects within the current type). */
  models: Record<PianoType, number>
  kbTouch: KbTouch
  dynComp: number
  timbre: Timbre
  unison: number
  softRelease: boolean
  stringRes: boolean
  /** SUSTPED: sustain pedal input affects this layer. */
  sustPed: boolean
  /** PSTICK: pitch stick bends this layer ±2 semitones. */
  pStick: boolean
}

export type DelayFilter = 'off' | 'hp' | 'lp' | 'bp'
export interface DelayState {
  on: boolean
  tempo: number
  feedback: number
  dryWet: number
  filter: DelayFilter
}

export const AMP_TYPES = ['eq', 'small', 'jc', 'twin', 'rotary', 'lp24', 'hp24'] as const
export type AmpType = (typeof AMP_TYPES)[number]
export interface AmpState {
  on: boolean
  type: AmpType
  drive: number
  bass: number
  /** Mid gain, or resonance for the LP/HP filter types. */
  mid: number
  /** Mid frequency, or cutoff for the LP/HP filter types. */
  freq: number
  treble: number
}

export interface CompState {
  on: boolean
  amount: number
  fast: boolean
}

export const REVERB_TYPES = ['room', 'booth', 'spring', 'stage', 'hall', 'cathedral'] as const
export type ReverbType = (typeof REVERB_TYPES)[number]
export type ReverbTone = 'normal' | 'bright' | 'dark'
export interface ReverbState {
  on: boolean
  type: ReverbType
  dryWet: number
  tone: ReverbTone
}

export interface ChainState {
  mod1: ModState<Mod1Type>
  mod2: ModState<Mod2Type>
  delay: DelayState
  amp: AmpState
  comp: CompState
  reverb: ReverbState
}

export type GlobalUnit = 'delay' | 'comp' | 'reverb'
export const GLOBAL_UNITS: readonly GlobalUnit[] = ['delay', 'comp', 'reverb']

export interface RotaryState {
  fast: boolean
  drive: number
}

export interface SoundState {
  piano: { on: boolean; focus: LayerId; layers: Record<LayerId, PianoLayerState> }
  fx: {
    /** Layer Effects ON: off bypasses every unit at once. */
    on: boolean
    focus: LayerId
    /** Piano group mode: both piano chains share one setting. */
    group: boolean
    chains: Record<LayerId, ChainState>
    global: Record<GlobalUnit, boolean>
    /** Settings used by a unit while it is in global mode (applies to every layer). */
    globalUnits: { delay: DelayState; comp: CompState; reverb: ReverbState }
  }
  rotary: RotaryState
  /** Master Level knob 0…127. */
  master: number
  /** Pitch stick -100…100 (bends layers with PSTICK on). */
  pitchStick: number
}

function defaultLayer(enabled: boolean, type: PianoType): PianoLayerState {
  const models = Object.fromEntries(PIANO_TYPES.map((t) => [t, 0])) as Record<PianoType, number>
  return {
    enabled,
    level: 110,
    octave: 0,
    type,
    models,
    kbTouch: 'medium',
    dynComp: 0,
    timbre: 'off',
    unison: 0,
    softRelease: false,
    stringRes: false,
    sustPed: true,
    pStick: true,
  }
}

export function defaultChain(): ChainState {
  return {
    mod1: { on: false, type: 'trem', rate: 50, amount: 64 },
    mod2: { on: false, type: 'chorus', rate: 40, amount: 70 },
    delay: { on: false, tempo: 60, feedback: 50, dryWet: 40, filter: 'off' },
    amp: { on: false, type: 'eq', drive: 30, bass: 64, mid: 64, freq: 64, treble: 64 },
    comp: { on: false, amount: 50, fast: false },
    reverb: { on: false, type: 'hall', dryWet: 45, tone: 'normal' },
  }
}

export function defaultSound(): SoundState {
  const chain = defaultChain()
  return {
    piano: { on: true, focus: 'A', layers: { A: defaultLayer(true, 'grand'), B: defaultLayer(false, 'electric') } },
    fx: {
      on: true,
      focus: 'A',
      group: false,
      chains: { A: defaultChain(), B: defaultChain() },
      global: { delay: false, comp: false, reverb: false },
      globalUnits: { delay: { ...chain.delay }, comp: { ...chain.comp }, reverb: { ...chain.reverb } },
    },
    rotary: { fast: false, drive: 40 },
    master: 96,
    pitchStick: 0,
  }
}

// ---- piano updates ----

export function updateLayer(s: SoundState, layer: LayerId, patch: Partial<PianoLayerState>): SoundState {
  return { ...s, piano: { ...s.piano, layers: { ...s.piano.layers, [layer]: { ...s.piano.layers[layer], ...patch } } } }
}

/** Focus a piano layer; the effects focus follows the layer focus (manual p. 48). */
export function focusLayer(s: SoundState, layer: LayerId): SoundState {
  return { ...s, piano: { ...s.piano, focus: layer }, fx: { ...s.fx, focus: layer } }
}

/**
 * The layer ON/OFF button: an off layer turns on and takes focus; an on layer that is not focused
 * takes focus; the focused on layer turns off.
 */
export function pressLayerButton(s: SoundState, layer: LayerId): SoundState {
  const l = s.piano.layers[layer]
  if (!l.enabled) return focusLayer(updateLayer(s, layer, { enabled: true }), layer)
  if (s.piano.focus !== layer) return focusLayer(s, layer)
  const off = updateLayer(s, layer, { enabled: false })
  // Focus moves to the other layer if it is still playing.
  const other: LayerId = layer === 'A' ? 'B' : 'A'
  return off.piano.layers[other].enabled ? focusLayer(off, other) : off
}

export function currentModel(l: PianoLayerState) {
  const list = modelsOfType(l.type)
  return list[Math.min(list.length - 1, Math.max(0, l.models[l.type]))]
}

export function stepModel(s: SoundState, layer: LayerId, delta: number): SoundState {
  const l = s.piano.layers[layer]
  const count = modelsOfType(l.type).length
  const index = (((l.models[l.type] + delta) % count) + count) % count
  return updateLayer(s, layer, { models: { ...l.models, [l.type]: index } })
}

// ---- effects updates ----

type UnitKey = keyof ChainState

const isGlobalUnit = (unit: UnitKey): unit is GlobalUnit => unit === 'delay' || unit === 'comp' || unit === 'reverb'

/** The effective settings of one unit for one layer (global and group resolved). */
export function effectiveUnit<K extends UnitKey>(s: SoundState, layer: LayerId, unit: K): ChainState[K] {
  if (isGlobalUnit(unit) && s.fx.global[unit]) return s.fx.globalUnits[unit] as ChainState[K]
  return s.fx.chains[layer][unit]
}

export function effectiveChain(s: SoundState, layer: LayerId): ChainState {
  return {
    mod1: effectiveUnit(s, layer, 'mod1'),
    mod2: effectiveUnit(s, layer, 'mod2'),
    delay: effectiveUnit(s, layer, 'delay'),
    amp: effectiveUnit(s, layer, 'amp'),
    comp: effectiveUnit(s, layer, 'comp'),
    reverb: effectiveUnit(s, layer, 'reverb'),
  }
}

/** Settings shown on the panel for a unit: the focused chain's (or the global instance). */
export function focusedUnit<K extends UnitKey>(s: SoundState, unit: K): ChainState[K] {
  return effectiveUnit(s, s.fx.focus, unit)
}

/**
 * Edit a unit from the panel: a global unit edits the global instance; otherwise the focused
 * chain — and, in Piano group mode, both piano chains.
 */
export function editUnit<K extends UnitKey>(s: SoundState, unit: K, patch: Partial<ChainState[K]>): SoundState {
  if (isGlobalUnit(unit) && s.fx.global[unit]) {
    const g = s.fx.globalUnits
    return { ...s, fx: { ...s.fx, globalUnits: { ...g, [unit]: { ...g[unit], ...(patch as object) } } } }
  }
  const targets: LayerId[] = s.fx.group ? ['A', 'B'] : [s.fx.focus]
  const chains = { ...s.fx.chains }
  for (const t of targets) chains[t] = { ...chains[t], [unit]: { ...chains[t][unit], ...patch } }
  return { ...s, fx: { ...s.fx, chains } }
}

/** Group mode on: both piano chains take the focused chain's settings and stay linked. */
export function setGroup(s: SoundState, group: boolean): SoundState {
  if (!group) return { ...s, fx: { ...s.fx, group } }
  const src = s.fx.chains[s.fx.focus]
  return { ...s, fx: { ...s.fx, group, chains: { A: structuredCloneChain(src), B: structuredCloneChain(src) } } }
}

function structuredCloneChain(c: ChainState): ChainState {
  return { mod1: { ...c.mod1 }, mod2: { ...c.mod2 }, delay: { ...c.delay }, amp: { ...c.amp }, comp: { ...c.comp }, reverb: { ...c.reverb } }
}

/** Global mode on for a unit: the global instance starts from the focused chain's settings. */
export function setGlobal(s: SoundState, unit: GlobalUnit, on: boolean): SoundState {
  const global = { ...s.fx.global, [unit]: on }
  if (!on) return { ...s, fx: { ...s.fx, global } }
  const globalUnits = { ...s.fx.globalUnits, [unit]: { ...s.fx.chains[s.fx.focus][unit] } }
  return { ...s, fx: { ...s.fx, global, globalUnits } }
}

/** True when a layer is routed into the shared Rotary (Amp Sim type To Rotary, unit and effects on). */
export function routesToRotary(s: SoundState, layer: LayerId): boolean {
  const amp = effectiveUnit(s, layer, 'amp')
  return s.fx.on && amp.on && amp.type === 'rotary'
}
