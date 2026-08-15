/**
 * Phase 3 canonical program-state types and pure helpers.
 *
 * Everything in this file is PROGRAM STATE: the serializable data a program
 * slot stores and round-trips (organ, synth, splits, zones, scenes, morphs,
 * clock, transpose — plus the Phase 2 piano/effect state that lives in
 * `instrument.ts`). Master Level is deliberately NOT program state
 * (spec: nord-stage-4.programs.json programState.excludes).
 */

/* ------------------------------------------------------------------ organ -- */

export type OrganModel = 'B3' | 'B3 Bass' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2'
export const ORGAN_MODELS: readonly OrganModel[] = ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2']

export type VibratoChorusMode = 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'
export const VIBRATO_CHORUS_MODES: readonly VibratoChorusMode[] = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3']

export type OrganLayerId = 'A' | 'B'

export interface OrganLayerState {
  enabled: boolean
  level: number // 0..127
  octave: -1 | 0 | 1
  model: OrganModel
  /** Nine drawbar positions 0..8 (pulled out = louder). */
  drawbars: number[]
  /** Vibrato/chorus on for this layer (per-layer on/off, manual p.19). */
  vibratoOn: boolean
}

export interface OrganState {
  sectionOn: boolean
  layers: Record<OrganLayerId, OrganLayerState>
  /** Drawbars/model/vibrato edits target this layer. */
  focusedLayer: OrganLayerId
  vibratoMode: VibratoChorusMode
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean }
  /** ORGAN button in the Rotary group: routes the organ chain to the rotary speaker. */
  toRotary: boolean
}

export function defaultOrganLayer(model: OrganModel = 'B3'): OrganLayerState {
  return { enabled: false, level: 100, octave: 0, model, drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], vibratoOn: false }
}

export function defaultOrganState(): OrganState {
  return {
    sectionOn: true,
    layers: { A: defaultOrganLayer('B3'), B: defaultOrganLayer('Vox') },
    focusedLayer: 'A',
    vibratoMode: 'C3',
    percussion: { on: false, soft: false, fast: false, third: false },
    toRotary: false,
  }
}

/* ------------------------------------------------------------------ synth -- */

export type SynthLayerId = 'A' | 'B' | 'C'
export const SYNTH_LAYER_IDS: readonly SynthLayerId[] = ['A', 'B', 'C']

export type SynthCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export const SYNTH_CATEGORIES: readonly SynthCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']

export const SYNTH_WAVEFORMS: Record<SynthCategory, readonly string[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op A'],
}

export type SynthFilterType = 'LP12' | 'LP24' | 'HP' | 'BP'
export const SYNTH_FILTER_TYPES: readonly SynthFilterType[] = ['LP12', 'LP24', 'HP', 'BP']

export type LfoWave = 'Triangle' | 'Saw Down' | 'Saw Up' | 'Square' | 'S&H'
export const LFO_WAVES: readonly LfoWave[] = ['Triangle', 'Saw Down', 'Saw Up', 'Square', 'S&H']

export type LfoDestination = 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
export const LFO_DESTINATIONS: readonly LfoDestination[] = ['Osc Pitch', 'Osc Ctrl', 'Filter Freq']

export type SynthVoiceMode = 'Poly' | 'Mono' | 'Legato'
export type NotePriority = 'Off' | 'Low' | 'High'
export type SynthVibratoMode = 'Off' | 'On' | 'Wheel'
export type ArpMode = 'Arp' | 'Poly' | 'Gate'
export const ARP_MODES: readonly ArpMode[] = ['Arp', 'Poly', 'Gate']
export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random'
export const ARP_DIRECTIONS: readonly ArpDirection[] = ['Up', 'Down', 'Up/Down', 'Random']

export interface SynthLayerState {
  enabled: boolean
  level: number
  octave: -1 | 0 | 1
  category: SynthCategory
  /** Index into SYNTH_WAVEFORMS[category]. */
  wave: number
  oscCtrl: number // 0..127, category-specific meaning
  /** Bipolar env amount: 64 = 0. toPitch retargets the env to oscillator pitch. */
  oscEnv: { attack: number; decay: number; release: number; velocity: boolean; amount: number; toPitch: boolean }
  /** Dedicated filter envelope (spec: attack/decay/release + velocity toggle). */
  filterEnv: { attack: number; decay: number; release: number; velocity: boolean }
  filter: {
    on: boolean
    type: SynthFilterType
    freq: number
    res: number
    envAmt: number
    tracking: 0 | 1 | 2 | 3 // Off, 1/3, 2/3, 1
    drive: 0 | 1 | 2 | 3
  }
  ampEnv: { attack: number; decay: number; release: number; velocity: 0 | 1 | 2 | 3 }
  lfo: { wave: LfoWave; rate: number; amount: number; dest: LfoDestination | null; clockSync: boolean }
  voice: {
    mode: SynthVoiceMode
    priority: NotePriority
    glide: number
    unison: 0 | 1 | 2 | 3
    vibrato: SynthVibratoMode
    vibRate: number // 0..127 -> 2..8 Hz
    vibAmount: number // 0..127
  }
  arp: {
    mode: ArpMode
    rate: number
    clockSync: boolean
    range: 1 | 2 | 3 | 4
    direction: ArpDirection
    hold: boolean
    run: boolean
    kbSync: boolean
  }
}

export function defaultSynthLayer(): SynthLayerState {
  return {
    enabled: false,
    level: 100,
    octave: 0,
    category: 'Pure',
    wave: 2, // Saw
    oscCtrl: 64,
    oscEnv: { attack: 0, decay: 64, release: 20, velocity: false, amount: 64, toPitch: false },
    filterEnv: { attack: 0, decay: 70, release: 30, velocity: false },
    filter: { on: true, type: 'LP24', freq: 90, res: 20, envAmt: 40, tracking: 1, drive: 0 },
    ampEnv: { attack: 2, decay: 127, release: 24, velocity: 0 },
    lfo: { wave: 'Triangle', rate: 64, amount: 0, dest: null, clockSync: false },
    voice: { mode: 'Poly', priority: 'Off', glide: 0, unison: 0, vibrato: 'Off', vibRate: 80, vibAmount: 40 },
    arp: { mode: 'Arp', rate: 64, clockSync: false, range: 1, direction: 'Up', hold: false, run: false, kbSync: true },
  }
}

export interface SynthState {
  sectionOn: boolean
  layers: Record<SynthLayerId, SynthLayerState>
  focusedLayer: SynthLayerId
}

export function defaultSynthState(): SynthState {
  return {
    sectionOn: true,
    layers: { A: defaultSynthLayer(), B: defaultSynthLayer(), C: defaultSynthLayer() },
    focusedLayer: 'A',
  }
}

/* ------------------------------------------------------- layers and zones -- */

/** Every sounding layer of every engine (7 total). */
export type LayerKey = 'pianoA' | 'pianoB' | 'organA' | 'organB' | 'synthA' | 'synthB' | 'synthC'
export const LAYER_KEYS: readonly LayerKey[] = ['pianoA', 'pianoB', 'organA', 'organB', 'synthA', 'synthB', 'synthC']

export type SectionKey = 'piano' | 'organ' | 'synth'

export function layerSection(key: LayerKey): SectionKey {
  return key.startsWith('piano') ? 'piano' : key.startsWith('organ') ? 'organ' : 'synth'
}

export function layerLetter(key: LayerKey): 'A' | 'B' | 'C' {
  return key.slice(-1) as 'A' | 'B' | 'C'
}

/** Effect chains: piano layers keep their Phase 2 'A'/'B' ids; the organ layers share one chain; synth layers have one each. */
export type ChainId = 'A' | 'B' | 'organ' | 'synthA' | 'synthB' | 'synthC'
export const CHAIN_IDS: readonly ChainId[] = ['A', 'B', 'organ', 'synthA', 'synthB', 'synthC']

export function chainForLayer(key: LayerKey): ChainId {
  switch (key) {
    case 'pianoA':
      return 'A'
    case 'pianoB':
      return 'B'
    case 'organA':
    case 'organB':
      return 'organ'
    default:
      return key as ChainId
  }
}

/** Which section/layer the Layer Effects panel is editing. */
export interface FxFocus {
  section: SectionKey
  layer: 'A' | 'B' | 'C'
}

export function chainForFocus(focus: FxFocus): ChainId {
  if (focus.section === 'organ') return 'organ'
  if (focus.section === 'piano') return focus.layer === 'B' ? 'B' : 'A'
  return `synth${focus.layer === 'C' ? 'C' : focus.layer === 'B' ? 'B' : 'A'}` as ChainId
}

/* ------------------------------------------------------------------ split -- */

export const SPLIT_POSITIONS = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
export const SPLIT_POSITION_MIDI: readonly number[] = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]

export type SplitPointId = 'low' | 'mid' | 'high'
export const SPLIT_POINT_IDS: readonly SplitPointId[] = ['low', 'mid', 'high']

export type CrossfadeWidth = 0 | 6 | 12
export const CROSSFADE_WIDTHS: readonly CrossfadeWidth[] = [0, 6, 12]

export interface SplitPointState {
  active: boolean
  /** Index into SPLIT_POSITIONS. */
  position: number
  xfade: CrossfadeWidth
}

export interface SplitState {
  on: boolean
  points: Record<SplitPointId, SplitPointState>
}

export function defaultSplitState(): SplitState {
  return {
    on: false,
    points: {
      low: { active: false, position: 2, xfade: 0 }, // C3
      mid: { active: true, position: 4, xfade: 0 }, // C4 (manual p.39 default)
      high: { active: false, position: 8, xfade: 0 }, // C6
    },
  }
}

/** Contiguous zone range a layer plays in (indices in 0..3, clamped to the active zone count). */
export interface ZoneRange {
  from: number
  to: number
}

export type ZoneAssignments = Record<LayerKey, ZoneRange>

export function defaultZoneAssignments(): ZoneAssignments {
  const zones = {} as ZoneAssignments
  for (const key of LAYER_KEYS) zones[key] = { from: 0, to: 3 }
  return zones
}

/** Active split points sorted by MIDI note, only meaningful while split is on. */
export function activeSplitPoints(split: SplitState): Array<{ id: SplitPointId; midi: number; xfade: CrossfadeWidth }> {
  if (!split.on) return []
  return SPLIT_POINT_IDS.filter((id) => split.points[id].active)
    .map((id) => ({ id, midi: SPLIT_POSITION_MIDI[split.points[id].position]!, xfade: split.points[id].xfade }))
    .sort((a, b) => a.midi - b.midi)
}

export function zoneCount(split: SplitState): number {
  return activeSplitPoints(split).length + 1
}

/**
 * Crossfade gain of `layerRange` for a physical key. The split-point key is
 * the first key of the upper zone; Off switches hard, ±6/±12 fade linearly
 * across that many semitones on each side of the point (manual p.39).
 */
export function layerZoneGain(split: SplitState, range: ZoneRange, midi: number): number {
  const points = activeSplitPoints(split)
  if (points.length === 0) return 1
  const maxZone = points.length
  const from = Math.min(range.from, maxZone)
  const to = Math.min(range.to, maxZone)
  // Gain rises across the lower boundary (point index from-1) and falls across the upper (point index to).
  const riseAt = from > 0 ? points[from - 1]! : null
  const fallAt = to < maxZone ? points[to]! : null
  const rise = riseAt === null ? 1 : boundaryUpperGain(riseAt.midi, riseAt.xfade, midi)
  const fall = fallAt === null ? 1 : 1 - boundaryUpperGain(fallAt.midi, fallAt.xfade, midi)
  return Math.max(0, Math.min(1, Math.min(rise, fall)))
}

/** Gain of the zone ABOVE a boundary point for a given key. */
function boundaryUpperGain(pointMidi: number, xfade: CrossfadeWidth, midi: number): number {
  if (xfade === 0) return midi >= pointMidi ? 1 : 0
  return Math.max(0, Math.min(1, (midi - (pointMidi - xfade)) / (2 * xfade)))
}

/** Ordered list of every contiguous zone range in 0..3 space, stepped by the KB ZONE buttons. */
export const ZONE_RANGE_STEPS: readonly ZoneRange[] = (() => {
  const steps: ZoneRange[] = []
  for (let from = 0; from < 4; from++) {
    for (let to = from; to < 4; to++) steps.push({ from, to })
  }
  return steps
})()

export function stepZoneRange(range: ZoneRange, delta: -1 | 1): ZoneRange {
  const index = ZONE_RANGE_STEPS.findIndex((step) => step.from === range.from && step.to === range.to)
  const next = ((index < 0 ? 0 : index) + delta + ZONE_RANGE_STEPS.length) % ZONE_RANGE_STEPS.length
  return { ...ZONE_RANGE_STEPS[next]! }
}

/* ----------------------------------------------------------------- scenes -- */

export type SceneId = 'I' | 'II'

export interface SceneState {
  active: SceneId
  /** Layer enable configuration per scene; sound parameters are shared (manual p.43). */
  enables: Record<SceneId, Record<LayerKey, boolean>>
}

export function defaultSceneState(initial: Record<LayerKey, boolean>): SceneState {
  return { active: 'I', enables: { I: { ...initial }, II: { ...initial } } }
}

/* ----------------------------------------------------------------- morphs -- */

export type MorphSource = 'wheel' | 'pedal'
export const MORPH_SOURCES: readonly MorphSource[] = ['wheel', 'pedal']

export type SynthMorphParam = 'lfoRate' | 'oscCtrl' | 'lfoAmount' | 'filterFreq' | 'filterRes' | 'arpRate'
export type FxMorphParam =
  | 'mod1.rate'
  | 'mod1.amount'
  | 'mod2.amount'
  | 'delay.tempo'
  | 'delay.feedback'
  | 'delay.mix'
  | 'ampEq.freq'
  | 'ampEq.drive'
  | 'reverb.mix'

export type MorphPath =
  | { kind: 'layerLevel'; layer: LayerKey }
  | { kind: 'drawbar'; layer: OrganLayerId; index: number }
  | { kind: 'rotarySpeed' }
  | { kind: 'synth'; layer: SynthLayerId; param: SynthMorphParam }
  | { kind: 'fx'; chain: ChainId; param: FxMorphParam }

export function morphPathKey(path: MorphPath): string {
  switch (path.kind) {
    case 'layerLevel':
      return `level:${path.layer}`
    case 'drawbar':
      return `drawbar:${path.layer}:${path.index}`
    case 'rotarySpeed':
      return 'rotary:speed'
    case 'synth':
      return `synth:${path.layer}:${path.param}`
    case 'fx':
      return `fx:${path.chain}:${path.param}`
  }
}

export interface MorphAssignment {
  path: MorphPath
  from: number
  to: number
}

export interface MorphState {
  wheel: MorphAssignment[]
  pedal: MorphAssignment[]
}

export function defaultMorphState(): MorphState {
  return { wheel: [], pedal: [] }
}

/* --------------------------------------------------------- clock/transpose -- */

export const CLOCK_BPM_MIN = 30
export const CLOCK_BPM_MAX = 300

export interface TransposeState {
  on: boolean
  semitones: number // -6..6
}

/** Clock-sync subdivisions selectable with a synced rate knob (0..127 → index). */
export const CLOCK_DIVISIONS = [
  { label: '1/2', beats: 2 },
  { label: '1/2T', beats: 4 / 3 },
  { label: '1/4', beats: 1 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
] as const

export function clockDivision(value: number): (typeof CLOCK_DIVISIONS)[number] {
  const index = Math.min(CLOCK_DIVISIONS.length - 1, Math.floor((value / 128) * CLOCK_DIVISIONS.length))
  return CLOCK_DIVISIONS[index]!
}

export function clockIntervalSeconds(bpm: number, value: number): number {
  return (60 / bpm) * clockDivision(value).beats
}

/* --------------------------------------------------------------- mappings -- */

export const synthMappings = {
  /** 0..127 -> envelope seconds (3 ms .. 10 s, exponential). */
  envSeconds(value: number): number {
    return 0.003 * Math.pow(10 / 0.003, value / 127)
  },
  /** Decay at maximum acts as sustain (manual p.33). */
  isSustainDecay(value: number): boolean {
    return value >= 126
  },
  /** 0..127 -> filter resonance Q. */
  resonanceQ(value: number): number {
    return 0.5 + Math.pow(value / 127, 2) * 18
  },
  /** Constant-rate glide: seconds per octave. */
  glideSecondsPerOctave(value: number): number {
    return Math.pow(value / 127, 2) * 1.5
  },
  /** Free arp rate: 0..127 -> quarter-note BPM 30..300. */
  arpBpm(value: number): number {
    return CLOCK_BPM_MIN + (value / 127) * (CLOCK_BPM_MAX - CLOCK_BPM_MIN)
  },
  /** Vibrato rate 2.0..8.0 Hz (manual menu range). */
  vibratoHz(value: number): number {
    return 2 + (value / 127) * 6
  },
  /** Sync ratio 1..4 of the synced oscillator. */
  syncRatio(value: number): number {
    return 1 + (value / 127) * 3
  },
}

/* ---------------------------------------------------------- deep equality -- */

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false
    if (!deepEqual(aObj[key], bObj[key])) return false
  }
  return true
}

export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as unknown as T
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = deepClone(item)
  return result as T
}
