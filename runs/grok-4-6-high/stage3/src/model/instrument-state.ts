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

export const ORGAN_MODELS = ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'] as const
export const VIBRATO_POSITIONS = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'] as const
export const SPLIT_NOTE_NAMES = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
export const SPLIT_NOTE_MIDI = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96] as const
export const XFADE_WIDTHS = [0, 6, 12] as const

export const SYNTH_WAVES = [
  'Sine',
  'Triangle',
  'Saw',
  'Square',
  'Pulse 33',
  'Pulse 10',
  'White Noise',
  'Sync Saw',
  'Sync Square',
  'Multi Saw',
  'Multi Saw 8ve',
  'Super Saw',
  'Super Square',
  'FM 2-op (algorithm A)',
] as const
export type SynthWave = (typeof SYNTH_WAVES)[number]
export type SynthCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export const SYNTH_WAVE_CATEGORY: Record<SynthWave, SynthCategory> = {
  Sine: 'Pure',
  Triangle: 'Pure',
  Saw: 'Pure',
  Square: 'Pure',
  'Pulse 33': 'Pure',
  'Pulse 10': 'Pure',
  'White Noise': 'Pure',
  'Sync Saw': 'Sync',
  'Sync Square': 'Sync',
  'Multi Saw': 'Multi',
  'Multi Saw 8ve': 'Multi',
  'Super Saw': 'Super',
  'Super Square': 'Super',
  'FM 2-op (algorithm A)': 'FM-H',
}
export const FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
export const FILTER_TRACK = ['Off', '1/3', '2/3', '1'] as const
export const FILTER_DRIVE = ['Off', 1, 2, 3] as const
export const LFO_WAVES = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const
export const LFO_DESTS = ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const
export const VOICE_MODES = ['Poly', 'Mono', 'Legato'] as const
export const NOTE_PRIORITY = ['Off', 'Low', 'High'] as const
export const ARP_MODES = ['Arp', 'Poly', 'Gate'] as const
export const ARP_DIRS = ['Up', 'Down', 'Up/Down', 'Random'] as const
export const VIBRATO_MODES = ['Off', 'On', 'Wheel'] as const
export const AMP_VEL_LEVELS = ['Off', 1, 2, 3] as const

export type Mod1Type = (typeof MOD1_TYPES)[number]
export type Mod2Type = (typeof MOD2_TYPES)[number]
export type AmpType = (typeof AMP_TYPES)[number]
export type ReverbType = (typeof REVERB_TYPES)[number]
export type DelayFilter = (typeof DELAY_FILTERS)[number]
export type FxSection = 'organ' | 'piano' | 'synth'
export type TimbreName = (typeof TIMBRE_ELECTRIC)[number]
export type OrganModel = (typeof ORGAN_MODELS)[number]
export type VibratoPos = (typeof VIBRATO_POSITIONS)[number]
export type SplitName = (typeof SPLIT_NOTE_NAMES)[number]
export type FilterType = (typeof FILTER_TYPES)[number]
export type LfoWave = (typeof LFO_WAVES)[number]
export type LfoDest = (typeof LFO_DESTS)[number]
export type VoiceMode = (typeof VOICE_MODES)[number]
export type ArpMode = (typeof ARP_MODES)[number]
export type ArpDir = (typeof ARP_DIRS)[number]
export type SynthLayerId = 'A' | 'B' | 'C'
export type OrganLayerId = 'A' | 'B'
export type MorphSource = 'wheel' | 'pedal'
export type StoreMode = 'off' | 'dest' | 'name'
export type SceneId = 'I' | 'II'

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

export interface ZoneRange {
  lo: number
  hi: number
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
  zone: ZoneRange
  fx: LayerFx
}

export interface OrganLayerState {
  id: OrganLayerId
  enable: boolean
  focus: boolean
  level: number
  octave: number
  model: OrganModel
  drawbars: number[]
  vibratoOn: boolean
  vibratoType: VibratoPos
  percOn: boolean
  percSoft: boolean
  percFast: boolean
  percThird: boolean
  sustped: boolean
  pstick: boolean
  zone: ZoneRange
}

export interface SynthLayerState {
  id: SynthLayerId
  enable: boolean
  focus: boolean
  level: number
  octave: number
  wave: SynthWave
  oscCtrl: number
  coarse: number
  fine: number
  filterType: FilterType
  filterFreq: number
  filterRes: number
  filterDrive: (typeof FILTER_DRIVE)[number]
  filterTrack: (typeof FILTER_TRACK)[number]
  filterEnvAmt: number
  oscEnvA: number
  oscEnvD: number
  oscEnvR: number
  oscEnvAmt: number
  oscEnvVel: boolean
  oscEnvToPitch: boolean
  filtEnvA: number
  filtEnvD: number
  filtEnvR: number
  filtEnvVel: boolean
  ampEnvA: number
  ampEnvD: number
  ampEnvS: number
  ampEnvR: number
  ampVel: (typeof AMP_VEL_LEVELS)[number]
  lfoWave: LfoWave
  lfoRate: number
  lfoAmt: number
  lfoDest: LfoDest
  lfoSync: boolean
  voiceMode: VoiceMode
  priority: (typeof NOTE_PRIORITY)[number]
  glide: number
  unison: (typeof UNISON)[number]
  vibrato: (typeof VIBRATO_MODES)[number]
  vibratoRate: number
  vibratoAmt: number
  arpMode: ArpMode
  arpOn: boolean
  arpRun: boolean
  arpRate: number
  arpSync: boolean
  arpRange: number
  arpDir: ArpDir
  arpHold: boolean
  sustped: boolean
  pstick: boolean
  zone: ZoneRange
  fx: LayerFx
}

export interface SplitPoint {
  enabled: boolean
  midi: number
  xfade: 0 | 6 | 12
}

export interface SplitState {
  on: boolean
  low: SplitPoint
  mid: SplitPoint
  high: SplitPoint
}

export interface MorphAssignment {
  source: MorphSource
  dest: string
  start: number
  end: number
}

export interface SceneEnables {
  pianoA: boolean
  pianoB: boolean
  organA: boolean
  organB: boolean
  synthA: boolean
  synthB: boolean
  synthC: boolean
}

export interface ProgramSlot {
  name: string
  patch: ProgramPatch
}

export interface ProgramPatch {
  pianoOn: boolean
  organOn: boolean
  synthOn: boolean
  fxSectionOn: boolean
  fxSectionFocus: FxSection
  pianoGroup: boolean
  delayGlobal: boolean
  compGlobal: boolean
  reverbGlobal: boolean
  rotaryOn: boolean
  rotarySpeed: number
  rotaryDrive: number
  rotaryOrgan: boolean
  rotaryStop: boolean
  rotaryFast: boolean
  layers: Record<LayerId, LayerState>
  organ: Record<OrganLayerId, OrganLayerState>
  organFx: LayerFx
  synth: Record<SynthLayerId, SynthLayerState>
  split: SplitState
  scene: SceneId
  sceneI: SceneEnables
  sceneII: SceneEnables
  morphs: MorphAssignment[]
  clockBpm: number
  clockSync: boolean
  transpose: number
}

export interface InstrumentState extends ProgramPatch {
  masterLevel: number
  pitchStick: number
  modWheel: number
  ctrlPedal: number
  dirty: boolean
  liveMode: boolean
  programIndex: number
  liveIndex: number
  page: number
  storeMode: StoreMode
  storeDest: number
  storeName: string
  nameCursor: number
  listView: boolean
  listOffset: number
  undoPatch: ProgramPatch | null
  morphLatch: 'off' | MorphSource
  splitEdit: 'off' | 'low' | 'mid' | 'high'
  clockHold: boolean
  clockTaps: number[]
  panicFlag: boolean
  programDial: number
  slots: ProgramSlot[]
  liveSlots: ProgramSlot[]
  loadedPatch: ProgramPatch
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

export function defaultZone(): ZoneRange {
  return { lo: 0, hi: 3 }
}

function defaultPianoLayer(id: LayerId, enable: boolean, focus: boolean, level: number): LayerState {
  return {
    id,
    enable,
    focus,
    level,
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
    zone: defaultZone(),
    fx: defaultLayerFx(),
  }
}

function defaultOrganLayer(id: OrganLayerId, enable: boolean, focus: boolean, level: number): OrganLayerState {
  return {
    id,
    enable,
    focus,
    level,
    octave: 0,
    model: 'B3',
    drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0],
    vibratoOn: false,
    vibratoType: 'C1',
    percOn: false,
    percSoft: false,
    percFast: false,
    percThird: false,
    sustped: false,
    pstick: false,
    zone: defaultZone(),
  }
}

export function defaultSynthLayer(id: SynthLayerId, enable: boolean, focus: boolean, level: number): SynthLayerState {
  return {
    id,
    enable,
    focus,
    level,
    octave: 0,
    wave: 'Saw',
    oscCtrl: 0.4,
    coarse: 0,
    fine: 0,
    filterType: 'LP24',
    filterFreq: 0.65,
    filterRes: 0.2,
    filterDrive: 'Off',
    filterTrack: '2/3',
    filterEnvAmt: 0.25,
    oscEnvA: 0.02,
    oscEnvD: 0.3,
    oscEnvR: 0.2,
    oscEnvAmt: 0,
    oscEnvVel: false,
    oscEnvToPitch: false,
    filtEnvA: 0.05,
    filtEnvD: 0.35,
    filtEnvR: 0.25,
    filtEnvVel: false,
    ampEnvA: 0.05,
    ampEnvD: 0.35,
    ampEnvS: 0.7,
    ampEnvR: 0.3,
    ampVel: 2,
    lfoWave: 'Triangle',
    lfoRate: 0.35,
    lfoAmt: 0.15,
    lfoDest: 'Off',
    lfoSync: false,
    voiceMode: 'Poly',
    priority: 'Off',
    glide: 0,
    unison: 'Off',
    vibrato: 'Off',
    vibratoRate: 5,
    vibratoAmt: 0.2,
    arpMode: 'Arp',
    arpOn: false,
    arpRun: false,
    arpRate: 0.45,
    arpSync: false,
    arpRange: 1,
    arpDir: 'Up',
    arpHold: false,
    sustped: false,
    pstick: false,
    zone: defaultZone(),
    fx: defaultLayerFx(),
  }
}

export function defaultSplit(): SplitState {
  return {
    on: false,
    low: { enabled: false, midi: 48, xfade: 0 },
    mid: { enabled: false, midi: 60, xfade: 0 },
    high: { enabled: false, midi: 72, xfade: 0 },
  }
}

export function captureEnables(state: ProgramPatch): SceneEnables {
  return {
    pianoA: state.layers.A.enable,
    pianoB: state.layers.B.enable,
    organA: state.organ.A.enable,
    organB: state.organ.B.enable,
    synthA: state.synth.A.enable,
    synthB: state.synth.B.enable,
    synthC: state.synth.C.enable,
  }
}

export function applyEnables(state: ProgramPatch, enables: SceneEnables): void {
  state.layers.A.enable = enables.pianoA
  state.layers.B.enable = enables.pianoB
  state.organ.A.enable = enables.organA
  state.organ.B.enable = enables.organB
  state.synth.A.enable = enables.synthA
  state.synth.B.enable = enables.synthB
  state.synth.C.enable = enables.synthC
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function extractPatch(state: ProgramPatch): ProgramPatch {
  return {
    pianoOn: state.pianoOn,
    organOn: state.organOn,
    synthOn: state.synthOn,
    fxSectionOn: state.fxSectionOn,
    fxSectionFocus: state.fxSectionFocus,
    pianoGroup: state.pianoGroup,
    delayGlobal: state.delayGlobal,
    compGlobal: state.compGlobal,
    reverbGlobal: state.reverbGlobal,
    rotaryOn: state.rotaryOn,
    rotarySpeed: state.rotarySpeed,
    rotaryDrive: state.rotaryDrive,
    rotaryOrgan: state.rotaryOrgan,
    rotaryStop: state.rotaryStop,
    rotaryFast: state.rotaryFast,
    layers: cloneJson(state.layers),
    organ: cloneJson(state.organ),
    organFx: copyFx(state.organFx),
    synth: cloneJson(state.synth),
    split: cloneJson(state.split),
    scene: state.scene,
    sceneI: { ...state.sceneI },
    sceneII: { ...state.sceneII },
    morphs: cloneJson(state.morphs),
    clockBpm: state.clockBpm,
    clockSync: state.clockSync,
    transpose: state.transpose,
  }
}

export function applyPatch(state: InstrumentState, patch: ProgramPatch): void {
  const next = extractPatch(patch)
  state.pianoOn = next.pianoOn
  state.organOn = next.organOn
  state.synthOn = next.synthOn
  state.fxSectionOn = next.fxSectionOn
  state.fxSectionFocus = next.fxSectionFocus
  state.pianoGroup = next.pianoGroup
  state.delayGlobal = next.delayGlobal
  state.compGlobal = next.compGlobal
  state.reverbGlobal = next.reverbGlobal
  state.rotaryOn = next.rotaryOn
  state.rotarySpeed = next.rotarySpeed
  state.rotaryDrive = next.rotaryDrive
  state.rotaryOrgan = next.rotaryOrgan
  state.rotaryStop = next.rotaryStop
  state.rotaryFast = next.rotaryFast
  state.layers = next.layers
  state.organ = next.organ
  state.organFx = next.organFx
  state.synth = next.synth
  state.split = next.split
  state.scene = next.scene
  state.sceneI = next.sceneI
  state.sceneII = next.sceneII
  state.morphs = next.morphs
  state.clockBpm = next.clockBpm
  state.clockSync = next.clockSync
  state.transpose = next.transpose
}

export function patchesEqual(a: ProgramPatch, b: ProgramPatch): boolean {
  return JSON.stringify(extractPatch(a)) === JSON.stringify(extractPatch(b))
}

export function defaultProgramPatch(): ProgramPatch {
  const layers = {
    A: defaultPianoLayer('A', true, true, 0.8),
    B: defaultPianoLayer('B', false, false, 0.6),
  }
  const organ = {
    A: defaultOrganLayer('A', true, true, 0.8),
    B: defaultOrganLayer('B', false, false, 0.6),
  }
  const synth = {
    A: defaultSynthLayer('A', false, true, 0.8),
    B: defaultSynthLayer('B', false, false, 0.7),
    C: defaultSynthLayer('C', false, false, 0.7),
  }
  const patch: ProgramPatch = {
    pianoOn: true,
    organOn: false,
    synthOn: false,
    fxSectionOn: true,
    fxSectionFocus: 'piano',
    pianoGroup: false,
    delayGlobal: false,
    compGlobal: false,
    reverbGlobal: false,
    rotaryOn: false,
    rotarySpeed: 0.35,
    rotaryDrive: 0.2,
    rotaryOrgan: false,
    rotaryStop: false,
    rotaryFast: false,
    layers,
    organ,
    organFx: defaultLayerFx(),
    synth,
    split: defaultSplit(),
    scene: 'I',
    sceneI: {
      pianoA: true,
      pianoB: false,
      organA: true,
      organB: false,
      synthA: false,
      synthB: false,
      synthC: false,
    },
    sceneII: {
      pianoA: false,
      pianoB: true,
      organA: false,
      organB: true,
      synthA: true,
      synthB: false,
      synthC: false,
    },
    morphs: [],
    clockBpm: 120,
    clockSync: false,
    transpose: 0,
  }
  patch.sceneI = captureEnables(patch)
  return patch
}

export function defaultInstrumentState(): InstrumentState {
  const patch = defaultProgramPatch()
  const slots = createFactorySlots()
  return {
    ...cloneJson(patch),
    masterLevel: 0.72,
    pitchStick: 0,
    modWheel: 0,
    ctrlPedal: 0,
    dirty: false,
    liveMode: false,
    programIndex: 0,
    liveIndex: 0,
    page: 0,
    storeMode: 'off',
    storeDest: 0,
    storeName: slots[0]?.name ?? 'Init',
    nameCursor: 0,
    listView: false,
    listOffset: 0,
    undoPatch: null,
    morphLatch: 'off',
    splitEdit: 'off',
    clockHold: false,
    clockTaps: [],
    panicFlag: false,
    programDial: 0,
    slots,
    liveSlots: Array.from({ length: 8 }, (_, i) => ({
      name: `Live ${i + 1}`,
      patch: extractPatch(i === 0 ? patch : defaultProgramPatch()),
    })),
    loadedPatch: extractPatch(patch),
  }
}

export function focusedLayer(state: InstrumentState): LayerId {
  if (state.layers.B.focus && !state.layers.A.focus) return 'B'
  return 'A'
}

export function focusedOrganLayer(state: InstrumentState): OrganLayerId {
  if (state.organ.B.focus && !state.organ.A.focus) return 'B'
  return 'A'
}

export function focusedSynthLayer(state: InstrumentState): SynthLayerId {
  if (state.synth.C.focus && !state.synth.A.focus && !state.synth.B.focus) return 'C'
  if (state.synth.B.focus && !state.synth.A.focus) return 'B'
  return 'A'
}

export function delayTimeSec(tempoKnob: number): number {
  const bpm = 40 + tempoKnob * 200
  return 60 / bpm
}

export function copyFx(fx: LayerFx): LayerFx {
  return { ...fx }
}

export function programLabel(index: number): string {
  const page = Math.floor(index / 8) + 1
  const button = (index % 8) + 1
  return `${page}.${button}`
}

function createFactorySlots(): ProgramSlot[] {
  const slots: ProgramSlot[] = Array.from({ length: 32 }, (_, i) => ({
    name: i === 0 ? 'Concert Grand' : `Init ${programLabel(i)}`,
    patch: defaultProgramPatch(),
  }))

  const upright = defaultProgramPatch()
  upright.layers.A.type = 'upright'
  upright.layers.A.timbre = 'Soft'
  slots[1] = { name: 'Upright Ballad', patch: upright }

  const tine = defaultProgramPatch()
  tine.layers.A.type = 'electric'
  tine.layers.A.timbre = 'Dyno 1'
  tine.layers.A.fx.mod2On = true
  tine.layers.A.fx.mod2Type = 'Chorus'
  slots[2] = { name: 'Tine Stack', patch: tine }

  const b3 = defaultProgramPatch()
  b3.pianoOn = false
  b3.organOn = true
  b3.layers.A.enable = false
  b3.organ.A.enable = true
  b3.organ.A.model = 'B3'
  b3.organ.A.drawbars = [8, 8, 8, 6, 0, 0, 0, 0, 0]
  b3.organ.A.percOn = true
  b3.rotaryOrgan = true
  b3.rotaryOn = true
  b3.fxSectionFocus = 'organ'
  b3.sceneI = captureEnables(b3)
  slots[3] = { name: 'B3 Gospel', patch: b3 }

  const vox = defaultProgramPatch()
  vox.pianoOn = false
  vox.organOn = true
  vox.layers.A.enable = false
  vox.organ.A.model = 'Vox'
  vox.organ.A.drawbars = [8, 0, 8, 8, 0, 6, 0, 0, 4]
  vox.organ.A.vibratoOn = true
  vox.organ.A.vibratoType = 'V2'
  vox.fxSectionFocus = 'organ'
  vox.sceneI = captureEnables(vox)
  slots[4] = { name: 'Vox Combo', patch: vox }

  const farf = defaultProgramPatch()
  farf.pianoOn = false
  farf.organOn = true
  farf.layers.A.enable = false
  farf.organ.A.model = 'Farf'
  farf.organ.A.drawbars = [8, 8, 8, 0, 8, 0, 0, 0, 0]
  farf.fxSectionFocus = 'organ'
  farf.sceneI = captureEnables(farf)
  slots[5] = { name: 'Farf Combo', patch: farf }

  const pipe = defaultProgramPatch()
  pipe.pianoOn = false
  pipe.organOn = true
  pipe.layers.A.enable = false
  pipe.organ.A.model = 'Pipe 1'
  pipe.organ.A.drawbars = [8, 0, 8, 8, 0, 4, 0, 0, 2]
  pipe.fxSectionFocus = 'organ'
  pipe.sceneI = captureEnables(pipe)
  slots[6] = { name: 'Pipe Chapel', patch: pipe }

  const lead = defaultProgramPatch()
  lead.pianoOn = false
  lead.synthOn = true
  lead.layers.A.enable = false
  lead.synth.A.enable = true
  lead.synth.A.wave = 'Super Saw'
  lead.synth.A.oscCtrl = 0.7
  lead.synth.A.filterType = 'LP24'
  lead.synth.A.filterFreq = 0.55
  lead.synth.A.unison = 2
  lead.fxSectionFocus = 'synth'
  lead.sceneI = captureEnables(lead)
  slots[7] = { name: 'Super Lead', patch: lead }

  const split = defaultProgramPatch()
  split.synthOn = true
  split.synth.A.enable = true
  split.synth.A.wave = 'Square'
  split.split.on = true
  split.split.mid.enabled = true
  split.split.mid.midi = 60
  split.split.mid.xfade = 6
  split.layers.A.zone = { lo: 0, hi: 0 }
  split.synth.A.zone = { lo: 1, hi: 3 }
  split.sceneI = captureEnables(split)
  slots[8] = { name: 'Split Keys', patch: split }

  const layered = defaultProgramPatch()
  layered.synthOn = true
  layered.synth.A.enable = true
  layered.synth.A.wave = 'Triangle'
  layered.synth.A.filterFreq = 0.4
  layered.synth.A.ampEnvA = 0.35
  layered.layers.A.level = 0.7
  layered.sceneI = captureEnables(layered)
  slots[9] = { name: 'Layer Pad', patch: layered }

  applyPatchToFirst(slots)
  return slots
}

function applyPatchToFirst(slots: ProgramSlot[]): void {
  const first = defaultProgramPatch()
  slots[0] = { name: 'Concert Grand', patch: first }
}

export const DRAWBAR_IDS = [
  'organ-drawbar-16',
  'organ-drawbar-513',
  'organ-drawbar-8',
  'organ-drawbar-4',
  'organ-drawbar-223',
  'organ-drawbar-2',
  'organ-drawbar-135',
  'organ-drawbar-113',
  'organ-drawbar-1',
] as const

export const UNSUPPORTED_CONTROL_IDS = ['program-morph-at', 'organ-preset-1', 'organ-preset-2'] as const

export const MORPH_DEST_IDS = new Set<string>([
  'organ-layer-a-level',
  'organ-layer-b-level',
  ...DRAWBAR_IDS,
  'organ-rotary-fast',
  'rotary-speed',
  'piano-layer-a-level',
  'piano-layer-b-level',
  'synth-layer-a-level',
  'synth-layer-b-level',
  'synth-layer-c-level',
  'synth-lfo-rate',
  'synth-osc-shape',
  'synth-lfo-amount',
  'synth-filter-freq',
  'synth-filter-res',
  'synth-arp-rate',
  'fx1-rate',
  'fx1-amount',
  'fx2-amount',
  'delay-tempo',
  'delay-feedback',
  'delay-mix',
  'amp-mid-freq',
  'amp-drive',
  'reverb-mix',
])
