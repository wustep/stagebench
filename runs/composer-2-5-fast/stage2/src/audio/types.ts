export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type PianoLayerId = 'A' | 'B'

export const PIANO_TYPES: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']

export type KbTouch = 'Heavy' | 'Medium' | 'Light'
export type DynCompLevel = 'Off' | '1' | '2' | '3'
export type UnisonLevel = 'Off' | '1' | '2' | '3'
export type AcousticTimbre = 'Off' | 'Soft' | 'Mid' | 'Bright'
export type ElectricTimbre = AcousticTimbre | 'Dyno 1' | 'Dyno 2'

export interface PianoLayerState {
  enabled: boolean
  focused: boolean
  level: number
  octave: number
  typeIndex: number
  modelDial: number
  sustPed: boolean
}

export interface PianoPerformanceState {
  kbTouch: KbTouch
  dynComp: DynCompLevel
  timbreIndex: number
  unison: UnisonLevel
  softRelease: boolean
  stringRes: boolean
  sectionOn: boolean
}

export interface EffectUnitState {
  bypass: boolean
  type: number
  rate: number
  amount: number
  mix: number
  feedback: number
  global: boolean
  fastMode?: boolean
  toRotary?: boolean
}

export interface EffectsState {
  layerAFocus: boolean
  layerBFocus: boolean
  pianoGroup: boolean
  allBypass: boolean
  mod1: EffectUnitState
  mod2: EffectUnitState
  delay: EffectUnitState
  amp: EffectUnitState
  comp: EffectUnitState
  reverb: EffectUnitState
  rotaryOn: boolean
  rotarySpeed: 'slow' | 'fast'
  rotaryDrive: number
}

export interface InstrumentAudioState {
  masterLevel: number
  pianoA: PianoLayerState
  pianoB: PianoLayerState
  pianoPerf: PianoPerformanceState
  effects: EffectsState
}

export function defaultLayerState(focused: boolean): PianoLayerState {
  return {
    enabled: true,
    focused,
    level: 100,
    octave: 0,
    typeIndex: 0,
    modelDial: 64,
    sustPed: true,
  }
}

export function defaultEffectsState(): EffectsState {
  const unit = (): EffectUnitState => ({
    bypass: false,
    type: 0,
    rate: 64,
    amount: 64,
    mix: 0,
    feedback: 40,
    global: false,
  })
  return {
    layerAFocus: true,
    layerBFocus: false,
    pianoGroup: false,
    allBypass: false,
    mod1: unit(),
    mod2: unit(),
    delay: { ...unit(), mix: 0, feedback: 40 },
    amp: { ...unit(), type: 0 },
    comp: { ...unit(), fastMode: false },
    reverb: { ...unit(), mix: 0 },
    rotaryOn: false,
    rotarySpeed: 'slow',
    rotaryDrive: 64,
  }
}

export function defaultInstrumentState(): InstrumentAudioState {
  return {
    masterLevel: 100,
    pianoA: defaultLayerState(true),
    pianoB: defaultLayerState(false),
    pianoPerf: {
      kbTouch: 'Medium',
      dynComp: 'Off',
      timbreIndex: 0,
      unison: 'Off',
      softRelease: false,
      stringRes: false,
      sectionOn: true,
    },
    effects: defaultEffectsState(),
  }
}
