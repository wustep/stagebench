import type { SampleBankId } from '../audio/sampleManifests'
import { PANEL_CONTROL_BY_ID } from './controls'
import {
  createInitialHardwareState,
  hardwareStateReducer,
  type HardwareAction,
  type HardwarePresentationState,
} from './hardwareState'
import {
  clearMorphSource,
  getMorphTargetMinMax,
  resolveMorphedValue,
  upsertMorphAssignment,
  type MorphInputValues,
  type MorphSourceId,
  type MorphState,
  type MorphTargetId,
} from './morphs'
import {
  createDefaultSynthLayer,
  ORGAN_MODELS,
  ORGAN_VIB_CHORUS_TYPES,
  SYNTH_ARP_DIRECTIONS,
  SYNTH_ARP_MODES,
  SYNTH_FILTER_TYPES,
  SYNTH_LFO_DESTINATIONS,
  SYNTH_LFO_WAVEFORMS,
  SYNTH_MODES,
  SYNTH_NOTE_PRIORITIES,
  SYNTH_OSC_CATEGORIES,
  SYNTH_VIBRATO_MODES,
  SYNTH_VOICE_MODES,
  SYNTH_WAVEFORMS_BY_CATEGORY,
  type DrawbarTuple,
  type LayerEnableSnapshot,
  type LayerSceneId,
  type LayerScenesState,
  type MasterClockState,
  type OrganLayerId,
  type OrganLayerState,
  type OrganSectionState,
  type SynthLayerId,
  type SynthLayerState,
  type SynthOledView,
  type SynthSectionState,
  type TransposeState,
} from './organSynthTypes'
import {
  browserStorageAdapter,
  loadOrInitProgramBank,
  patchesEqual,
  persistProgramBank,
  snapshotLayerEnables,
  type LiveSlot,
  type ProgramPatch,
  type ProgramSlot,
  type StorageAdapter,
} from './programBank'
import {
  cycleLayerZone,
  FULL_KEYBOARD_ZONE,
  SPLIT_CROSSFADE_OPTIONS,
  SPLIT_POSITION_NOTES,
  type LayerZoneRange,
  type SplitPointId,
  type SplitState,
} from './splits'

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
  readonly level: number // 0..100 (morphable)
  readonly octave: -1 | 0 | 1 // ±12 semitones
  readonly zone: LayerZoneRange
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

export type FxChainId = 'pianoA' | 'pianoB' | 'organ' | 'synthA' | 'synthB' | 'synthC'

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
  readonly clockSync?: boolean
}

export interface Mod2State {
  readonly on: boolean
  readonly type: Mod2Type
  readonly rate: number // 0..100
  readonly amount: number // 0..100
}

export interface DelayState {
  readonly on: boolean
  readonly tempo: number // 0..100
  readonly feedback: number // 0..100
  readonly dryWet: number // 0..100
  readonly filter: DelayFilterType
  readonly pingPong: boolean
  readonly bpm: number // 40..240
  readonly clockSync?: boolean
}

export interface AmpEqState {
  readonly on: boolean
  readonly type: AmpEqType
  readonly drive: number // 0..100
  readonly bass: number // 0..100
  readonly mid: number // 0..100
  readonly midFreq: number // 0..100
  readonly treble: number // 0..100
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
  readonly dryWet: number // 0..100
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
  readonly organRouted?: boolean
  readonly speed: 'Slow' | 'Fast'
  readonly morphedSpeed?: number // 0..1 continuous morph blend (Slow..Fast)
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
  readonly synthGroupMode: boolean
  readonly shiftActive: boolean
  readonly chains: Readonly<Record<FxChainId, EffectChainState>>
  readonly global: GlobalEffectsState
  readonly rotary: RotaryState
  readonly lastTapTimestampMs: number | null
}

// ===================== Program System & UI Overlay State =====================

export type ProgramOverlayState =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'store-confirm'
      readonly destMode: 'program' | 'live'
      readonly destSlot: number
      readonly pendingName: string
      readonly sourcePatch: ProgramPatch
    }
  | {
      readonly kind: 'store-as-name'
      readonly draftName: string
      readonly cursor: number
      readonly destMode: 'program' | 'live'
      readonly destSlot: number
      readonly sourcePatch: ProgramPatch
    }
  | { readonly kind: 'list-view'; readonly selectedIndex: number }
  | { readonly kind: 'split-edit'; readonly activePoint: SplitPointId }
  | { readonly kind: 'clock-edit' }
  | { readonly kind: 'transpose-edit' }

export interface UndoProgramSnapshot {
  readonly mode: 'program' | 'live'
  readonly slotIndex: number
  readonly patch: ProgramPatch
}

export interface ProgramSystemState {
  readonly mode: 'program' | 'live'
  readonly activeSlot: number // 0..31
  readonly activeLiveSlot: number // 0..7
  readonly programs: readonly ProgramSlot[]
  readonly liveSlots: readonly LiveSlot[]
  readonly dirty: boolean
  readonly undoSnapshot: UndoProgramSnapshot | null
  readonly overlay: ProgramOverlayState
  readonly shiftActive: boolean
  readonly morphAssignSource: MorphSourceId | null
  readonly mstClkTaps: readonly number[]
  readonly soloSection: 'organ' | 'piano' | 'synth' | null
  readonly statusNotice: string | null
}

export interface StageInstrumentState {
  readonly masterLevel: number // 0..100 (EXCLUDED from ProgramPatch)
  readonly pitchStick: number // -100..+100
  readonly modWheel: number // 0..100 (Wheel morph source + Synth Vibrato)
  readonly controlPedal: number // 0..100 (Control Pedal morph source + MIDI CC11)
  readonly organ: OrganSectionState
  readonly piano: PianoSectionState
  readonly synth: SynthSectionState
  readonly effects: EffectsSectionState
  readonly split: SplitState
  readonly scenes: LayerScenesState
  readonly morphs: MorphState
  readonly masterClock: MasterClockState
  readonly transpose: TransposeState
  readonly program: ProgramSystemState
  readonly synthOledView: SynthOledView
  readonly panicCounter: number
  readonly decorative: HardwarePresentationState
}

export function tempoKnobToBpm(knob0To100: number): number {
  const t = Math.max(0, Math.min(100, knob0To100)) / 100
  return Math.round(50 + t * 190)
}

export function bpmToTempoKnob(bpm: number): number {
  const clamped = Math.max(50, Math.min(240, bpm))
  return Math.round(((clamped - 50) / 190) * 100)
}

export function bpmToDelaySeconds(bpm: number): number {
  const clamped = Math.max(30, Math.min(300, bpm))
  return 60 / clamped
}

export function createDefaultEffectChain(reverbOn = false): EffectChainState {
  return {
    mod1: { on: false, type: 'A-Pan', rate: 40, amount: 64, clockSync: false },
    mod2: { on: false, type: 'Chorus', rate: 45, amount: 55 },
    delay: {
      on: false,
      tempo: 48,
      feedback: 45,
      dryWet: 34,
      filter: 'Off',
      pingPong: false,
      bpm: tempoKnobToBpm(48),
      clockSync: false,
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

export function extractProgramPatch(state: StageInstrumentState): ProgramPatch {
  const { shiftActive: _s, lastTapTimestampMs: _t, ...serializableEffects } = state.effects
  return {
    version: 3,
    organ: state.organ,
    piano: state.piano,
    synth: state.synth,
    effects: serializableEffects,
    split: state.split,
    scenes: state.scenes,
    morphs: state.morphs,
    masterClock: state.masterClock,
    transpose: state.transpose,
  }
}

function applyPatchOntoState(
  state: StageInstrumentState,
  patch: ProgramPatch,
): StageInstrumentState {
  return {
    ...state,
    organ: patch.organ,
    piano: patch.piano,
    synth: patch.synth,
    effects: {
      ...patch.effects,
      shiftActive: false,
      lastTapTimestampMs: state.effects.lastTapTimestampMs,
    },
    split: patch.split,
    scenes: patch.scenes,
    morphs: patch.morphs,
    masterClock: patch.masterClock,
    transpose: patch.transpose,
  }
}

export function createInitialInstrumentState(storage?: StorageAdapter): StageInstrumentState {
  const bank = loadOrInitProgramBank(storage ?? browserStorageAdapter)
  const initialSlot = bank.programs[0]
  const patch = initialSlot.patch

  return {
    masterLevel: 75,
    pitchStick: 0,
    modWheel: 0,
    controlPedal: 0,
    organ: patch.organ,
    piano: patch.piano,
    synth: patch.synth,
    effects: {
      ...patch.effects,
      shiftActive: false,
      lastTapTimestampMs: null,
    },
    split: patch.split,
    scenes: patch.scenes,
    morphs: patch.morphs,
    masterClock: patch.masterClock,
    transpose: patch.transpose,
    program: {
      mode: 'program',
      activeSlot: 0,
      activeLiveSlot: 0,
      programs: bank.programs,
      liveSlots: bank.liveSlots,
      dirty: false,
      undoSnapshot: null,
      overlay: { kind: 'none' },
      shiftActive: false,
      morphAssignSource: null,
      mstClkTaps: [],
      soloSection: null,
      statusNotice: null,
    },
    synthOledView: 'wave',
    panicCounter: 0,
    decorative: createInitialHardwareState(),
  }
}

/**
 * Resolves the effective EffectChainState for any of the 6 layer chains,
 * applying Piano/Synth Group Modes and Global Mode overrides (Delay/Comp/Reverb).
 */
export function resolveEffectiveChain(
  effects: EffectsSectionState,
  chainId: FxChainId,
): EffectChainState {
  let baseChainId: FxChainId = chainId
  if (effects.pianoGroupMode && (chainId === 'pianoA' || chainId === 'pianoB')) {
    baseChainId = 'pianoA'
  } else if (
    effects.synthGroupMode &&
    (chainId === 'synthA' || chainId === 'synthB' || chainId === 'synthC')
  ) {
    baseChainId = 'synthA'
  }
  const base = effects.chains[baseChainId] ?? effects.chains.pianoA
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
 * Phase 2 compatibility helper for Piano layers ('A' | 'B').
 */
export function resolveEffectiveChainForLayer(
  effects: EffectsSectionState,
  layer: PianoLayerId,
): EffectChainState {
  return resolveEffectiveChain(effects, layer === 'A' ? 'pianoA' : 'pianoB')
}

export function getDisplayedEffectChain(effects: EffectsSectionState): EffectChainState {
  return resolveEffectiveChain(effects, effects.focusedChain)
}
/**
 * Applies Wheel and Control Pedal morph assignments onto a StageInstrumentState to produce
 * effective runtime parameters for audio DSP and visual LED graphs without mutating stored base values.
 */
export function resolveMorphedStageState(state: StageInstrumentState): StageInstrumentState {
  const inputs: MorphInputValues = {
    wheel: state.modWheel,
    controlPedal: state.controlPedal,
  }
  if (state.morphs.wheel.length === 0 && state.morphs.controlPedal.length === 0) {
    return state
  }
  const m = state.morphs

  const resolveDrawbars = (layer: OrganLayerId, bars: DrawbarTuple): DrawbarTuple => {
    const out = bars.map((val, idx) =>
      Math.round(
        resolveMorphedValue(
          val,
          `organ:${layer}:drawbar:${idx as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`,
          m,
          inputs,
          0,
          8,
        ),
      ),
    )
    return out as unknown as DrawbarTuple
  }

  const resolveSynthLayer = (id: SynthLayerId, layer: SynthLayerState): SynthLayerState => ({
    ...layer,
    level: resolveMorphedValue(layer.level, `synth:${id}:level`, m, inputs, 0, 100),
    oscCtrl: resolveMorphedValue(layer.oscCtrl, `synth:${id}:oscCtrl`, m, inputs, 0, 100),
    filter: {
      ...layer.filter,
      freq: resolveMorphedValue(layer.filter.freq, `synth:${id}:filterFreq`, m, inputs, 0, 100),
      res: resolveMorphedValue(layer.filter.res, `synth:${id}:filterRes`, m, inputs, 0, 100),
    },
    lfo: {
      ...layer.lfo,
      rate: resolveMorphedValue(layer.lfo.rate, `synth:${id}:lfoRate`, m, inputs, 0, 100),
      amount: resolveMorphedValue(layer.lfo.amount, `synth:${id}:lfoAmt`, m, inputs, 0, 100),
    },
    arp: {
      ...layer.arp,
      rate: resolveMorphedValue(layer.arp.rate, `synth:${id}:arpRate`, m, inputs, 0, 100),
    },
  })

  const resolveChain = (id: FxChainId, c: EffectChainState): EffectChainState => {
    const nextTempo = resolveMorphedValue(c.delay.tempo, `fx:${id}:delayTempo`, m, inputs, 0, 100)
    return {
      ...c,
      mod1: {
        ...c.mod1,
        rate: resolveMorphedValue(c.mod1.rate, `fx:${id}:mod1Rate`, m, inputs, 0, 100),
        amount: resolveMorphedValue(c.mod1.amount, `fx:${id}:mod1Amt`, m, inputs, 0, 100),
      },
      mod2: {
        ...c.mod2,
        amount: resolveMorphedValue(c.mod2.amount, `fx:${id}:mod2Amt`, m, inputs, 0, 100),
      },
      delay: {
        ...c.delay,
        tempo: nextTempo,
        bpm: nextTempo !== c.delay.tempo ? tempoKnobToBpm(nextTempo) : c.delay.bpm,
        feedback: resolveMorphedValue(c.delay.feedback, `fx:${id}:delayFeedback`, m, inputs, 0, 100),
        dryWet: resolveMorphedValue(c.delay.dryWet, `fx:${id}:delayDryWet`, m, inputs, 0, 100),
      },
      ampEq: {
        ...c.ampEq,
        midFreq: resolveMorphedValue(c.ampEq.midFreq, `fx:${id}:eqMidFreq`, m, inputs, 0, 100),
        drive: resolveMorphedValue(c.ampEq.drive, `fx:${id}:drive`, m, inputs, 0, 100),
      },
      reverb: {
        ...c.reverb,
        dryWet: resolveMorphedValue(c.reverb.dryWet, `fx:${id}:reverbDryWet`, m, inputs, 0, 100),
      },
    }
  }

  const baseRotarySpeed = state.effects.rotary.speed === 'Fast' ? 1 : 0
  const morphedRotarySpeed = resolveMorphedValue(baseRotarySpeed, 'rotary:speed', m, inputs, 0, 1)

  return {
    ...state,
    organ: {
      ...state.organ,
      layers: {
        A: {
          ...state.organ.layers.A,
          level: resolveMorphedValue(state.organ.layers.A.level, 'organ:A:level', m, inputs, 0, 100),
          drawbars: resolveDrawbars('A', state.organ.layers.A.drawbars),
        },
        B: {
          ...state.organ.layers.B,
          level: resolveMorphedValue(state.organ.layers.B.level, 'organ:B:level', m, inputs, 0, 100),
          drawbars: resolveDrawbars('B', state.organ.layers.B.drawbars),
        },
      },
    },
    piano: {
      ...state.piano,
      layers: {
        A: {
          ...state.piano.layers.A,
          level: resolveMorphedValue(state.piano.layers.A.level, 'piano:A:level', m, inputs, 0, 100),
        },
        B: {
          ...state.piano.layers.B,
          level: resolveMorphedValue(state.piano.layers.B.level, 'piano:B:level', m, inputs, 0, 100),
        },
      },
    },
    synth: {
      ...state.synth,
      layers: {
        A: resolveSynthLayer('A', state.synth.layers.A),
        B: resolveSynthLayer('B', state.synth.layers.B),
        C: resolveSynthLayer('C', state.synth.layers.C),
      },
    },
    effects: {
      ...state.effects,
      chains: {
        pianoA: resolveChain('pianoA', state.effects.chains.pianoA),
        pianoB: resolveChain('pianoB', state.effects.chains.pianoB),
        organ: resolveChain('organ', state.effects.chains.organ),
        synthA: resolveChain('synthA', state.effects.chains.synthA),
        synthB: resolveChain('synthB', state.effects.chains.synthB),
        synthC: resolveChain('synthC', state.effects.chains.synthC),
      },
      rotary: {
        ...state.effects.rotary,
        morphedSpeed: morphedRotarySpeed,
        speed: morphedRotarySpeed >= 0.5 ? 'Fast' : 'Slow',
      },
    },
  }
}

export type InstrumentAction =
  | HardwareAction
  // Piano (Phase 2 preserved)
  | { readonly type: 'focus-piano-layer'; readonly layer: PianoLayerId }
  | { readonly type: 'set-piano-layer'; readonly layer: PianoLayerId; readonly patch: Partial<PianoLayerState> }
  | { readonly type: 'set-piano-section'; readonly patch: Partial<Omit<PianoSectionState, 'layers'>> }
  // Organ
  | { readonly type: 'focus-organ-layer'; readonly layer: OrganLayerId }
  | { readonly type: 'set-organ-layer'; readonly layer: OrganLayerId; readonly patch: Partial<OrganLayerState> }
  | { readonly type: 'set-organ-section'; readonly patch: Partial<Omit<OrganSectionState, 'layers'>> }
  // Synth
  | { readonly type: 'focus-synth-layer'; readonly layer: SynthLayerId }
  | { readonly type: 'set-synth-layer'; readonly layer: SynthLayerId; readonly patch: Partial<SynthLayerState> }
  | { readonly type: 'set-synth-section'; readonly patch: Partial<Omit<SynthSectionState, 'layers'>> }
  | { readonly type: 'set-synth-oled-view'; readonly view: SynthOledView }
  // Effects
  | { readonly type: 'set-fx-focus'; readonly chain: FxChainId }
  | { readonly type: 'toggle-piano-group-mode' }
  | { readonly type: 'toggle-synth-group-mode' }
  | { readonly type: 'toggle-global-unit'; readonly unit: 'delay' | 'comp' | 'reverb' }
  | { readonly type: 'tap-delay-tempo'; readonly nowMs: number }
  | { readonly type: 'set-pitch-stick'; readonly value: number }
  | { readonly type: 'set-mod-wheel'; readonly value: number }
  | { readonly type: 'set-control-pedal'; readonly value: number }
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
  // Program / Live / Store / Store As / List / Undo
  | { readonly type: 'select-program'; readonly index: number }
  | { readonly type: 'select-live-slot'; readonly index: number }
  | { readonly type: 'toggle-live-mode' }
  | { readonly type: 'start-store' }
  | { readonly type: 'start-store-as' }
  | { readonly type: 'set-store-as-name'; readonly name: string }
  | { readonly type: 'store-as-insert-char'; readonly char: string }
  | { readonly type: 'store-as-delete-char' }
  | { readonly type: 'advance-store-as-to-confirm' }
  | { readonly type: 'set-store-dest'; readonly destMode: 'program' | 'live'; readonly destSlot: number }
  | { readonly type: 'confirm-store'; readonly storage?: StorageAdapter }
  | { readonly type: 'cancel-overlay' }
  | { readonly type: 'open-list-view' }
  | { readonly type: 'undo-program-change' }
  // Splits / Zones / Scenes / Morphs / Clock / Transpose / Panic
  | { readonly type: 'set-split'; readonly patch: Partial<SplitState> }
  | {
      readonly type: 'set-split-point'
      readonly point: SplitPointId
      readonly patch: Partial<SplitState['points']['mid']>
    }
  | {
      readonly type: 'set-layer-zone'
      readonly section: 'organ' | 'piano' | 'synth'
      readonly layer: string
      readonly zone: LayerZoneRange
    }
  | { readonly type: 'switch-scene'; readonly scene?: LayerSceneId }
  | { readonly type: 'set-morph-assign-source'; readonly source: MorphSourceId | null }
  | {
      readonly type: 'assign-morph'
      readonly source: MorphSourceId
      readonly target: MorphTargetId
      readonly start: number
      readonly end: number
    }
  | { readonly type: 'clear-morph-source'; readonly source: MorphSourceId }
  | { readonly type: 'tap-master-clock'; readonly nowMs: number }
  | { readonly type: 'set-master-clock'; readonly patch: Partial<MasterClockState> }
  | { readonly type: 'set-transpose'; readonly patch: Partial<TransposeState> }
  | { readonly type: 'panic' }

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function getEffectiveFxChainId(effects: EffectsSectionState, explicit?: FxChainId): FxChainId {
  const target = explicit ?? effects.focusedChain
  if (effects.pianoGroupMode && (target === 'pianoA' || target === 'pianoB')) return 'pianoA'
  if (effects.synthGroupMode && (target === 'synthA' || target === 'synthB' || target === 'synthC')) {
    return 'synthA'
  }
  return target
}

function updateEditableChain(
  effects: EffectsSectionState,
  updater: (chain: EffectChainState) => EffectChainState,
  explicitChain?: FxChainId,
): EffectsSectionState {
  const target = explicitChain ?? effects.focusedChain
  const nextChains = { ...effects.chains }

  if (effects.pianoGroupMode && (target === 'pianoA' || target === 'pianoB')) {
    const updated = updater(effects.chains.pianoA)
    nextChains.pianoA = updated
    nextChains.pianoB = updated
  } else if (
    effects.synthGroupMode &&
    (target === 'synthA' || target === 'synthB' || target === 'synthC')
  ) {
    const updated = updater(effects.chains.synthA)
    nextChains.synthA = updated
    nextChains.synthB = updated
    nextChains.synthC = updated
  } else {
    nextChains[target] = updater(effects.chains[target])
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

/**
 * Syncs current section/layer enables into the active Layer Scene snapshot,
 * and updates `program.dirty` (or auto-stores into the active Live slot in Live Mode).
 */
function finalizeSoundState(
  state: StageInstrumentState,
  syncSceneFromLayers = true,
  storage?: StorageAdapter,
): StageInstrumentState {
  let next = state
  if (syncSceneFromLayers) {
    const snap = snapshotLayerEnables(next.organ, next.piano, next.synth)
    const activeScene = next.scenes.activeScene
    next = {
      ...next,
      scenes:
        activeScene === 'I'
          ? { ...next.scenes, sceneI: snap }
          : { ...next.scenes, sceneII: snap },
    }
  }

  const currentPatch = extractProgramPatch(next)
  if (next.program.mode === 'live') {
    const liveIdx = next.program.activeLiveSlot
    const prevSlot = next.program.liveSlots[liveIdx]
    if (!patchesEqual(prevSlot.patch, currentPatch)) {
      const nextLiveSlots = next.program.liveSlots.map((s, i) =>
        i === liveIdx ? { ...s, patch: currentPatch } : s,
      )
      persistProgramBank(
        { version: 3, programs: next.program.programs, liveSlots: nextLiveSlots },
        storage,
      )
      return {
        ...next,
        program: {
          ...next.program,
          liveSlots: nextLiveSlots,
          dirty: false,
        },
      }
    }
    return { ...next, program: { ...next.program, dirty: false } }
  }

  const storedSlot = next.program.programs[next.program.activeSlot]
  const dirty = !patchesEqual(storedSlot.patch, currentPatch)
  if (dirty === next.program.dirty) return next
  return {
    ...next,
    program: { ...next.program, dirty },
  }
}

function applySceneSnapshot(
  state: StageInstrumentState,
  snap: LayerEnableSnapshot,
  sceneId: LayerSceneId,
): StageInstrumentState {
  return {
    ...state,
    organ: {
      ...state.organ,
      sectionOn: snap.organSectionOn,
      layers: {
        A: { ...state.organ.layers.A, enabled: snap.organA },
        B: { ...state.organ.layers.B, enabled: snap.organB },
      },
    },
    piano: {
      ...state.piano,
      sectionOn: snap.pianoSectionOn,
      layers: {
        A: { ...state.piano.layers.A, enabled: snap.pianoA },
        B: { ...state.piano.layers.B, enabled: snap.pianoB },
      },
    },
    synth: {
      ...state.synth,
      sectionOn: snap.synthSectionOn,
      layers: {
        A: { ...state.synth.layers.A, enabled: snap.synthA },
        B: { ...state.synth.layers.B, enabled: snap.synthB },
        C: { ...state.synth.layers.C, enabled: snap.synthC },
      },
    },
    scenes: {
      ...state.scenes,
      activeScene: sceneId,
    },
  }
}

export function getControlMorphTarget(state: StageInstrumentState, controlId: string): MorphTargetId | null {
  const orgLayer = state.organ.focusedLayer
  const synLayer = state.synth.focusedLayer
  const fxChain = getEffectiveFxChainId(state.effects)

  if (controlId === 'organ-layer-a-fader') return 'organ:A:level'
  if (controlId === 'organ-layer-b-fader') return 'organ:B:level'
  if (controlId.startsWith('organ-drawbar-')) {
    const idx = Number(controlId.slice('organ-drawbar-'.length)) - 1
    if (idx >= 0 && idx <= 8) {
      return `organ:${orgLayer}:drawbar:${idx as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
    }
  }
  if (controlId === 'perf-rotary-speed') return 'rotary:speed'
  if (controlId === 'piano-layer-a-fader') return 'piano:A:level'
  if (controlId === 'piano-layer-b-fader') return 'piano:B:level'
  if (controlId === 'synth-layer-a-fader') return 'synth:A:level'
  if (controlId === 'synth-layer-b-fader') return 'synth:B:level'
  if (controlId === 'synth-layer-c-fader') return 'synth:C:level'
  if (controlId === 'synth-lfo-rate') return `synth:${synLayer}:lfoRate`
  if (controlId === 'synth-osc-ctrl') return `synth:${synLayer}:oscCtrl`
  if (controlId === 'synth-lfo-amt') return `synth:${synLayer}:lfoAmt`
  if (controlId === 'synth-filter-freq') return `synth:${synLayer}:filterFreq`
  if (controlId === 'synth-filter-res') return `synth:${synLayer}:filterRes`
  if (controlId === 'synth-arp-rate') return `synth:${synLayer}:arpRate`
  if (controlId === 'fx-mod1-rate') return `fx:${fxChain}:mod1Rate`
  if (controlId === 'fx-mod1-amount') return `fx:${fxChain}:mod1Amt`
  if (controlId === 'fx-mod2-amount') return `fx:${fxChain}:mod2Amt`
  if (controlId === 'fx-delay-tempo') return `fx:${fxChain}:delayTempo`
  if (controlId === 'fx-delay-feedback') return `fx:${fxChain}:delayFeedback`
  if (controlId === 'fx-delay-dry-wet') return `fx:${fxChain}:delayDryWet`
  if (controlId === 'fx-amp-freq') return `fx:${fxChain}:eqMidFreq`
  if (controlId === 'fx-amp-drive') return `fx:${fxChain}:drive`
  if (controlId === 'fx-reverb-dry-wet') return `fx:${fxChain}:reverbDryWet`
  return null
}

function readMorphTargetBaseValue(state: StageInstrumentState, target: MorphTargetId): number {
  if (target === 'organ:A:level') return state.organ.layers.A.level
  if (target === 'organ:B:level') return state.organ.layers.B.level
  if (target.startsWith('organ:A:drawbar:')) {
    return state.organ.layers.A.drawbars[Number(target.split(':')[3])] ?? 0
  }
  if (target.startsWith('organ:B:drawbar:')) {
    return state.organ.layers.B.drawbars[Number(target.split(':')[3])] ?? 0
  }
  if (target === 'rotary:speed') return state.effects.rotary.speed === 'Fast' ? 1 : 0
  if (target === 'piano:A:level') return state.piano.layers.A.level
  if (target === 'piano:B:level') return state.piano.layers.B.level
  if (target.startsWith('synth:')) {
    const [, layerKey, param] = target.split(':') as ['synth', SynthLayerId, string]
    const layer = state.synth.layers[layerKey]
    if (param === 'level') return layer.level
    if (param === 'lfoRate') return layer.lfo.rate
    if (param === 'oscCtrl') return layer.oscCtrl
    if (param === 'lfoAmt') return layer.lfo.amount
    if (param === 'filterFreq') return layer.filter.freq
    if (param === 'filterRes') return layer.filter.res
    if (param === 'arpRate') return layer.arp.rate
  }
  if (target.startsWith('fx:')) {
    const [, chainKey, param] = target.split(':') as ['fx', FxChainId, string]
    const chain = resolveEffectiveChain(state.effects, chainKey)
    if (param === 'mod1Rate') return chain.mod1.rate
    if (param === 'mod1Amt') return chain.mod1.amount
    if (param === 'mod2Amt') return chain.mod2.amount
    if (param === 'delayTempo') return chain.delay.tempo
    if (param === 'delayFeedback') return chain.delay.feedback
    if (param === 'delayDryWet') return chain.delay.dryWet
    if (param === 'eqMidFreq') return chain.ampEq.midFreq
    if (param === 'drive') return chain.ampEq.drive
    if (param === 'reverbDryWet') return chain.reverb.dryWet
  }
  return 0
}

function selectProgramSlot(
  state: StageInstrumentState,
  slotIndex: number,
): StageInstrumentState {
  const clamped = ((slotIndex % 32) + 32) % 32
  const dest = state.program.programs[clamped]

  // If we are in store-confirm mode, move destination & audition it!
  if (state.program.overlay.kind === 'store-confirm') {
    const auditioned = applyPatchOntoState(state, dest.patch)
    return {
      ...auditioned,
      program: {
        ...state.program,
        overlay: {
          ...state.program.overlay,
          destMode: 'program',
          destSlot: clamped,
        },
        statusNotice: `Audition dest ${Math.floor(clamped / 8) + 1}.${(clamped % 8) + 1}`,
      },
    }
  }

  // Switching programs from an edited state discards edits & saves single-level Undo snapshot
  const undoSnapshot: UndoProgramSnapshot | null = state.program.dirty
    ? {
        mode: state.program.mode,
        slotIndex: state.program.mode === 'live' ? state.program.activeLiveSlot : state.program.activeSlot,
        patch: extractProgramPatch(state),
      }
    : state.program.undoSnapshot

  const loaded = applyPatchOntoState(state, dest.patch)
  return {
    ...loaded,
    program: {
      ...state.program,
      mode: 'program',
      activeSlot: clamped,
      dirty: false,
      undoSnapshot,
      overlay: state.program.overlay.kind === 'list-view' ? { kind: 'none' } : state.program.overlay,
      shiftActive: false,
      morphAssignSource: null,
      soloSection: null,
      statusNotice: null,
    },
  }
}

function selectLiveSlot(
  state: StageInstrumentState,
  liveIndex: number,
): StageInstrumentState {
  const clamped = ((liveIndex % 8) + 8) % 8
  const dest = state.program.liveSlots[clamped]

  if (state.program.overlay.kind === 'store-confirm') {
    const auditioned = applyPatchOntoState(state, dest.patch)
    return {
      ...auditioned,
      program: {
        ...state.program,
        overlay: {
          ...state.program.overlay,
          destMode: 'live',
          destSlot: clamped,
        },
        statusNotice: `Audition Live ${clamped + 1}`,
      },
    }
  }

  const loaded = applyPatchOntoState(state, dest.patch)
  return {
    ...loaded,
    program: {
      ...state.program,
      mode: 'live',
      activeLiveSlot: clamped,
      dirty: false,
      overlay: { kind: 'none' },
      shiftActive: false,
      morphAssignSource: null,
      soloSection: null,
      statusNotice: null,
    },
  }
}

function resolveNumericAction(
  current: number,
  action: Exclude<HardwareAction, { type: 'reset' }>,
  min: number,
  max: number,
  step: number,
): number {
  if (action.type === 'set') return clamp(Math.round(action.value), min, max)
  if (action.type === 'step') return clamp(Math.round(current + action.delta * step), min, max)
  return current + step > max ? min : current + step
}

function isShiftHeld(state: StageInstrumentState): boolean {
  return state.program.shiftActive || state.effects.shiftActive
}

function clearShift(state: StageInstrumentState): StageInstrumentState {
  if (!state.program.shiftActive && !state.effects.shiftActive) return state
  return {
    ...state,
    program: { ...state.program, shiftActive: false },
    effects: { ...state.effects, shiftActive: false },
  }
}

function applySynthEncoder(
  state: StageInstrumentState,
  encoderIndex: 0 | 1 | 2,
  delta: number,
): StageInstrumentState {
  const layerId = state.synth.focusedLayer
  const layer = state.synth.layers[layerId]
  const view = state.synthOledView

  const updateLayer = (patch: Partial<SynthLayerState>): StageInstrumentState =>
    finalizeSoundState({
      ...state,
      synth: {
        ...state.synth,
        layers: {
          ...state.synth.layers,
          [layerId]: { ...layer, ...patch },
        },
      },
    })

  if (view === 'wave') {
    if (encoderIndex === 0) {
      // Category: Pure / Sync / Multi / Super / FM-H
      const curIdx = SYNTH_OSC_CATEGORIES.indexOf(layer.oscCategory)
      const nextIdx = (curIdx + delta + SYNTH_OSC_CATEGORIES.length) % SYNTH_OSC_CATEGORIES.length
      const nextCat = SYNTH_OSC_CATEGORIES[nextIdx]
      const nextWave = SYNTH_WAVEFORMS_BY_CATEGORY[nextCat][0]
      return updateLayer({ oscCategory: nextCat, oscWaveform: nextWave })
    }
    if (encoderIndex === 1) {
      // Waveform within category
      const waves = SYNTH_WAVEFORMS_BY_CATEGORY[layer.oscCategory]
      const curIdx = Math.max(0, waves.indexOf(layer.oscWaveform))
      const nextIdx = (curIdx + delta + waves.length) % waves.length
      return updateLayer({ oscWaveform: waves[nextIdx] })
    }
    // Encoder 2: Coarse pitch in wave view for fast access
    return updateLayer({ pitchCoarse: clamp(layer.pitchCoarse + delta, -24, 24) })
  }

  if (view === 'osc-pitch') {
    if (encoderIndex === 0) {
      return updateLayer({ pitchCoarse: clamp(layer.pitchCoarse + delta, -24, 24) })
    }
    if (encoderIndex === 1) {
      return updateLayer({ pitchFine: clamp(layer.pitchFine + delta * 5, -50, 50) })
    }
    return updateLayer({
      oscEnv: { ...layer.oscEnv, toPitch: !layer.oscEnv.toPitch },
    })
  }

  if (view === 'osc-env') {
    if (encoderIndex === 0) {
      return updateLayer({ oscEnv: { ...layer.oscEnv, attack: clamp(layer.oscEnv.attack + delta * 5, 0, 100) } })
    }
    if (encoderIndex === 1) {
      return updateLayer({ oscEnv: { ...layer.oscEnv, decay: clamp(layer.oscEnv.decay + delta * 5, 0, 100) } })
    }
    return updateLayer({ oscEnv: { ...layer.oscEnv, release: clamp(layer.oscEnv.release + delta * 5, 0, 100) } })
  }

  if (view === 'filter') {
    if (encoderIndex === 0) {
      const idx = SYNTH_FILTER_TYPES.indexOf(layer.filter.type)
      const next = SYNTH_FILTER_TYPES[(idx + delta + SYNTH_FILTER_TYPES.length) % SYNTH_FILTER_TYPES.length]
      return updateLayer({ filter: { ...layer.filter, type: next } })
    }
    if (encoderIndex === 1) {
      const nextTrack = clamp(layer.filter.kbTrack + delta, 0, 3) as 0 | 1 | 2 | 3
      return updateLayer({ filter: { ...layer.filter, kbTrack: nextTrack } })
    }
    const nextDrive = clamp(layer.filter.drive + delta, 0, 3) as 0 | 1 | 2 | 3
    return updateLayer({ filter: { ...layer.filter, drive: nextDrive } })
  }

  if (view === 'filter-env') {
    if (encoderIndex === 0) {
      return updateLayer({ filterEnv: { ...layer.filterEnv, attack: clamp(layer.filterEnv.attack + delta * 5, 0, 100) } })
    }
    if (encoderIndex === 1) {
      return updateLayer({ filterEnv: { ...layer.filterEnv, decay: clamp(layer.filterEnv.decay + delta * 5, 0, 100) } })
    }
    return updateLayer({ filterEnv: { ...layer.filterEnv, release: clamp(layer.filterEnv.release + delta * 5, 0, 100) } })
  }

  if (view === 'amp-env') {
    if (encoderIndex === 0) {
      return updateLayer({ ampEnv: { ...layer.ampEnv, attack: clamp(layer.ampEnv.attack + delta * 5, 0, 100) } })
    }
    if (encoderIndex === 1) {
      return updateLayer({ ampEnv: { ...layer.ampEnv, decay: clamp(layer.ampEnv.decay + delta * 5, 0, 100) } })
    }
    return updateLayer({ ampEnv: { ...layer.ampEnv, release: clamp(layer.ampEnv.release + delta * 5, 0, 100) } })
  }

  if (view === 'arp') {
    if (encoderIndex === 0) {
      const idx = SYNTH_ARP_DIRECTIONS.indexOf(layer.arp.direction)
      const next = SYNTH_ARP_DIRECTIONS[(idx + delta + SYNTH_ARP_DIRECTIONS.length) % SYNTH_ARP_DIRECTIONS.length]
      return updateLayer({ arp: { ...layer.arp, direction: next } })
    }
    if (encoderIndex === 1) {
      return updateLayer({ arp: { ...layer.arp, clockSync: !layer.arp.clockSync } })
    }
    const nextRange = clamp(layer.arp.range + delta, 1, 4) as 1 | 2 | 3 | 4
    return updateLayer({ arp: { ...layer.arp, range: nextRange } })
  }

  // voice-vib
  if (encoderIndex === 0) {
    const nextRate = Number(clamp(layer.vibrato.rateHz + delta * 0.5, 2.0, 8.0).toFixed(1))
    return updateLayer({ vibrato: { ...layer.vibrato, rateHz: nextRate } })
  }
  if (encoderIndex === 1) {
    return updateLayer({ vibrato: { ...layer.vibrato, amount: clamp(layer.vibrato.amount + delta, 0, 10) } })
  }
  const priIdx = SYNTH_NOTE_PRIORITIES.indexOf(layer.voice.priority)
  const nextPri = SYNTH_NOTE_PRIORITIES[(priIdx + delta + SYNTH_NOTE_PRIORITIES.length) % SYNTH_NOTE_PRIORITIES.length]
  return updateLayer({ voice: { ...layer.voice, priority: nextPri } })
}

function applyPanelControlAction(
  state: StageInstrumentState,
  action: Exclude<HardwareAction, { type: 'reset' }>,
): StageInstrumentState {
  const id = action.id
  const spec = PANEL_CONTROL_BY_ID[id]
  if (!spec) return state

  const shift = isShiftHeld(state)

  // ===================== MORPH ASSIGN INTERCEPTION =====================
  // While holding/latching a Morph Assign source button (Wheel / Control Pedal),
  // moving any morphable destination control assigns/updates/clears its [start, end] morph range.
  if (
    state.program.morphAssignSource &&
    id !== 'program-morph-wheel' &&
    id !== 'program-morph-ctrlped' &&
    id !== 'program-shift' &&
    id !== 'fx-shift'
  ) {
    const morphTarget = getControlMorphTarget(state, id)
    if (morphTarget) {
      const source = state.program.morphAssignSource
      const bounds = getMorphTargetMinMax(morphTarget)
      const baseVal = readMorphTargetBaseValue(state, morphTarget)
      const existing = state.morphs[source].find((a) => a.target === morphTarget)
      const curEnd = existing ? existing.end : baseVal
      let nextEnd = curEnd
      if (morphTarget === 'rotary:speed') {
        nextEnd = curEnd === baseVal ? (baseVal === 0 ? 1 : 0) : baseVal
      } else {
        nextEnd = resolveNumericAction(curEnd, action, bounds.min, bounds.max, spec.step)
      }
      const nextMorphs = upsertMorphAssignment(state.morphs, source, morphTarget, baseVal, nextEnd)
      return finalizeSoundState({ ...state, morphs: nextMorphs }, false)
    }
  }

  // ===================== 1. PERFORMANCE =====================
  if (id === 'perf-master-level') {
    const next = resolveNumericAction(state.masterLevel, action, 0, 100, spec.step)
    return { ...state, masterLevel: next }
  }

  if (id === 'perf-pitch-stick') {
    const next = resolveNumericAction(state.pitchStick, action, -100, 100, spec.step)
    return { ...state, pitchStick: next }
  }

  if (id === 'perf-mod-wheel') {
    const next = resolveNumericAction(state.modWheel, action, 0, 100, spec.step)
    return { ...state, modWheel: next }
  }

  if (id === 'perf-rotary-drive') {
    const next = resolveNumericAction(state.effects.rotary.drive, action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: { ...state.effects, rotary: { ...state.effects.rotary, drive: next } } },
      false,
    )
  }

  if (id === 'perf-rotary-drive-on') {
    const nextOn = !state.effects.rotary.driveOn
    const nextOrganRouted = shift ? !(state.effects.rotary.organRouted ?? true) : nextOn
    return finalizeSoundState(
      clearShift({
        ...state,
        effects: {
          ...state.effects,
          rotary: {
            ...state.effects.rotary,
            driveOn: shift ? state.effects.rotary.driveOn : nextOn,
            organRouted: nextOrganRouted,
          },
        },
      }),
      false,
    )
  }

  if (id === 'perf-rotary-stop') {
    return finalizeSoundState(
      {
        ...state,
        effects: {
          ...state.effects,
          rotary: { ...state.effects.rotary, stopMode: !state.effects.rotary.stopMode },
        },
      },
      false,
    )
  }

  if (id === 'perf-rotary-speed') {
    const nextSpeed = state.effects.rotary.speed === 'Fast' ? 'Slow' : 'Fast'
    return finalizeSoundState(
      {
        ...state,
        effects: {
          ...state.effects,
          rotary: { ...state.effects.rotary, speed: nextSpeed, stopMode: false },
        },
      },
      false,
    )
  }

  // ===================== 2. ORGAN SECTION =====================
  const focusedOrgId = state.organ.focusedLayer
  const focusedOrg = state.organ.layers[focusedOrgId]
  const updateFocusedOrg = (patch: Partial<OrganLayerState>): StageInstrumentState =>
    finalizeSoundState({
      ...state,
      organ: {
        ...state.organ,
        layers: {
          ...state.organ.layers,
          [focusedOrgId]: { ...focusedOrg, ...patch },
        },
      },
    })

  if (id === 'organ-section-on') {
    const nextOn = !state.organ.sectionOn
    return finalizeSoundState({
      ...state,
      organ: { ...state.organ, sectionOn: nextOn },
      effects: nextOn ? { ...state.effects, focusedChain: 'organ' } : state.effects,
    })
  }

  if (id === 'organ-layer-a-fader' || id === 'organ-layer-b-fader') {
    const layerId: OrganLayerId = id === 'organ-layer-a-fader' ? 'A' : 'B'
    const cur = state.organ.layers[layerId].level
    const next = resolveNumericAction(cur, action, 0, 100, spec.step)
    return finalizeSoundState(
      {
        ...state,
        organ: {
          ...state.organ,
          focusedLayer: layerId,
          layers: {
            ...state.organ.layers,
            [layerId]: { ...state.organ.layers[layerId], level: next },
          },
        },
        effects: { ...state.effects, focusedChain: 'organ' },
      },
      false,
    )
  }

  if (id === 'organ-layer-a-on' || id === 'organ-layer-b-on') {
    const layerId: OrganLayerId = id === 'organ-layer-a-on' ? 'A' : 'B'
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          organ:
            layerId === 'A'
              ? { ...state.organ, sustped: !state.organ.sustped }
              : { ...state.organ, pstick: !state.organ.pstick },
        }),
        false,
      )
    }
    const target = state.organ.layers[layerId]
    const nextEnabled = !target.enabled
    const nextFocus: OrganLayerId = nextEnabled
      ? layerId
      : state.organ.layers[layerId === 'A' ? 'B' : 'A'].enabled
        ? layerId === 'A'
          ? 'B'
          : 'A'
        : layerId
    return finalizeSoundState({
      ...state,
      organ: {
        ...state.organ,
        focusedLayer: nextFocus,
        layers: {
          ...state.organ.layers,
          [layerId]: { ...target, enabled: nextEnabled },
        },
      },
      effects: { ...state.effects, focusedChain: 'organ' },
    })
  }

  if (id === 'organ-octave-down' || id === 'organ-octave-up') {
    if (shift) {
      const nextZone = cycleLayerZone(focusedOrg.zone, state.split, id === 'organ-octave-up' ? 1 : -1)
      return finalizeSoundState(
        clearShift({
          ...state,
          organ: {
            ...state.organ,
            layers: { ...state.organ.layers, [focusedOrgId]: { ...focusedOrg, zone: nextZone } },
          },
        }),
        false,
      )
    }
    const delta = id === 'organ-octave-up' ? 1 : -1
    const nextOct = clamp(focusedOrg.octave + delta, -1, 1) as -1 | 0 | 1
    return updateFocusedOrg({ octave: nextOct })
  }

  if (id === 'organ-model-select') {
    const curIdx = ORGAN_MODELS.indexOf(focusedOrg.model)
    const nextIdx = (curIdx + 1) % ORGAN_MODELS.length
    return updateFocusedOrg({ model: ORGAN_MODELS[nextIdx] })
  }

  if (id === 'organ-vib-type') {
    const curIdx = ORGAN_VIB_CHORUS_TYPES.indexOf(focusedOrg.vibChorusType)
    const nextIdx = (curIdx + 1) % ORGAN_VIB_CHORUS_TYPES.length
    return updateFocusedOrg({ vibChorusType: ORGAN_VIB_CHORUS_TYPES[nextIdx] })
  }

  if (id === 'organ-vib-on') {
    return updateFocusedOrg({ vibChorusOn: !focusedOrg.vibChorusOn })
  }

  if (id === 'organ-perc-soft') {
    return updateFocusedOrg({
      percussion: { ...focusedOrg.percussion, soft: !focusedOrg.percussion.soft },
    })
  }
  if (id === 'organ-perc-fast') {
    return updateFocusedOrg({
      percussion: { ...focusedOrg.percussion, fast: !focusedOrg.percussion.fast },
    })
  }
  if (id === 'organ-perc-third') {
    return updateFocusedOrg({
      percussion: { ...focusedOrg.percussion, third: !focusedOrg.percussion.third },
    })
  }
  if (id === 'organ-perc-on') {
    return updateFocusedOrg({
      percussion: { ...focusedOrg.percussion, on: !focusedOrg.percussion.on },
    })
  }

  if (id.startsWith('organ-drawbar-')) {
    const idx = Number(id.slice('organ-drawbar-'.length)) - 1
    if (idx >= 0 && idx <= 8) {
      const cur = focusedOrg.drawbars[idx]
      const next = resolveNumericAction(cur, action, 0, 8, 1)
      const nextBars = [...focusedOrg.drawbars]
      nextBars[idx] = next
      return updateFocusedOrg({ drawbars: nextBars as unknown as DrawbarTuple })
    }
  }

  // ===================== 3. PIANO SECTION =====================
  const focusedPianoId = state.piano.focusedLayer
  const focusedPiano = state.piano.layers[focusedPianoId]
  const updateFocusedPiano = (patch: Partial<PianoLayerState>): StageInstrumentState =>
    finalizeSoundState({
      ...state,
      piano: {
        ...state.piano,
        layers: {
          ...state.piano.layers,
          [focusedPianoId]: { ...focusedPiano, ...patch },
        },
      },
    })

  if (id === 'piano-section-on') {
    const nextOn = !state.piano.sectionOn
    return finalizeSoundState({
      ...state,
      piano: { ...state.piano, sectionOn: nextOn },
      effects: nextOn
        ? { ...state.effects, focusedChain: state.piano.focusedLayer === 'A' ? 'pianoA' : 'pianoB' }
        : state.effects,
    })
  }

  if (id === 'piano-layer-a-fader' || id === 'piano-layer-b-fader') {
    const layerId: PianoLayerId = id === 'piano-layer-a-fader' ? 'A' : 'B'
    const cur = state.piano.layers[layerId].level
    const next = resolveNumericAction(cur, action, 0, 100, spec.step)
    return finalizeSoundState(
      {
        ...state,
        piano: {
          ...state.piano,
          focusedLayer: layerId,
          layers: {
            ...state.piano.layers,
            [layerId]: { ...state.piano.layers[layerId], level: next },
          },
        },
        effects: {
          ...state.effects,
          focusedChain: layerId === 'A' ? 'pianoA' : 'pianoB',
        },
      },
      false,
    )
  }

  if (id === 'piano-layer-a-on' || id === 'piano-layer-b-on') {
    const layerId: PianoLayerId = id === 'piano-layer-a-on' ? 'A' : 'B'
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          piano:
            layerId === 'A'
              ? { ...state.piano, sustped: !state.piano.sustped }
              : { ...state.piano, pstick: !state.piano.pstick },
        }),
        false,
      )
    }
    const target = state.piano.layers[layerId]
    const nextEnabled = !target.enabled
    const nextFocus: PianoLayerId = nextEnabled
      ? layerId
      : state.piano.layers[layerId === 'A' ? 'B' : 'A'].enabled
        ? layerId === 'A'
          ? 'B'
          : 'A'
        : layerId
    return finalizeSoundState({
      ...state,
      piano: {
        ...state.piano,
        focusedLayer: nextFocus,
        layers: {
          ...state.piano.layers,
          [layerId]: { ...target, enabled: nextEnabled },
        },
      },
      effects: {
        ...state.effects,
        focusedChain: nextFocus === 'A' ? 'pianoA' : 'pianoB',
      },
    })
  }

  if (id === 'piano-sustped') {
    return finalizeSoundState(
      { ...state, piano: { ...state.piano, sustped: !state.piano.sustped } },
      false,
    )
  }

  if (id === 'piano-pstick') {
    return finalizeSoundState(
      { ...state, piano: { ...state.piano, pstick: !state.piano.pstick } },
      false,
    )
  }

  if (id === 'piano-octave-down' || id === 'piano-octave-up') {
    if (shift) {
      const nextZone = cycleLayerZone(
        focusedPiano.zone,
        state.split,
        id === 'piano-octave-up' ? 1 : -1,
      )
      return finalizeSoundState(
        clearShift({
          ...state,
          piano: {
            ...state.piano,
            layers: {
              ...state.piano.layers,
              [focusedPianoId]: { ...focusedPiano, zone: nextZone },
            },
          },
        }),
        false,
      )
    }
    const delta = id === 'piano-octave-up' ? 1 : -1
    const nextOct = clamp(focusedPiano.octave + delta, -1, 1) as -1 | 0 | 1
    return updateFocusedPiano({ octave: nextOct })
  }

  if (id === 'piano-type-select') {
    const curIdx = PIANO_TYPES.indexOf(focusedPiano.type)
    const nextIdx =
      action.type === 'set'
        ? clamp(Math.round(action.value), 0, PIANO_TYPES.length - 1)
        : (curIdx + (action.type === 'step' ? action.delta : 1) + PIANO_TYPES.length) %
          PIANO_TYPES.length
    const nextType = PIANO_TYPES[nextIdx]
    const availTimbres = getAvailableTimbres(nextType)
    const nextTimbre = availTimbres.includes(focusedPiano.timbre) ? focusedPiano.timbre : 'Off'
    return updateFocusedPiano({
      type: nextType,
      modelIndex: 0,
      timbre: nextTimbre,
      softRelease: nextType === 'Clav' ? false : focusedPiano.softRelease,
    })
  }

  if (id === 'piano-model-dial') {
    const models = PIANO_MODELS_BY_TYPE[focusedPiano.type]
    if (models.length <= 1) return state
    let nextModelIdx = focusedPiano.modelIndex
    if (action.type === 'step') {
      const dir = action.delta >= 0 ? 1 : -1
      nextModelIdx = (focusedPiano.modelIndex + dir + models.length) % models.length
    } else if (action.type === 'set') {
      nextModelIdx = clamp(Math.round((action.value / 100) * (models.length - 1)), 0, models.length - 1)
    } else {
      nextModelIdx = (focusedPiano.modelIndex + 1) % models.length
    }
    return updateFocusedPiano({ modelIndex: nextModelIdx })
  }

  if (id === 'piano-timbre') {
    const available = getAvailableTimbres(focusedPiano.type)
    const curIdx = Math.max(0, available.indexOf(focusedPiano.timbre))
    const nextIdx = (curIdx + 1) % available.length
    return updateFocusedPiano({ timbre: available[nextIdx] })
  }

  if (id === 'piano-acoustics') {
    const curCode = (focusedPiano.softRelease ? 1 : 0) + (focusedPiano.stringRes ? 2 : 0)
    const nextCode =
      focusedPiano.type === 'Clav' ? (focusedPiano.stringRes ? 0 : 2) : (curCode + 1) % 4
    return updateFocusedPiano({
      softRelease: focusedPiano.type === 'Clav' ? false : (nextCode & 1) !== 0,
      stringRes: (nextCode & 2) !== 0,
    })
  }

  if (id === 'piano-unison') {
    const next = ((focusedPiano.unison + 1) % 4) as UnisonLevel
    return updateFocusedPiano({ unison: next })
  }

  if (id === 'piano-kb-touch') {
    const curIdx = KB_TOUCH_CURVES.indexOf(focusedPiano.kbTouch)
    const nextIdx = (curIdx + 1) % KB_TOUCH_CURVES.length
    return updateFocusedPiano({ kbTouch: KB_TOUCH_CURVES[nextIdx] })
  }

  if (id === 'piano-dyn-comp') {
    const next = ((focusedPiano.dynComp + 1) % 4) as DynCompLevel
    return updateFocusedPiano({ dynComp: next })
  }

  // ===================== 4. PROGRAM & MORPH SECTION =====================
  if (id === 'program-shift') {
    // Shift/Exit cancels any open overlay or morph-assign mode; otherwise toggles Shift
    if (state.program.overlay.kind !== 'none' || state.program.morphAssignSource !== null) {
      let restored = state
      if (state.program.overlay.kind === 'store-confirm' || state.program.overlay.kind === 'store-as-name') {
        restored = applyPatchOntoState(state, state.program.overlay.sourcePatch)
      }
      return {
        ...restored,
        program: {
          ...restored.program,
          overlay: { kind: 'none' },
          morphAssignSource: null,
          shiftActive: false,
          statusNotice: null,
        },
        effects: { ...restored.effects, shiftActive: false },
      }
    }
    const nextShift = !state.program.shiftActive
    return {
      ...state,
      program: { ...state.program, shiftActive: nextShift },
      effects: { ...state.effects, shiftActive: nextShift },
    }
  }

  if (id === 'program-morph-wheel' || id === 'program-morph-ctrlped') {
    const source: MorphSourceId = id === 'program-morph-wheel' ? 'wheel' : 'controlPedal'
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          morphs: clearMorphSource(state.morphs, source),
          program: {
            ...state.program,
            morphAssignSource: null,
            statusNotice: `Cleared ${source === 'wheel' ? 'Wheel' : 'Ctrl Pedal'} morphs`,
          },
        }),
        false,
      )
    }
    const nextSource = state.program.morphAssignSource === source ? null : source
    return {
      ...state,
      program: {
        ...state.program,
        morphAssignSource: nextSource,
        statusNotice: nextSource
          ? `Morph Assign: ${source === 'wheel' ? 'WHL' : 'PED'} (move target)`
          : null,
      },
    }
  }

  if (id === 'program-split') {
    if (shift) {
      return clearShift({
        ...state,
        split: state.split.enabled
          ? state.split
          : {
              ...state.split,
              enabled: true,
              points: {
                ...state.split.points,
                mid: { ...state.split.points.mid, active: true },
              },
            },
        program: {
          ...state.program,
          overlay:
            state.program.overlay.kind === 'split-edit'
              ? { kind: 'none' }
              : { kind: 'split-edit', activePoint: 'mid' },
        },
      })
    }
    const nextEnabled = !state.split.enabled
    return finalizeSoundState(
      {
        ...state,
        split: {
          ...state.split,
          enabled: nextEnabled,
          points: nextEnabled
            ? {
                ...state.split.points,
                mid: {
                  ...state.split.points.mid,
                  active:
                    state.split.points.low.active ||
                    state.split.points.mid.active ||
                    state.split.points.high.active
                      ? state.split.points.mid.active
                      : true,
                },
              }
            : state.split.points,
        },
        program: {
          ...state.program,
          overlay: nextEnabled ? state.program.overlay : { kind: 'none' },
        },
      },
      false,
    )
  }

  if (id === 'program-mst-clk') {
    if (shift) {
      return clearShift({
        ...state,
        program: {
          ...state.program,
          overlay:
            state.program.overlay.kind === 'clock-edit'
              ? { kind: 'none' }
              : { kind: 'clock-edit' },
        },
      })
    }
    // Tap tempo: 4+ taps sets Master Clock BPM (30..300)
    const nowMs = Date.now()
    return instrumentStateReducer(state, { type: 'tap-master-clock', nowMs })
  }

  if (id === 'program-transpose') {
    if (shift) {
      // Shift + Transpose = PANIC (All Notes Off + reset performance inputs, manual p. 40)
      return instrumentStateReducer(clearShift(state), { type: 'panic' })
    }
    const nextEnabled = !state.transpose.enabled
    return finalizeSoundState(
      {
        ...state,
        transpose: { ...state.transpose, enabled: nextEnabled },
        program: {
          ...state.program,
          overlay: nextEnabled ? { kind: 'transpose-edit' } : { kind: 'none' },
        },
      },
      false,
    )
  }

  if (id === 'program-store') {
    if (shift) {
      return instrumentStateReducer(clearShift(state), { type: 'start-store-as' })
    }
    if (state.program.overlay.kind === 'store-confirm') {
      return instrumentStateReducer(state, { type: 'confirm-store' })
    }
    if (state.program.overlay.kind === 'store-as-name') {
      return instrumentStateReducer(state, { type: 'advance-store-as-to-confirm' })
    }
    return instrumentStateReducer(state, { type: 'start-store' })
  }

  if (id === 'program-prog-view') {
    return {
      ...state,
      program: {
        ...state.program,
        overlay:
          state.program.overlay.kind === 'list-view'
            ? { kind: 'none' }
            : { kind: 'list-view', selectedIndex: state.program.activeSlot },
      },
    }
  }

  if (id === 'program-dial') {
    const dir =
      action.type === 'step'
        ? action.delta >= 0
          ? 1
          : -1
        : action.type === 'set'
          ? action.value >= (state.decorative['program-dial'] ?? 50)
            ? 1
            : -1
          : 1

    if (shift) {
      return clearShift({
        ...state,
        program: {
          ...state.program,
          overlay: { kind: 'list-view', selectedIndex: state.program.activeSlot },
        },
      })
    }

    const overlay = state.program.overlay
    if (overlay.kind === 'list-view') {
      const nextIdx = (overlay.selectedIndex + dir + 32) % 32
      return selectProgramSlot(
        {
          ...state,
          program: { ...state.program, overlay: { kind: 'list-view', selectedIndex: nextIdx } },
        },
        nextIdx,
      )
    }

    if (overlay.kind === 'store-confirm') {
      if (overlay.destMode === 'live') {
        return selectLiveSlot(state, overlay.destSlot + dir)
      }
      return selectProgramSlot(state, overlay.destSlot + dir)
    }

    if (overlay.kind === 'split-edit') {
      const pt = state.split.points[overlay.activePoint]
      const idx = SPLIT_POSITION_NOTES.indexOf(pt.note)
      const nextNote = SPLIT_POSITION_NOTES[clamp(idx + dir, 0, SPLIT_POSITION_NOTES.length - 1)]
      return instrumentStateReducer(state, {
        type: 'set-split-point',
        point: overlay.activePoint,
        patch: { active: true, note: nextNote },
      })
    }

    if (overlay.kind === 'clock-edit') {
      return instrumentStateReducer(state, {
        type: 'set-master-clock',
        patch: { bpm: clamp(state.masterClock.bpm + dir, 30, 300) },
      })
    }

    if (overlay.kind === 'transpose-edit') {
      return instrumentStateReducer(state, {
        type: 'set-transpose',
        patch: { enabled: true, semitones: clamp(state.transpose.semitones + dir, -6, 6) },
      })
    }

    if (state.program.mode === 'live') {
      return selectLiveSlot(state, state.program.activeLiveSlot + dir)
    }
    return selectProgramSlot(state, state.program.activeSlot + dir)
  }

  if (id === 'program-page-prev' || id === 'program-page-next') {
    const delta = id === 'program-page-next' ? 1 : -1
    const overlay = state.program.overlay
    if (overlay.kind === 'split-edit') {
      const order: readonly SplitPointId[] = ['low', 'mid', 'high']
      const nextPt = order[(order.indexOf(overlay.activePoint) + delta + 3) % 3]
      return {
        ...state,
        program: { ...state.program, overlay: { kind: 'split-edit', activePoint: nextPt } },
      }
    }
    if (overlay.kind === 'clock-edit') {
      return instrumentStateReducer(state, {
        type: 'set-master-clock',
        patch: { kbSync: !state.masterClock.kbSync },
      })
    }
    if (overlay.kind === 'store-confirm' && overlay.destMode === 'program') {
      const page = Math.floor(overlay.destSlot / 8)
      const btn = overlay.destSlot % 8
      const nextPage = (page + delta + 4) % 4
      return selectProgramSlot(state, nextPage * 8 + btn)
    }
    const page = Math.floor(state.program.activeSlot / 8)
    const btn = state.program.activeSlot % 8
    const nextPage = (page + delta + 4) % 4
    return selectProgramSlot(state, nextPage * 8 + btn)
  }

  if (id === 'program-solo') {
    if (shift) {
      return instrumentStateReducer(clearShift(state), { type: 'undo-program-change' })
    }
    const focusedSection: 'organ' | 'piano' | 'synth' =
      state.effects.focusedChain === 'organ'
        ? 'organ'
        : state.effects.focusedChain.startsWith('synth')
          ? 'synth'
          : 'piano'
    const nextSolo = state.program.soloSection === focusedSection ? null : focusedSection
    return {
      ...state,
      program: { ...state.program, soloSection: nextSolo },
    }
  }

  if (id === 'program-live-mode') {
    return instrumentStateReducer(state, { type: 'toggle-live-mode' })
  }

  if (id === 'program-layer-scene') {
    return instrumentStateReducer(state, { type: 'switch-scene' })
  }

  if (id.startsWith('program-btn-')) {
    const btnNum = Number(id.slice('program-btn-'.length))
    if (btnNum >= 1 && btnNum <= 8) {
      if (state.program.overlay.kind === 'store-confirm') {
        if (state.program.overlay.destMode === 'live') {
          return selectLiveSlot(state, btnNum - 1)
        }
        const page = Math.floor(state.program.overlay.destSlot / 8)
        return selectProgramSlot(state, page * 8 + (btnNum - 1))
      }
      if (state.program.mode === 'live') {
        return selectLiveSlot(state, btnNum - 1)
      }
      const page = Math.floor(state.program.activeSlot / 8)
      return selectProgramSlot(state, page * 8 + (btnNum - 1))
    }
  }

  // ===================== 5. SYNTH SECTION =====================
  const focusedSynId = state.synth.focusedLayer
  const focusedSyn = state.synth.layers[focusedSynId]
  const updateFocusedSyn = (patch: Partial<SynthLayerState>): StageInstrumentState =>
    finalizeSoundState({
      ...state,
      synth: {
        ...state.synth,
        layers: {
          ...state.synth.layers,
          [focusedSynId]: { ...focusedSyn, ...patch },
        },
      },
    })

  if (id === 'synth-section-on') {
    const nextOn = !state.synth.sectionOn
    return finalizeSoundState({
      ...state,
      synth: { ...state.synth, sectionOn: nextOn },
      effects: nextOn
        ? { ...state.effects, focusedChain: (`synth${state.synth.focusedLayer}` as FxChainId) }
        : state.effects,
    })
  }

  if (id === 'synth-layer-a-fader' || id === 'synth-layer-b-fader' || id === 'synth-layer-c-fader') {
    const layerId: SynthLayerId =
      id === 'synth-layer-a-fader' ? 'A' : id === 'synth-layer-b-fader' ? 'B' : 'C'
    const cur = state.synth.layers[layerId].level
    const next = resolveNumericAction(cur, action, 0, 100, spec.step)
    return finalizeSoundState(
      {
        ...state,
        synth: {
          ...state.synth,
          focusedLayer: layerId,
          layers: {
            ...state.synth.layers,
            [layerId]: { ...state.synth.layers[layerId], level: next },
          },
        },
        effects: { ...state.effects, focusedChain: (`synth${layerId}` as FxChainId) },
      },
      false,
    )
  }

  if (id === 'synth-layer-a-on' || id === 'synth-layer-b-on' || id === 'synth-layer-c-on') {
    const layerId: SynthLayerId =
      id === 'synth-layer-a-on' ? 'A' : id === 'synth-layer-b-on' ? 'B' : 'C'
    if (shift && layerId !== 'C') {
      return finalizeSoundState(
        clearShift({
          ...state,
          synth:
            layerId === 'A'
              ? { ...state.synth, sustped: !state.synth.sustped }
              : { ...state.synth, pstick: !state.synth.pstick },
        }),
        false,
      )
    }
    const target = state.synth.layers[layerId]
    const nextEnabled = !target.enabled
    let nextFocus: SynthLayerId = layerId
    if (!nextEnabled) {
      const other = (['A', 'B', 'C'] as const).find(
        (k) => k !== layerId && state.synth.layers[k].enabled,
      )
      if (other) nextFocus = other
    }
    return finalizeSoundState({
      ...state,
      synth: {
        ...state.synth,
        focusedLayer: nextFocus,
        layers: {
          ...state.synth.layers,
          [layerId]: { ...target, enabled: nextEnabled },
        },
      },
      effects: { ...state.effects, focusedChain: (`synth${nextFocus}` as FxChainId) },
    })
  }

  if (id === 'synth-kb-hold') {
    return updateFocusedSyn({ arp: { ...focusedSyn.arp, kbHold: !focusedSyn.arp.kbHold } })
  }

  if (id === 'synth-arp-run') {
    return updateFocusedSyn({ arp: { ...focusedSyn.arp, run: !focusedSyn.arp.run } })
  }

  if (id === 'synth-octave-down' || id === 'synth-octave-up') {
    if (shift) {
      const nextZone = cycleLayerZone(
        focusedSyn.zone,
        state.split,
        id === 'synth-octave-up' ? 1 : -1,
      )
      return finalizeSoundState(
        clearShift({
          ...state,
          synth: {
            ...state.synth,
            layers: { ...state.synth.layers, [focusedSynId]: { ...focusedSyn, zone: nextZone } },
          },
        }),
        false,
      )
    }
    const delta = id === 'synth-octave-up' ? 1 : -1
    const nextOct = clamp(focusedSyn.octave + delta, -1, 1) as -1 | 0 | 1
    return updateFocusedSyn({ octave: nextOct })
  }

  if (id === 'synth-enc-type' || id === 'synth-enc-cat' || id === 'synth-enc-wave') {
    const encIdx = id === 'synth-enc-type' ? 0 : id === 'synth-enc-cat' ? 1 : 2
    const delta =
      action.type === 'step'
        ? action.delta >= 0
          ? 1
          : -1
        : action.type === 'set'
          ? action.value >= (state.decorative[id] ?? 50)
            ? 1
            : -1
          : 1
    const nextDeco = hardwareStateReducer(state.decorative, action)
    return applySynthEncoder({ ...state, decorative: nextDeco }, encIdx, delta)
  }

  if (id === 'synth-mode') {
    const curIdx = SYNTH_MODES.indexOf(focusedSyn.mode)
    const nextMode = SYNTH_MODES[(curIdx + 1) % SYNTH_MODES.length]
    return updateFocusedSyn({ mode: nextMode })
  }

  if (id === 'synth-waveform-btn') {
    if (shift) {
      // Optional Sound Init for focused Synth layer
      const initLayer = createDefaultSynthLayer(focusedSynId, { enabled: focusedSyn.enabled })
      return finalizeSoundState(
        clearShift({
          ...state,
          synthOledView: 'wave',
          synth: {
            ...state.synth,
            layers: { ...state.synth.layers, [focusedSynId]: initLayer },
          },
        }),
        false,
      )
    }
    return { ...state, synthOledView: 'wave' }
  }

  if (id === 'synth-arp-rate') {
    const next = resolveNumericAction(focusedSyn.arp.rate, action, 0, 100, spec.step)
    return updateFocusedSyn({ arp: { ...focusedSyn.arp, rate: next } })
  }

  if (id === 'synth-arp-mode') {
    const curIdx = SYNTH_ARP_MODES.indexOf(focusedSyn.arp.mode)
    const nextMode = SYNTH_ARP_MODES[(curIdx + 1) % SYNTH_ARP_MODES.length]
    return updateFocusedSyn({ arp: { ...focusedSyn.arp, mode: nextMode } })
  }

  if (id === 'synth-arp-range') {
    if (focusedSyn.arp.mode === 'Gate') {
      const nextGate = resolveNumericAction(focusedSyn.arp.gateEnv, action, 0, 100, spec.step)
      return updateFocusedSyn({ arp: { ...focusedSyn.arp, gateEnv: nextGate } })
    }
    const curVal = ((focusedSyn.arp.range - 1) / 3) * 100
    const nextVal = resolveNumericAction(curVal, action, 0, 100, 34)
    const nextRange = clamp(Math.round((nextVal / 100) * 3) + 1, 1, 4) as 1 | 2 | 3 | 4
    return updateFocusedSyn({ arp: { ...focusedSyn.arp, range: nextRange } })
  }

  if (id === 'synth-arp-menu') {
    if (state.synthOledView === 'arp') {
      // Pressing Arp Menu again cycles direction directly for fast accessibility
      const idx = SYNTH_ARP_DIRECTIONS.indexOf(focusedSyn.arp.direction)
      const nextDir = SYNTH_ARP_DIRECTIONS[(idx + 1) % SYNTH_ARP_DIRECTIONS.length]
      return updateFocusedSyn({ arp: { ...focusedSyn.arp, direction: nextDir } })
    }
    return { ...state, synthOledView: 'arp' }
  }

  if (id === 'synth-voice-mode') {
    const curIdx = SYNTH_VOICE_MODES.indexOf(focusedSyn.voice.mode)
    const nextMode = SYNTH_VOICE_MODES[(curIdx + 1) % SYNTH_VOICE_MODES.length]
    return updateFocusedSyn({ voice: { ...focusedSyn.voice, mode: nextMode } })
  }

  if (id === 'synth-voice-glide') {
    const next = resolveNumericAction(focusedSyn.voice.glide, action, 0, 100, spec.step)
    return updateFocusedSyn({ voice: { ...focusedSyn.voice, glide: next } })
  }

  if (id === 'synth-vibrato-mode') {
    const curIdx = SYNTH_VIBRATO_MODES.indexOf(focusedSyn.vibrato.mode)
    const nextMode = SYNTH_VIBRATO_MODES[(curIdx + 1) % SYNTH_VIBRATO_MODES.length]
    return updateFocusedSyn({ vibrato: { ...focusedSyn.vibrato, mode: nextMode } })
  }

  if (id === 'synth-vibrato-menu') {
    return { ...state, synthOledView: state.synthOledView === 'voice-vib' ? 'wave' : 'voice-vib' }
  }

  if (id === 'synth-lfo-wave') {
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          synth: {
            ...state.synth,
            layers: {
              ...state.synth.layers,
              [focusedSynId]: {
                ...focusedSyn,
                lfo: { ...focusedSyn.lfo, clockSync: !focusedSyn.lfo.clockSync },
              },
            },
          },
        }),
        false,
      )
    }
    const idx = SYNTH_LFO_WAVEFORMS.indexOf(focusedSyn.lfo.waveform)
    const nextWave = SYNTH_LFO_WAVEFORMS[(idx + 1) % SYNTH_LFO_WAVEFORMS.length]
    return updateFocusedSyn({ lfo: { ...focusedSyn.lfo, waveform: nextWave } })
  }

  if (id === 'synth-lfo-amt') {
    const next = resolveNumericAction(focusedSyn.lfo.amount, action, 0, 100, spec.step)
    return updateFocusedSyn({ lfo: { ...focusedSyn.lfo, amount: next } })
  }

  if (id === 'synth-lfo-rate') {
    const next = resolveNumericAction(focusedSyn.lfo.rate, action, 0, 100, spec.step)
    return updateFocusedSyn({ lfo: { ...focusedSyn.lfo, rate: next } })
  }

  if (id === 'synth-lfo-dest') {
    const idx = SYNTH_LFO_DESTINATIONS.indexOf(focusedSyn.lfo.destination)
    const nextDest = SYNTH_LFO_DESTINATIONS[(idx + 1) % SYNTH_LFO_DESTINATIONS.length]
    return updateFocusedSyn({ lfo: { ...focusedSyn.lfo, destination: nextDest } })
  }

  if (id === 'synth-osc-pitch') {
    if (state.synthOledView === 'osc-pitch') {
      return updateFocusedSyn({ oscEnv: { ...focusedSyn.oscEnv, toPitch: !focusedSyn.oscEnv.toPitch } })
    }
    return { ...state, synthOledView: 'osc-pitch' }
  }

  if (id === 'synth-osc-env') {
    if (state.synthOledView === 'osc-env') {
      return updateFocusedSyn({ oscEnv: { ...focusedSyn.oscEnv, velocity: !focusedSyn.oscEnv.velocity } })
    }
    return { ...state, synthOledView: 'osc-env' }
  }

  if (id === 'synth-osc-ctrl') {
    const next = resolveNumericAction(focusedSyn.oscCtrl, action, 0, 100, spec.step)
    return updateFocusedSyn({ oscCtrl: next })
  }

  if (id === 'synth-osc-env-amt') {
    const next = resolveNumericAction(focusedSyn.oscEnv.amount, action, 0, 100, spec.step)
    return updateFocusedSyn({ oscEnv: { ...focusedSyn.oscEnv, amount: next } })
  }

  if (id === 'synth-filter-type') {
    if (shift) {
      return clearShift({ ...state, synthOledView: 'filter' })
    }
    const idx = SYNTH_FILTER_TYPES.indexOf(focusedSyn.filter.type)
    const nextType = SYNTH_FILTER_TYPES[(idx + 1) % SYNTH_FILTER_TYPES.length]
    return {
      ...updateFocusedSyn({ filter: { ...focusedSyn.filter, type: nextType } }),
      synthOledView: 'filter',
    }
  }

  if (id === 'synth-filter-env') {
    if (state.synthOledView === 'filter-env') {
      return updateFocusedSyn({
        filterEnv: { ...focusedSyn.filterEnv, velocity: !focusedSyn.filterEnv.velocity },
      })
    }
    return { ...state, synthOledView: 'filter-env' }
  }

  if (id === 'synth-filter-env-amt') {
    const next = resolveNumericAction(focusedSyn.filter.envAmt, action, 0, 100, spec.step)
    return updateFocusedSyn({ filter: { ...focusedSyn.filter, envAmt: next } })
  }

  if (id === 'synth-filter-freq') {
    const next = resolveNumericAction(focusedSyn.filter.freq, action, 0, 100, spec.step)
    return updateFocusedSyn({ filter: { ...focusedSyn.filter, freq: next } })
  }

  if (id === 'synth-filter-res') {
    const next = resolveNumericAction(focusedSyn.filter.res, action, 0, 100, spec.step)
    return updateFocusedSyn({ filter: { ...focusedSyn.filter, res: next } })
  }

  if (id === 'synth-filter-on') {
    return updateFocusedSyn({ filter: { ...focusedSyn.filter, on: !focusedSyn.filter.on } })
  }

  if (id === 'synth-amp-env') {
    if (state.synthOledView === 'amp-env') {
      const nextVel = ((focusedSyn.ampEnv.velocity + 1) % 4) as 0 | 1 | 2 | 3
      return updateFocusedSyn({ ampEnv: { ...focusedSyn.ampEnv, velocity: nextVel } })
    }
    return { ...state, synthOledView: 'amp-env' }
  }

  if (id === 'synth-unison') {
    const next = ((focusedSyn.voice.unison + 1) % 4) as 0 | 1 | 2 | 3
    return updateFocusedSyn({ voice: { ...focusedSyn.voice, unison: next } })
  }

  // ===================== 6. LAYER EFFECTS SECTION =====================
  const fx = state.effects

  if (id === 'fx-section-on') {
    return finalizeSoundState({ ...state, effects: { ...fx, allOn: !fx.allOn } }, false)
  }

  if (id === 'fx-shift') {
    const nextShift = !fx.shiftActive
    return {
      ...state,
      effects: { ...fx, shiftActive: nextShift },
      program: { ...state.program, shiftActive: nextShift },
    }
  }

  if (id === 'fx-focus-organ') {
    return clearShift({
      ...state,
      effects: { ...fx, focusedChain: 'organ', shiftActive: false },
    })
  }

  if (id === 'fx-focus-piano') {
    if (shift) {
      const nextGroup = !fx.pianoGroupMode
      return finalizeSoundState(
        clearShift({
          ...state,
          effects: {
            ...fx,
            pianoGroupMode: nextGroup,
            focusedChain: 'pianoA',
            shiftActive: false,
            chains: nextGroup ? { ...fx.chains, pianoB: fx.chains.pianoA } : fx.chains,
          },
        }),
        false,
      )
    }
    const nextChain: FxChainId = fx.focusedChain === 'pianoA' ? 'pianoB' : 'pianoA'
    return {
      ...state,
      piano: { ...state.piano, focusedLayer: nextChain === 'pianoA' ? 'A' : 'B' },
      effects: { ...fx, focusedChain: nextChain },
    }
  }

  if (id === 'fx-focus-synth') {
    if (shift) {
      const nextGroup = !fx.synthGroupMode
      return finalizeSoundState(
        clearShift({
          ...state,
          effects: {
            ...fx,
            synthGroupMode: nextGroup,
            focusedChain: 'synthA',
            shiftActive: false,
            chains: nextGroup
              ? { ...fx.chains, synthB: fx.chains.synthA, synthC: fx.chains.synthA }
              : fx.chains,
          },
        }),
        false,
      )
    }
    const order: readonly FxChainId[] = ['synthA', 'synthB', 'synthC']
    const curIdx = order.indexOf(fx.focusedChain)
    const nextChain = curIdx === -1 ? (`synth${state.synth.focusedLayer}` as FxChainId) : order[(curIdx + 1) % 3]
    const nextLayer = (nextChain.slice('synth'.length) as SynthLayerId)
    return {
      ...state,
      synth: { ...state.synth, focusedLayer: nextLayer },
      effects: { ...fx, focusedChain: nextChain },
    }
  }

  // Mod 1
  if (id === 'fx-mod1-on') {
    return finalizeSoundState(
      { ...state, effects: updateEditableChain(fx, (c) => ({ ...c, mod1: { ...c.mod1, on: !c.mod1.on } })) },
      false,
    )
  }
  if (id === 'fx-mod1-type') {
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          effects: updateEditableChain(fx, (c) => ({
            ...c,
            mod1: { ...c.mod1, clockSync: !(c.mod1.clockSync ?? false) },
          })),
        }),
        false,
      )
    }
    return finalizeSoundState(
      {
        ...state,
        effects: updateEditableChain(fx, (c) => {
          const nextIdx = (MOD1_TYPES.indexOf(c.mod1.type) + 1) % MOD1_TYPES.length
          return { ...c, mod1: { ...c.mod1, type: MOD1_TYPES[nextIdx] } }
        }),
      },
      false,
    )
  }
  if (id === 'fx-mod1-rate' || id === 'fx-mod1-amount') {
    const disp = getDisplayedEffectChain(fx)
    const field = id === 'fx-mod1-rate' ? 'rate' : 'amount'
    const next = resolveNumericAction(disp.mod1[field], action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: updateEditableChain(fx, (c) => ({ ...c, mod1: { ...c.mod1, [field]: next } })) },
      false,
    )
  }

  // Mod 2
  if (id === 'fx-mod2-on') {
    return finalizeSoundState(
      { ...state, effects: updateEditableChain(fx, (c) => ({ ...c, mod2: { ...c.mod2, on: !c.mod2.on } })) },
      false,
    )
  }
  if (id === 'fx-mod2-type') {
    return finalizeSoundState(
      {
        ...state,
        effects: updateEditableChain(fx, (c) => {
          const nextIdx = (MOD2_TYPES.indexOf(c.mod2.type) + 1) % MOD2_TYPES.length
          return { ...c, mod2: { ...c.mod2, type: MOD2_TYPES[nextIdx] } }
        }),
      },
      false,
    )
  }
  if (id === 'fx-mod2-rate' || id === 'fx-mod2-amount') {
    const disp = getDisplayedEffectChain(fx)
    const field = id === 'fx-mod2-rate' ? 'rate' : 'amount'
    const next = resolveNumericAction(disp.mod2[field], action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: updateEditableChain(fx, (c) => ({ ...c, mod2: { ...c.mod2, [field]: next } })) },
      false,
    )
  }

  // Amp Sim / EQ
  if (id === 'fx-amp-on') {
    return finalizeSoundState(
      { ...state, effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, on: !c.ampEq.on } })) },
      false,
    )
  }
  if (id === 'fx-amp-type') {
    return finalizeSoundState(
      {
        ...state,
        effects: updateEditableChain(fx, (c) => {
          const nextIdx = (AMP_EQ_TYPES.indexOf(c.ampEq.type) + 1) % AMP_EQ_TYPES.length
          return { ...c, ampEq: { ...c.ampEq, type: AMP_EQ_TYPES[nextIdx] } }
        }),
      },
      false,
    )
  }
  if (
    id === 'fx-amp-drive' ||
    id === 'fx-amp-freq' ||
    id === 'fx-eq-bass' ||
    id === 'fx-eq-mid' ||
    id === 'fx-eq-treble'
  ) {
    const disp = getDisplayedEffectChain(fx)
    const field =
      id === 'fx-amp-drive'
        ? 'drive'
        : id === 'fx-amp-freq'
          ? 'midFreq'
          : id === 'fx-eq-bass'
            ? 'bass'
            : id === 'fx-eq-mid'
              ? 'mid'
              : 'treble'
    const next = resolveNumericAction(disp.ampEq[field], action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: updateEditableChain(fx, (c) => ({ ...c, ampEq: { ...c.ampEq, [field]: next } })) },
      false,
    )
  }

  // Delay
  if (id === 'fx-delay-on') {
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          effects: {
            ...fx,
            shiftActive: false,
            global: { ...fx.global, delayGlobal: !fx.global.delayGlobal },
          },
        }),
        false,
      )
    }
    return finalizeSoundState(
      { ...state, effects: updateDelayState(fx, (d) => ({ ...d, on: !d.on })) },
      false,
    )
  }
  if (id === 'fx-delay-tempo') {
    const disp = getDisplayedEffectChain(fx)
    const next = resolveNumericAction(disp.delay.tempo, action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: updateDelayState(fx, (d) => ({ ...d, tempo: next, bpm: tempoKnobToBpm(next) })) },
      false,
    )
  }
  if (id === 'fx-delay-feedback' || id === 'fx-delay-dry-wet') {
    const disp = getDisplayedEffectChain(fx)
    const field = id === 'fx-delay-feedback' ? 'feedback' : 'dryWet'
    const next = resolveNumericAction(disp.delay[field], action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: updateDelayState(fx, (d) => ({ ...d, [field]: next })) },
      false,
    )
  }
  if (id === 'fx-delay-type') {
    return finalizeSoundState(
      {
        ...state,
        effects: updateDelayState(fx, (d) => {
          const nextIdx = (DELAY_FILTER_TYPES.indexOf(d.filter) + 1) % DELAY_FILTER_TYPES.length
          return { ...d, filter: DELAY_FILTER_TYPES[nextIdx] }
        }),
      },
      false,
    )
  }
  if (id === 'fx-delay-pingpong') {
    return finalizeSoundState(
      { ...state, effects: updateDelayState(fx, (d) => ({ ...d, pingPong: !d.pingPong })) },
      false,
    )
  }
  if (id === 'fx-delay-tap') {
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          effects: updateDelayState(fx, (d) => ({ ...d, clockSync: !(d.clockSync ?? false) })),
        }),
        false,
      )
    }
    return instrumentStateReducer(state, { type: 'tap-delay-tempo', nowMs: Date.now() })
  }

  // Compressor
  if (id === 'fx-comp-on') {
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          effects: {
            ...fx,
            shiftActive: false,
            global: { ...fx.global, compGlobal: !fx.global.compGlobal },
          },
        }),
        false,
      )
    }
    return finalizeSoundState(
      { ...state, effects: updateCompState(fx, (c) => ({ ...c, on: !c.on })) },
      false,
    )
  }
  if (id === 'fx-comp-fast') {
    return finalizeSoundState(
      { ...state, effects: updateCompState(fx, (c) => ({ ...c, fast: !c.fast })) },
      false,
    )
  }
  if (id === 'fx-comp-amount') {
    const disp = getDisplayedEffectChain(fx)
    const next = resolveNumericAction(disp.comp.amount, action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: updateCompState(fx, (c) => ({ ...c, amount: next })) },
      false,
    )
  }

  // Reverb
  if (id === 'fx-reverb-on') {
    if (shift) {
      return finalizeSoundState(
        clearShift({
          ...state,
          effects: {
            ...fx,
            shiftActive: false,
            global: { ...fx.global, reverbGlobal: !fx.global.reverbGlobal },
          },
        }),
        false,
      )
    }
    return finalizeSoundState(
      { ...state, effects: updateReverbState(fx, (r) => ({ ...r, on: !r.on })) },
      false,
    )
  }
  if (id === 'fx-reverb-type') {
    return finalizeSoundState(
      {
        ...state,
        effects: updateReverbState(fx, (r) => {
          const nextIdx = (REVERB_TYPES.indexOf(r.type) + 1) % REVERB_TYPES.length
          return { ...r, type: REVERB_TYPES[nextIdx] }
        }),
      },
      false,
    )
  }
  if (id === 'fx-reverb-tone') {
    return finalizeSoundState(
      {
        ...state,
        effects: updateReverbState(fx, (r) => {
          const nextIdx = (REVERB_TONES.indexOf(r.tone) + 1) % REVERB_TONES.length
          return { ...r, tone: REVERB_TONES[nextIdx] }
        }),
      },
      false,
    )
  }
  if (id === 'fx-reverb-dry-wet') {
    const disp = getDisplayedEffectChain(fx)
    const next = resolveNumericAction(disp.reverb.dryWet, action, 0, 100, spec.step)
    return finalizeSoundState(
      { ...state, effects: updateReverbState(fx, (r) => ({ ...r, dryWet: next })) },
      false,
    )
  }

  // Remaining spec-excluded controls remain honestly presentation-only
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

  // ---- Piano ----
  if (action.type === 'focus-piano-layer') {
    return {
      ...state,
      piano: { ...state.piano, focusedLayer: action.layer },
      effects: { ...state.effects, focusedChain: action.layer === 'A' ? 'pianoA' : 'pianoB' },
    }
  }
  if (action.type === 'set-piano-layer') {
    return finalizeSoundState({
      ...state,
      piano: {
        ...state.piano,
        layers: {
          ...state.piano.layers,
          [action.layer]: { ...state.piano.layers[action.layer], ...action.patch },
        },
      },
    })
  }
  if (action.type === 'set-piano-section') {
    return finalizeSoundState({ ...state, piano: { ...state.piano, ...action.patch } })
  }

  // ---- Organ ----
  if (action.type === 'focus-organ-layer') {
    return {
      ...state,
      organ: { ...state.organ, focusedLayer: action.layer },
      effects: { ...state.effects, focusedChain: 'organ' },
    }
  }
  if (action.type === 'set-organ-layer') {
    return finalizeSoundState({
      ...state,
      organ: {
        ...state.organ,
        layers: {
          ...state.organ.layers,
          [action.layer]: { ...state.organ.layers[action.layer], ...action.patch },
        },
      },
    })
  }
  if (action.type === 'set-organ-section') {
    return finalizeSoundState({ ...state, organ: { ...state.organ, ...action.patch } })
  }

  // ---- Synth ----
  if (action.type === 'focus-synth-layer') {
    return {
      ...state,
      synth: { ...state.synth, focusedLayer: action.layer },
      effects: { ...state.effects, focusedChain: (`synth${action.layer}` as FxChainId) },
    }
  }
  if (action.type === 'set-synth-layer') {
    return finalizeSoundState({
      ...state,
      synth: {
        ...state.synth,
        layers: {
          ...state.synth.layers,
          [action.layer]: { ...state.synth.layers[action.layer], ...action.patch },
        },
      },
    })
  }
  if (action.type === 'set-synth-section') {
    return finalizeSoundState({ ...state, synth: { ...state.synth, ...action.patch } })
  }
  if (action.type === 'set-synth-oled-view') {
    return { ...state, synthOledView: action.view }
  }

  // ---- Effects & Performance ----
  if (action.type === 'set-fx-focus') {
    return { ...state, effects: { ...state.effects, focusedChain: action.chain } }
  }
  if (action.type === 'toggle-piano-group-mode') {
    const nextGroup = !state.effects.pianoGroupMode
    return finalizeSoundState(
      {
        ...state,
        effects: {
          ...state.effects,
          pianoGroupMode: nextGroup,
          chains: nextGroup
            ? { ...state.effects.chains, pianoB: state.effects.chains.pianoA }
            : state.effects.chains,
        },
      },
      false,
    )
  }
  if (action.type === 'toggle-synth-group-mode') {
    const nextGroup = !state.effects.synthGroupMode
    return finalizeSoundState(
      {
        ...state,
        effects: {
          ...state.effects,
          synthGroupMode: nextGroup,
          chains: nextGroup
            ? {
                ...state.effects.chains,
                synthB: state.effects.chains.synthA,
                synthC: state.effects.chains.synthA,
              }
            : state.effects.chains,
        },
      },
      false,
    )
  }
  if (action.type === 'toggle-global-unit') {
    const g = state.effects.global
    return finalizeSoundState(
      {
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
      },
      false,
    )
  }
  if (action.type === 'tap-delay-tempo') {
    const prev = state.effects.lastTapTimestampMs
    if (prev !== null) {
      const dtMs = action.nowMs - prev
      if (dtMs >= 200 && dtMs <= 1500) {
        const bpm = clamp(Math.round(60000 / dtMs), 50, 240)
        const tempo = bpmToTempoKnob(bpm)
        return finalizeSoundState(
          {
            ...state,
            effects: {
              ...updateDelayState(state.effects, (d) => ({ ...d, bpm, tempo })),
              lastTapTimestampMs: action.nowMs,
            },
          },
          false,
        )
      }
    }
    return { ...state, effects: { ...state.effects, lastTapTimestampMs: action.nowMs } }
  }
  if (action.type === 'set-pitch-stick') {
    return { ...state, pitchStick: clamp(action.value, -100, 100) }
  }
  if (action.type === 'set-mod-wheel') {
    return { ...state, modWheel: clamp(action.value, 0, 100) }
  }
  if (action.type === 'set-control-pedal') {
    return { ...state, controlPedal: clamp(action.value, 0, 100) }
  }
  if (action.type === 'set-master-level') {
    return { ...state, masterLevel: clamp(action.value, 0, 100) }
  }
  if (action.type === 'set-rotary') {
    return finalizeSoundState(
      { ...state, effects: { ...state.effects, rotary: { ...state.effects.rotary, ...action.patch } } },
      false,
    )
  }
  if (action.type === 'patch-fx-chain') {
    const { patch, chain } = action
    return finalizeSoundState(
      {
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
      },
      false,
    )
  }

  // ---- Programs / Live / Store / Store As / Undo ----
  if (action.type === 'select-program') {
    return selectProgramSlot(state, action.index)
  }
  if (action.type === 'select-live-slot') {
    return selectLiveSlot(state, action.index)
  }
  if (action.type === 'toggle-live-mode') {
    if (state.program.overlay.kind === 'store-confirm') {
      const nextDestMode = state.program.overlay.destMode === 'live' ? 'program' : 'live'
      const nextDestSlot = nextDestMode === 'live' ? state.program.activeLiveSlot : state.program.activeSlot
      const auditionPatch =
        nextDestMode === 'live'
          ? state.program.liveSlots[nextDestSlot].patch
          : state.program.programs[nextDestSlot].patch
      return {
        ...applyPatchOntoState(state, auditionPatch),
        program: {
          ...state.program,
          overlay: { ...state.program.overlay, destMode: nextDestMode, destSlot: nextDestSlot },
        },
      }
    }
    if (state.program.mode === 'live') {
      return selectProgramSlot(state, state.program.activeSlot)
    }
    return selectLiveSlot(state, state.program.activeLiveSlot)
  }

  if (action.type === 'start-store') {
    const patch = extractProgramPatch(state)
    const destMode = state.program.mode
    const destSlot = destMode === 'live' ? state.program.activeLiveSlot : state.program.activeSlot
    const pendingName =
      destMode === 'live'
        ? state.program.liveSlots[destSlot].name
        : state.program.programs[destSlot].name
    return {
      ...state,
      program: {
        ...state.program,
        overlay: {
          kind: 'store-confirm',
          destMode,
          destSlot,
          pendingName,
          sourcePatch: patch,
        },
        statusNotice: 'Press STORE to confirm, EXIT to cancel',
      },
    }
  }

  if (action.type === 'start-store-as') {
    const patch = extractProgramPatch(state)
    const destMode = state.program.mode
    const destSlot = destMode === 'live' ? state.program.activeLiveSlot : state.program.activeSlot
    const currentName =
      destMode === 'live'
        ? state.program.liveSlots[destSlot].name
        : state.program.programs[destSlot].name
    return {
      ...state,
      program: {
        ...state.program,
        overlay: {
          kind: 'store-as-name',
          draftName: currentName,
          cursor: currentName.length,
          destMode,
          destSlot,
          sourcePatch: patch,
        },
        statusNotice: 'STORE AS: Enter name then STORE',
      },
    }
  }

  if (action.type === 'set-store-as-name') {
    if (state.program.overlay.kind !== 'store-as-name') return state
    const clean = action.name.slice(0, 20)
    return {
      ...state,
      program: {
        ...state.program,
        overlay: { ...state.program.overlay, draftName: clean, cursor: clean.length },
      },
    }
  }

  if (action.type === 'store-as-insert-char') {
    if (state.program.overlay.kind !== 'store-as-name') return state
    const ov = state.program.overlay
    if (ov.draftName.length >= 20) return state
    const ch = action.char.slice(0, 1)
    if (!ch) return state
    const nextName = ov.draftName.slice(0, ov.cursor) + ch + ov.draftName.slice(ov.cursor)
    return {
      ...state,
      program: {
        ...state.program,
        overlay: { ...ov, draftName: nextName, cursor: ov.cursor + 1 },
      },
    }
  }

  if (action.type === 'store-as-delete-char') {
    if (state.program.overlay.kind !== 'store-as-name') return state
    const ov = state.program.overlay
    if (ov.draftName.length === 0 || ov.cursor === 0) return state
    const nextName = ov.draftName.slice(0, ov.cursor - 1) + ov.draftName.slice(ov.cursor)
    return {
      ...state,
      program: {
        ...state.program,
        overlay: { ...ov, draftName: nextName, cursor: Math.max(0, ov.cursor - 1) },
      },
    }
  }

  if (action.type === 'advance-store-as-to-confirm') {
    if (state.program.overlay.kind !== 'store-as-name') return state
    const ov = state.program.overlay
    const trimmed = ov.draftName.trim() || 'Untitled'
    return {
      ...state,
      program: {
        ...state.program,
        overlay: {
          kind: 'store-confirm',
          destMode: ov.destMode,
          destSlot: ov.destSlot,
          pendingName: trimmed,
          sourcePatch: ov.sourcePatch,
        },
        statusNotice: 'Select dest & press STORE',
      },
    }
  }

  if (action.type === 'set-store-dest') {
    if (state.program.overlay.kind !== 'store-confirm') return state
    return action.destMode === 'live'
      ? selectLiveSlot(state, action.destSlot)
      : selectProgramSlot(state, action.destSlot)
  }

  if (action.type === 'confirm-store') {
    const ov = state.program.overlay
    if (ov.kind !== 'store-confirm') return state
    const patchToSave = ov.sourcePatch
    const finalName = ov.pendingName.trim() || 'Untitled'
    let nextPrograms = state.program.programs
    let nextLiveSlots = state.program.liveSlots
    if (ov.destMode === 'live') {
      nextLiveSlots = nextLiveSlots.map((s, idx) =>
        idx === ov.destSlot ? { ...s, name: finalName, patch: patchToSave } : s,
      )
    } else {
      nextPrograms = nextPrograms.map((s, idx) =>
        idx === ov.destSlot ? { ...s, name: finalName, patch: patchToSave } : s,
      )
    }
    persistProgramBank(
      { version: 3, programs: nextPrograms, liveSlots: nextLiveSlots },
      action.storage,
    )
    const restored = applyPatchOntoState(state, patchToSave)
    return {
      ...restored,
      program: {
        ...state.program,
        mode: ov.destMode,
        activeSlot: ov.destMode === 'program' ? ov.destSlot : state.program.activeSlot,
        activeLiveSlot: ov.destMode === 'live' ? ov.destSlot : state.program.activeLiveSlot,
        programs: nextPrograms,
        liveSlots: nextLiveSlots,
        dirty: false,
        overlay: { kind: 'none' },
        statusNotice: `Stored: ${finalName}`,
      },
    }
  }

  if (action.type === 'cancel-overlay') {
    let restored = state
    if (state.program.overlay.kind === 'store-confirm' || state.program.overlay.kind === 'store-as-name') {
      restored = applyPatchOntoState(state, state.program.overlay.sourcePatch)
    }
    return {
      ...restored,
      program: {
        ...restored.program,
        overlay: { kind: 'none' },
        morphAssignSource: null,
        statusNotice: null,
      },
    }
  }

  if (action.type === 'open-list-view') {
    return {
      ...state,
      program: {
        ...state.program,
        overlay: { kind: 'list-view', selectedIndex: state.program.activeSlot },
      },
    }
  }

  if (action.type === 'undo-program-change') {
    const snap = state.program.undoSnapshot
    if (!snap) return state
    const restored = applyPatchOntoState(state, snap.patch)
    const storedSlot =
      snap.mode === 'live'
        ? state.program.liveSlots[snap.slotIndex]
        : state.program.programs[snap.slotIndex]
    const dirty = snap.mode === 'live' ? false : !patchesEqual(storedSlot.patch, snap.patch)
    return {
      ...restored,
      program: {
        ...state.program,
        mode: snap.mode,
        activeSlot: snap.mode === 'program' ? snap.slotIndex : state.program.activeSlot,
        activeLiveSlot: snap.mode === 'live' ? snap.slotIndex : state.program.activeLiveSlot,
        dirty,
        undoSnapshot: null,
        overlay: { kind: 'none' },
        statusNotice: 'Undo restored edited state',
      },
    }
  }

  // ---- Splits / Zones / Scenes / Morphs / Clock / Transpose / Panic ----
  if (action.type === 'set-split') {
    return finalizeSoundState({ ...state, split: { ...state.split, ...action.patch } }, false)
  }
  if (action.type === 'set-split-point') {
    const pt = state.split.points[action.point]
    const nextCrossfade =
      action.patch.crossfade !== undefined && SPLIT_CROSSFADE_OPTIONS.includes(action.patch.crossfade)
        ? action.patch.crossfade
        : pt.crossfade
    return finalizeSoundState(
      {
        ...state,
        split: {
          ...state.split,
          points: {
            ...state.split.points,
            [action.point]: { ...pt, ...action.patch, crossfade: nextCrossfade },
          },
        },
      },
      false,
    )
  }
  if (action.type === 'set-layer-zone') {
    if (action.section === 'organ') {
      const k = action.layer as OrganLayerId
      return finalizeSoundState(
        {
          ...state,
          organ: {
            ...state.organ,
            layers: { ...state.organ.layers, [k]: { ...state.organ.layers[k], zone: action.zone } },
          },
        },
        false,
      )
    }
    if (action.section === 'piano') {
      const k = action.layer as PianoLayerId
      return finalizeSoundState(
        {
          ...state,
          piano: {
            ...state.piano,
            layers: { ...state.piano.layers, [k]: { ...state.piano.layers[k], zone: action.zone } },
          },
        },
        false,
      )
    }
    const k = action.layer as SynthLayerId
    return finalizeSoundState(
      {
        ...state,
        synth: {
          ...state.synth,
          layers: { ...state.synth.layers, [k]: { ...state.synth.layers[k], zone: action.zone } },
        },
      },
      false,
    )
  }

  if (action.type === 'switch-scene') {
    const nextScene: LayerSceneId = action.scene ?? (state.scenes.activeScene === 'I' ? 'II' : 'I')
    if (nextScene === state.scenes.activeScene) return state
    const targetSnap = nextScene === 'I' ? state.scenes.sceneI : state.scenes.sceneII
    return finalizeSoundState(applySceneSnapshot(state, targetSnap, nextScene), false)
  }

  if (action.type === 'set-morph-assign-source') {
    return {
      ...state,
      program: { ...state.program, morphAssignSource: action.source },
    }
  }

  if (action.type === 'assign-morph') {
    return finalizeSoundState(
      {
        ...state,
        morphs: upsertMorphAssignment(
          state.morphs,
          action.source,
          action.target,
          action.start,
          action.end,
        ),
      },
      false,
    )
  }

  if (action.type === 'clear-morph-source') {
    return finalizeSoundState(
      {
        ...state,
        morphs: clearMorphSource(state.morphs, action.source),
      },
      false,
    )
  }

  if (action.type === 'tap-master-clock') {
    const recent = state.program.mstClkTaps.filter((t) => action.nowMs - t <= 2200)
    const nextTaps = [...recent, action.nowMs].slice(-6)
    // Spec: tap the MST CLK button four or more times
    if (nextTaps.length >= 4) {
      let sum = 0
      for (let i = 1; i < nextTaps.length; i++) {
        sum += nextTaps[i] - nextTaps[i - 1]
      }
      const avgMs = sum / (nextTaps.length - 1)
      if (avgMs >= 180 && avgMs <= 2100) {
        const bpm = clamp(Math.round(60000 / avgMs), 30, 300)
        return finalizeSoundState(
          {
            ...state,
            masterClock: { ...state.masterClock, bpm },
            program: { ...state.program, mstClkTaps: nextTaps },
          },
          false,
        )
      }
    }
    return { ...state, program: { ...state.program, mstClkTaps: nextTaps } }
  }

  if (action.type === 'set-master-clock') {
    const nextBpm =
      action.patch.bpm !== undefined ? clamp(Math.round(action.patch.bpm), 30, 300) : state.masterClock.bpm
    return finalizeSoundState(
      {
        ...state,
        masterClock: { ...state.masterClock, ...action.patch, bpm: nextBpm },
      },
      false,
    )
  }

  if (action.type === 'set-transpose') {
    const nextSemi =
      action.patch.semitones !== undefined
        ? clamp(Math.round(action.patch.semitones), -6, 6)
        : state.transpose.semitones
    return finalizeSoundState(
      {
        ...state,
        transpose: { ...state.transpose, ...action.patch, semitones: nextSemi },
      },
      false,
    )
  }

  if (action.type === 'panic') {
    return {
      ...state,
      pitchStick: 0,
      modWheel: 0,
      controlPedal: 0,
      synth: {
        ...state.synth,
        layers: {
          A: { ...state.synth.layers.A, arp: { ...state.synth.layers.A.arp, kbHold: false } },
          B: { ...state.synth.layers.B, arp: { ...state.synth.layers.B.arp, kbHold: false } },
          C: { ...state.synth.layers.C, arp: { ...state.synth.layers.C.arp, kbHold: false } },
        },
      },
      panicCounter: state.panicCounter + 1,
      program: {
        ...state.program,
        shiftActive: false,
        morphAssignSource: null,
        statusNotice: 'PANIC: All Notes Off',
      },
      effects: { ...state.effects, shiftActive: false },
    }
  }

  return state
}

/**
 * Projects the canonical StageInstrumentState into the flat HardwarePresentationState
 * map consumed by PanelControls so every knob, fader, drawbar, button, and ARIA
 * valuenow/valuetext stays 100% synchronized with live state (including morph preview!).
 */
export function projectPanelControlState(state: StageInstrumentState): HardwarePresentationState {
  const effective = resolveMorphedStageState(state)
  const focusedPiano = effective.piano.layers[effective.piano.focusedLayer]
  const focusedOrg = effective.organ.layers[effective.organ.focusedLayer]
  const focusedSyn = effective.synth.layers[effective.synth.focusedLayer]
  const fx = effective.effects
  const disp = getDisplayedEffectChain(fx)
  const models = PIANO_MODELS_BY_TYPE[focusedPiano.type]
  const modelKnobValue =
    models.length <= 1 ? 0 : Math.round((focusedPiano.modelIndex / (models.length - 1)) * 100)
  const acousticsCode = (focusedPiano.softRelease ? 1 : 0) + (focusedPiano.stringRes ? 2 : 0)
  const timbreIndex = Math.max(0, ELECTRIC_TIMBRES.indexOf(focusedPiano.timbre))

  const activeProgBtn =
    state.program.overlay.kind === 'store-confirm'
      ? (state.program.overlay.destSlot % 8) + 1
      : state.program.mode === 'live'
        ? state.program.activeLiveSlot + 1
        : (state.program.activeSlot % 8) + 1

  const synthArpRangeVal =
    focusedSyn.arp.mode === 'Gate'
      ? Math.round(focusedSyn.arp.gateEnv)
      : Math.round(((focusedSyn.arp.range - 1) / 3) * 100)

  const lfoDestIdx =
    focusedSyn.lfo.destination === 'Osc Pitch'
      ? 0
      : focusedSyn.lfo.destination === 'Osc Ctrl'
        ? 1
        : focusedSyn.lfo.destination === 'Filter Freq'
          ? 2
          : 0

  return {
    ...state.decorative,
    // Performance
    'perf-master-level': state.masterLevel,
    'perf-pitch-stick': state.pitchStick,
    'perf-mod-wheel': state.modWheel,
    'perf-rotary-drive': Math.round(fx.rotary.drive),
    'perf-rotary-drive-on': fx.rotary.driveOn ? 1 : 0,
    'perf-rotary-stop': fx.rotary.stopMode ? 1 : 0,
    'perf-rotary-speed': fx.rotary.speed === 'Fast' ? 1 : 0,

    // Organ
    'organ-section-on': effective.organ.sectionOn ? 1 : 0,
    'organ-layer-a-fader': Math.round(effective.organ.layers.A.level),
    'organ-layer-b-fader': Math.round(effective.organ.layers.B.level),
    'organ-layer-a-on': effective.organ.layers.A.enabled ? 1 : 0,
    'organ-layer-b-on': effective.organ.layers.B.enabled ? 1 : 0,
    'organ-octave-down': focusedOrg.octave < 0 ? 1 : 0,
    'organ-octave-up': focusedOrg.octave > 0 ? 1 : 0,
    'organ-model-select': ORGAN_MODELS.indexOf(focusedOrg.model),
    'organ-vib-type': ORGAN_VIB_CHORUS_TYPES.indexOf(focusedOrg.vibChorusType),
    'organ-vib-on': focusedOrg.vibChorusOn ? 1 : 0,
    'organ-perc-soft': focusedOrg.percussion.soft ? 1 : 0,
    'organ-perc-fast': focusedOrg.percussion.fast ? 1 : 0,
    'organ-perc-third': focusedOrg.percussion.third ? 1 : 0,
    'organ-perc-on': focusedOrg.percussion.on ? 1 : 0,
    'organ-drawbar-1': focusedOrg.drawbars[0],
    'organ-drawbar-2': focusedOrg.drawbars[1],
    'organ-drawbar-3': focusedOrg.drawbars[2],
    'organ-drawbar-4': focusedOrg.drawbars[3],
    'organ-drawbar-5': focusedOrg.drawbars[4],
    'organ-drawbar-6': focusedOrg.drawbars[5],
    'organ-drawbar-7': focusedOrg.drawbars[6],
    'organ-drawbar-8': focusedOrg.drawbars[7],
    'organ-drawbar-9': focusedOrg.drawbars[8],

    // Piano
    'piano-section-on': effective.piano.sectionOn ? 1 : 0,
    'piano-layer-a-fader': Math.round(effective.piano.layers.A.level),
    'piano-layer-b-fader': Math.round(effective.piano.layers.B.level),
    'piano-layer-a-on': effective.piano.layers.A.enabled ? 1 : 0,
    'piano-layer-b-on': effective.piano.layers.B.enabled ? 1 : 0,
    'piano-sustped': effective.piano.sustped ? 1 : 0,
    'piano-pstick': effective.piano.pstick ? 1 : 0,
    'piano-octave-down': focusedPiano.octave < 0 ? 1 : 0,
    'piano-octave-up': focusedPiano.octave > 0 ? 1 : 0,
    'piano-type-select': PIANO_TYPES.indexOf(focusedPiano.type),
    'piano-model-dial': modelKnobValue,
    'piano-timbre': timbreIndex,
    'piano-acoustics': acousticsCode,
    'piano-unison': focusedPiano.unison,
    'piano-kb-touch': KB_TOUCH_CURVES.indexOf(focusedPiano.kbTouch),
    'piano-dyn-comp': focusedPiano.dynComp,

    // Program & Morph
    'program-morph-wheel':
      state.program.morphAssignSource === 'wheel' || state.morphs.wheel.length > 0 ? 1 : 0,
    'program-morph-ctrlped':
      state.program.morphAssignSource === 'controlPedal' || state.morphs.controlPedal.length > 0
        ? 1
        : 0,
    'program-split': state.split.enabled ? 1 : 0,
    'program-mst-clk': state.program.overlay.kind === 'clock-edit' || state.masterClock.kbSync ? 1 : 0,
    'program-transpose': state.transpose.enabled ? 1 : 0,
    'program-store':
      state.program.overlay.kind === 'store-confirm' || state.program.overlay.kind === 'store-as-name'
        ? 1
        : 0,
    'program-prog-view': state.program.overlay.kind === 'list-view' ? 1 : 0,
    'program-dial': Math.round((state.program.activeSlot / 31) * 100),
    'program-solo': state.program.soloSection !== null ? 1 : 0,
    'program-live-mode': state.program.mode === 'live' ? 1 : 0,
    'program-layer-scene': state.scenes.activeScene === 'II' ? 1 : 0,
    'program-shift': state.program.shiftActive ? 1 : 0,
    'program-btn-1': activeProgBtn === 1 ? 1 : 0,
    'program-btn-2': activeProgBtn === 2 ? 1 : 0,
    'program-btn-3': activeProgBtn === 3 ? 1 : 0,
    'program-btn-4': activeProgBtn === 4 ? 1 : 0,
    'program-btn-5': activeProgBtn === 5 ? 1 : 0,
    'program-btn-6': activeProgBtn === 6 ? 1 : 0,
    'program-btn-7': activeProgBtn === 7 ? 1 : 0,
    'program-btn-8': activeProgBtn === 8 ? 1 : 0,

    // Synth
    'synth-section-on': effective.synth.sectionOn ? 1 : 0,
    'synth-layer-a-fader': Math.round(effective.synth.layers.A.level),
    'synth-layer-b-fader': Math.round(effective.synth.layers.B.level),
    'synth-layer-c-fader': Math.round(effective.synth.layers.C.level),
    'synth-layer-a-on': effective.synth.layers.A.enabled ? 1 : 0,
    'synth-layer-b-on': effective.synth.layers.B.enabled ? 1 : 0,
    'synth-layer-c-on': effective.synth.layers.C.enabled ? 1 : 0,
    'synth-kb-hold': focusedSyn.arp.kbHold ? 1 : 0,
    'synth-arp-run': focusedSyn.arp.run ? 1 : 0,
    'synth-octave-down': focusedSyn.octave < 0 ? 1 : 0,
    'synth-octave-up': focusedSyn.octave > 0 ? 1 : 0,
    'synth-mode': SYNTH_MODES.indexOf(focusedSyn.mode),
    'synth-waveform-btn': state.synthOledView === 'wave' ? 1 : 0,
    'synth-arp-rate': Math.round(focusedSyn.arp.rate),
    'synth-arp-mode': SYNTH_ARP_MODES.indexOf(focusedSyn.arp.mode),
    'synth-arp-range': synthArpRangeVal,
    'synth-arp-menu': state.synthOledView === 'arp' ? 1 : 0,
    'synth-voice-mode': SYNTH_VOICE_MODES.indexOf(focusedSyn.voice.mode),
    'synth-voice-glide': Math.round(focusedSyn.voice.glide),
    'synth-vibrato-mode': Math.max(0, SYNTH_VIBRATO_MODES.indexOf(focusedSyn.vibrato.mode)),
    'synth-vibrato-menu': state.synthOledView === 'voice-vib' ? 1 : 0,
    'synth-lfo-wave': SYNTH_LFO_WAVEFORMS.indexOf(focusedSyn.lfo.waveform) > 0 ? 1 : 0,
    'synth-lfo-amt': Math.round(focusedSyn.lfo.amount),
    'synth-lfo-rate': Math.round(focusedSyn.lfo.rate),
    'synth-lfo-dest': lfoDestIdx,
    'synth-osc-pitch': state.synthOledView === 'osc-pitch' ? 1 : 0,
    'synth-osc-env': state.synthOledView === 'osc-env' ? 1 : 0,
    'synth-osc-ctrl': Math.round(focusedSyn.oscCtrl),
    'synth-osc-env-amt': Math.round(focusedSyn.oscEnv.amount),
    'synth-filter-type': SYNTH_FILTER_TYPES.indexOf(focusedSyn.filter.type),
    'synth-filter-env': state.synthOledView === 'filter-env' ? 1 : 0,
    'synth-filter-env-amt': Math.round(focusedSyn.filter.envAmt),
    'synth-filter-freq': Math.round(focusedSyn.filter.freq),
    'synth-filter-res': Math.round(focusedSyn.filter.res),
    'synth-filter-on': focusedSyn.filter.on ? 1 : 0,
    'synth-amp-env': state.synthOledView === 'amp-env' ? 1 : 0,
    'synth-unison': focusedSyn.voice.unison,

    // Layer Effects
    'fx-section-on': fx.allOn ? 1 : 0,
    'fx-focus-organ': fx.focusedChain === 'organ' ? 1 : 0,
    'fx-focus-piano': fx.focusedChain === 'pianoA' || fx.focusedChain === 'pianoB' ? 1 : 0,
    'fx-focus-synth':
      fx.focusedChain === 'synthA' || fx.focusedChain === 'synthB' || fx.focusedChain === 'synthC'
        ? 1
        : 0,
    'fx-shift': fx.shiftActive ? 1 : 0,

    'fx-mod1-on': disp.mod1.on ? 1 : 0,
    'fx-mod1-type': MOD1_TYPES.indexOf(disp.mod1.type),
    'fx-mod1-rate': Math.round(disp.mod1.rate),
    'fx-mod1-amount': Math.round(disp.mod1.amount),

    'fx-mod2-on': disp.mod2.on ? 1 : 0,
    'fx-mod2-type': MOD2_TYPES.indexOf(disp.mod2.type),
    'fx-mod2-rate': Math.round(disp.mod2.rate),
    'fx-mod2-amount': Math.round(disp.mod2.amount),

    'fx-amp-on': disp.ampEq.on ? 1 : 0,
    'fx-amp-type': AMP_EQ_TYPES.indexOf(disp.ampEq.type),
    'fx-amp-drive': Math.round(disp.ampEq.drive),
    'fx-amp-freq': Math.round(disp.ampEq.midFreq),
    'fx-eq-bass': Math.round(disp.ampEq.bass),
    'fx-eq-mid': Math.round(disp.ampEq.mid),
    'fx-eq-treble': Math.round(disp.ampEq.treble),

    'fx-delay-on': disp.delay.on ? 1 : 0,
    'fx-delay-tempo': Math.round(disp.delay.tempo),
    'fx-delay-type': DELAY_FILTER_TYPES.indexOf(disp.delay.filter),
    'fx-delay-feedback': Math.round(disp.delay.feedback),
    'fx-delay-dry-wet': Math.round(disp.delay.dryWet),
    'fx-delay-pingpong': disp.delay.pingPong ? 1 : 0,

    'fx-comp-on': disp.comp.on ? 1 : 0,
    'fx-comp-amount': Math.round(disp.comp.amount),
    'fx-comp-fast': disp.comp.fast ? 1 : 0,

    'fx-reverb-on': disp.reverb.on ? 1 : 0,
    'fx-reverb-type': REVERB_TYPES.indexOf(disp.reverb.type),
    'fx-reverb-tone': REVERB_TONES.indexOf(disp.reverb.tone),
    'fx-reverb-dry-wet': Math.round(disp.reverb.dryWet),
  }
}

export { FULL_KEYBOARD_ZONE }
