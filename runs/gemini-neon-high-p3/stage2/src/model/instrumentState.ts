import type { SampleBankId } from '../audio/sampleManifests'
import { PANEL_CONTROL_BY_ID } from './controls'
import {
  createInitialHardwareState,
  hardwareStateReducer,
  type HardwareAction,
  type HardwarePresentationState,
} from './hardwareState'

// ===================== Piano Model Catalog =====================

export type PianoLayerId = 'A' | 'B'
export type PianoTypeId = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type KbTouchCurve = 'Heavy' | 'Medium' | 'Light'
export type DynCompLevel = 0 | 1 | 2 | 3
export type UnisonLevel = 0 | 1 | 2 | 3
export type PianoTimbreId = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2'

export const PIANO_TYPES: readonly PianoTypeId[] = [
  'Grand',
  'Upright',
  'Electric',
  'Clav',
  'Digital',
  'Misc',
]

export const KB_TOUCH_CURVES: readonly KbTouchCurve[] = ['Heavy', 'Medium', 'Light']
export const ACOUSTIC_TIMBRES: readonly PianoTimbreId[] = ['Off', 'Soft', 'Mid', 'Bright']
export const ELECTRIC_TIMBRES: readonly PianoTimbreId[] = [
  'Off',
  'Soft',
  'Mid',
  'Bright',
  'Dyno 1',
  'Dyno 2',
]

export interface PianoModelSpec {
  readonly id: string
  readonly name: string
  readonly type: PianoTypeId
  readonly sourceKind: 'recorded' | 'synthesized'
  readonly sampleBankId?: SampleBankId
  readonly synthVoice?: 'clavinet' | 'harpsichord' | 'dx-ep' | 'fm-bell' | 'marimba' | 'vibraphone'
  readonly brightnessOffsetDb?: number
  readonly lowpassHz?: number
}

export const PIANO_MODELS_BY_TYPE: Readonly<Record<PianoTypeId, readonly PianoModelSpec[]>> = {
  Grand: [
    {
      id: 'grand-salamander',
      name: 'Salamander Grand',
      type: 'Grand',
      sourceKind: 'recorded',
      sampleBankId: 'grand',
    },
    {
      id: 'grand-studio-2',
      name: 'Studio Grand 2',
      type: 'Grand',
      sourceKind: 'recorded',
      sampleBankId: 'grand',
      brightnessOffsetDb: 4.5,
    },
  ],
  Upright: [
    {
      id: 'upright-kw',
      name: 'Kawai Upright KW',
      type: 'Upright',
      sourceKind: 'recorded',
      sampleBankId: 'upright',
    },
    {
      id: 'upright-felt',
      name: 'Felt Upright',
      type: 'Upright',
      sourceKind: 'recorded',
      sampleBankId: 'upright',
      lowpassHz: 1850,
    },
  ],
  Electric: [
    {
      id: 'electric-rhodes',
      name: 'EP1 Mk I Rhodes',
      type: 'Electric',
      sourceKind: 'recorded',
      sampleBankId: 'rhodes',
    },
    {
      id: 'electric-wurli',
      name: 'EP2 Wurli 200',
      type: 'Electric',
      sourceKind: 'recorded',
      sampleBankId: 'wurli',
    },
  ],
  Clav: [
    {
      id: 'clav-d6',
      name: 'Clavinet D6',
      type: 'Clav',
      sourceKind: 'synthesized',
      synthVoice: 'clavinet',
    },
    {
      id: 'clav-harpsichord',
      name: "Harpsichord 8'",
      type: 'Clav',
      sourceKind: 'synthesized',
      synthVoice: 'harpsichord',
    },
  ],
  Digital: [
    {
      id: 'digital-dx',
      name: 'DX E.Piano',
      type: 'Digital',
      sourceKind: 'synthesized',
      synthVoice: 'dx-ep',
    },
    {
      id: 'digital-fm-bell',
      name: 'FM Bell Grand',
      type: 'Digital',
      sourceKind: 'synthesized',
      synthVoice: 'fm-bell',
    },
  ],
  Misc: [
    {
      id: 'misc-marimba',
      name: 'Concert Marimba',
      type: 'Misc',
      sourceKind: 'synthesized',
      synthVoice: 'marimba',
    },
    {
      id: 'misc-vibraphone',
      name: 'Warm Vibraphone',
      type: 'Misc',
      sourceKind: 'synthesized',
      synthVoice: 'vibraphone',
    },
  ],
}

export function getPianoModel(type: PianoTypeId, modelIndex: number): PianoModelSpec {
  const models = PIANO_MODELS_BY_TYPE[type]
  const safeIdx = ((modelIndex % models.length) + models.length) % models.length
  return models[safeIdx]
}

export function getAvailableTimbres(type: PianoTypeId): readonly PianoTimbreId[] {
  return type === 'Electric' ? ELECTRIC_TIMBRES : ACOUSTIC_TIMBRES
}

export interface PianoLayerState {
  readonly enabled: boolean
  readonly level: number // 0..100
  readonly octave: -1 | 0 | 1 // ±12 semitones
  readonly type: PianoTypeId
  readonly modelIndex: number
  readonly timbre: PianoTimbreId
  readonly kbTouch: KbTouchCurve
  readonly dynComp: DynCompLevel
  readonly unison: UnisonLevel
  readonly softRelease: boolean
  readonly stringRes: boolean
}

export interface PianoSectionState {
  readonly sectionOn: boolean
  readonly focusedLayer: PianoLayerId
  readonly sustped: boolean
  readonly pstick: boolean
  readonly layers: {
    readonly A: PianoLayerState
    readonly B: PianoLayerState
  }
}

// ===================== Layer Effects State =====================

export type FxChainId = 'pianoA' | 'pianoB' | 'organ' | 'synthA'

export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump'
export type Mod2Type = 'Chorus' | 'Flanger' | 'Phaser' | 'Vibe' | 'Ensemble' | 'Spin'
export type DelayFilterType = 'Off' | 'LP' | 'HP' | 'BP'
export type AmpEqType =
  | 'EQ only'
  | 'Twin'
  | 'JC'
  | 'Small'
  | 'LP24 Filter'
  | 'HP24 Filter'
  | 'To Rotary'
export type ReverbType = 'Room' | 'Booth' | 'Spring' | 'Stage' | 'Hall' | 'Cathedral'
export type ReverbTone = 'Normal' | 'Bright' | 'Dark'

export const MOD1_TYPES: readonly Mod1Type[] = [
  'A-Pan',
  'Tremolo',
  'Ring Mod',
  'A-Wah',
  'Wah',
  'Pump',
]
export const MOD2_TYPES: readonly Mod2Type[] = [
  'Chorus',
  'Flanger',
  'Phaser',
  'Vibe',
  'Ensemble',
  'Spin',
]
export const DELAY_FILTER_TYPES: readonly DelayFilterType[] = ['Off', 'LP', 'HP', 'BP']
export const AMP_EQ_TYPES: readonly AmpEqType[] = [
  'EQ only',
  'Twin',
  'JC',
  'Small',
  'LP24 Filter',
  'HP24 Filter',
  'To Rotary',
]
export const REVERB_TYPES: readonly ReverbType[] = [
  'Room',
  'Booth',
  'Spring',
  'Stage',
  'Hall',
  'Cathedral',
]
export const REVERB_TONES: readonly ReverbTone[] = ['Normal', 'Bright', 'Dark']

export interface Mod1State {
  readonly on: boolean
  readonly type: Mod1Type
  readonly rate: number // 0..100
  readonly amount: number // 0..100
}

export interface Mod2State {
  readonly on: boolean
  readonly type: Mod2Type
  readonly rate: number // 0..100
  readonly amount: number // 0..100
}

export interface DelayState {
  readonly on: boolean
  readonly tempo: number // 0..100 (maps to 60..750 ms / 80..1000 BPM equiv)
  readonly feedback: number // 0..100
  readonly dryWet: number // 0..100
  readonly filter: DelayFilterType
  readonly pingPong: boolean
  readonly bpm: number // exact BPM from knob or tap tempo (40..240)
}

export interface AmpEqState {
  readonly on: boolean
  readonly type: AmpEqType
  readonly drive: number // 0..100
  readonly bass: number // 0..100 (50 = 0 dB, -15..+15 dB @ 100 Hz)
  readonly mid: number // 0..100 (50 = 0 dB, -15..+15 dB, or Filter Res)
  readonly midFreq: number // 0..100 (200..8000 Hz, or Filter Cutoff)
  readonly treble: number // 0..100 (50 = 0 dB, -15..+15 dB @ 4000 Hz)
}

export interface CompressorState {
  readonly on: boolean
  readonly amount: number // 0..100
  readonly fast: boolean
}

export interface ReverbState {
  readonly on: boolean
  readonly type: ReverbType
  readonly tone: ReverbTone
  readonly dryWet: number // 0..100 (100 = fully wet)
}

export interface EffectChainState {
  readonly mod1: Mod1State
  readonly mod2: Mod2State
  readonly delay: DelayState
  readonly ampEq: AmpEqState
  readonly comp: CompressorState
  readonly reverb: ReverbState
}

export interface RotaryState {
  readonly on: boolean
  readonly speed: 'Slow' | 'Fast'
  readonly stopMode: boolean
  readonly drive: number // 0..100
  readonly driveOn: boolean
}

export interface GlobalEffectsState {
  readonly delayGlobal: boolean
  readonly compGlobal: boolean
  readonly reverbGlobal: boolean
  readonly delay: DelayState
  readonly comp: CompressorState
  readonly reverb: ReverbState
}

export interface EffectsSectionState {
  readonly allOn: boolean
  readonly focusedChain: FxChainId
  readonly pianoGroupMode: boolean
  readonly shiftActive: boolean
  readonly chains: Readonly<Record<FxChainId, EffectChainState>>
  readonly global: GlobalEffectsState
  readonly rotary: RotaryState
  readonly lastTapTimestampMs: number | null
}

export interface StageInstrumentState {
  readonly masterLevel: number // 0..100
  readonly pitchStick: number // -100..+100 (±2 semitones when PSTICK enabled)
  readonly piano: PianoSectionState
  readonly effects: EffectsSectionState
  readonly decorative: HardwarePresentationState
}

export function tempoKnobToBpm(knob0To100: number): number {
  const t = Math.max(0, Math.min(100, knob0To100)) / 100
  return Math.round(50 + t * 190) // 50..240 BPM
}

export function bpmToTempoKnob(bpm: number): number {
  const clamped = Math.max(50, Math.min(240, bpm))
  return Math.round(((clamped - 50) / 190) * 100)
}

export function bpmToDelaySeconds(bpm: number): number {
  // Quarter note delay in seconds (0.25 s at 240 BPM .. 1.2 s at 50 BPM)
  const clamped = Math.max(50, Math.min(240, bpm))
  return 60 / clamped
}

export function createDefaultEffectChain(reverbOn = false): EffectChainState {
  return {
    mod1: { on: false, type: 'A-Pan', rate: 40, amount: 64 },
    mod2: { on: false, type: 'Chorus', rate: 45, amount: 55 },
    delay: {
      on: false,
      tempo: 48,
      feedback: 45,
      dryWet: 34,
      filter: 'Off',
      pingPong: false,
      bpm: tempoKnobToBpm(48),
    },
    ampEq: {
      on: false,
      type: 'EQ only',
      drive: 32,
      bass: 50,
      mid: 50,
      midFreq: 50,
      treble: 50,
    },
    comp: { on: false, amount: 36, fast: false },
    reverb: {
      on: reverbOn,
      type: 'Booth',
      tone: 'Normal',
      dryWet: reverbOn ? 10 : 32,
    },
  }
}

export function createInitialInstrumentState(): StageInstrumentState {
  const chainA = createDefaultEffectChain(true)
  const chainB = createDefaultEffectChain(false)
  const organChain = createDefaultEffectChain(false)
  const synthChain = createDefaultEffectChain(false)

  return {
    masterLevel: 75,
    pitchStick: 0,
    piano: {
      sectionOn: true,
      focusedLayer: 'A',
      sustped: true,
      pstick: true,
      layers: {
        A: {
          enabled: true,
          level: 92,
          octave: 0,
          type: 'Grand',
          modelIndex: 0,
          timbre: 'Off',
          kbTouch: 'Medium',
          dynComp: 0,
          unison: 0,
          softRelease: false,
          stringRes: true,
        },
        B: {
          enabled: false,
          level: 70,
          octave: 0,
          type: 'Electric',
          modelIndex: 0,
          timbre: 'Off',
          kbTouch: 'Medium',
          dynComp: 0,
          unison: 0,
          softRelease: false,
          stringRes: false,
        },
      },
    },
    effects: {
      allOn: true,
      focusedChain: 'pianoA',
      pianoGroupMode: false,
      shiftActive: false,
      chains: {
        pianoA: chainA,
        pianoB: chainB,
        organ: organChain,
        synthA: synthChain,
      },
      global: {
        delayGlobal: false,
        compGlobal: false,
        reverbGlobal: false,
        delay: { ...chainA.delay, on: true, dryWet: 34 },
        comp: { ...chainA.comp, on: true, amount: 45 },
        reverb: { ...chainA.reverb, on: true, type: 'Hall', dryWet: 35 },
      },
      rotary: {
        on: true,
        speed: 'Slow',
        stopMode: false,
        drive: 35,
        driveOn: false,
      },
      lastTapTimestampMs: null,
    },
    decorative: createInitialHardwareState(),
  }
}

/**
 * Resolves the effective EffectChainState for a Piano layer ('A' | 'B'),
 * applying Piano Group Mode (B mirrors A) and Global Mode overrides (Delay/Comp/Reverb).
 */
export function resolveEffectiveChainForLayer(
  effects: EffectsSectionState,
  layer: PianoLayerId,
): EffectChainState {
  const baseChainId: FxChainId =
    effects.pianoGroupMode || layer === 'A' ? 'pianoA' : 'pianoB'
  const base = effects.chains[baseChainId]
  return {
    mod1: base.mod1,
    mod2: base.mod2,
    ampEq: base.ampEq,
    delay: effects.global.delayGlobal ? effects.global.delay : base.delay,
    comp: effects.global.compGlobal ? effects.global.comp : base.comp,
    reverb: effects.global.reverbGlobal ? effects.global.reverb : base.reverb,
  }
}

/**
 * Returns the EffectChainState currently displayed & edited by the Layer Effects panel.
 */
export function getDisplayedEffectChain(effects: EffectsSectionState): EffectChainState {
  const activeChainId: FxChainId =
    effects.pianoGroupMode && effects.focusedChain === 'pianoB'
      ? 'pianoA'
      : effects.focusedChain
  const base = effects.chains[activeChainId]
  return {
    mod1: base.mod1,
    mod2: base.mod2,
    ampEq: base.ampEq,
    delay: effects.global.delayGlobal ? effects.global.delay : base.delay,
    comp: effects.global.compGlobal ? effects.global.comp : base.comp,
    reverb: effects.global.reverbGlobal ? effects.global.reverb : base.reverb,
  }
}

export type InstrumentAction =
  | HardwareAction
  | { readonly type: 'focus-piano-layer'; readonly layer: PianoLayerId }
  | { readonly type: 'set-piano-layer'; readonly layer: PianoLayerId; readonly patch: Partial<PianoLayerState> }
  | { readonly type: 'set-piano-section'; readonly patch: Partial<Omit<PianoSectionState, 'layers'>> }
  | { readonly type: 'set-fx-focus'; readonly chain: FxChainId }
  | { readonly type: 'toggle-piano-group-mode' }
  | { readonly type: 'toggle-global-unit'; readonly unit: 'delay' | 'comp' | 'reverb' }
  | { readonly type: 'tap-delay-tempo'; readonly nowMs: number }
  | { readonly type: 'set-pitch-stick'; readonly value: number }
  | { readonly type: 'set-master-level'; readonly value: number }
  | { readonly type: 'set-rotary'; readonly patch: Partial<RotaryState> }
  | {
      readonly type: 'patch-fx-chain'
      readonly chain?: FxChainId
      readonly patch: {
        readonly mod1?: Partial<Mod1State>
        readonly mod2?: Partial<Mod2State>
        readonly delay?: Partial<DelayState>
        readonly ampEq?: Partial<AmpEqState>
        readonly comp?: Partial<CompressorState>
        readonly reverb?: Partial<ReverbState>
      }
    }

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function updateEditableChain(
  effects: EffectsSectionState,
  updater: (chain: EffectChainState) => EffectChainState,
  explicitChain?: FxChainId,
): EffectsSectionState {
  const targetId: FxChainId =
    explicitChain ??
    (effects.pianoGroupMode && effects.focusedChain === 'pianoB'
      ? 'pianoA'
      : effects.focusedChain)
  const nextChain = updater(effects.chains[targetId])
  const nextChains: Record<FxChainId, EffectChainState> = {
    ...effects.chains,
    [targetId]: nextChain,
  }
  if (effects.pianoGroupMode && (targetId === 'pianoA' || targetId === 'pianoB')) {
    nextChains.pianoA = nextChain
    nextChains.pianoB = nextChain
  }
  return { ...effects, chains: nextChains }
}

function updateDelayState(
  effects: EffectsSectionState,
  updater: (d: DelayState) => DelayState,
): EffectsSectionState {
  if (effects.global.delayGlobal) {
    return {
      ...effects,
      global: { ...effects.global, delay: updater(effects.global.delay) },
    }
  }
  return updateEditableChain(effects, (c) => ({ ...c, delay: updater(c.delay) }))
}

function updateCompState(
  effects: EffectsSectionState,
  updater: (c: CompressorState) => CompressorState,
): EffectsSectionState {
  if (effects.global.compGlobal) {
    return {
      ...effects,
      global: { ...effects.global, comp: updater(effects.global.comp) },
    }
  }
  return updateEditableChain(effects, (c) => ({ ...c, comp: updater(c.comp) }))
}

function updateReverbState(
  effects: EffectsSectionState,
  updater: (r: ReverbState) => ReverbState,
): EffectsSectionState {
  if (effects.global.reverbGlobal) {
    return {
      ...effects,
      global: { ...effects.global, reverb: updater(effects.global.reverb) },
    }
  }
  return updateEditableChain(effects, (c) => ({ ...c, reverb: updater(c.reverb) }))
}

function applyPanelControlAction(
  state: StageInstrumentState,
  action: Exclude<HardwareAction, { type: 'reset' }>,
): StageInstrumentState {
  const { id } = action
  const spec = PANEL_CONTROL_BY_ID[id]
  if (!spec) return state

  const nextNumeric = (current: number): number => {
    if (action.type === 'set') return clamp(action.value, spec.min, spec.max)
    if (action.type === 'step') return clamp(current + action.delta * spec.step, spec.min, spec.max)
    return current + spec.step > spec.max ? spec.min : current + spec.step
  }

  // ---- Performance functional controls ----
  if (id === 'perf-master-level') {
    return { ...state, masterLevel: nextNumeric(state.masterLevel) }
  }
  if (id === 'perf-pitch-stick') {
    return { ...state, pitchStick: nextNumeric(state.pitchStick) }
  }
  if (id === 'perf-rotary-drive') {
    return {
      ...state,
      effects: {
        ...state.effects,
        rotary: { ...state.effects.rotary, drive: nextNumeric(state.effects.rotary.drive) },
      },
    }
  }
  if (id === 'perf-rotary-drive-on') {
    const next = action.type === 'set' ? action.value > 0 : !state.effects.rotary.driveOn
    return {
      ...state,
      effects: {
        ...state.effects,
        rotary: { ...state.effects.rotary, driveOn: next },
      },
    }
  }
  if (id === 'perf-rotary-stop') {
    const next = action.type === 'set' ? action.value > 0 : !state.effects.rotary.stopMode
    return {
      ...state,
      effects: {
        ...state.effects,
        rotary: { ...state.effects.rotary, stopMode: next },
      },
    }
  }
  if (id === 'perf-rotary-speed') {
    const isFast = state.effects.rotary.speed === 'Fast'
    const nextFast = action.type === 'set' ? action.value > 0 : !isFast
    return {
      ...state,
      effects: {
        ...state.effects,
        rotary: { ...state.effects.rotary, speed: nextFast ? 'Fast' : 'Slow', stopMode: false },
      },
    }
  }

  // ---- Shift (shared between fx-shift & program-shift for ergonomic Shift-combos) ----
  if (id === 'fx-shift') {
    const next = action.type === 'set' ? action.value > 0 : !state.effects.shiftActive
    return {
      ...state,
      effects: { ...state.effects, shiftActive: next },
    }
  }

  // ---- Piano section functional controls ----
  const focusedLayerId = state.piano.focusedLayer
  const focusedLayer = state.piano.layers[focusedLayerId]
  const updateFocusedPianoLayer = (
    updater: (layer: PianoLayerState) => PianoLayerState,
  ): StageInstrumentState => ({
    ...state,
    piano: {
      ...state.piano,
      layers: {
        ...state.piano.layers,
        [focusedLayerId]: updater(state.piano.layers[focusedLayerId]),
      },
    },
  })

  if (id === 'piano-section-on') {
    const next = action.type === 'set' ? action.value > 0 : !state.piano.sectionOn
    return { ...state, piano: { ...state.piano, sectionOn: next } }
  }

  if (id === 'piano-layer-a-fader' || id === 'piano-layer-b-fader') {
    const targetLayer: PianoLayerId = id === 'piano-layer-a-fader' ? 'A' : 'B'
    const nextLevel = nextNumeric(state.piano.layers[targetLayer].level)
    return {
      ...state,
      piano: {
        ...state.piano,
        focusedLayer: targetLayer,
        layers: {
          ...state.piano.layers,
          [targetLayer]: { ...state.piano.layers[targetLayer], level: nextLevel },
        },
      },
      effects: {
        ...state.effects,
        focusedChain: targetLayer === 'A' ? 'pianoA' : 'pianoB',
      },
    }
  }

  if (id === 'piano-layer-a-on' || id === 'piano-layer-b-on') {
    const targetLayer: PianoLayerId = id === 'piano-layer-a-on' ? 'A' : 'B'
    if (state.effects.shiftActive) {
      return {
        ...state,
        piano: {
          ...state.piano,
          sustped: targetLayer === 'A' ? !state.piano.sustped : state.piano.sustped,
          pstick: targetLayer === 'B' ? !state.piano.pstick : state.piano.pstick,
        },
        effects: { ...state.effects, shiftActive: false },
      }
    }
    const curLayer = state.piano.layers[targetLayer]
    const otherLayer: PianoLayerId = targetLayer === 'A' ? 'B' : 'A'
    if (action.type === 'set') {
      const nextEnabled = action.value > 0
      const nextFocus: PianoLayerId = nextEnabled
        ? targetLayer
        : state.piano.layers[otherLayer].enabled
          ? otherLayer
          : targetLayer
      return {
        ...state,
        piano: {
          ...state.piano,
          focusedLayer: nextFocus,
          layers: {
            ...state.piano.layers,
            [targetLayer]: { ...curLayer, enabled: nextEnabled },
          },
        },
        effects: {
          ...state.effects,
          focusedChain: nextFocus === 'A' ? 'pianoA' : 'pianoB',
        },
      }
    }
    // Activate: if off -> turn on & focus; if on & unfocused -> focus; if on & focused -> turn off
    if (!curLayer.enabled) {
      return {
        ...state,
        piano: {
          ...state.piano,
          focusedLayer: targetLayer,
          layers: {
            ...state.piano.layers,
            [targetLayer]: { ...curLayer, enabled: true },
          },
        },
        effects: {
          ...state.effects,
          focusedChain: targetLayer === 'A' ? 'pianoA' : 'pianoB',
        },
      }
    }
    if (state.piano.focusedLayer !== targetLayer) {
      return {
        ...state,
        piano: { ...state.piano, focusedLayer: targetLayer },
        effects: {
          ...state.effects,
          focusedChain: targetLayer === 'A' ? 'pianoA' : 'pianoB',
        },
      }
    }
    const nextFocus: PianoLayerId = state.piano.layers[otherLayer].enabled ? otherLayer : targetLayer
    return {
      ...state,
      piano: {
        ...state.piano,
        focusedLayer: nextFocus,
        layers: {
          ...state.piano.layers,
          [targetLayer]: { ...curLayer, enabled: false },
        },
      },
      effects: {
        ...state.effects,
        focusedChain: nextFocus === 'A' ? 'pianoA' : 'pianoB',
      },
    }
  }

  if (id === 'piano-sustped') {
    const next = action.type === 'set' ? action.value > 0 : !state.piano.sustped
    return { ...state, piano: { ...state.piano, sustped: next } }
  }

  if (id === 'piano-pstick') {
    const next = action.type === 'set' ? action.value > 0 : !state.piano.pstick
    return { ...state, piano: { ...state.piano, pstick: next } }
  }

  if (id === 'piano-octave-down') {
    return updateFocusedPianoLayer((layer) => ({
      ...layer,
      octave: Math.max(-1, layer.octave - 1) as -1 | 0 | 1,
    }))
  }

  if (id === 'piano-octave-up') {
    return updateFocusedPianoLayer((layer) => ({
      ...layer,
      octave: Math.min(1, layer.octave + 1) as -1 | 0 | 1,
    }))
  }

  if (id === 'piano-type-select') {
    const curIdx = PIANO_TYPES.indexOf(focusedLayer.type)
    const nextIdx =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, PIANO_TYPES.length - 1)
        : (curIdx + 1) % PIANO_TYPES.length
    const nextType = PIANO_TYPES[nextIdx]
    const validTimbres = getAvailableTimbres(nextType)
    const nextTimbre = validTimbres.includes(focusedLayer.timbre) ? focusedLayer.timbre : 'Off'
    return updateFocusedPianoLayer((layer) => ({
      ...layer,
      type: nextType,
      modelIndex: 0,
      timbre: nextTimbre,
    }))
  }

  if (id === 'piano-model-dial') {
    const models = PIANO_MODELS_BY_TYPE[focusedLayer.type]
    let nextModelIndex = focusedLayer.modelIndex
    if (action.type === 'step') {
      const dir = action.delta >= 0 ? 1 : -1
      nextModelIndex = (focusedLayer.modelIndex + dir + models.length) % models.length
    } else if (action.type === 'set') {
      const ratio = clamp(action.value, 0, 100) / 100
      nextModelIndex = Math.min(models.length - 1, Math.floor(ratio * models.length))
    } else {
      nextModelIndex = (focusedLayer.modelIndex + 1) % models.length
    }
    return updateFocusedPianoLayer((layer) => ({
      ...layer,
      modelIndex: nextModelIndex,
    }))
  }

  if (id === 'piano-timbre') {
    const timbres = getAvailableTimbres(focusedLayer.type)
    const curIdx = Math.max(0, timbres.indexOf(focusedLayer.timbre))
    const nextIdx =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, timbres.length - 1)
        : (curIdx + 1) % timbres.length
    return updateFocusedPianoLayer((layer) => ({ ...layer, timbre: timbres[nextIdx] }))
  }

  if (id === 'piano-acoustics') {
    const curCode = (focusedLayer.softRelease ? 1 : 0) + (focusedLayer.stringRes ? 2 : 0)
    const nextCode =
      action.type === 'set' ? clamp(Math.round(action.value), 0, 3) : (curCode + 1) % 4
    return updateFocusedPianoLayer((layer) => ({
      ...layer,
      softRelease: nextCode === 1 || nextCode === 3,
      stringRes: nextCode === 2 || nextCode === 3,
    }))
  }

  if (id === 'piano-unison') {
    const next = (
      action.type === 'set' ? clamp(Math.round(action.value), 0, 3) : (focusedLayer.unison + 1) % 4
    ) as UnisonLevel
    return updateFocusedPianoLayer((layer) => ({ ...layer, unison: next }))
  }

  if (id === 'piano-kb-touch') {
    const curIdx = KB_TOUCH_CURVES.indexOf(focusedLayer.kbTouch)
    const nextIdx =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, KB_TOUCH_CURVES.length - 1)
        : (curIdx + 1) % KB_TOUCH_CURVES.length
    return updateFocusedPianoLayer((layer) => ({ ...layer, kbTouch: KB_TOUCH_CURVES[nextIdx] }))
  }

  if (id === 'piano-dyn-comp') {
    const next = (
      action.type === 'set' ? clamp(Math.round(action.value), 0, 3) : (focusedLayer.dynComp + 1) % 4
    ) as DynCompLevel
    return updateFocusedPianoLayer((layer) => ({ ...layer, dynComp: next }))
  }

  // ---- Layer Effects section functional controls ----
  const fx = state.effects
  const displayed = getDisplayedEffectChain(fx)

  if (id === 'fx-section-on') {
    const next = action.type === 'set' ? action.value > 0 : !fx.allOn
    return { ...state, effects: { ...fx, allOn: next } }
  }

  if (id === 'fx-focus-organ') {
    return { ...state, effects: { ...fx, focusedChain: 'organ', shiftActive: false } }
  }
  if (id === 'fx-focus-synth') {
    return { ...state, effects: { ...fx, focusedChain: 'synthA', shiftActive: false } }
  }
  if (id === 'fx-focus-piano') {
    if (fx.shiftActive) {
      const nextGroup = !fx.pianoGroupMode
      let nextChains = fx.chains
      if (nextGroup) {
        nextChains = { ...fx.chains, pianoB: fx.chains.pianoA }
      }
      return {
        ...state,
        effects: {
          ...fx,
          pianoGroupMode: nextGroup,
          focusedChain: 'pianoA',
          shiftActive: false,
          chains: nextChains,
        },
      }
    }
    const nextChain: FxChainId =
      fx.focusedChain === 'pianoA' ? 'pianoB' : 'pianoA'
    return {
      ...state,
      piano: { ...state.piano, focusedLayer: nextChain === 'pianoA' ? 'A' : 'B' },
      effects: { ...fx, focusedChain: nextChain },
    }
  }

  // Mod 1
  if (id === 'fx-mod1-on') {
    const next = action.type === 'set' ? action.value > 0 : !displayed.mod1.on
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, mod1: { ...c.mod1, on: next } })),
    }
  }
  if (id === 'fx-mod1-type') {
    const cur = MOD1_TYPES.indexOf(displayed.mod1.type)
    const next =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, MOD1_TYPES.length - 1)
        : (cur + 1) % MOD1_TYPES.length
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({
        ...c,
        mod1: { ...c.mod1, type: MOD1_TYPES[next] },
      })),
    }
  }
  if (id === 'fx-mod1-rate') {
    const val = nextNumeric(displayed.mod1.rate)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, mod1: { ...c.mod1, rate: val } })),
    }
  }
  if (id === 'fx-mod1-amount') {
    const val = nextNumeric(displayed.mod1.amount)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, mod1: { ...c.mod1, amount: val } })),
    }
  }

  // Mod 2
  if (id === 'fx-mod2-on') {
    const next = action.type === 'set' ? action.value > 0 : !displayed.mod2.on
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, mod2: { ...c.mod2, on: next } })),
    }
  }
  if (id === 'fx-mod2-type') {
    const cur = MOD2_TYPES.indexOf(displayed.mod2.type)
    const next =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, MOD2_TYPES.length - 1)
        : (cur + 1) % MOD2_TYPES.length
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({
        ...c,
        mod2: { ...c.mod2, type: MOD2_TYPES[next] },
      })),
    }
  }
  if (id === 'fx-mod2-rate') {
    const val = nextNumeric(displayed.mod2.rate)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, mod2: { ...c.mod2, rate: val } })),
    }
  }
  if (id === 'fx-mod2-amount') {
    const val = nextNumeric(displayed.mod2.amount)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, mod2: { ...c.mod2, amount: val } })),
    }
  }

  // Amp Sim / EQ
  if (id === 'fx-amp-on') {
    const next = action.type === 'set' ? action.value > 0 : !displayed.ampEq.on
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, on: next } })),
    }
  }
  if (id === 'fx-amp-type') {
    const cur = AMP_EQ_TYPES.indexOf(displayed.ampEq.type)
    const next =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, AMP_EQ_TYPES.length - 1)
        : (cur + 1) % AMP_EQ_TYPES.length
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({
        ...c,
        ampEq: { ...c.ampEq, type: AMP_EQ_TYPES[next] },
      })),
    }
  }
  if (id === 'fx-amp-drive') {
    const val = nextNumeric(displayed.ampEq.drive)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, drive: val } })),
    }
  }
  if (id === 'fx-amp-freq') {
    const val = nextNumeric(displayed.ampEq.midFreq)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, midFreq: val } })),
    }
  }
  if (id === 'fx-eq-bass') {
    const val = nextNumeric(displayed.ampEq.bass)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, bass: val } })),
    }
  }
  if (id === 'fx-eq-mid') {
    const val = nextNumeric(displayed.ampEq.mid)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, mid: val } })),
    }
  }
  if (id === 'fx-eq-treble') {
    const val = nextNumeric(displayed.ampEq.treble)
    return {
      ...state,
      effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, treble: val } })),
    }
  }

  // Delay (Global-capable via Shift+On)
  if (id === 'fx-delay-on') {
    if (fx.shiftActive) {
      return {
        ...state,
        effects: {
          ...fx,
          shiftActive: false,
          global: { ...fx.global, delayGlobal: !fx.global.delayGlobal },
        },
      }
    }
    const next = action.type === 'set' ? action.value > 0 : !displayed.delay.on
    return {
      ...state,
      effects: updateDelayState(fx, (d) => ({ ...d, on: next })),
    }
  }
  if (id === 'fx-delay-tempo') {
    const val = nextNumeric(displayed.delay.tempo)
    return {
      ...state,
      effects: updateDelayState(fx, (d) => ({ ...d, tempo: val, bpm: tempoKnobToBpm(val) })),
    }
  }
  if (id === 'fx-delay-feedback') {
    const val = nextNumeric(displayed.delay.feedback)
    return {
      ...state,
      effects: updateDelayState(fx, (d) => ({ ...d, feedback: val })),
    }
  }
  if (id === 'fx-delay-dry-wet') {
    const val = nextNumeric(displayed.delay.dryWet)
    return {
      ...state,
      effects: updateDelayState(fx, (d) => ({ ...d, dryWet: val })),
    }
  }
  if (id === 'fx-delay-type') {
    const cur = DELAY_FILTER_TYPES.indexOf(displayed.delay.filter)
    const next =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, DELAY_FILTER_TYPES.length - 1)
        : (cur + 1) % DELAY_FILTER_TYPES.length
    return {
      ...state,
      effects: updateDelayState(fx, (d) => ({ ...d, filter: DELAY_FILTER_TYPES[next] })),
    }
  }
  if (id === 'fx-delay-pingpong') {
    const next = action.type === 'set' ? action.value > 0 : !displayed.delay.pingPong
    return {
      ...state,
      effects: updateDelayState(fx, (d) => ({ ...d, pingPong: next })),
    }
  }
  if (id === 'fx-delay-tap') {
    const nowMs = Date.now()
    const prev = fx.lastTapTimestampMs
    if (prev !== null) {
      const dtMs = nowMs - prev
      if (dtMs >= 200 && dtMs <= 1500) {
        const bpm = clamp(Math.round(60000 / dtMs), 50, 240)
        const knob = bpmToTempoKnob(bpm)
        return {
          ...state,
          effects: {
            ...updateDelayState(fx, (d) => ({ ...d, bpm, tempo: knob })),
            lastTapTimestampMs: nowMs,
          },
        }
      }
    }
    return { ...state, effects: { ...fx, lastTapTimestampMs: nowMs } }
  }

  // Compressor (Global-capable via Shift+On)
  if (id === 'fx-comp-on') {
    if (fx.shiftActive) {
      return {
        ...state,
        effects: {
          ...fx,
          shiftActive: false,
          global: { ...fx.global, compGlobal: !fx.global.compGlobal },
        },
      }
    }
    const next = action.type === 'set' ? action.value > 0 : !displayed.comp.on
    return {
      ...state,
      effects: updateCompState(fx, (c) => ({ ...c, on: next })),
    }
  }
  if (id === 'fx-comp-amount') {
    const val = nextNumeric(displayed.comp.amount)
    return {
      ...state,
      effects: updateCompState(fx, (c) => ({ ...c, amount: val })),
    }
  }
  if (id === 'fx-comp-fast') {
    const next = action.type === 'set' ? action.value > 0 : !displayed.comp.fast
    return {
      ...state,
      effects: updateCompState(fx, (c) => ({ ...c, fast: next })),
    }
  }

  // Reverb (Global-capable via Shift+On)
  if (id === 'fx-reverb-on') {
    if (fx.shiftActive) {
      return {
        ...state,
        effects: {
          ...fx,
          shiftActive: false,
          global: { ...fx.global, reverbGlobal: !fx.global.reverbGlobal },
        },
      }
    }
    const next = action.type === 'set' ? action.value > 0 : !displayed.reverb.on
    return {
      ...state,
      effects: updateReverbState(fx, (r) => ({ ...r, on: next })),
    }
  }
  if (id === 'fx-reverb-type') {
    const cur = REVERB_TYPES.indexOf(displayed.reverb.type)
    const next =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, REVERB_TYPES.length - 1)
        : (cur + 1) % REVERB_TYPES.length
    return {
      ...state,
      effects: updateReverbState(fx, (r) => ({ ...r, type: REVERB_TYPES[next] })),
    }
  }
  if (id === 'fx-reverb-tone') {
    const cur = REVERB_TONES.indexOf(displayed.reverb.tone)
    const next =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, REVERB_TONES.length - 1)
        : (cur + 1) % REVERB_TONES.length
    return {
      ...state,
      effects: updateReverbState(fx, (r) => ({ ...r, tone: REVERB_TONES[next] })),
    }
  }
  if (id === 'fx-reverb-dry-wet') {
    const val = nextNumeric(displayed.reverb.dryWet)
    return {
      ...state,
      effects: updateReverbState(fx, (r) => ({ ...r, dryWet: val })),
    }
  }

  // ---- Decorative controls (Organ, Synth, Program, Mod Wheel) ----
  const nextDecorative = hardwareStateReducer(state.decorative, action)
  if (nextDecorative === state.decorative) return state
  return { ...state, decorative: nextDecorative }
}

export function instrumentStateReducer(
  state: StageInstrumentState,
  action: InstrumentAction,
): StageInstrumentState {
  if (action.type === 'reset') {
    return createInitialInstrumentState()
  }

  if (action.type === 'set' || action.type === 'step' || action.type === 'activate') {
    return applyPanelControlAction(state, action)
  }

  if (action.type === 'focus-piano-layer') {
    return {
      ...state,
      piano: { ...state.piano, focusedLayer: action.layer },
      effects: {
        ...state.effects,
        focusedChain: action.layer === 'A' ? 'pianoA' : 'pianoB',
      },
    }
  }

  if (action.type === 'set-piano-layer') {
    return {
      ...state,
      piano: {
        ...state.piano,
        layers: {
          ...state.piano.layers,
          [action.layer]: { ...state.piano.layers[action.layer], ...action.patch },
        },
      },
    }
  }

  if (action.type === 'set-piano-section') {
    return {
      ...state,
      piano: { ...state.piano, ...action.patch },
    }
  }

  if (action.type === 'set-fx-focus') {
    return {
      ...state,
      effects: { ...state.effects, focusedChain: action.chain },
    }
  }

  if (action.type === 'toggle-piano-group-mode') {
    const nextGroup = !state.effects.pianoGroupMode
    return {
      ...state,
      effects: {
        ...state.effects,
        pianoGroupMode: nextGroup,
        chains: nextGroup
          ? { ...state.effects.chains, pianoB: state.effects.chains.pianoA }
          : state.effects.chains,
      },
    }
  }

  if (action.type === 'toggle-global-unit') {
    const g = state.effects.global
    return {
      ...state,
      effects: {
        ...state.effects,
        global: {
          ...g,
          delayGlobal: action.unit === 'delay' ? !g.delayGlobal : g.delayGlobal,
          compGlobal: action.unit === 'comp' ? !g.compGlobal : g.compGlobal,
          reverbGlobal: action.unit === 'reverb' ? !g.reverbGlobal : g.reverbGlobal,
        },
      },
    }
  }

  if (action.type === 'tap-delay-tempo') {
    const prev = state.effects.lastTapTimestampMs
    if (prev !== null) {
      const dtMs = action.nowMs - prev
      if (dtMs >= 200 && dtMs <= 1500) {
        const bpm = clamp(Math.round(60000 / dtMs), 50, 240)
        const tempo = bpmToTempoKnob(bpm)
        return {
          ...state,
          effects: {
            ...updateDelayState(state.effects, (d) => ({ ...d, bpm, tempo })),
            lastTapTimestampMs: action.nowMs,
          },
        }
      }
    }
    return {
      ...state,
      effects: { ...state.effects, lastTapTimestampMs: action.nowMs },
    }
  }

  if (action.type === 'set-pitch-stick') {
    return { ...state, pitchStick: clamp(action.value, -100, 100) }
  }

  if (action.type === 'set-master-level') {
    return { ...state, masterLevel: clamp(action.value, 0, 100) }
  }

  if (action.type === 'set-rotary') {
    return {
      ...state,
      effects: {
        ...state.effects,
        rotary: { ...state.effects.rotary, ...action.patch },
      },
    }
  }

  if (action.type === 'patch-fx-chain') {
    const { patch, chain } = action
    return {
      ...state,
      effects: updateEditableChain(
        state.effects,
        (c) => ({
          mod1: patch.mod1 ? { ...c.mod1, ...patch.mod1 } : c.mod1,
          mod2: patch.mod2 ? { ...c.mod2, ...patch.mod2 } : c.mod2,
          delay: patch.delay ? { ...c.delay, ...patch.delay } : c.delay,
          ampEq: patch.ampEq ? { ...c.ampEq, ...patch.ampEq } : c.ampEq,
          comp: patch.comp ? { ...c.comp, ...patch.comp } : c.comp,
          reverb: patch.reverb ? { ...c.reverb, ...patch.reverb } : c.reverb,
        }),
        chain,
      ),
    }
  }

  return state
}

/**
 * Projects the canonical StageInstrumentState into the flat HardwarePresentationState
 * map consumed by PanelControls so every knob, fader, button, and ARIA valuenow/valuetext
 * stays 100% synchronized with live Piano & Effects state.
 */
export function projectPanelControlState(state: StageInstrumentState): HardwarePresentationState {
  const focused = state.piano.layers[state.piano.focusedLayer]
  const fx = state.effects
  const disp = getDisplayedEffectChain(fx)
  const models = PIANO_MODELS_BY_TYPE[focused.type]
  const modelKnobValue =
    models.length <= 1 ? 0 : Math.round((focused.modelIndex / (models.length - 1)) * 100)
  const acousticsCode = (focused.softRelease ? 1 : 0) + (focused.stringRes ? 2 : 0)
  const timbreIndex = Math.max(0, ELECTRIC_TIMBRES.indexOf(focused.timbre))

  return {
    ...state.decorative,
    // Performance
    'perf-master-level': state.masterLevel,
    'perf-pitch-stick': state.pitchStick,
    'perf-rotary-drive': fx.rotary.drive,
    'perf-rotary-drive-on': fx.rotary.driveOn ? 1 : 0,
    'perf-rotary-stop': fx.rotary.stopMode ? 1 : 0,
    'perf-rotary-speed': fx.rotary.speed === 'Fast' ? 1 : 0,

    // Piano
    'piano-section-on': state.piano.sectionOn ? 1 : 0,
    'piano-layer-a-fader': state.piano.layers.A.level,
    'piano-layer-b-fader': state.piano.layers.B.level,
    'piano-layer-a-on': state.piano.layers.A.enabled ? 1 : 0,
    'piano-layer-b-on': state.piano.layers.B.enabled ? 1 : 0,
    'piano-sustped': state.piano.sustped ? 1 : 0,
    'piano-pstick': state.piano.pstick ? 1 : 0,
    'piano-octave-down': focused.octave < 0 ? 1 : 0,
    'piano-octave-up': focused.octave > 0 ? 1 : 0,
    'piano-type-select': PIANO_TYPES.indexOf(focused.type),
    'piano-model-dial': modelKnobValue,
    'piano-timbre': timbreIndex,
    'piano-acoustics': acousticsCode,
    'piano-unison': focused.unison,
    'piano-kb-touch': KB_TOUCH_CURVES.indexOf(focused.kbTouch),
    'piano-dyn-comp': focused.dynComp,

    // Layer Effects
    'fx-section-on': fx.allOn ? 1 : 0,
    'fx-focus-organ': fx.focusedChain === 'organ' ? 1 : 0,
    'fx-focus-piano': fx.focusedChain === 'pianoA' || fx.focusedChain === 'pianoB' ? 1 : 0,
    'fx-focus-synth': fx.focusedChain === 'synthA' ? 1 : 0,
    'fx-shift': fx.shiftActive ? 1 : 0,

    'fx-mod1-on': disp.mod1.on ? 1 : 0,
    'fx-mod1-type': MOD1_TYPES.indexOf(disp.mod1.type),
    'fx-mod1-rate': disp.mod1.rate,
    'fx-mod1-amount': disp.mod1.amount,

    'fx-mod2-on': disp.mod2.on ? 1 : 0,
    'fx-mod2-type': MOD2_TYPES.indexOf(disp.mod2.type),
    'fx-mod2-rate': disp.mod2.rate,
    'fx-mod2-amount': disp.mod2.amount,

    'fx-amp-on': disp.ampEq.on ? 1 : 0,
    'fx-amp-type': AMP_EQ_TYPES.indexOf(disp.ampEq.type),
    'fx-amp-drive': disp.ampEq.drive,
    'fx-amp-freq': disp.ampEq.midFreq,
    'fx-eq-bass': disp.ampEq.bass,
    'fx-eq-mid': disp.ampEq.mid,
    'fx-eq-treble': disp.ampEq.treble,

    'fx-delay-on': disp.delay.on ? 1 : 0,
    'fx-delay-tempo': disp.delay.tempo,
    'fx-delay-type': DELAY_FILTER_TYPES.indexOf(disp.delay.filter),
    'fx-delay-feedback': disp.delay.feedback,
    'fx-delay-dry-wet': disp.delay.dryWet,
    'fx-delay-pingpong': disp.delay.pingPong ? 1 : 0,

    'fx-comp-on': disp.comp.on ? 1 : 0,
    'fx-comp-amount': disp.comp.amount,
    'fx-comp-fast': disp.comp.fast ? 1 : 0,

    'fx-reverb-on': disp.reverb.on ? 1 : 0,
    'fx-reverb-type': REVERB_TYPES.indexOf(disp.reverb.type),
    'fx-reverb-tone': REVERB_TONES.indexOf(disp.reverb.tone),
    'fx-reverb-dry-wet': disp.reverb.dryWet,
  }
}
