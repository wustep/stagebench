import type { LayerId, PianoType } from '../audio/samples'
export type { LayerId, PianoType }

export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'] as const
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export const DELAY_FILTERS = ['Off', 'LP', 'HP', 'BP'] as const
export const KB_TOUCH = ['Heavy', 'Medium', 'Light'] as const
export const DYN_COMP = ['Off', 1, 2, 3] as const
export const UNISON = ['Off', 1, 2, 3] as const
export const TIMBRE_ACOUSTIC = ['Off', 'Soft', 'Mid', 'Bright'] as const
export const TIMBRE_ELECTRIC = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const

export type Mod1Type = (typeof MOD1_TYPES)[number]
export type Mod2Type = (typeof MOD2_TYPES)[number]
export type AmpType = (typeof AMP_TYPES)[number]
export type ReverbType = (typeof REVERB_TYPES)[number]
export type DelayFilter = (typeof DELAY_FILTERS)[number]
export type FxSection = 'organ' | 'piano' | 'synth'
export type TimbreName = (typeof TIMBRE_ELECTRIC)[number]

export interface LayerFx {
  mod1On: boolean
  mod1Type: Mod1Type
  mod1Rate: number
  mod1Amount: number
  mod2On: boolean
  mod2Type: Mod2Type
  mod2Rate: number
  mod2Amount: number
  delayOn: boolean
  delayTempo: number
  delayFeedback: number
  delayMix: number
  delayFilter: DelayFilter
  ampOn: boolean
  ampType: AmpType
  ampDrive: number
  ampBass: number
  ampMid: number
  ampMidFreq: number
  ampTreble: number
  compOn: boolean
  compAmount: number
  compFast: boolean
  reverbOn: boolean
  reverbType: ReverbType
  reverbMix: number
  reverbBright: boolean
}

export interface LayerState {
  id: LayerId
  enable: boolean
  focus: boolean
  level: number
  octave: number
  type: PianoType
  model: number
  kbTouch: (typeof KB_TOUCH)[number]
  dynComp: (typeof DYN_COMP)[number]
  timbre: TimbreName
  unison: (typeof UNISON)[number]
  softRelease: boolean
  stringRes: boolean
  sustped: boolean
  pstick: boolean
  fx: LayerFx
}

export interface InstrumentState {
  pianoOn: boolean
  masterLevel: number
  pitchStick: number
  fxSectionOn: boolean
  fxSectionFocus: FxSection
  pianoGroup: boolean
  delayGlobal: boolean
  compGlobal: boolean
  reverbGlobal: boolean
  rotaryOn: boolean
  rotarySpeed: number
  rotaryDrive: number
  layers: Record<LayerId, LayerState>
}

export function discrete<T>(value: number, options: readonly T[]): T {
  if (options.length <= 1) return options[0]
  const t = Math.min(1, Math.max(0, value))
  const i = Math.min(options.length - 1, Math.round(t * (options.length - 1)))
  return options[i]
}

export function cycleIndex(value: number, length: number): number {
  return ((Math.round(value) % length) + length) % length
}

export function defaultLayerFx(): LayerFx {
  return {
    mod1On: false,
    mod1Type: 'Tremolo',
    mod1Rate: 0.4,
    mod1Amount: 0.35,
    mod2On: false,
    mod2Type: 'Chorus',
    mod2Rate: 0.4,
    mod2Amount: 0.35,
    delayOn: false,
    delayTempo: 0.45,
    delayFeedback: 0.25,
    delayMix: 0.2,
    delayFilter: 'Off',
    ampOn: false,
    ampType: 'EQ only',
    ampDrive: 0.2,
    ampBass: 0.5,
    ampMid: 0.5,
    ampMidFreq: 0.4,
    ampTreble: 0.5,
    compOn: false,
    compAmount: 0.3,
    compFast: false,
    reverbOn: false,
    reverbType: 'Stage',
    reverbMix: 0.28,
    reverbBright: true,
  }
}

export function defaultInstrumentState(): InstrumentState {
  const fx = defaultLayerFx()
  return {
    pianoOn: true,
    masterLevel: 0.72,
    pitchStick: 0,
    fxSectionOn: true,
    fxSectionFocus: 'piano',
    pianoGroup: false,
    delayGlobal: false,
    compGlobal: false,
    reverbGlobal: false,
    rotaryOn: false,
    rotarySpeed: 0.35,
    rotaryDrive: 0.2,
    layers: {
      A: {
        id: 'A',
        enable: true,
        focus: true,
        level: 0.8,
        octave: 0,
        type: 'grand',
        model: 0,
        kbTouch: 'Medium',
        dynComp: 'Off',
        timbre: 'Mid',
        unison: 'Off',
        softRelease: false,
        stringRes: false,
        sustped: true,
        pstick: false,
        fx: { ...fx },
      },
      B: {
        id: 'B',
        enable: false,
        focus: false,
        level: 0.6,
        octave: 0,
        type: 'grand',
        model: 0,
        kbTouch: 'Medium',
        dynComp: 'Off',
        timbre: 'Mid',
        unison: 'Off',
        softRelease: false,
        stringRes: false,
        sustped: true,
        pstick: false,
        fx: { ...defaultLayerFx() },
      },
    },
  }
}

export function focusedLayer(state: InstrumentState): LayerId {
  if (state.layers.B.focus && !state.layers.A.focus) return 'B'
  return 'A'
}

export function delayTimeSec(tempoKnob: number): number {
  const bpm = 40 + tempoKnob * 200
  return 60 / bpm
}

export function copyFx(fx: LayerFx): LayerFx {
  return { ...fx }
}
