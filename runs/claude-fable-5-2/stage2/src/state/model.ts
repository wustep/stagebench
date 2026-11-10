import {
  AmpType,
  DelayFilter,
  KbTouch,
  Mod1Type,
  Mod2Type,
  ReverbTone,
  ReverbType,
  Timbre,
  delayKnobToSeconds,
  type ChainSound,
  type LayerSound,
  type SoundState,
} from '../audio/dsp/params'
import { modelAt, modelsOf, PIANO_TYPES, type PianoModel } from '../piano/catalog'

/**
 * Canonical state of everything that is functional in Phase 2: the Piano section, the Layer
 * Effects section for the two Piano layers, the Rotary Speaker, and Master Level.
 *
 * Values are kept in panel units (knobs 0..10, EQ in dB, faders 0..100) so the panel can show
 * them directly. `deriveSound` reduces this to what the audio kernel needs.
 */

export const LAYER_NAMES = ['A', 'B'] as const
export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Phaser', 'Flanger', 'Chorus', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_TYPES = ['Twin', 'JC', 'Small', 'To Rotary', 'LP24 Filter', 'HP24 Filter', 'EQ only'] as const
export const DELAY_FILTERS = ['Off', 'LP', 'BP', 'HP'] as const
export const REVERB_TYPES = ['Spring', 'Booth', 'Room', 'Stage', 'Hall', 'Cathedral'] as const
export const REVERB_TONES = ['Off', 'Bright', 'Dark'] as const
export const KB_TOUCHES = ['Medium', 'Light', 'Heavy'] as const
export const TIMBRES = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const
export const LEVELS = ['Off', '1', '2', '3'] as const

export type UnitId = 'mod1' | 'mod2' | 'delay' | 'amp' | 'comp' | 'reverb'
export const UNIT_NAMES: Record<UnitId, string> = {
  mod1: 'Mod 1',
  mod2: 'Mod 2',
  delay: 'Delay',
  amp: 'Amp Sim/EQ',
  comp: 'Compressor',
  reverb: 'Reverb',
}
/** Units that can be set to Global with Shift + On (manual p. 48). */
export const GLOBAL_UNITS = ['delay', 'comp', 'reverb'] as const
export type GlobalUnitId = (typeof GLOBAL_UNITS)[number]

export interface PianoLayerState {
  on: boolean
  /** Fader, 0..100. */
  level: number
  /** Octave shift, -1..1. */
  octave: number
  /** Index into PIANO_TYPES. */
  type: number
  /** Selected model per type, so each type remembers its model. */
  models: number[]
  /** Index into TIMBRES. */
  timbre: number
  /** Index into KB_TOUCHES. */
  kbTouch: number
  dynComp: number
  unison: number
  softRelease: boolean
  stringRes: boolean
}

export interface FxChainState {
  mod1: { on: boolean; type: number; rate: number; amount: number }
  mod2: { on: boolean; type: number; rate: number; amount: number }
  delay: {
    on: boolean
    /** Tempo knob, 0..10. */
    tempo: number
    /** The actual delay time; set by the knob or, more exactly, by tapping. */
    seconds: number
    feedback: number
    mix: number
    filter: number
    pingPong: boolean
  }
  amp: { on: boolean; type: number; drive: number; bass: number; mid: number; freq: number; treble: number }
  comp: { on: boolean; amount: number; fast: boolean }
  reverb: { on: boolean; type: number; tone: number; mix: number }
}

export interface StageState {
  /** Master Level knob, 0..10. */
  master: number
  piano: {
    on: boolean
    /** SUSTPED: the sustain pedal reaches the Piano section. */
    sustPed: boolean
    /** PSTICK: the pitch stick bends the Piano section ±2 semitones. */
    pStick: boolean
    /** Layer the Piano panel controls edit. */
    focus: number
    layers: [PianoLayerState, PianoLayerState]
  }
  fx: {
    /** Layer Effects On. Off bypasses every effect at once. */
    on: boolean
    /** Piano layer whose chain the effect controls edit and show. */
    focus: number
    /** Piano Group: both layers share one effect setting. */
    group: boolean
    global: Record<GlobalUnitId, boolean>
    chains: [FxChainState, FxChainState]
  }
  rotary: { fast: boolean; stopMode: boolean; drive: number }
  /** Pitch stick position, -100..100. */
  pitchStick: number
  /** What the last panel action did, for the Program display. */
  notice: string
}

function initialChain(): FxChainState {
  return {
    mod1: { on: false, type: Mod1Type.Pump, rate: 3.2, amount: 6.5 },
    mod2: { on: false, type: Mod2Type.Chorus, rate: 6.3, amount: 3 },
    delay: { on: false, tempo: 3, seconds: delayKnobToSeconds(0.3), feedback: 6.5, mix: 2, filter: DelayFilter.LP, pingPong: false },
    amp: { on: false, type: AmpType.Twin, drive: 3.2, bass: 6, mid: 8, freq: 5.2, treble: 1 },
    comp: { on: false, amount: 2.2, fast: false },
    reverb: { on: false, type: ReverbType.Cathedral, tone: ReverbTone.Off, mix: 6.5 },
  }
}

function initialLayer(on: boolean, level: number): PianoLayerState {
  return {
    on,
    level,
    octave: 0,
    type: 0,
    models: PIANO_TYPES.map(() => 0),
    timbre: Timbre.Off,
    kbTouch: KbTouch.Medium,
    dynComp: 0,
    unison: 0,
    softRelease: false,
    stringRes: true,
  }
}

/**
 * Start-up state. Knob, fader, and selector positions are the ones on the reference photo.
 * Two things deliberately differ from the photo so the instrument starts as a plain, clean
 * piano: Layer B starts off, and every effect unit starts switched off.
 */
export function createInitialState(): StageState {
  return {
    master: 7,
    piano: { on: true, sustPed: true, pStick: false, focus: 0, layers: [initialLayer(true, 100), initialLayer(false, 42)] },
    fx: {
      on: true,
      focus: 0,
      group: false,
      global: { delay: false, comp: false, reverb: false },
      chains: [initialChain(), initialChain()],
    },
    rotary: { fast: false, stopMode: false, drive: 1.5 },
    pitchStick: 0,
    notice: '',
  }
}

// ── Reading the state ─────────────────────────────────────────────────────────

export function layerModel(layer: PianoLayerState): PianoModel {
  return modelAt(layer.type, layer.models[layer.type] ?? 0)
}

/** How many Timbre positions the layer's model has: 4 for acoustic, 6 with the two Dyno settings. */
export function timbreCount(layer: PianoLayerState): number {
  return layerModel(layer).family === 'electric' ? 6 : 4
}

export function effectiveSoftRelease(layer: PianoLayerState): boolean {
  return layer.softRelease && layerModel(layer).softRelease
}

export function effectiveStringRes(layer: PianoLayerState): boolean {
  return layer.stringRes && layerModel(layer).stringRes
}

/** Chains an edit of `unit` applies to: all in Global, both piano chains in Group, else the focused one. */
export function fxTargets(state: StageState, unit: UnitId): number[] {
  const global = (GLOBAL_UNITS as readonly string[]).includes(unit) && state.fx.global[unit as GlobalUnitId]
  return global || state.fx.group ? [0, 1] : [state.fx.focus]
}

/** A layer is routed into the Rotary when its Amp Sim/EQ unit is on, set To Rotary, and effects are on. */
export function routedToRotary(state: StageState, layer: number): boolean {
  const amp = state.fx.chains[layer].amp
  return state.fx.on && amp.on && amp.type === AmpType.ToRotary
}

function chainSound(chain: FxChainState): ChainSound {
  return {
    mod1: { on: chain.mod1.on, type: chain.mod1.type, rate: chain.mod1.rate / 10, amount: chain.mod1.amount / 10 },
    mod2: { on: chain.mod2.on, type: chain.mod2.type, rate: chain.mod2.rate / 10, amount: chain.mod2.amount / 10 },
    delay: {
      on: chain.delay.on,
      time: chain.delay.seconds,
      feedback: chain.delay.feedback / 10,
      mix: chain.delay.mix / 10,
      filter: chain.delay.filter,
      pingPong: chain.delay.pingPong,
    },
    amp: {
      on: chain.amp.on,
      type: chain.amp.type,
      drive: chain.amp.drive / 10,
      bass: chain.amp.bass,
      mid: chain.amp.mid,
      freq: chain.amp.freq / 10,
      treble: chain.amp.treble,
    },
    comp: { on: chain.comp.on, amount: chain.comp.amount / 10, fast: chain.comp.fast },
    reverb: { on: chain.reverb.on, type: chain.reverb.type, tone: chain.reverb.tone, mix: chain.reverb.mix / 10 },
  }
}

/** Reduce the canonical state to the sound state the kernel consumes. */
export function deriveSound(state: StageState): SoundState {
  const layer = (index: number): LayerSound => {
    const piano = state.piano.layers[index]
    const model = layerModel(piano)
    return {
      on: state.piano.on && piano.on,
      level: piano.level / 100,
      octave: piano.octave,
      source: model.source,
      family: model.family,
      timbre: piano.timbre < timbreCount(piano) ? piano.timbre : Timbre.Off,
      kbTouch: piano.kbTouch,
      dynComp: piano.dynComp,
      unison: piano.unison,
      softRelease: effectiveSoftRelease(piano),
      stringRes: effectiveStringRes(piano),
      sustain: state.piano.sustPed,
      bend: state.piano.pStick ? (state.pitchStick / 100) * 2 : 0,
      fx: chainSound(state.fx.chains[index]),
    }
  }
  return {
    master: state.master / 10,
    fxOn: state.fx.on,
    layers: [layer(0), layer(1)],
    rotary: { fast: state.rotary.fast, stop: state.rotary.stopMode, drive: state.rotary.drive / 10 },
  }
}

export function typeName(layer: PianoLayerState): string {
  return PIANO_TYPES[layer.type] ?? 'Grand'
}

export function modelCount(layer: PianoLayerState): number {
  return modelsOf(layer.type).length
}
