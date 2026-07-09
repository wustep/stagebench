export type LayerId = 'A' | 'B'
export type SynthLayerId = 'A' | 'B' | 'C'
export type EngineSection = 'organ' | 'piano' | 'synth'
export type LayerAddress = `organ:${LayerId}` | `piano:${LayerId}` | `synth:${SynthLayerId}`
export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type KbTouch = 'Heavy' | 'Medium' | 'Light'
export type Timbre = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2'
export type FeedbackFilter = 'Off' | 'LP' | 'HP' | 'BP'
export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump'
export type Mod2Type = 'Chorus' | 'Flanger' | 'Phaser' | 'Vibe' | 'Ensemble' | 'Spin'
export type AmpType = 'EQ only' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'To Rotary'
export type ReverbType = 'Room' | 'Booth' | 'Spring' | 'Stage' | 'Hall' | 'Cathedral'
export type EffectUnitId = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'
export type EffectTarget = 'organ' | 'piano:A' | 'piano:B' | 'synth:A' | 'synth:B' | 'synth:C'
export type OrganModel = 'B3' | 'B3 Bass' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2'
export type VibratoChorus = 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'
export type SynthCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export type SynthWaveform =
  | 'Sine' | 'Triangle' | 'Saw' | 'Square' | 'Pulse 33' | 'Pulse 10' | 'White Noise'
  | 'Sync Saw' | 'Sync Square' | 'Multi Saw' | 'Multi Saw 8ve' | 'Super Saw' | 'Super Square'
  | 'FM 2-op (algorithm A)'
export type FilterType = 'LP12' | 'LP24' | 'HP' | 'BP'
export type FilterTracking = 'Off' | '1/3' | '2/3' | '1'
export type LfoWaveform = 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold'
export type LfoDestination = 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
export type VoiceMode = 'Poly' | 'Mono' | 'Legato'
export type NotePriority = 'Off' | 'Low' | 'High'
export type VibratoMode = 'On' | 'Wheel'
export type ArpMode = 'Arp' | 'Poly' | 'Gate'
export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random'
export type SplitPosition = 'C2' | 'F2' | 'C3' | 'F3' | 'C4' | 'F4' | 'C5' | 'F5' | 'C6' | 'F6' | 'C7'
export type CrossfadeWidth = 0 | 6 | 12
export type ZoneIndex = 0 | 1 | 2 | 3
export type SceneId = 'I' | 'II'
export type MorphSource = 'wheel' | 'controlPedal'

export const PIANO_TYPES: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
export const KB_TOUCHES: KbTouch[] = ['Heavy', 'Medium', 'Light']
export const TIMBRES: Timbre[] = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2']
export const MOD1_TYPES: Mod1Type[] = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
export const MOD2_TYPES: Mod2Type[] = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
export const AMP_TYPES: AmpType[] = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
export const REVERB_TYPES: ReverbType[] = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']
export const FEEDBACK_FILTERS: FeedbackFilter[] = ['Off', 'LP', 'HP', 'BP']
export const ORGAN_MODELS: OrganModel[] = ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2']
export const VIBRATO_CHORUS: VibratoChorus[] = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3']
export const SYNTH_WAVEFORMS: Record<SynthCategory, SynthWaveform[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
}
export const SYNTH_CATEGORIES = Object.keys(SYNTH_WAVEFORMS) as SynthCategory[]
export const FILTER_TYPES: FilterType[] = ['LP12', 'LP24', 'HP', 'BP']
export const FILTER_TRACKING: FilterTracking[] = ['Off', '1/3', '2/3', '1']
export const LFO_WAVEFORMS: LfoWaveform[] = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold']
export const LFO_DESTINATIONS: LfoDestination[] = ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq']
export const VOICE_MODES: VoiceMode[] = ['Poly', 'Mono', 'Legato']
export const NOTE_PRIORITIES: NotePriority[] = ['Off', 'Low', 'High']
export const ARP_MODES: ArpMode[] = ['Arp', 'Poly', 'Gate']
export const ARP_DIRECTIONS: ArpDirection[] = ['Up', 'Down', 'Up/Down', 'Random']
export const SPLIT_POSITIONS: SplitPosition[] = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']

export interface ZoneRange { from: ZoneIndex; to: ZoneIndex }

export interface PianoLayerState {
  enabled: boolean
  level: number
  octave: -12 | 0 | 12
  sustped: boolean
  pstick: boolean
  type: PianoType
  model: string
  kbTouch: KbTouch
  dynComp: 0 | 1 | 2 | 3
  timbre: Timbre
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
  zone?: ZoneRange
}

export interface EffectUnitState {
  on: boolean
  type: string
  rate: number
  amount: number
  mix: number
  feedback: number
  filter: FeedbackFilter
  bright: number
  fast: boolean
  global: boolean
}

export interface EffectChainState {
  allBypass: boolean
  mod1: EffectUnitState
  mod2: EffectUnitState
  delay: EffectUnitState
  ampEq: EffectUnitState
  compressor: EffectUnitState
  reverb: EffectUnitState
}

export interface OrganLayerState {
  enabled: boolean
  level: number
  octave: -12 | 0 | 12
  sustped: boolean
  pstick: boolean
  model: OrganModel
  drawbars: number[]
  percussion: boolean
  percussionSoft: boolean
  percussionFast: boolean
  percussionThird: boolean
  keyClick: boolean
  vibratoOn: boolean
  vibrato: VibratoChorus
  zone: ZoneRange
}

export interface EnvelopeState {
  attack: number
  decay: number
  release: number
  velocity: 0 | 1 | 2 | 3
  amount: number
}

export interface SynthLayerState {
  enabled: boolean
  level: number
  octave: -12 | 0 | 12
  sustped: boolean
  pstick: boolean
  category: SynthCategory
  waveform: SynthWaveform
  oscCtrl: number
  coarse: number
  fine: number
  filterType: FilterType
  filterFreq: number
  filterResonance: number
  filterTracking: FilterTracking
  filterDrive: 0 | 1 | 2 | 3
  oscEnvelope: EnvelopeState
  filterEnvelope: EnvelopeState
  ampEnvelope: EnvelopeState
  lfoWaveform: LfoWaveform
  lfoDestination: LfoDestination
  lfoRate: number
  lfoAmount: number
  lfoSync: boolean
  voiceMode: VoiceMode
  priority: NotePriority
  glide: number
  unison: 0 | 1 | 2 | 3
  vibratoMode: VibratoMode
  vibratoRate: number
  vibratoAmount: number
  arpMode: ArpMode
  arpRate: number
  arpSync: boolean
  arpRange: 1 | 2 | 3 | 4
  arpDirection: ArpDirection
  arpHold: boolean
  arpRun: boolean
  zone: ZoneRange
}

export interface SplitPointState {
  enabled: boolean
  position: SplitPosition
  crossfade: CrossfadeWidth
}

export interface SceneState {
  active: SceneId
  layers: Record<SceneId, Record<LayerAddress, boolean>>
}

export type MorphDestination =
  | LayerAddress
  | `organ:${LayerId}:drawbar:${number}` | 'rotary:speed'
  | `synth:${SynthLayerId}:oscCtrl` | `synth:${SynthLayerId}:lfoRate` | `synth:${SynthLayerId}:lfoAmount`
  | `synth:${SynthLayerId}:filterFreq` | `synth:${SynthLayerId}:filterResonance` | `synth:${SynthLayerId}:arpRate`
  | `${EffectTarget}:${EffectUnitId}:rate` | `${EffectTarget}:${EffectUnitId}:amount`
  | `${EffectTarget}:delay:feedback` | `${EffectTarget}:delay:mix` | `${EffectTarget}:reverb:mix`

export interface MorphAssignment { destination: MorphDestination; start: number; end: number }
export interface MorphState {
  values: Record<MorphSource, number>
  assignments: Record<MorphSource, MorphAssignment[]>
  editing: MorphSource | null
}

export interface InstrumentState {
  // Inherited Piano fields remain stable for Phase 1–2 callers.
  sectionOn: boolean
  focus: LayerId
  group: boolean
  masterLevel: number
  sustainDown: boolean
  pitchBend: number
  rotaryOn: boolean
  rotaryFast: boolean
  rotaryStopped: boolean
  rotaryDrive: number
  layers: Record<LayerId, PianoLayerState>
  effects: Record<LayerId, EffectChainState>
  organ: {
    sectionOn: boolean
    focus: LayerId
    layers: Record<LayerId, OrganLayerState>
    effects: EffectChainState
    rotaryRouted: boolean
  }
  synth: {
    sectionOn: boolean
    focus: SynthLayerId
    group: boolean
    layers: Record<SynthLayerId, SynthLayerState>
    effects: Record<SynthLayerId, EffectChainState>
  }
  effectsFocus: { section: EngineSection; layer: SynthLayerId }
  splits: { enabled: boolean; points: [SplitPointState, SplitPointState, SplitPointState] }
  scenes: SceneState
  morphs: MorphState
  masterClockBpm: number
  keyboardSync: boolean
  transpose: number
}

const unit = (type: string, overrides: Partial<EffectUnitState> = {}): EffectUnitState => ({
  on: false, type, rate: 0.42, amount: 0.38, mix: 0.28, feedback: 0.32,
  filter: 'Off', bright: 0.55, fast: false, global: false, ...overrides,
})

export const createEffectChain = (): EffectChainState => ({
  allBypass: false,
  mod1: unit('A-Pan'),
  mod2: unit('Chorus'),
  delay: unit('Digital', { mix: 0.2 }),
  ampEq: unit('EQ only'),
  compressor: unit('Compressor'),
  reverb: unit('Room', { mix: 0.24 }),
})

const defaultZone = (): ZoneRange => ({ from: 0, to: 3 })
const drawbars = (): number[] => [8, 8, 6, 4, 3, 2, 2, 1, 1]
const envelope = (amount = .5): EnvelopeState => ({ attack: .02, decay: .55, release: .32, velocity: 1, amount })

export const createOrganLayer = (model: OrganModel, enabled: boolean): OrganLayerState => ({
  enabled, level: enabled ? .72 : .58, octave: 0, sustped: false, pstick: false, model,
  drawbars: drawbars(), percussion: model === 'B3', percussionSoft: false, percussionFast: false,
  percussionThird: true, keyClick: true, vibratoOn: false, vibrato: 'C1', zone: defaultZone(),
})

export const createSynthLayer = (waveform: SynthWaveform, category: SynthCategory, enabled: boolean): SynthLayerState => ({
  enabled, level: enabled ? .62 : .5, octave: 0, sustped: true, pstick: true, category, waveform,
  oscCtrl: .35, coarse: 0, fine: 0, filterType: 'LP24', filterFreq: .68, filterResonance: .22,
  filterTracking: '2/3', filterDrive: 0, oscEnvelope: envelope(.18), filterEnvelope: envelope(.55),
  ampEnvelope: envelope(1), lfoWaveform: 'Triangle', lfoDestination: 'Off', lfoRate: .3,
  lfoAmount: .2, lfoSync: false, voiceMode: 'Poly', priority: 'Off', glide: .08, unison: 0,
  vibratoMode: 'Wheel', vibratoRate: 5.2, vibratoAmount: .18, arpMode: 'Arp', arpRate: .45,
  arpSync: false, arpRange: 1, arpDirection: 'Up', arpHold: false, arpRun: false, zone: defaultZone(),
})

const initialSceneLayers = (): Record<LayerAddress, boolean> => ({
  'organ:A': false, 'organ:B': false, 'piano:A': true, 'piano:B': false,
  'synth:A': false, 'synth:B': false, 'synth:C': false,
})

export const createInitialInstrumentState = (): InstrumentState => {
  const sceneI = initialSceneLayers()
  return {
    sectionOn: true,
    focus: 'A',
    group: false,
    masterLevel: 0.72,
    sustainDown: false,
    pitchBend: 0,
    rotaryOn: true,
    rotaryFast: false,
    rotaryStopped: false,
    rotaryDrive: 0.25,
    layers: {
      A: { enabled: true, level: 0.78, octave: 0, sustped: true, pstick: false, type: 'Grand', model: 'Studio Grand', kbTouch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false, zone: defaultZone() },
      B: { enabled: false, level: 0.6, octave: 0, sustped: true, pstick: false, type: 'Upright', model: 'Felt Upright', kbTouch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false, zone: defaultZone() },
    },
    effects: { A: createEffectChain(), B: createEffectChain() },
    organ: {
      sectionOn: true, focus: 'A', rotaryRouted: true,
      layers: { A: createOrganLayer('B3', false), B: createOrganLayer('Vox', false) },
      effects: createEffectChain(),
    },
    synth: {
      sectionOn: true, focus: 'A', group: false,
      layers: {
        A: createSynthLayer('Saw', 'Pure', false),
        B: createSynthLayer('Super Saw', 'Super', false),
        C: createSynthLayer('FM 2-op (algorithm A)', 'FM-H', false),
      },
      effects: { A: createEffectChain(), B: createEffectChain(), C: createEffectChain() },
    },
    effectsFocus: { section: 'piano', layer: 'A' },
    splits: {
      enabled: false,
      points: [
        { enabled: false, position: 'C3', crossfade: 0 },
        { enabled: true, position: 'C4', crossfade: 0 },
        { enabled: false, position: 'C5', crossfade: 0 },
      ],
    },
    scenes: { active: 'I', layers: { I: sceneI, II: { ...sceneI, 'piano:B': true, 'synth:A': true } } },
    morphs: { values: { wheel: 0, controlPedal: 0 }, assignments: { wheel: [], controlPedal: [] }, editing: null },
    masterClockBpm: 120,
    keyboardSync: false,
    transpose: 0,
  }
}

export const cycle = <T,>(values: readonly T[], current: T): T => values[(values.indexOf(current) + 1) % values.length]

export function targetsForUnit(state: InstrumentState, unitId: EffectUnitId): LayerId[] {
  if (state.group || state.effects[state.focus][unitId].global) return ['A', 'B']
  return [state.focus]
}

export function updateEffectUnit(
  state: InstrumentState,
  unitId: EffectUnitId,
  update: (unitState: EffectUnitState) => EffectUnitState,
): InstrumentState {
  const effects = { ...state.effects }
  for (const layer of targetsForUnit(state, unitId)) {
    effects[layer] = { ...effects[layer], [unitId]: update(effects[layer][unitId]) }
  }
  return { ...state, effects }
}

export function effectTargetForFocus(state: InstrumentState): EffectTarget {
  const { section, layer } = state.effectsFocus
  if (section === 'organ') return 'organ'
  if (section === 'piano') return `piano:${layer === 'C' ? 'A' : layer}`
  return `synth:${layer}`
}

export function getEffectChain(state: InstrumentState, target: EffectTarget): EffectChainState {
  if (target === 'organ') return state.organ.effects
  const [section, layer] = target.split(':') as ['piano' | 'synth', SynthLayerId]
  return section === 'piano' ? state.effects[layer as LayerId] : state.synth.effects[layer]
}

export function updateEffectTarget(
  state: InstrumentState,
  target: EffectTarget,
  unitId: EffectUnitId,
  update: (unitState: EffectUnitState) => EffectUnitState,
): InstrumentState {
  const unit = getEffectChain(state, target)[unitId]
  if (target === 'organ') return { ...state, organ: { ...state.organ, effects: { ...state.organ.effects, [unitId]: update(unit) } } }
  const [section, layer] = target.split(':') as ['piano' | 'synth', SynthLayerId]
  if (section === 'piano') {
    const effects = { ...state.effects, [layer]: { ...state.effects[layer as LayerId], [unitId]: update(unit) } }
    return { ...state, effects: effects as Record<LayerId, EffectChainState> }
  }
  return { ...state, synth: { ...state.synth, effects: { ...state.synth.effects, [layer]: { ...state.synth.effects[layer], [unitId]: update(unit) } } } }
}

export const ALL_LAYER_ADDRESSES: LayerAddress[] = ['organ:A', 'organ:B', 'piano:A', 'piano:B', 'synth:A', 'synth:B', 'synth:C']

export const SAMPLE_BANKS = {
  Grand: { roots: [36, 48, 60, 72, 84, 96], velocities: [0.32, 0.66, 1], source: 'generated-pcm' },
  Upright: { roots: [36, 48, 60, 72, 84, 96], velocities: [0.32, 0.66, 1], source: 'generated-pcm' },
  Electric: { roots: [36, 48, 60, 72, 84, 96], velocities: [0.32, 0.66, 1], source: 'generated-pcm' },
} as const
