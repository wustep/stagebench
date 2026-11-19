import type { LayerZoneRange } from './splits'
import { FULL_KEYBOARD_ZONE } from './splits'

// ===================== Organ Section Types =====================

export type OrganLayerId = 'A' | 'B'
export type OrganModelId = 'B3' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2' | 'B3 Bass'
export type OrganVibChorusType = 'V1' | 'C1' | 'V2' | 'C2' | 'V3' | 'C3'

export const ORGAN_MODELS: readonly OrganModelId[] = [
  'B3',
  'Vox',
  'Farf',
  'Pipe 1',
  'Pipe 2',
  'B3 Bass',
]

export const ORGAN_VIB_CHORUS_TYPES: readonly OrganVibChorusType[] = [
  'V1',
  'C1',
  'V2',
  'C2',
  'V3',
  'C3',
]

export type DrawbarTuple = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export interface B3PercussionState {
  readonly on: boolean
  readonly soft: boolean
  readonly fast: boolean
  readonly third: boolean
}

export interface OrganLayerState {
  readonly enabled: boolean
  readonly level: number // 0..100 (morphable)
  readonly octave: -1 | 0 | 1 // ±12 semitones
  readonly zone: LayerZoneRange
  readonly model: OrganModelId
  readonly drawbars: DrawbarTuple // 9 drawbars, each 0..8 (morphable)
  readonly vibChorusType: OrganVibChorusType
  readonly vibChorusOn: boolean
  readonly percussion: B3PercussionState
  readonly keyClick: boolean
}

export interface OrganSectionState {
  readonly sectionOn: boolean
  readonly focusedLayer: OrganLayerId
  readonly sustped: boolean
  readonly pstick: boolean
  readonly layers: {
    readonly A: OrganLayerState
    readonly B: OrganLayerState
  }
}

export function createDefaultOrganLayer(
  layerId: OrganLayerId,
  overrides: Partial<OrganLayerState> = {},
): OrganLayerState {
  return {
    enabled: layerId === 'A',
    level: layerId === 'A' ? 82 : 64,
    octave: 0,
    zone: FULL_KEYBOARD_ZONE,
    model: 'B3',
    drawbars: layerId === 'A' ? [8, 8, 8, 0, 0, 0, 0, 0, 0] : [0, 0, 8, 6, 4, 4, 0, 0, 0],
    vibChorusType: 'C3',
    vibChorusOn: layerId === 'A',
    percussion: {
      on: false,
      soft: false,
      fast: true,
      third: true,
    },
    keyClick: true,
    ...overrides,
  }
}

export function createDefaultOrganSection(
  overrides: Partial<OrganSectionState> = {},
): OrganSectionState {
  return {
    sectionOn: false,
    focusedLayer: 'A',
    sustped: false,
    pstick: true,
    layers: {
      A: createDefaultOrganLayer('A'),
      B: createDefaultOrganLayer('B'),
    },
    ...overrides,
  }
}

// ===================== Synth Section Types =====================

export type SynthLayerId = 'A' | 'B' | 'C'
export type SynthModeId = 'Samples' | 'Analog' | 'Extern'
export type SynthOscCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'

export type SynthWaveformId =
  // Pure
  | 'Sine'
  | 'Triangle'
  | 'Saw'
  | 'Square'
  | 'Pulse 33'
  | 'Pulse 10'
  | 'White Noise'
  // Sync
  | 'Sync Saw'
  | 'Sync Square'
  // Multi
  | 'Multi Saw'
  | 'Multi Saw 8ve'
  // Super
  | 'Super Saw'
  | 'Super Square'
  // FM-H
  | 'FM 2-op'

export const SYNTH_MODES: readonly SynthModeId[] = ['Samples', 'Analog', 'Extern']
export const SYNTH_OSC_CATEGORIES: readonly SynthOscCategory[] = [
  'Pure',
  'Sync',
  'Multi',
  'Super',
  'FM-H',
]

export const SYNTH_WAVEFORMS_BY_CATEGORY: Readonly<
  Record<SynthOscCategory, readonly SynthWaveformId[]>
> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op'],
}

export const ALL_REQUIRED_SYNTH_WAVEFORMS: readonly SynthWaveformId[] = SYNTH_OSC_CATEGORIES.flatMap(
  (cat) => SYNTH_WAVEFORMS_BY_CATEGORY[cat],
)

export function getCategoryForWaveform(wave: SynthWaveformId): SynthOscCategory {
  for (const cat of SYNTH_OSC_CATEGORIES) {
    if (SYNTH_WAVEFORMS_BY_CATEGORY[cat].includes(wave)) return cat
  }
  return 'Pure'
}

export type SynthFilterType = 'LP12' | 'LP24' | 'LP M' | 'HP' | 'BP' | 'LP+HP'
export const SYNTH_FILTER_TYPES: readonly SynthFilterType[] = [
  'LP12',
  'LP24',
  'LP M',
  'HP',
  'BP',
  'LP+HP',
]

export type SynthKbTrackLevel = 0 | 1 | 2 | 3 // Off, 1/3, 2/3, 1
export const SYNTH_KB_TRACK_LABELS: readonly string[] = ['Off', '1/3', '2/3', '1']

export type SynthFilterDriveLevel = 0 | 1 | 2 | 3 // Off, 1, 2, 3

export type SynthLfoWaveform = 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold'
export const SYNTH_LFO_WAVEFORMS: readonly SynthLfoWaveform[] = [
  'Triangle',
  'Saw down',
  'Saw up',
  'Square',
  'Sample & Hold',
]

export type SynthLfoDestination = 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
export const SYNTH_LFO_DESTINATIONS: readonly SynthLfoDestination[] = [
  'Off',
  'Osc Pitch',
  'Osc Ctrl',
  'Filter Freq',
]

export type SynthVoiceMode = 'Poly' | 'Mono' | 'Legato'
export const SYNTH_VOICE_MODES: readonly SynthVoiceMode[] = ['Poly', 'Mono', 'Legato']

export type SynthNotePriority = 'Off' | 'Low' | 'High'
export const SYNTH_NOTE_PRIORITIES: readonly SynthNotePriority[] = ['Off', 'Low', 'High']

export type SynthVibratoMode = 'Off' | 'On' | 'Wheel' | 'Delayed' | 'Pedal'
export const SYNTH_VIBRATO_MODES: readonly SynthVibratoMode[] = [
  'Off',
  'On',
  'Wheel',
  'Delayed',
  'Pedal',
]

export type SynthArpMode = 'Poly' | 'Arp' | 'Gate'
export const SYNTH_ARP_MODES: readonly SynthArpMode[] = ['Poly', 'Arp', 'Gate']

export type SynthArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random'
export const SYNTH_ARP_DIRECTIONS: readonly SynthArpDirection[] = [
  'Up',
  'Down',
  'Up/Down',
  'Random',
]

export type SynthOledView =
  | 'wave'
  | 'osc-pitch'
  | 'osc-env'
  | 'filter'
  | 'filter-env'
  | 'amp-env'
  | 'arp'
  | 'voice-vib'

export interface SynthOscEnvState {
  readonly attack: number // 0..100
  readonly decay: number // 0..100 (100 = sustain hold)
  readonly release: number // 0..100
  readonly velocity: boolean
  readonly toPitch: boolean
  readonly amount: number // 0..100 (50 = 0 bipolar center)
}

export interface SynthFilterEnvState {
  readonly attack: number // 0..100
  readonly decay: number // 0..100 (100 = sustain hold)
  readonly release: number // 0..100
  readonly velocity: boolean
}

export interface SynthAmpEnvState {
  readonly attack: number // 0..100
  readonly decay: number // 0..100 (100 = sustain hold)
  readonly release: number // 0..100
  readonly velocity: 0 | 1 | 2 | 3 // Off, 1, 2, 3
}

export interface SynthFilterState {
  readonly on: boolean
  readonly type: SynthFilterType
  readonly freq: number // 0..100 (morphable)
  readonly res: number // 0..100 (morphable)
  readonly envAmt: number // 0..100
  readonly kbTrack: SynthKbTrackLevel
  readonly drive: SynthFilterDriveLevel
}

export interface SynthLfoState {
  readonly waveform: SynthLfoWaveform
  readonly destination: SynthLfoDestination
  readonly rate: number // 0..100 (morphable, clock-syncable)
  readonly amount: number // 0..100 (morphable)
  readonly clockSync: boolean
}

export interface SynthVoiceState {
  readonly mode: SynthVoiceMode
  readonly priority: SynthNotePriority
  readonly glide: number // 0..100
  readonly unison: 0 | 1 | 2 | 3
}

export interface SynthVibratoState {
  readonly mode: SynthVibratoMode
  readonly rateHz: number // 2.0..8.0 Hz
  readonly amount: number // 0..10
}

export interface SynthArpState {
  readonly run: boolean
  readonly kbHold: boolean
  readonly mode: SynthArpMode
  readonly rate: number // 0..100 (morphable, clock-syncable)
  readonly clockSync: boolean
  readonly range: 1 | 2 | 3 | 4 // octaves in Arp/Poly
  readonly gateEnv: number // 0..100 gate envelope hardness in Gate mode
  readonly direction: SynthArpDirection
}

export interface SynthLayerState {
  readonly enabled: boolean
  readonly level: number // 0..100 (morphable)
  readonly octave: -1 | 0 | 1 // ±12 semitones
  readonly zone: LayerZoneRange
  readonly mode: SynthModeId
  readonly oscCategory: SynthOscCategory
  readonly oscWaveform: SynthWaveformId
  readonly oscCtrl: number // 0..100 (0..10, morphable)
  readonly pitchCoarse: number // -24..24 semitones
  readonly pitchFine: number // -50..50 cents
  readonly oscEnv: SynthOscEnvState
  readonly filter: SynthFilterState
  readonly filterEnv: SynthFilterEnvState
  readonly ampEnv: SynthAmpEnvState
  readonly lfo: SynthLfoState
  readonly voice: SynthVoiceState
  readonly vibrato: SynthVibratoState
  readonly arp: SynthArpState
}

export interface SynthSectionState {
  readonly sectionOn: boolean
  readonly focusedLayer: SynthLayerId
  readonly sustped: boolean
  readonly pstick: boolean
  readonly layers: {
    readonly A: SynthLayerState
    readonly B: SynthLayerState
    readonly C: SynthLayerState
  }
}

export function createDefaultSynthLayer(
  layerId: SynthLayerId,
  overrides: Partial<SynthLayerState> = {},
): SynthLayerState {
  return {
    enabled: layerId === 'A',
    level: layerId === 'A' ? 90 : layerId === 'B' ? 68 : 74,
    octave: 0,
    zone: FULL_KEYBOARD_ZONE,
    mode: 'Analog',
    oscCategory: 'Pure',
    oscWaveform: 'Saw',
    oscCtrl: 30,
    pitchCoarse: 0,
    pitchFine: 0,
    oscEnv: {
      attack: 5,
      decay: 40,
      release: 25,
      velocity: false,
      toPitch: false,
      amount: 50, // 50 = centered 0 bipolar
    },
    filter: {
      on: true,
      type: 'LP24',
      freq: 35,
      res: 28,
      envAmt: 48,
      kbTrack: 1,
      drive: 0,
    },
    filterEnv: {
      attack: 4,
      decay: 45,
      release: 32,
      velocity: true,
    },
    ampEnv: {
      attack: 3,
      decay: 100, // 100 = sustain mode
      release: 30,
      velocity: 2,
    },
    lfo: {
      waveform: 'Triangle',
      destination: 'Filter Freq',
      rate: 26,
      amount: 0,
      clockSync: false,
    },
    voice: {
      mode: 'Poly',
      priority: 'Off',
      glide: 20,
      unison: 0,
    },
    vibrato: {
      mode: 'Wheel',
      rateHz: 5.5,
      amount: 4,
    },
    arp: {
      run: false,
      kbHold: false,
      mode: 'Arp',
      rate: 38,
      clockSync: false,
      range: 1,
      gateEnv: 52,
      direction: 'Up',
    },
    ...overrides,
  }
}

export function createDefaultSynthSection(
  overrides: Partial<SynthSectionState> = {},
): SynthSectionState {
  return {
    sectionOn: false,
    focusedLayer: 'A',
    sustped: true,
    pstick: true,
    layers: {
      A: createDefaultSynthLayer('A'),
      B: createDefaultSynthLayer('B'),
      C: createDefaultSynthLayer('C'),
    },
    ...overrides,
  }
}

// ===================== Layer Scenes, Master Clock, Transpose =====================

export interface LayerEnableSnapshot {
  readonly organSectionOn: boolean
  readonly organA: boolean
  readonly organB: boolean
  readonly pianoSectionOn: boolean
  readonly pianoA: boolean
  readonly pianoB: boolean
  readonly synthSectionOn: boolean
  readonly synthA: boolean
  readonly synthB: boolean
  readonly synthC: boolean
}

export type LayerSceneId = 'I' | 'II'

export interface LayerScenesState {
  readonly activeScene: LayerSceneId
  readonly sceneI: LayerEnableSnapshot
  readonly sceneII: LayerEnableSnapshot
}

export interface MasterClockState {
  readonly bpm: number // 30..300
  readonly kbSync: boolean
}

export interface TransposeState {
  readonly enabled: boolean
  readonly semitones: number // -6..6
}

export function createDefaultMasterClockState(): MasterClockState {
  return { bpm: 120, kbSync: false }
}

export function createDefaultTransposeState(): TransposeState {
  return { enabled: false, semitones: 0 }
}

// ===================== Master Clock Subdivision Helpers =====================

export interface ClockSubdivisionSpec {
  readonly label: string
  readonly beatsPerCycle: number // in quarter notes (1 = 1/4, 0.5 = 1/8, etc.)
}

export const CLOCK_SUBDIVISIONS: readonly ClockSubdivisionSpec[] = [
  { label: '1/2', beatsPerCycle: 2 },
  { label: '1/2T', beatsPerCycle: 4 / 3 },
  { label: '1/4', beatsPerCycle: 1 },
  { label: '1/4T', beatsPerCycle: 2 / 3 },
  { label: '1/8', beatsPerCycle: 0.5 },
  { label: '1/8T', beatsPerCycle: 1 / 3 },
  { label: '1/16', beatsPerCycle: 0.25 },
  { label: '1/16T', beatsPerCycle: 1 / 6 },
]

export function knobToClockSubdivision(knob0To100: number): ClockSubdivisionSpec {
  const clamped = Math.max(0, Math.min(100, knob0To100))
  const idx = Math.min(
    CLOCK_SUBDIVISIONS.length - 1,
    Math.floor((clamped / 100) * CLOCK_SUBDIVISIONS.length),
  )
  return CLOCK_SUBDIVISIONS[idx]
}

export function masterClockSubdivisionSeconds(bpm: number, knob0To100: number): number {
  const safeBpm = Math.max(30, Math.min(300, bpm))
  const sub = knobToClockSubdivision(knob0To100)
  return (60 / safeBpm) * sub.beatsPerCycle
}

export function masterClockSubdivisionHz(bpm: number, knob0To100: number): number {
  return 1 / Math.max(0.02, masterClockSubdivisionSeconds(bpm, knob0To100))
}

/**
 * Converts a 0..100 envelope knob into seconds using a musical exponential curve.
 * Attack: 0.002s .. 4.0s; Decay/Release: 0.015s .. 6.0s.
 */
export function envKnobToSeconds(knob0To100: number, kind: 'attack' | 'decay' | 'release'): number {
  const norm = Math.max(0, Math.min(100, knob0To100)) / 100
  if (kind === 'attack') {
    return 0.002 * Math.pow(2000, norm)
  }
  return 0.015 * Math.pow(400, norm)
}
