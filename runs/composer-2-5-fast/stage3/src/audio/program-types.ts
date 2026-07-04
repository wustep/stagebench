import {
  defaultEffectsState,
  defaultInstrumentState,
  type InstrumentAudioState,
} from './types'

export const SPLIT_POSITIONS = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96] as const
export type SplitPositionMidi = (typeof SPLIT_POSITIONS)[number]
export type CrossfadeWidth = 0 | 6 | 12

export type OrganModel = 'B3' | 'Vox' | 'Farf' | 'Pipe'
export type SynthLayerId = 'A' | 'B' | 'C'
export type EngineLayerRef =
  | { engine: 'piano'; layer: 'A' | 'B' }
  | { engine: 'organ'; layer: 'A' | 'B' }
  | { engine: 'synth'; layer: SynthLayerId }

export interface OrganLayerState {
  enabled: boolean
  focused: boolean
  level: number
  octave: number
  model: OrganModel
  drawbars: number[]
  vibChorus: number
  vibOn: boolean
}

export interface OrganState {
  sectionOn: boolean
  layerA: OrganLayerState
  layerB: OrganLayerState
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean }
  keyClick: number
  sustPed: boolean
  rotaryRoute: boolean
}

export type SynthWaveCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export type SynthVoiceMode = 'Poly' | 'Mono' | 'Legato'
export type SynthFilterType = 'LP12' | 'LP24' | 'HP' | 'BP'
export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random'
export type ArpMode = 'Arp' | 'Poly' | 'Gate'

export interface SynthLayerState {
  enabled: boolean
  focused: boolean
  level: number
  octave: number
  category: SynthWaveCategory
  waveformIndex: number
  oscCtrl: number
  filterType: SynthFilterType
  filterFreq: number
  filterRes: number
  filterDrive: number
  filterTrack: number
  filterEnvAmt: number
  oscAttack: number
  oscDecay: number
  oscRelease: number
  filterAttack: number
  filterDecay: number
  filterRelease: number
  ampAttack: number
  ampDecay: number
  ampRelease: number
  ampVelocity: number
  lfoWave: number
  lfoRate: number
  lfoAmount: number
  lfoDest: number
  voiceMode: SynthVoiceMode
  priority: number
  glide: number
  unison: number
  vibratoOn: boolean
  vibratoRate: number
  vibratoAmount: number
  arpMode: ArpMode
  arpRate: number
  arpRange: number
  arpDirection: ArpDirection
  arpHold: boolean
  arpRun: boolean
  sustPed: boolean
}

export interface SynthState {
  sectionOn: boolean
  layerA: SynthLayerState
  layerB: SynthLayerState
  layerC: SynthLayerState
}

export interface SplitPointState {
  positionIndex: number
  crossfade: CrossfadeWidth
}

export interface SplitState {
  enabled: boolean
  low: SplitPointState
  mid: SplitPointState
  high: SplitPointState
}

export interface ZoneAssignment {
  layer: EngineLayerRef
  zoneStart: number
  zoneEnd: number
}

export interface LayerSceneConfig {
  pianoA: boolean
  pianoB: boolean
  organA: boolean
  organB: boolean
  synthA: boolean
  synthB: boolean
  synthC: boolean
}

export interface MorphDestination {
  controlId: string
  start: number
  end: number
}

export interface MorphState {
  wheel: MorphDestination[]
  pedal: MorphDestination[]
}

export interface MasterClockState {
  bpm: number
  keyboardSync: boolean
}

export interface PerformanceState {
  transpose: number
  modWheel: number
  controlPedal: number
  pitchStick: number
}

export interface ProgramSystemState {
  slots: ProgramSlot[]
  liveSlots: ProgramSlot[]
  currentPage: number
  currentButton: number
  liveMode: boolean
  dirty: boolean
  activeScene: 'I' | 'II'
  sceneI: LayerSceneConfig
  sceneII: LayerSceneConfig
  split: SplitState
  zones: ZoneAssignment[]
  morph: MorphState
  clock: MasterClockState
  performance: PerformanceState
  storeMode: 'idle' | 'select' | 'naming'
  storeAsName: string
  listViewOpen: boolean
}

export interface ProgramSlot {
  name: string
  state: SerializableProgramState
}

/** Program payload excludes master level per programs spec. */
export type SerializableProgramState = Omit<InstrumentAudioState, 'masterLevel'> & {
  organ: OrganState
  synth: SynthState
  split: SplitState
  zones: ZoneAssignment[]
  sceneI: LayerSceneConfig
  sceneII: LayerSceneConfig
  morph: MorphState
  clock: MasterClockState
  performance: PerformanceState
}

export function defaultOrganLayer(focused: boolean, model: OrganModel = 'B3'): OrganLayerState {
  return {
    enabled: true,
    focused,
    level: 100,
    octave: 0,
    model,
    drawbars: model === 'Farf' ? [0, 0, 4, 0, 4, 0, 0, 0, 0] : [0, 0, 4, 0, 4, 0, 0, 0, 0],
    vibChorus: 0,
    vibOn: false,
  }
}

export function defaultOrganState(): OrganState {
  return {
    sectionOn: true,
    layerA: defaultOrganLayer(true, 'B3'),
    layerB: defaultOrganLayer(false, 'Vox'),
    percussion: { on: false, soft: false, fast: false, third: false },
    keyClick: 64,
    sustPed: true,
    rotaryRoute: false,
  }
}

export function defaultSynthLayer(focused: boolean): SynthLayerState {
  return {
    enabled: true,
    focused,
    level: 100,
    octave: 0,
    category: 'Pure',
    waveformIndex: 2,
    oscCtrl: 64,
    filterType: 'LP24',
    filterFreq: 90,
    filterRes: 20,
    filterDrive: 0,
    filterTrack: 64,
    filterEnvAmt: 64,
    oscAttack: 0,
    oscDecay: 64,
    oscRelease: 40,
    filterAttack: 10,
    filterDecay: 64,
    filterRelease: 40,
    ampAttack: 0,
    ampDecay: 64,
    ampRelease: 40,
    ampVelocity: 127,
    lfoWave: 0,
    lfoRate: 64,
    lfoAmount: 0,
    lfoDest: 0,
    voiceMode: 'Poly',
    priority: 0,
    glide: 0,
    unison: 0,
    vibratoOn: false,
    vibratoRate: 64,
    vibratoAmount: 0,
    arpMode: 'Arp',
    arpRate: 64,
    arpRange: 1,
    arpDirection: 'Up',
    arpHold: false,
    arpRun: false,
    sustPed: true,
  }
}

export function defaultSynthState(): SynthState {
  return {
    sectionOn: true,
    layerA: defaultSynthLayer(true),
    layerB: defaultSynthLayer(false),
    layerC: defaultSynthLayer(false),
  }
}

export function defaultLayerScene(): LayerSceneConfig {
  return {
    pianoA: true,
    pianoB: true,
    organA: false,
    organB: false,
    synthA: false,
    synthB: false,
    synthC: false,
  }
}

export function defaultSplitState(): SplitState {
  return {
    enabled: false,
    low: { positionIndex: 4, crossfade: 0 },
    mid: { positionIndex: 4, crossfade: 0 },
    high: { positionIndex: 8, crossfade: 0 },
  }
}

export function defaultZones(): ZoneAssignment[] {
  return [
    { layer: { engine: 'piano', layer: 'A' }, zoneStart: 0, zoneEnd: 127 },
    { layer: { engine: 'piano', layer: 'B' }, zoneStart: 0, zoneEnd: 127 },
    { layer: { engine: 'organ', layer: 'A' }, zoneStart: 0, zoneEnd: 127 },
    { layer: { engine: 'organ', layer: 'B' }, zoneStart: 0, zoneEnd: 127 },
    { layer: { engine: 'synth', layer: 'A' }, zoneStart: 0, zoneEnd: 127 },
    { layer: { engine: 'synth', layer: 'B' }, zoneStart: 0, zoneEnd: 127 },
    { layer: { engine: 'synth', layer: 'C' }, zoneStart: 0, zoneEnd: 127 },
  ]
}

export function defaultMorphState(): MorphState {
  return { wheel: [], pedal: [] }
}

export function defaultClockState(): MasterClockState {
  return { bpm: 120, keyboardSync: false }
}

export function defaultPerformanceState(): PerformanceState {
  return { transpose: 0, modWheel: 64, controlPedal: 0, pitchStick: 64 }
}

export function createSerializableState(base?: Partial<SerializableProgramState>): SerializableProgramState {
  const core = defaultInstrumentState()
  return {
    pianoA: base?.pianoA ?? core.pianoA,
    pianoB: base?.pianoB ?? core.pianoB,
    pianoPerf: base?.pianoPerf ?? core.pianoPerf,
    effects: base?.effects ?? defaultEffectsState(),
    organ: base?.organ ?? defaultOrganState(),
    synth: base?.synth ?? defaultSynthState(),
    split: base?.split ?? defaultSplitState(),
    zones: base?.zones ?? defaultZones(),
    sceneI: base?.sceneI ?? defaultLayerScene(),
    sceneII: base?.sceneII ?? defaultLayerScene(),
    activeScene: base?.activeScene ?? 'I',
    morph: base?.morph ?? defaultMorphState(),
    clock: base?.clock ?? defaultClockState(),
    performance: base?.performance ?? defaultPerformanceState(),
  }
}

export function createEmptySlot(index: number): ProgramSlot {
  return {
    name: `Init ${index + 1}`,
    state: createSerializableState(),
  }
}

export const SYNTH_WAVEFORMS: Record<SynthWaveCategory, string[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
}

export function splitMidiAt(index: number): number {
  return SPLIT_POSITIONS[Math.max(0, Math.min(SPLIT_POSITIONS.length - 1, index))] ?? 60
}
