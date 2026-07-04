import { useSyncExternalStore } from 'react'
import { INSTRUMENTS, instrumentsOfType, PIANO_TYPES, SYNTH_SAMPLE_SETS, type PianoType } from '../audio/library'
import { DRAWBAR_INITIAL, getControl } from '../model/hardware'
import {
  ORGAN_PRESETS,
  PIANO_PRESETS,
  PRESET_BANKS,
  SYNTH_PRESETS,
  type EffectChainPresetSpec,
  type OrganLayerPresetSpec,
  type PianoLayerPresetSpec,
  type SynthLayerPresetSpec,
} from '../model/presets'
import type { StorageBoundary } from '../audio/boundaries'
import { buildFactoryContent, PROGRAM_SNAPSHOT_KEYS, snapshotOf } from './factory-programs'

export { PROGRAM_SNAPSHOT_KEYS }

/**
 * Canonical instrument state: two Piano layers with per-layer effect chains,
 * effect focus/group/global routing, the Organ section (two layers, four
 * modeled engines, drawbars, percussion, vibrato/chorus, rotary routing),
 * rotary, master volume.
 *
 * Honesty contract: everything in this store is REAL — the audio engine
 * subscribes to it and every field here audibly changes the signal graph
 * (or, for selection of unpopulated piano types, truthfully reports
 * "Piano not found"). Presentation-only controls (Synth and the remaining
 * Program scope) never write here; they stay in the panel store.
 */

export type LayerId = 'A' | 'B'
export type SectionKey = 'piano' | 'organ' | 'synth'

/** The four modeled organ engines (spec: nord-stage-4.organ.json). B3 Bass
 *  and Pipe 2 are not modeled; their panel LEDs exist and stay unlit. */
export type OrganModelId = 'B3' | 'Vox' | 'Farf' | 'Pipe1' | 'B3Bass' | 'Pipe2'
export const ORGAN_MODELS: readonly OrganModelId[] = ['B3', 'Vox', 'Farf', 'Pipe1', 'B3Bass', 'Pipe2']

/** Panel-legend label for the Organ display (manual p. 18): "Pipe 1"/"Pipe 2"
 *  print with a space; "B3 Bass" prints with one too. */
export function organModelLabel(model: OrganModelId): string {
  if (model === 'Pipe1') return 'Pipe 1'
  if (model === 'Pipe2') return 'Pipe 2'
  if (model === 'B3Bass') return 'B3 Bass'
  return model
}
export type VibratoType = 'V1' | 'C1' | 'V2' | 'C2' | 'V3' | 'C3'
/** Panel selector order (manual p. 19: C1-C3 and V1-V3 share one button). */
export const VIBRATO_TYPES: readonly VibratoType[] = ['C1', 'V1', 'C2', 'V2', 'C3', 'V3']

export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump'
export type Mod2Type = 'Phaser' | 'Flanger' | 'Vibe' | 'Chorus' | 'Ensemble' | 'Spin'
export type AmpType = 'Neutral EQ' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'To Rotary'
export type ReverbType = 'Room' | 'Stage' | 'Booth' | 'Hall' | 'Spring' | 'Cathedral'
export type DelayFilter = 'Off' | 'Low Pass' | 'High Pass' | 'Band Pass'
export type DelayEffect = 'Off' | 'Chorus' | 'Vibe' | 'Ensemble' | 'Flam' | 'Space'
export type RotarySpeed = 'slow' | 'fast' | 'stop'

export const MOD1_TYPES: readonly Mod1Type[] = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
export const MOD2_TYPES: readonly Mod2Type[] = ['Phaser', 'Flanger', 'Vibe', 'Chorus', 'Ensemble', 'Spin']
export const AMP_TYPES: readonly AmpType[] = ['Neutral EQ', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
export const REVERB_TYPES: readonly ReverbType[] = ['Room', 'Stage', 'Booth', 'Hall', 'Spring', 'Cathedral']
export const DELAY_FILTERS: readonly DelayFilter[] = ['Off', 'Low Pass', 'High Pass', 'Band Pass']
export const DELAY_EFFECTS: readonly DelayEffect[] = ['Off', 'Chorus', 'Vibe', 'Ensemble', 'Flam', 'Space']

export interface Mod1State {
  on: boolean
  type: Mod1Type
  rate: number
  amount: number
  /** PED (manual p. 49, Shift + Selector): the control pedal drives the
   *  Wah/A-Wah sweep instead of the LFO / envelope follower. */
  ped: boolean
  mstClk: boolean
}
export interface Mod2State { on: boolean; type: Mod2Type; rate: number; amount: number }
export interface DelayState {
  on: boolean
  tempo: number // 0..127 -> 20..1400 ms
  feedback: number // 0..127
  mix: number // 0..127 dry..wet
  filter: DelayFilter
  effect: DelayEffect
  analog: boolean
  /** Ping Pong (manual p. 51, Shift + Filter): repeats alternate L/R. */
  pingPong: boolean
  mstClk: boolean
}
export interface AmpEqState {
  on: boolean
  type: AmpType
  drive: number
  bass: number
  mid: number
  treble: number
  freq: number // mid frequency / filter cutoff, 0..127
}
export interface CompState { on: boolean; amount: number; fast: boolean }
export interface ReverbState { on: boolean; type: ReverbType; mix: number; bright: boolean }

export interface EffectChainState {
  mod1: Mod1State
  mod2: Mod2State
  delay: DelayState
  ampEq: AmpEqState
  comp: CompState
  reverb: ReverbState
}

/** Contiguous keyboard-zone assignment for one layer (manual p. 39). Indices
 *  are clamped to the number of zones the active split points create. */
export interface ZoneRange {
  from: number
  to: number
}

export interface PianoLayerState {
  enabled: boolean
  level: number // 0..127
  octave: -1 | 0 | 1
  type: PianoType
  /** Index into instrumentsOfType(type); selection of an unpopulated type keeps the previous audible instrument. */
  model: number
  zone: ZoneRange
}

export interface PianoSharedState {
  sectionOn: boolean
  kbTouch: 0 | 1 | 2 // Heavy, Mid, Light
  dynComp: 0 | 1 | 2 | 3
  timbre: number // index into the timbre list for the focused layer's family
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
  pedNoise: boolean
  /** SUSTPED (Shift + Layer A): routes the sustain pedal to the Piano section (manual p. 23). */
  sustped: boolean
  /** PSTICK (Shift + Layer B): lets the pitch stick bend the Piano section ±2 semitones (manual p. 23). */
  pstick: boolean
}

export interface OrganLayerState {
  enabled: boolean
  level: number // 0..127
  octave: -1 | 0 | 1
  zone: ZoneRange
  model: OrganModelId
  /** The Program's stored drawbar registration, 0 (in) .. 8 (fully out).
   *  Drives the sound and the LED graphs while `presetOn` is true. */
  drawbars: number[]
  /** Per-layer vibrato/chorus on/off (manual p. 19). */
  vibrato: boolean
  /** PRESET On (default, manual p. 21): the stored `drawbars` drive the
   *  sound and the LED graphs. Off = "Drawbar Live" (manual p. 19): the
   *  physical drawbar pose (`organDrawbarPose`) drives the sound and the
   *  drawbar LED graphs go dark. Per-layer, program-stored. */
  presetOn: boolean
}

export interface OrganState {
  sectionOn: boolean
  focusedLayer: LayerId
  layers: Record<LayerId, OrganLayerState>
  /** B3 percussion (manual p. 20): single-triggered attack partial.
   *  `poly` (Shift + Percussion Volume) lets every new key retrigger its own
   *  percussion partial instead of gating on "no organ key already down". */
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean; poly: boolean }
  /** Shared vibrato/chorus scanner type; per-layer on/off lives on the layer. */
  vibratoType: VibratoType
  /** ORGAN button in the Rotary group: routes the organ through the shared rotary speaker (manual p. 53). */
  toRotary: boolean
  /** SUSTPED (Shift + Layer A) / PSTICK (Shift + Layer B), manual p. 18. */
  sustped: boolean
  pstick: boolean
}

/* --------------------------------------------------------------- synth -- */

export type SynthLayerId = 'A' | 'B' | 'C'
export const SYNTH_LAYER_IDS: readonly SynthLayerId[] = ['A', 'B', 'C']

/** One waveform category (spec oscillator.requiredWaveforms, plus the
 *  optional Sub Osc/Shape/Shape Sine/Wave/FM-I categories); Osc Ctrl's
 *  meaning depends on which category the selected waveform belongs to.
 *  Shape and Shape Sine are SEPARATE categories per spec.scope.optional
 *  ("Sub Osc, Shape, Shape Sine, Misc, and Wave oscillator categories") even
 *  though both waveforms share a "wavefold/duty" family flavor — kept apart
 *  so the category-cycle button (manual p. 28) steps through Shape Pulse and
 *  Shape Sine as their own stops, not lumped into one. */
export type SynthWaveformCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H' | 'Sub' | 'Shape' | 'ShapeSine' | 'Wave' | 'FM-I'

export interface SynthWaveform {
  category: SynthWaveformCategory
  name: string
}

/** The exact Analog-mode waveform list (spec oscillator.requiredWaveforms),
 *  in panel order: Pure, Sync, Multi, Super, FM-H, then the OPTIONAL Sub
 *  Osc/Shape/Shape Sine/Wave/FM-I categories APPENDED after — factory
 *  programs reference these by index, so the required-scope entries never
 *  move. */
export const SYNTH_WAVEFORMS: readonly SynthWaveform[] = [
  { category: 'Pure', name: 'Sine' },
  { category: 'Pure', name: 'Triangle' },
  { category: 'Pure', name: 'Saw' },
  { category: 'Pure', name: 'Square' },
  { category: 'Pure', name: 'Pulse 33' },
  { category: 'Pure', name: 'Pulse 10' },
  { category: 'Pure', name: 'White Noise' },
  { category: 'Sync', name: 'Sync Saw' },
  { category: 'Sync', name: 'Sync Square' },
  { category: 'Multi', name: 'Multi Saw' },
  { category: 'Multi', name: 'Multi Saw 8ve' },
  { category: 'Super', name: 'Super Saw' },
  { category: 'Super', name: 'Super Square' },
  { category: 'FM-H', name: 'FM 2-op' },
  // Optional scope (spec.scope.optional), appended — never reorder above.
  { category: 'Sub', name: 'Saw Sub' },
  { category: 'Sub', name: 'Square Sub' },
  { category: 'Shape', name: 'Shape Pulse' },
  { category: 'ShapeSine', name: 'Shape Sine' },
  { category: 'Wave', name: 'Wave Organ' },
  { category: 'Wave', name: 'Wave Formant' },
  { category: 'FM-I', name: 'FM 2-op B' },
]

/** Index of Saw within SYNTH_WAVEFORMS — the default waveform for layer A. */
const SYNTH_SAW_INDEX = SYNTH_WAVEFORMS.findIndex((w) => w.name === 'Saw')

export const SYNTH_WAVEFORM_CATEGORIES: readonly SynthWaveformCategory[] = [
  'Pure',
  'Sync',
  'Multi',
  'Super',
  'FM-H',
  'Sub',
  'Shape',
  'ShapeSine',
  'Wave',
  'FM-I',
]

export interface SynthAmpEnvelopeState {
  attack: number // 0..127
  decay: number // 0..127; 127 = sustain mode (manual p. 33)
  release: number // 0..127
  velocity: 0 | 1 | 2 | 3
}

/** Shared attack/decay/release + velocity shape for the filter and
 *  oscillator envelopes (spec envelopes.shared/oscillator/filter). */
export interface SynthEnvelopeState {
  attack: number // 0..127
  decay: number // 0..127; 127 = sustain mode (manual p. 33)
  release: number // 0..127
  velocity: boolean
}

/** Required LP12/LP24/HP/BP, plus the optional LP M (declared ladder-style
 *  approximation) and LP+HP (series lowpass+highpass) types, appended. */
export const SYNTH_FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP', 'LP M', 'LP+HP'] as const
export type SynthFilterType = (typeof SYNTH_FILTER_TYPES)[number]

export interface SynthFilterState {
  on: boolean
  type: SynthFilterType
  freq: number // 0..127 -> mappings.filterFreqHz
  res: number // 0..127
  /** Keyboard tracking (manual p. 32): Off/1-3/2-3/1. */
  tracking: 0 | 1 | 2 | 3
  /** Drive stage before the filter (manual p. 32): Off/1/2/3. */
  drive: 0 | 1 | 2 | 3
  envAmount: number // 0..127, bipolar around 64 = 0 (manual p. 32/33)
  envelope: SynthEnvelopeState
}

/** Oscillator envelope (spec envelopes.oscillator): can retarget pitch or
 *  the live Osc Ctrl target, with a bipolar amount (64 = 0). */
export interface SynthOscEnvelopeState {
  attack: number
  decay: number
  release: number
  velocity: boolean
  toPitch: boolean
  amount: number // 0..127 bipolar, 64 = 0
}

export const SYNTH_LFO_WAVEFORMS = ['Triangle', 'Saw Down', 'Saw Up', 'Square', 'S&H'] as const
export type SynthLfoWaveform = (typeof SYNTH_LFO_WAVEFORMS)[number]

export const SYNTH_LFO_DESTINATIONS = ['Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const
export type SynthLfoDestination = (typeof SYNTH_LFO_DESTINATIONS)[number]

/** One standing LFO per synth layer (spec lfo): no destination lit means the
 *  LFO is off but keeps its settings (manual p. 34). */
export interface SynthLfoState {
  waveform: SynthLfoWaveform
  rate: number // 0..127 -> mappings.lfoRateHz, or master-clock substitution when mstClk
  amount: number // 0..127
  destination: SynthLfoDestination | null
  mstClk: boolean
}

export type SynthVoiceMode = 'Poly' | 'Mono' | 'Legato'
export const SYNTH_VOICE_MODES: readonly SynthVoiceMode[] = ['Poly', 'Mono', 'Legato']

export type SynthVoicePriority = 'Off' | 'Low' | 'High'
export const SYNTH_VOICE_PRIORITIES: readonly SynthVoicePriority[] = ['Off', 'Low', 'High']

/** Off/On/Wheel are required; Delayed and Pedal are optional scope (spec
 *  voice.vibrato.optionalModes). Aftertouch is spec-excluded (no browser
 *  aftertouch input) and never appears in this cycle. */
export type SynthVibratoMode = 'Off' | 'On' | 'Wheel' | 'Delayed' | 'Pedal'
export const SYNTH_VIBRATO_MODES: readonly SynthVibratoMode[] = ['Off', 'On', 'Wheel', 'Delayed', 'Pedal']

/** Voice behavior (spec voice): mode/priority/glide/unison/vibrato — governs
 *  how the layer's notes are triggered and held, not what they sound like. */
export interface SynthVoiceState {
  mode: SynthVoiceMode
  priority: SynthVoicePriority
  glide: number // 0..127 -> mappings.glideTimeConstant; active in Mono/Legato when played legato
  unison: 0 | 1 | 2 | 3
  vibrato: SynthVibratoMode
  /** 0..127 -> mappings.vibratoRateHz (spec vibrato.menu: 2.0-8.0 Hz), edited
   *  via the VIBRATO MENU button's OLED dial 1 (synthVibratoEdit). */
  vibratoRate: number
  /** 0..127, displayed 0..10 (spec vibrato.menu: Amount 0-10), edited via the
   *  VIBRATO MENU button's OLED dial 2 (synthVibratoEdit). */
  vibratoAmount: number
}

function defaultSynthVoice(): SynthVoiceState {
  // vibratoRate 74 -> ~5.5 Hz (mappings.vibratoRateHz), matching the prior fixed rate.
  return { mode: 'Poly', priority: 'Off', glide: 0, unison: 0, vibrato: 'Off', vibratoRate: 74, vibratoAmount: 40 }
}

/** Analog (oscillator) or Samples (bundled recorded sample sets) sound
 *  source (spec.scope.optional: "Samples mode with a small bundled sample
 *  set"). Extern is spec-excluded and never represented here. */
export type SynthLayerMode = 'Analog' | 'Samples'

/** Osc Pitch view (manual p. 28 "Pitch and Fine Tune"): per-layer transpose
 *  in semitones (-24..+24) plus fine tune in cents (±50), edited via the
 *  PITCH/SMP button's latched OLED dial mode (synthOscPitchEdit). */
export interface SynthOscPitchState {
  semis: number // -24..+24
  cents: number // -50..+50
}

export interface SynthLayerState {
  enabled: boolean
  level: number // 0..127
  octave: -1 | 0 | 1
  zone: ZoneRange
  /** Analog mode: index into SYNTH_WAVEFORMS. Samples mode: reused, clamped
   *  to the 2-item SYNTH_SAMPLE_SETS list (spec: "the OLED WAVE list
   *  selects between the two sample sets"). */
  waveform: number
  oscCtrl: number // 0..127, displayed 0..10 with one decimal; no effect in Samples mode
  /** Osc Pitch semitone/fine-tune offset (manual p. 28), applied to every
   *  source oscillator (Analog) or via playbackRate (Samples). */
  oscPitch: SynthOscPitchState
  ampEnvelope: SynthAmpEnvelopeState
  filter: SynthFilterState
  oscEnvelope: SynthOscEnvelopeState
  lfo: SynthLfoState
  voice: SynthVoiceState
  mode: SynthLayerMode
  /** EXCLUDE (manual p. 36, Shift + KB Hold): this layer opts out of KB
   *  Hold — its notes release on key-up even while the hold is on. */
  kbHoldExclude: boolean
}

export type ArpMode = 'Arp' | 'Poly' | 'Gate'
export const ARP_MODES: readonly ArpMode[] = ['Arp', 'Poly', 'Gate']

export type ArpDirection = 'Up' | 'Down' | 'UpDown' | 'Random'
export const ARP_DIRECTIONS: readonly ArpDirection[] = ['Up', 'Down', 'UpDown', 'Random']

/** Section-level arpeggiator/gate (spec arpeggiatorGate): shared by every
 *  enabled synth layer, driven by a deterministic scheduler on the injected
 *  timer boundary. */
export interface ArpState {
  run: boolean
  mode: ArpMode
  rate: number // 0..127 -> mappings.arpRateBpm, or master-clock BPM when mstClk
  mstClk: boolean
  /** Octave range 1..4 in half steps (manual p. 35: values in between add
   *  "a fifth on top" — 2.5 = 2 octaves and a fifth). */
  range: number
  direction: ArpDirection
  hold: boolean
  /** Zig Zag (Arpeggiator Menu page 1, manual p. 35): "played notes will
   *  jump by two steps and then back one, in a given direction". */
  zigZag: boolean
}

function defaultArp(): ArpState {
  return { run: false, mode: 'Arp', rate: 64, mstClk: false, range: 1, direction: 'Up', hold: false, zigZag: false }
}

export interface SynthState {
  sectionOn: boolean
  focusedLayer: SynthLayerId
  layers: Record<SynthLayerId, SynthLayerState>
  /** SUSTPED (Shift + Layer A) / PSTICK (Shift + Layer B), manual p. 18. */
  sustped: boolean
  pstick: boolean
  arp: ArpState
}

/** One of the three split points (Low/Mid/High, manual p. 39). */
export interface SplitPoint {
  active: boolean
  /** MIDI note; one of SPLIT_POSITIONS. */
  note: number
  /** Crossfade half-width in semitones on each side: 0 = hard switch. */
  xf: 0 | 6 | 12
}

export interface SplitState {
  on: boolean
  /** [Low, Mid, High] — active points partition the keybed into up to 4 zones. */
  points: [SplitPoint, SplitPoint, SplitPoint]
}

/** The 11 documented split positions (spec split.possiblePositions): C2..C7. */
export const SPLIT_POSITIONS: readonly number[] = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export const SPLIT_POSITION_NAMES: readonly string[] = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']
export const SPLIT_POINT_NAMES = ['LOW', 'MID', 'HIGH'] as const

/** Layer Scenes I/II (manual p. 43): two layer-enable configurations sharing
 *  every sound parameter. `stored` holds the INACTIVE scene's enables. */
export interface ScenesState {
  active: 'I' | 'II'
  stored: {
    pianoA: boolean
    pianoB: boolean
    organA: boolean
    organB: boolean
    synthA: boolean
    synthB: boolean
    synthC: boolean
  }
}

/** Master Clock (manual p. 40): 30..300 BPM, syncs Delay time and Mod 1 rate per chain. */
export interface MasterClockState {
  bpm: number // 30..300
}

/** Transpose (manual p. 40): shifts sounding pitch; keyboard-zone routing keeps following the played key. */
export interface TransposeState {
  on: boolean
  semitones: number // -6..+6
}

/* --------------------------------------------------------------- morphs -- */

export type MorphSource = 'wheel' | 'pedal'

/** One morph destination: the source interpolates the control from `start`
 *  (source at minimum) to `end` (source at maximum), manual p. 38-39. */
export interface MorphAssignment {
  /** Hardware control id of the destination (MORPH_DESTINATIONS). */
  control: string
  /** Layer context captured at assignment time (drawbars, effect chains,
   *  or a synth layer's own voice/filter/LFO). 'organ' captures the shared
   *  Organ effect chain (manual p. 18); 'SA'/'SB'/'SC' capture a synth
   *  layer's own effect chain (manual p. 48 pattern, applied per synth
   *  layer since each has its own chain) or, for osc-ctrl/filter-freq/
   *  filter-res/lfo-rate/lfo-mod-amt, that layer's voice graph — always the
   *  focused synth layer at capture time. synth-level-a/b/c and arp-rate
   *  encode their own target in the control id, so their captured layer is
   *  a fixed don't-care ('SA'). */
  layer: LayerId | 'organ' | 'SA' | 'SB' | 'SC'
  start: number
  end: number
}

/** Program-stored morph assignments per source (A.T. is spec-excluded). */
export interface MorphState {
  wheel: MorphAssignment[]
  pedal: MorphAssignment[]
}

/** Every currently-morphable destination (spec morph.destinations: piano/organ
 *  levels, organ drawbars, rotary speed, per-chain effect fields, and the
 *  Synth destinations — levelIsMorphable, oscCtrlKnob, filter Freq/Res, LFO
 *  Rate/Mod Amt, plus the programs-spec Arp/Gate Rate). */
export const MORPH_DESTINATIONS: ReadonlySet<string> = new Set([
  'piano-level-a',
  'piano-level-b',
  'organ-level-a',
  'organ-level-b',
  'organ-drawbar-1',
  'organ-drawbar-2',
  'organ-drawbar-3',
  'organ-drawbar-4',
  'organ-drawbar-5',
  'organ-drawbar-6',
  'organ-drawbar-7',
  'organ-drawbar-8',
  'organ-drawbar-9',
  'rotary-speed',
  'mod1-rate',
  'mod1-amount',
  'mod2-amount',
  'delay-tempo',
  'delay-feedback',
  'delay-mix',
  'amp-freq',
  'amp-drive',
  'reverb-mix',
  'synth-level-a',
  'synth-level-b',
  'synth-level-c',
  'osc-ctrl',
  'filter-freq',
  'filter-res',
  'lfo-rate',
  'lfo-mod-amt',
  'arp-rate',
])

/* ------------------------------------------------- monitor / copy / paste -- */

/** MON/COPY clipboard (manual p. 43): the one copied object, deep-cloned at
 *  copy time so later edits never leak into (or out of) it. `label` is the
 *  truthful display name a paste refusal re-prints ("Cannot paste X here").
 *  Not program state. */
export type MonCopyClipboard =
  | { kind: 'piano-layer'; label: string; payload: { layer: PianoLayerState; chain: EffectChainState } }
  | { kind: 'organ-layer'; label: string; payload: { layer: OrganLayerState; chain: EffectChainState } }
  | { kind: 'synth-layer'; label: string; payload: { layer: SynthLayerState; chain: EffectChainState } }
  | { kind: 'effect'; label: string; unit: keyof EffectChainState; payload: EffectChainState[keyof EffectChainState] }
  | { kind: 'morph'; label: string; payload: MorphAssignment[] }
  | { kind: 'program'; label: string; payload: ProgramSlot }

/**
 * Everything a program stores (spec: nord-stage-4.programs.json
 * programState.includes) — Master Level is deliberately excluded. The
 * snapshot is JSON-serializable so programs persist across reloads.
 */
export type ProgramSnapshot = Pick<
  InstrumentState,
  | 'piano'
  | 'layers'
  | 'focusedLayer'
  | 'organ'
  | 'synth'
  | 'chains'
  | 'organChain'
  | 'synthChains'
  | 'fxSection'
  | 'fxGroupPiano'
  | 'fxGroupSynth'
  | 'allFxOff'
  | 'fxGlobal'
  | 'rotary'
  | 'split'
  | 'scenes'
  | 'morph'
  | 'masterClock'
  | 'transpose'
  | 'kbHold'
>


export interface ProgramSlot {
  name: string
  snapshot: ProgramSnapshot
}

export interface ProgramsState {
  /** One bank of 32 programs: 4 pages × 8 program buttons. */
  bank: ProgramSlot[]
  /** The 8 auto-storing Live slots (manual p. 13). */
  live: ProgramSlot[]
  liveMode: boolean
  /** Index into the active bank: 0..31, or 0..7 in Live mode. */
  current: number
  /** Slot to return to when leaving / re-entering Live mode. */
  lastBank: number
  lastLive: number
  /** True when the loaded program has unsaved edits (the display's E flag). */
  dirty: boolean
  /** STORE pressed once: destination selection in progress; the captured
   *  slot is what will be written on confirm (manual p. 13). */
  storePending: {
    origin: number
    originDirty: boolean
    /** Bank mode at Store time — restored on cancel (Live Mode may have
     *  been toggled during destination selection, manual p. 13/44). */
    originLiveMode: boolean
    destination: number
    captured: ProgramSlot
  } | null
  /** STORE AS naming step before destination selection (manual p. 41). */
  naming: { name: string; cursor: number } | null
  /** Single-level undo: the edited state discarded by the last program change. */
  undo: { slot: number; liveMode: boolean; snapshot: ProgramSnapshot } | null
  /** Numeric list view (Shift + Program dial, manual p. 41). */
  listView: boolean
  /** NUM PAD mode (Shift + Live Mode, manual p. 44): PROGRAM 1-8 enter
   *  two-digit page.slot numbers instead of direct slot selection. Not
   *  program state. */
  numPad: boolean
  /** Pending Num Pad page digit (1-4) awaiting its slot digit, or null. */
  numPadPending: number | null
  /** PROG VIEW display mode (manual p. 42): 0 = default layout, 1 = large
   *  name/number only, 2 = full program configuration, 3 = the current
   *  page's eight programs as a list. Not program state. */
  progView: 0 | 1 | 2 | 3
  /** PRESET NAME (Shift + Prog View, manual p. 42): layer lines show the
   *  underlying sound source; reset when a Program is loaded. Not program
   *  state. */
  presetName: boolean
}

export interface InstrumentState {
  masterVolume: number // 0..127
  piano: PianoSharedState
  layers: Record<LayerId, PianoLayerState>
  focusedLayer: LayerId
  organ: OrganState
  synth: SynthState
  split: SplitState
  scenes: ScenesState
  morph: MorphState
  programs: ProgramsState
  masterClock: MasterClockState
  transpose: TransposeState
  /** Split-edit panel mode (dial = position, PAGE = point, PROG 1/2 = active/xf). Not program state. */
  splitEdit: { point: 0 | 1 | 2 } | null
  /** Master-clock dial-edit panel mode (dial = BPM, PROG 1/2 = delay/mod1 sync). Not program state. */
  clockEdit: boolean
  /** External MIDI clock lock (manual p. 40): true while real-time clock
   *  ticks drive the tempo — the dial/tap are overridden until the device
   *  stops. Performance state, never stored in programs. */
  clockExternal: boolean
  /** Transpose dial-edit panel mode (dial = semitones). Not program state. */
  transposeEdit: boolean
  /** SOLO monitor latch (manual quick guide): the soloed layer plays alone
   *  via a live gain gate — nothing destructive. Not program state. */
  soloLayer: { section: 'piano' | 'organ' | 'synth'; layer: 'A' | 'B' | 'C' } | null
  /** LAYER INIT screen (Shift + Section Edit, manual p. 43): PROGRAM 1-4 act
   *  as the four soft buttons (All / Org AB / Pno / Syn). Not program state. */
  layerInitEdit: boolean
  /** SECTION EDIT sticky latch (manual p. 43): while engaged, an edit done
   *  to a parameter is performed on all Layers of that parameter's Section.
   *  The hardware's double-tap "sticky" mode maps to our click = sticky
   *  latch (declared adaptation, same convention as Mon/Copy); click again
   *  or Shift/Exit leaves. Temporary panel state — never stored in programs
   *  (manual p. 38). */
  sectionEdit: boolean
  /** PRESET LIBRARY browse screen (manual p. 41-42): the Program dial steps
   *  the section's preset list, loading each preset live into the current
   *  program as an ordinary dirty edit. `preBrowse` is the snapshot the
   *  Cancel soft button restores; `loaded` stays false until the dial first
   *  loads (the manual's "E" coupling on the focused, not-yet-loaded
   *  preset); `singleLayer` = SINGLE LAYER (Shift + preset button): load
   *  into the focused layer only. Mutually exclusive with the other
   *  Program-OLED edit modes. Not program state. */
  presetBrowse: {
    section: SectionKey
    index: number
    preBrowse: ProgramSnapshot
    preDirty: boolean
    singleLayer: boolean
    loaded: boolean
  } | null
  /** Morph source being assigned (source button latched). Not program state. */
  morphArming: MorphSource | null
  /** MON/COPY / PASTE latch (manual p. 43) — pointer-first adaptation of the
   *  hardware's hold gestures (like SOLO's click convention): 'copy' =
   *  Mon/Copy latched (continuous controls become read-only monitor
   *  readouts; Layer / effect ON / Morph Assign / PROGRAM buttons copy),
   *  'paste' = PASTE (Shift + Mon/Copy) latched (the same buttons paste).
   *  Mutually exclusive with the Program-OLED edit modes and preset
   *  browsing. Not program state. */
  monCopy: 'copy' | 'paste' | null
  /** The copied object (deep-cloned, manual p. 43). Survives leaving the
   *  latch so a later Paste can use it. Not program state. */
  clipboard: MonCopyClipboard | null
  /** AMP/FILTER/OSC ENVELOPE button latched: the three Synth OLED dials edit
   *  the focused layer's selected envelope's attack/decay/release instead of
   *  their normal waveform-list/menu roles. Not program state (panel mode only). */
  synthEnvEdit: 'amp' | 'filter' | 'osc' | null
  /** Shift + Piano Model dial (spec.scope.optional model list view): shows the
   *  focused layer's type's model list on the Program OLED, mirroring the
   *  Shift + Program dial numeric list view. Not program state (panel mode only). */
  modelListView: boolean
  /** Synth VIBRATO MENU button latched: the Synth OLED dials 1/2 edit the
   *  focused layer's vibrato Rate/Amount (spec voice.vibrato.menu) instead of
   *  their normal roles. Mutually exclusive with synthEnvEdit and
   *  synthOscPitchEdit. Not program state. */
  synthVibratoEdit: boolean
  /** Synth PITCH/SMP button latched (manual p. 28 "Osc Pitch" view): the
   *  Synth OLED dials 1/2 edit the focused layer's Osc Pitch semitones /
   *  Fine Tune cents instead of their normal roles. Mutually exclusive with
   *  synthEnvEdit and synthVibratoEdit. Not program state. */
  synthOscPitchEdit: boolean
  /** Arpeggiator MENU button latched (manual p. 35): the Synth OLED dials
   *  become page / Direction / Zig Zag. Only menu page 1 (Direction and
   *  Zig Zag) is implemented, so dial 1's page navigation stays on 1/1;
   *  pages 2-5 (Pattern presets/edit/accent/pan) are out of scope. Mutually
   *  exclusive with synthEnvEdit, synthVibratoEdit and synthOscPitchEdit.
   *  Not program state. */
  synthArpMenuEdit: boolean
  /** Live morph source positions (mod wheel, control pedal 0..127). Not program state. */
  morphValues: Record<MorphSource, number>
  /** The ONE physical set of nine drawbars on the hardware: their current
   *  pose, 0..8 each. Dragging a drawbar always moves this; an organ layer
   *  with Preset Off ("Drawbar Live", manual p. 19/21) sounds from this pose
   *  instead of its stored registration. Not program state — like real
   *  hardware positions, the pose persists across program loads. */
  organDrawbarPose: number[]
  /** When true (Group mode), effect edits apply to both piano layer chains. */
  fxGroupPiano: boolean
  allFxOff: boolean
  chains: Record<LayerId, EffectChainState>
  /** The single effect chain shared by both Organ layers (manual p. 18:
   *  "Both Organ Layers share the same effects chain"). */
  organChain: EffectChainState
  /** One independent effect chain per Synth layer (spec: "three layers
   *  integrate with... their own effect chains" — unlike Organ, each synth
   *  layer keeps its own). */
  synthChains: Record<SynthLayerId, EffectChainState>
  /** Which set of effect controls the panel currently edits: the focused
   *  Piano layer's chain, the shared Organ chain, or the focused Synth
   *  layer's chain. Focus follows section layer presses (manual p. 18). */
  fxSection: SectionKey
  /** Group mode for the Synth FX focus button (mirrors fxGroupPiano): when
   *  true, an effect edit while fxSection is 'synth' applies to all three
   *  synth layer chains. */
  fxGroupSynth: boolean
  /** KB HOLD (manual p. 36): held notes (and the arp's set) keep sounding
   *  after keys are lifted, section-wide. */
  kbHold: boolean
  fxGlobal: { delay: boolean; comp: boolean; reverb: boolean }
  rotary: { speed: RotarySpeed; drive: number }
  /** Truthful last-edit readout shown on the Program display. */
  lastEdit: string
  /** Set when a Clav/Digital/Misc type with no bundled model is selected. */
  pianoNotFound: PianoType | null
}

export const ACOUSTIC_TIMBRES = ['Off', 'Soft', 'Mid', 'Bright'] as const
export const ELECTRIC_TIMBRES = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const

export function timbreListFor(type: PianoType): readonly string[] {
  return type === 'Electric' ? ELECTRIC_TIMBRES : ACOUSTIC_TIMBRES
}

function defaultSynthLayer(enabled: boolean): SynthLayerState {
  return {
    enabled,
    level: 100,
    octave: 0,
    zone: { from: 0, to: 3 },
    waveform: SYNTH_SAW_INDEX,
    oscCtrl: 64,
    oscPitch: { semis: 0, cents: 0 },
    ampEnvelope: { attack: 0, decay: 127, release: 20, velocity: 0 },
    filter: {
      on: true,
      type: 'LP24',
      freq: 127,
      res: 0,
      tracking: 0,
      drive: 0,
      envAmount: 64,
      envelope: { attack: 0, decay: 127, release: 20, velocity: false },
    },
    oscEnvelope: { attack: 0, decay: 64, release: 20, velocity: false, toPitch: false, amount: 64 },
    lfo: { waveform: 'Triangle', rate: 64, amount: 0, destination: null, mstClk: false },
    voice: defaultSynthVoice(),
    mode: 'Analog',
    kbHoldExclude: false,
  }
}

/** The default Piano layer sound (the power-on layer A pose): first Grand
 *  model, full level, no octave shift, full keyboard zone. LAYER INIT —
 *  Pno (manual p. 43) resets the focused layer to this. */
function defaultPianoLayer(enabled: boolean): PianoLayerState {
  return { enabled, level: 100, octave: 0, type: 'Grand', model: 0, zone: { from: 0, to: 3 } }
}

/** Default B3 layer used by LAYER INIT — Org AB (manual p. 43: "Initializes
 *  both Organ Layers to a B3 sound"): a stock 888000000 registration (the
 *  same default the power-on layer B carries), vibrato off. */
function initOrganLayer(enabled: boolean): OrganLayerState {
  return { enabled, level: 100, octave: 0, zone: { from: 0, to: 3 }, model: 'B3', drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], vibrato: false, presetOn: true }
}

function defaultChain(): EffectChainState {
  // Continuous defaults match the panel's initial knob pose (64 = 12 o'clock).
  return {
    mod1: { on: false, type: 'Tremolo', rate: 64, amount: 64, ped: false, mstClk: false },
    mod2: { on: false, type: 'Chorus', rate: 64, amount: 64 },
    delay: { on: false, tempo: 64, feedback: 64, mix: 64, filter: 'Off', effect: 'Off', analog: false, pingPong: false, mstClk: false },
    ampEq: { on: false, type: 'Neutral EQ', drive: 64, bass: 64, mid: 64, treble: 64, freq: 64 },
    comp: { on: false, amount: 64, fast: false },
    reverb: { on: false, type: 'Hall', mix: 64, bright: true },
  }
}

export function initialInstrumentState(): InstrumentState {
  const base = baseInstrumentState()
  const factory = buildFactoryContent(base)
  return { ...base, programs: { ...base.programs, bank: factory.bank, live: factory.live } }
}

function baseInstrumentState(): InstrumentState {
  return {
    masterVolume: 100,
    piano: {
      sectionOn: true,
      kbTouch: 0,
      dynComp: 0,
      timbre: 0,
      unison: 0,
      softRelease: false,
      stringRes: false,
      pedNoise: false,
      sustped: true,
      pstick: true,
    },
    layers: {
      A: defaultPianoLayer(true),
      B: { ...defaultPianoLayer(false), type: 'Electric' },
    },
    focusedLayer: 'A',
    split: {
      on: false,
      points: [
        { active: false, note: 48, xf: 0 },
        { active: true, note: 60, xf: 0 }, // SPLIT ON/SET starts as a single Mid split at C4
        { active: false, note: 72, xf: 0 },
      ],
    },
    scenes: {
      active: 'I',
      stored: { pianoA: true, pianoB: false, organA: true, organB: false, synthA: true, synthB: false, synthC: false },
    },
    morph: { wheel: [], pedal: [] },
    masterClock: { bpm: 120 },
    transpose: { on: false, semitones: 0 },
    splitEdit: null,
    clockEdit: false,
    clockExternal: false,
    transposeEdit: false,
    soloLayer: null,
    layerInitEdit: false,
    sectionEdit: false,
    presetBrowse: null,
    morphArming: null,
    monCopy: null,
    clipboard: null,
    synthEnvEdit: null,
    modelListView: false,
    synthVibratoEdit: false,
    synthOscPitchEdit: false,
    synthArpMenuEdit: false,
    morphValues: { wheel: 0, pedal: 0 },
    // The physical pose boots matching the power-on focused layer's (A's)
    // registration so nothing jumps when a layer first goes Drawbar Live.
    organDrawbarPose: [...DRAWBAR_INITIAL],
    organ: {
      // The section starts off (Piano is the power-on sound); its layer A is
      // pre-enabled so the ON button makes it immediately audible.
      sectionOn: false,
      focusedLayer: 'A',
      layers: {
        // Layer A's registration matches the reference photo's drawbar pose.
        A: { enabled: true, level: 100, octave: 0, zone: { from: 0, to: 3 }, model: 'B3', drawbars: [...DRAWBAR_INITIAL], vibrato: false, presetOn: true },
        B: { enabled: false, level: 100, octave: 0, zone: { from: 0, to: 3 }, model: 'B3', drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], vibrato: false, presetOn: true },
      },
      percussion: { on: false, soft: false, fast: false, third: false, poly: false },
      vibratoType: 'C3',
      toRotary: false,
      sustped: true,
      pstick: true,
    },
    synth: {
      // The section starts off, matching the Organ pose; layer A is
      // pre-enabled so the ON button makes it immediately audible.
      sectionOn: false,
      focusedLayer: 'A',
      layers: {
        A: defaultSynthLayer(true),
        B: defaultSynthLayer(false),
        C: defaultSynthLayer(false),
      },
      sustped: true,
      pstick: true,
      arp: defaultArp(),
    },
    fxGroupPiano: false,
    fxGroupSynth: false,
    allFxOff: false,
    chains: { A: defaultChain(), B: defaultChain() },
    organChain: defaultChain(),
    synthChains: { A: defaultChain(), B: defaultChain(), C: defaultChain() },
    fxSection: 'piano',
    fxGlobal: { delay: false, comp: false, reverb: false },
    rotary: { speed: 'slow', drive: 64 },
    kbHold: false,
    programs: {
      bank: [],
      live: [],
      liveMode: false,
      current: 0,
      lastBank: 0,
      lastLive: 0,
      dirty: false,
      storePending: null,
      naming: null,
      undo: null,
      listView: false,
      numPad: false,
      numPadPending: null,
      progView: 0,
      presetName: false,
    },
    lastEdit: '',
    pianoNotFound: null,
  }
}

/** Display label for a slot in the hardware's bank:page-slot format
 *  (manual p. 13/44: e.g. "A:11" … "A:48"). This build carries one bank, so
 *  the letter is always A; Live slots read L1 … L8. */
function sectionShort(section: 'piano' | 'organ' | 'synth'): string {
  return section === 'piano' ? 'Pno' : section === 'organ' ? 'Org' : 'Syn'
}

export function programLabel(index: number, liveMode: boolean): string {
  return liveMode ? `L${index + 1}` : `A:${Math.floor(index / 8) + 1}${(index % 8) + 1}`
}

/** Characters available to the STORE AS naming dial. */
export const NAMING_CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'

/* ------------------------------------------------------------ zone math -- */

/** Sorted MIDI notes of the active split points (empty = one full-keyboard zone). */
export function splitBoundaries(split: SplitState): number[] {
  if (!split.on) return []
  return split.points
    .filter((point) => point.active)
    .map((point) => point.note)
    .sort((a, b) => a - b)
}

/**
 * Gain factor (0..1) a layer contributes at a played note, from its zone
 * assignment and the split crossfades (manual p. 39): Off switches exactly at
 * the point (the point's note starts the upper zone); ±6/±12 fade linearly
 * across that many semitones on each side, adjacent zones summing to 1.
 */
export function zoneGainFor(split: SplitState, zone: ZoneRange, midi: number): number {
  const boundaries = splitBoundaries(split)
  if (boundaries.length === 0) return 1
  const zoneCount = boundaries.length + 1
  const from = Math.min(zone.from, zoneCount - 1)
  const to = Math.min(zone.to, zoneCount - 1)
  const xfOf = (note: number): number => split.points.find((p) => p.active && p.note === note)?.xf ?? 0
  let factor = 1
  if (from > 0) {
    const edge = boundaries[from - 1]!
    const width = xfOf(edge)
    factor *= width === 0 ? (midi >= edge ? 1 : 0) : Math.min(1, Math.max(0, (midi - (edge - width)) / (2 * width)))
  }
  if (to < zoneCount - 1) {
    const edge = boundaries[to]!
    const width = xfOf(edge)
    factor *= width === 0 ? (midi < edge ? 1 : 0) : Math.min(1, Math.max(0, (edge + width - midi) / (2 * width)))
  }
  return factor
}

/** All contiguous zone ranges for a zone count, in KB ZONE ◂ ▸ cycling order. */
export function contiguousZoneRanges(zoneCount: number): ZoneRange[] {
  const ranges: ZoneRange[] = []
  for (let from = 0; from < zoneCount; from++) {
    for (let to = from; to < zoneCount; to++) ranges.push({ from, to })
  }
  return ranges
}

export function selectedInstrumentId(layer: PianoLayerState): string | null {
  const models = instrumentsOfType(layer.type)
  return models[layer.model]?.id ?? null
}

type Listener = () => void

const PROGRAMS_STORAGE_KEY = 'stagebench.programs.v1'

export class InstrumentStore {
  private state: InstrumentState = initialInstrumentState()
  private listeners = new Set<Listener>()
  private readonly storage: StorageBoundary | null
  /** Pending trailing write for Live-mode auto-store (see schedulePersist). */
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(storage: StorageBoundary | null = null) {
    this.storage = storage
    const restored = this.restorePrograms()
    if (restored) this.state = restored
  }

  getState = (): InstrumentState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(next: InstrumentState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private patch(partial: Partial<InstrumentState>, lastEdit?: string): void {
    let next = { ...this.state, ...partial, lastEdit: lastEdit ?? this.state.lastEdit }
    // Program-captured edits flip the dirty flag — or auto-store in Live mode
    // (manual p. 13). Master Level, display text and program bookkeeping do not.
    if (PROGRAM_SNAPSHOT_KEYS.some((key) => key in partial)) next = this.withEditApplied(next)
    this.commit(next)
  }

  private withEditApplied(next: InstrumentState): InstrumentState {
    const programs = next.programs
    if (programs.liveMode && !programs.storePending) {
      const live = [...programs.live]
      const slot = live[programs.current]
      if (slot) live[programs.current] = { name: slot.name, snapshot: snapshotOf(next) }
      const result = { ...next, programs: { ...programs, live, dirty: false } }
      // The in-memory Live slot updates synchronously (auto-store, manual
      // p. 13); only the localStorage serialization is debounced — writing
      // all 40 program slots per drag tick measured 4.6x the whole commit
      // cost, and a knob drag produces ~120 commits a second.
      this.schedulePersist()
      return result
    }
    return programs.dirty ? next : { ...next, programs: { ...programs, dirty: true } }
  }

  /* ------------------------------------------------------ program storage -- */

  private persistPrograms(state: InstrumentState): void {
    if (!this.storage) return
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const { bank, live, liveMode, current } = state.programs
    this.storage.save(PROGRAMS_STORAGE_KEY, JSON.stringify({ version: 1, bank, live, liveMode, current }))
  }

  private schedulePersist(): void {
    if (!this.storage || this.persistTimer !== null) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistPrograms(this.state)
    }, 300)
  }

  /** Writes any pending debounced Live-mode auto-store immediately. The app
   *  calls this on pagehide/visibilitychange so a reload never loses edits. */
  flushPersist(): void {
    if (this.persistTimer !== null) this.persistPrograms(this.state)
  }

  private restorePrograms(): InstrumentState | null {
    if (!this.storage) return null
    const raw = this.storage.load(PROGRAMS_STORAGE_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as {
        version: number
        bank: ProgramSlot[]
        live: ProgramSlot[]
        liveMode: boolean
        current: number
      }
      if (parsed.version !== 1 || parsed.bank.length !== 32 || parsed.live.length !== 8) return null
      const liveMode = parsed.liveMode === true
      const count = liveMode ? 8 : 32
      const current = Math.max(0, Math.min(count - 1, Math.floor(parsed.current)))
      const slot = (liveMode ? parsed.live : parsed.bank)[current]!
      const base = this.state
      const snapshot = cloneSnapshot(slot.snapshot)
      return {
        ...base,
        ...snapshot,
        // The physical drawbar pose (never persisted) boots from the
        // restored program's focused organ layer so nothing jumps when a
        // layer first goes Drawbar Live.
        organDrawbarPose: [
          ...(snapshot.organ?.layers[snapshot.organ.focusedLayer]?.drawbars ?? base.organDrawbarPose),
        ],
        pianoNotFound: null,
        programs: {
          ...base.programs,
          bank: parsed.bank,
          live: parsed.live,
          liveMode,
          current,
          lastBank: liveMode ? 0 : current,
          lastLive: liveMode ? current : 0,
        },
      }
    } catch {
      return null // unreadable persisted data: fall back to factory content
    }
  }

  /* ------------------------------------------------------------ master -- */

  setMasterVolume(value: number): void {
    const clamped = clamp(value)
    this.patch({ masterVolume: clamped }, `Master Level ${clamped}`)
  }

  /* ------------------------------------------------------- piano layers -- */

  /** SECTION EDIT-aware Piano layer patch (manual p. 43): the partial fans
   *  out to BOTH Piano layers while the latch is on. Layer On/Off
   *  (setLayerEnabled) and Mon/Copy layer paste stay deliberately un-fanned
   *  — they are layer selection / clipboard operations, not parameter
   *  edits (Layer Scenes own the on/off configurations). */
  private patchPianoLayer(layer: LayerId, partial: Partial<PianoLayerState>, lastEdit: string, extra: Partial<InstrumentState> = {}): void {
    const targets: readonly LayerId[] = this.state.sectionEdit ? ['A', 'B'] : [layer]
    const layers = { ...this.state.layers }
    for (const id of targets) layers[id] = { ...layers[id], ...partial }
    this.patch({ layers, ...extra }, targets.length > 1 ? `${lastEdit} — both Piano layers` : lastEdit)
  }

  setLayerEnabled(layer: LayerId, enabled: boolean): void {
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], enabled } }
    // Focus follows the layer being switched on; focusing a disabled layer is allowed on hardware.
    const focusedLayer = enabled ? layer : this.state.focusedLayer
    this.patch(
      { layers, focusedLayer, fxSection: enabled ? 'piano' : this.state.fxSection },
      `Piano ${layer} ${enabled ? 'On' : 'Off'}`,
    )
  }

  toggleLayerEnabled(layer: LayerId): void {
    this.setLayerEnabled(layer, !this.state.layers[layer].enabled)
  }

  /** Canonical Layer-button press (manual p. 12/18): pressing an ACTIVE
   *  layer's button focuses it for editing — it never mutes it; pressing an
   *  inactive layer's button switches it on (focus follows). Turning a
   *  layer OFF is the hold gesture (holdOffLayer). */
  pressLayer(layer: LayerId): void {
    if (!this.state.layers[layer].enabled) this.setLayerEnabled(layer, true)
    else this.setFocusedLayer(layer)
  }

  /** Hold a Layer button ~½ s (manual p. 18: "Layers are turned OFF by
   *  holding down a Layer button for a short moment"). The section's last
   *  active layer stays on, as on the hardware; focus moves to the layer
   *  that remains. */
  holdOffLayer(layer: LayerId): void {
    if (!this.state.layers[layer].enabled) return
    const other: LayerId = layer === 'A' ? 'B' : 'A'
    if (!this.state.layers[other].enabled) {
      this.patch({}, `Piano ${layer} is the only active Layer`)
      return
    }
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], enabled: false } }
    this.patch(
      { layers, focusedLayer: this.state.focusedLayer === layer ? other : this.state.focusedLayer },
      `Piano ${layer} Off (hold)`,
    )
  }

  setLayerLevel(layer: LayerId, level: number): void {
    const clamped = clamp(level)
    this.patchPianoLayer(layer, { level: clamped }, `Piano ${layer} Level ${clamped}`)
  }

  setFocusedLayer(layer: LayerId): void {
    this.patch({ focusedLayer: layer, fxSection: 'piano' }, `FX Focus Piano ${layer}`)
  }

  cycleFocusedLayer(): void {
    this.setFocusedLayer(this.state.focusedLayer === 'A' ? 'B' : 'A')
  }

  shiftOctave(layer: LayerId, delta: -1 | 1): void {
    const current = this.state.layers[layer].octave
    const next = Math.max(-1, Math.min(1, current + delta)) as -1 | 0 | 1
    this.patchPianoLayer(layer, { octave: next }, `Piano ${layer} Octave ${next > 0 ? `+${next}` : next}`)
  }

  setPianoSectionOn(on: boolean): void {
    this.patch({ piano: { ...this.state.piano, sectionOn: on } }, `Piano Section ${on ? 'On' : 'Off'}`)
  }

  /* ---------------------------------------------------- piano selection -- */

  cyclePianoType(): void {
    const layer = this.state.focusedLayer
    const current = this.state.layers[layer].type
    const nextType = PIANO_TYPES[(PIANO_TYPES.indexOf(current) + 1) % PIANO_TYPES.length]!
    this.selectPianoType(nextType)
  }

  selectPianoType(type: PianoType): void {
    const layer = this.state.focusedLayer
    const populated = instrumentsOfType(type).length > 0
    this.patchPianoLayer(
      layer,
      { type, model: 0 },
      populated ? `Piano ${layer}: ${instrumentsOfType(type)[0]!.name}` : `Piano not found (${type})`,
      { pianoNotFound: populated ? null : type },
    )
  }

  selectPianoModel(model: number): void {
    const layer = this.state.focusedLayer
    const models = instrumentsOfType(this.state.layers[layer].type)
    if (models.length === 0) return
    const clamped = Math.max(0, Math.min(models.length - 1, Math.round(model)))
    // The partial carries the focused layer's type too: a fanned Section
    // Edit model selection means "this instrument on both layers" — a bare
    // model index would be meaningless (or out of range) under the other
    // layer's type. Without the latch the type write is a no-op.
    this.patchPianoLayer(layer, { type: this.state.layers[layer].type, model: clamped }, `Piano ${layer}: ${models[clamped]!.name}`, { pianoNotFound: null })
  }

  /** Model list view (Shift + Piano Model dial, spec.scope.optional): shows
   *  the focused layer's type's model list on the Program OLED, mirroring
   *  setProgramListView. Not program state (panel mode only). */
  setModelListView(on: boolean): void {
    if (this.state.modelListView !== on) this.patch({ modelListView: on })
  }

  /* -------------------------------------------------- piano performance -- */

  cycleKbTouch(): void {
    const next = ((this.state.piano.kbTouch + 1) % 3) as 0 | 1 | 2
    this.patch({ piano: { ...this.state.piano, kbTouch: next } }, `KB Touch ${['Heavy', 'Mid', 'Light'][next]}`)
  }

  cycleDynComp(): void {
    const next = ((this.state.piano.dynComp + 1) % 4) as 0 | 1 | 2 | 3
    this.patch({ piano: { ...this.state.piano, dynComp: next } }, `Dyn Comp ${next === 0 ? 'Off' : next}`)
  }

  cycleTimbre(): void {
    const list = timbreListFor(this.state.layers[this.state.focusedLayer].type)
    const next = (this.state.piano.timbre + 1) % list.length
    this.patch({ piano: { ...this.state.piano, timbre: next } }, `Timbre ${list[next]}`)
  }

  cycleUnison(): void {
    const next = ((this.state.piano.unison + 1) % 4) as 0 | 1 | 2 | 3
    this.patch({ piano: { ...this.state.piano, unison: next } }, `Unison ${next === 0 ? 'Off' : next}`)
  }

  togglePianoSustped(): void {
    const sustped = !this.state.piano.sustped
    this.patch({ piano: { ...this.state.piano, sustped } }, `Piano SUSTPED ${sustped ? 'On' : 'Off'}`)
  }

  togglePianoPstick(): void {
    const pstick = !this.state.piano.pstick
    this.patch({ piano: { ...this.state.piano, pstick } }, `Piano PSTICK ${pstick ? 'On' : 'Off'}`)
  }

  cycleAcoustics(): void {
    // One button steps through: none -> Soft Rel -> +String Res -> +Ped Noise -> none.
    const { softRelease, stringRes, pedNoise } = this.state.piano
    let next: Pick<PianoSharedState, 'softRelease' | 'stringRes' | 'pedNoise'>
    if (!softRelease && !stringRes) next = { softRelease: true, stringRes: false, pedNoise: false }
    else if (softRelease && !stringRes) next = { softRelease: true, stringRes: true, pedNoise: false }
    else if (!pedNoise) next = { softRelease: true, stringRes: true, pedNoise: true }
    else next = { softRelease: false, stringRes: false, pedNoise: false }
    const label = next.pedNoise
      ? 'Acoustics: SoftRel+StringRes+PedNoise'
      : next.stringRes
        ? 'Acoustics: SoftRel+StringRes'
        : next.softRelease
          ? 'Acoustics: Soft Release'
          : 'Acoustics: Off'
    this.patch({ piano: { ...this.state.piano, ...next } }, label)
  }

  /* ----- master clock / transpose ----- */

  setMasterClockBpm(bpm: number): void {
    // While locked to external MIDI clock the dial/tap are overridden
    // (manual p. 40) — announce why instead of silently ignoring.
    if (this.state.clockExternal) {
      this.commit({ ...this.state, lastEdit: 'Mst Clk locked to external MIDI clock' })
      return
    }
    const clamped = Math.max(30, Math.min(300, Math.round(bpm)))
    this.patch({ masterClock: { bpm: clamped } }, `Mst Clk ${clamped} BPM`)
  }

  /** External MIDI clock lock (manual p. 40): follows the estimated device
   *  tempo; `null` (clock stop / device gone) reverts to internal control.
   *  A performance input — the program is never marked edited by it. */
  setExternalClock(bpm: number | null): void {
    if (bpm === null) {
      if (!this.state.clockExternal) return
      this.commit({ ...this.state, clockExternal: false, lastEdit: 'Mst Clk external clock stopped — internal' })
      return
    }
    const clamped = Math.max(30, Math.min(300, Math.round(bpm)))
    if (this.state.clockExternal && this.state.masterClock.bpm === clamped) return
    this.commit({
      ...this.state,
      clockExternal: true,
      masterClock: { ...this.state.masterClock, bpm: clamped },
      lastEdit: `Mst Clk EXT ${clamped} BPM`,
    })
  }

  setClockEdit(on: boolean): void {
    if (on === this.state.clockEdit) return
    this.patch(
      { clockEdit: on, ...(on ? { transposeEdit: false, splitEdit: null, layerInitEdit: false, presetBrowse: null, monCopy: null } : {}) },
      on ? 'Mst Clk Edit — dial: BPM · PROG 1/2: delay/mod1 sync' : 'Mst Clk Edit closed',
    )
  }

  toggleDelayClockSync(): void {
    const next = !this.focusedChain().delay.mstClk
    this.updateUnit('delay', { mstClk: next } as never, `Delay MST CLK ${next ? 'On' : 'Off'}`)
  }

  toggleMod1ClockSync(): void {
    const next = !this.focusedChain().mod1.mstClk
    this.updateUnit('mod1', { mstClk: next } as never, `Mod 1 MST CLK ${next ? 'On' : 'Off'}`)
  }

  toggleTranspose(): void {
    const on = !this.state.transpose.on
    this.patch(
      { transpose: { ...this.state.transpose, on } },
      on ? `Transpose On ${fmtSemitones(this.state.transpose.semitones)} st` : 'Transpose Off',
    )
  }

  setTransposeEdit(on: boolean): void {
    if (on === this.state.transposeEdit) return
    this.patch(
      { transposeEdit: on, ...(on ? { clockEdit: false, splitEdit: null, layerInitEdit: false, presetBrowse: null, monCopy: null } : {}) },
      on ? 'Transpose Edit — dial: -6…+6 st' : 'Transpose Edit closed',
    )
  }

  setTransposeSemitones(semitones: number): void {
    const clamped = Math.max(-6, Math.min(6, Math.round(semitones)))
    this.patch(
      { transpose: { ...this.state.transpose, semitones: clamped } },
      `Transpose ${fmtSemitones(clamped)} st`,
    )
  }

  /* ------------------------------------------------------- scenes/splits -- */

  /** Layer Scene I/II: swaps the layer-enable configuration; every sound
   *  parameter is shared between the scenes (manual p. 43). */
  toggleLayerScene(): void {
    const { scenes, layers, organ, synth } = this.state
    const stored = scenes.stored
    const active = scenes.active === 'I' ? 'II' : 'I'
    this.patch(
      {
        layers: {
          A: { ...layers.A, enabled: stored.pianoA },
          B: { ...layers.B, enabled: stored.pianoB },
        },
        organ: {
          ...organ,
          layers: {
            A: { ...organ.layers.A, enabled: stored.organA },
            B: { ...organ.layers.B, enabled: stored.organB },
          },
        },
        synth: {
          ...synth,
          layers: {
            A: { ...synth.layers.A, enabled: stored.synthA },
            B: { ...synth.layers.B, enabled: stored.synthB },
            C: { ...synth.layers.C, enabled: stored.synthC },
          },
        },
        scenes: {
          active,
          stored: {
            pianoA: layers.A.enabled,
            pianoB: layers.B.enabled,
            organA: organ.layers.A.enabled,
            organB: organ.layers.B.enabled,
            synthA: synth.layers.A.enabled,
            synthB: synth.layers.B.enabled,
            synthC: synth.layers.C.enabled,
          },
        },
      },
      `Layer Scene ${active}`,
    )
  }

  /** SPLIT ON/SET: toggles the split (a single Mid point at C4 by default). */
  toggleSplit(): void {
    const on = !this.state.split.on
    this.patch({ split: { ...this.state.split, on } }, `Split ${on ? 'On' : 'Off'}`)
  }

  /** Split-edit panel mode (our adaptation of the manual's press-and-hold menu). */
  setSplitEdit(on: boolean): void {
    if (on === !!this.state.splitEdit) return
    this.patch(
      { splitEdit: on ? { point: 1 } : null, ...(on ? { clockEdit: false, transposeEdit: false, layerInitEdit: false, presetBrowse: null, monCopy: null } : {}) },
      on ? 'Split Edit — dial: position · PAGE: point · PROG 1/2: on/xfade' : 'Split Edit closed',
    )
  }

  selectSplitPoint(delta: -1 | 1): void {
    const edit = this.state.splitEdit
    if (!edit) return
    const point = Math.max(0, Math.min(2, edit.point + delta)) as 0 | 1 | 2
    this.patch({ splitEdit: { point } }, `Split Edit — ${SPLIT_POINT_NAMES[point]}`)
  }

  private patchSplitPoint(partial: Partial<SplitPoint>, label: string): void {
    const edit = this.state.splitEdit
    if (!edit) return
    const points = [...this.state.split.points] as SplitState['points']
    points[edit.point] = { ...points[edit.point], ...partial }
    this.patch({ split: { ...this.state.split, points } }, label)
  }

  /** Dial while in split edit: one of the 11 documented positions. */
  setSplitPosition(value: number): void {
    const edit = this.state.splitEdit
    if (!edit) return
    const index = Math.round((value / 127) * (SPLIT_POSITIONS.length - 1))
    this.patchSplitPoint(
      { note: SPLIT_POSITIONS[index]! },
      `Split ${SPLIT_POINT_NAMES[edit.point]}: ${SPLIT_POSITION_NAMES[index]}`,
    )
  }

  toggleSplitPointActive(): void {
    const edit = this.state.splitEdit
    if (!edit) return
    const active = !this.state.split.points[edit.point].active
    this.patchSplitPoint({ active }, `Split ${SPLIT_POINT_NAMES[edit.point]} ${active ? 'On' : 'Off'}`)
  }

  cycleSplitXf(): void {
    const edit = this.state.splitEdit
    if (!edit) return
    const current = this.state.split.points[edit.point].xf
    const xf = current === 0 ? 6 : current === 6 ? 12 : 0
    this.patchSplitPoint({ xf }, `Split ${SPLIT_POINT_NAMES[edit.point]} XFade ${xf === 0 ? 'Off' : `±${xf}`}`)
  }

  /* ----------------------------------------------------------- layer init -- */

  /** LAYER INIT screen (Shift + Section Edit, manual p. 43), our latched
   *  Program-OLED edit-mode adaptation of the hardware's soft-button menu:
   *  PROGRAM 1-4 act as the All / Org AB / Pno / Syn soft buttons. Mutually
   *  exclusive with the split/clock/transpose edit modes. Not program state. */
  setLayerInitEdit(on: boolean): void {
    if (on === this.state.layerInitEdit) return
    this.patch(
      { layerInitEdit: on, ...(on ? { clockEdit: false, transposeEdit: false, splitEdit: null, presetBrowse: null, monCopy: null } : {}) },
      on ? 'Layer Init — PROG 1: All · 2: Org AB · 3: Pno · 4: Syn' : 'Layer Init closed',
    )
  }

  /** SECTION EDIT (manual p. 43): while engaged, edits done to a parameter
   *  are performed on all Layers of that parameter's Section (the per-layer
   *  patch funnels and updateUnit fan out). The hardware's double-tap
   *  "sticky" mode maps to our click = sticky latch (declared adaptation,
   *  same convention as Mon/Copy); click again or Shift/Exit leaves. Not a
   *  Program-OLED edit mode — the latch coexists with them. Temporary panel
   *  state, never stored in programs (manual p. 38). */
  setSectionEdit(on: boolean): void {
    if (on === this.state.sectionEdit) return
    this.patch(
      { sectionEdit: on },
      on ? 'Section Edit — edits apply to all Layers of the Section' : 'Section Edit off',
    )
  }

  /** LAYER INIT — All (manual p. 43): "Initializes the entire Program so
   *  that only Piano A is active, with no effects turned on." Every
   *  program-stored key returns to its power-on default (Piano A Grand on,
   *  Organ/Synth sections off, all effect chains reset and off); one
   *  ordinary program edit (dirty flag / Live auto-store apply). */
  layerInitAll(): void {
    this.patch({ ...snapshotOf(baseInstrumentState()), pianoNotFound: null }, 'Layer Init — All')
  }

  /** LAYER INIT — Org AB (manual p. 43): both Organ Layers to a default B3
   *  registration with Layer A turned on, percussion/vibrato reset, the
   *  shared Organ effect chain reset and off — except the Rotary Speaker,
   *  which is On. SUSTPED/PSTICK and the section's on/off are performance
   *  routing, not the layers' sound, and stay untouched. */
  layerInitOrganAB(): void {
    this.patch(
      {
        organ: {
          ...this.state.organ,
          focusedLayer: 'A',
          layers: { A: initOrganLayer(true), B: initOrganLayer(false) },
          percussion: { on: false, soft: false, fast: false, third: false, poly: false },
          vibratoType: 'C3',
          toRotary: true,
        },
        organChain: defaultChain(),
      },
      'Layer Init — Organ AB',
    )
  }

  /** LAYER INIT — Pno (manual p. 43): the focused Piano layer to the default
   *  Piano sound and parameters, its effect chain turned off and reset, and
   *  Group-mode effects back to per-layer. The layer's on/off state is kept
   *  (only Org AB documents an enable change). Piano parameters (KB Touch,
   *  Timbre, Acoustics…) are section-shared in this model, so their reset is
   *  section-wide — the closest truthful reading of "default parameters". */
  layerInitPiano(): void {
    const layer = this.state.focusedLayer
    const layers = { ...this.state.layers, [layer]: defaultPianoLayer(this.state.layers[layer].enabled) }
    this.patch(
      {
        layers,
        piano: {
          ...this.state.piano,
          kbTouch: 0,
          dynComp: 0,
          timbre: 0,
          unison: 0,
          softRelease: false,
          stringRes: false,
          pedNoise: false,
        },
        chains: { ...this.state.chains, [layer]: defaultChain() },
        fxGroupPiano: false,
        pianoNotFound: null,
      },
      `Layer Init — Piano ${layer}`,
    )
  }

  /** LAYER INIT — Syn (manual p. 43): the focused Synth layer to the init
   *  synth (defaultSynthLayer — the full-layer superset of SOUND INIT, which
   *  also resets level/octave/zone), its own effect chain turned off and
   *  reset, and Group-mode effects back to per-layer. Enable state is kept. */
  layerInitSynth(): void {
    const layer = this.state.synth.focusedLayer
    const layers = { ...this.state.synth.layers, [layer]: defaultSynthLayer(this.state.synth.layers[layer].enabled) }
    this.patch(
      {
        synth: { ...this.state.synth, layers },
        synthChains: { ...this.state.synthChains, [layer]: defaultChain() },
        fxGroupSynth: false,
      },
      `Layer Init — Synth ${layer}`,
    )
  }

  /* ------------------------------------------------------ preset library -- */

  /** PRESET LIBRARY (manual p. 41): opens the browse screen for a section's
   *  preset bank (ORGAN_PRESETS / PIANO_PRESETS / SYNTH_PRESETS). Entering
   *  captures the current sound for the Cancel soft button and does NOT
   *  load anything yet — the focused preset stays coupled with an "E" until
   *  the dial is turned (manual p. 41). Organ presets are always
   *  whole-Section (manual p. 41 note: both Organ layers share one effect
   *  chain), so singleLayer is forced off there. Mutually exclusive with
   *  the other Program-OLED edit modes. */
  enterPresetBrowse(section: SectionKey, singleLayer: boolean): void {
    const single = section === 'organ' ? false : singleLayer
    const name = presetSectionName(section)
    const focused = section === 'piano' ? this.state.focusedLayer : this.state.synth.focusedLayer
    this.patch(
      {
        presetBrowse: {
          section,
          index: 0,
          preBrowse: snapshotOf(this.state),
          preDirty: this.state.programs.dirty,
          singleLayer: single,
          loaded: false,
        },
        clockEdit: false,
        transposeEdit: false,
        splitEdit: null,
        layerInitEdit: false,
        monCopy: null,
      },
      single ? `${name} Preset — Single Layer ${focused} · dial: load` : `${name} Preset — dial: load · PROG 1: Cancel`,
    )
  }

  /** Leaves the Preset screen. keep=true (Shift/Exit or the same library
   *  button, manual p. 42) keeps the loaded sound — it stays an ordinary
   *  edit; keep=false is the Cancel soft button (manual p. 42: "Pressing
   *  Cancel instead reverts to the sound that was loaded prior to entering
   *  the Preset Library"). */
  exitPresetBrowse(keep: boolean): void {
    const browse = this.state.presetBrowse
    if (!browse) return
    if (keep) {
      this.patch({ presetBrowse: null }, 'Preset Library closed')
      return
    }
    // Routed through patch so a Live slot's auto-store also restores (the
    // cancel is itself an ordinary "edit" back to the pre-browse sound).
    this.patch(
      { ...cloneSnapshot(browse.preBrowse), pianoNotFound: null, presetBrowse: null },
      'Preset cancelled — previous sound restored',
    )
    // Outside Live mode the restore is not an edit relative to the loaded
    // program: put the dirty flag back the way the browse found it.
    if (!this.state.programs.liveMode && this.state.programs.dirty !== browse.preDirty) {
      this.patchPrograms({ dirty: browse.preDirty })
    }
  }

  /** Program dial while browsing (manual p. 41: "Once the dial is operated,
   *  the Preset sound is actually loaded"): 0..127 across the preset list. */
  dialPreset(value: number): void {
    const browse = this.state.presetBrowse
    if (!browse) return
    const count = PRESET_BANKS[browse.section].length
    this.loadPreset(Math.round((clamp(value) / 127) * (count - 1)))
  }

  /** PAGE ◂ ▸ while browsing (manual p. 41: the PAGE buttons navigate the
   *  list): steps to — and loads — the neighboring preset. */
  stepPreset(delta: -1 | 1): void {
    const browse = this.state.presetBrowse
    if (!browse) return
    this.loadPreset(browse.index + delta)
  }

  /** Loads the browsed section's preset at `index` into the current program
   *  — one ordinary dirty (or Live auto-stored) edit. */
  loadPreset(index: number): void {
    const browse = this.state.presetBrowse
    if (!browse) return
    if (browse.section === 'organ') this.loadOrganPreset(index)
    else if (browse.section === 'piano') this.loadPianoPreset(index)
    else this.loadSynthPreset(index)
  }

  /** Layer Scenes and presets (manual p. 43): "When loading a Preset for an
   *  entire Section ... that Section will be turned off in the non-active
   *  Layer Scene." (Single Layer loads leave the other scene untouched.) */
  private scenesWithSectionOff(section: SectionKey): ScenesState {
    const scenes = this.state.scenes
    const off =
      section === 'piano'
        ? { pianoA: false, pianoB: false }
        : section === 'organ'
          ? { organA: false, organB: false }
          : { synthA: false, synthB: false, synthC: false }
    return { ...scenes, stored: { ...scenes.stored, ...off } }
  }

  /** Loads SYNTH_PRESETS[index] into the current program — one ordinary
   *  dirty (or Live auto-stored) edit. Section mode (manual p. 41 "entire
   *  Section") configures layer A plus any declared B/C with the section on
   *  and undeclared layers reset off; SINGLE LAYER (manual p. 42) writes
   *  only the focused layer's sound and its own chain, leaving the other
   *  layers, the section on/off and the arp intact. */
  loadSynthPreset(index: number): void {
    const browse = this.state.presetBrowse
    if (!browse) return
    const clamped = Math.max(0, Math.min(SYNTH_PRESETS.length - 1, Math.round(index)))
    const preset = SYNTH_PRESETS[clamped]!
    const label = `Synth Preset ${clamped + 1}/${SYNTH_PRESETS.length}: ${preset.name}`
    if (browse.singleLayer) {
      const id = this.state.synth.focusedLayer
      const current = this.state.synth.layers[id]
      // Sound fields reset to init then the preset's primary (A) layer is
      // applied; enabled/level/octave/zone are the player's performance
      // setup, not the preset's sound, and stay untouched.
      const loaded = synthLayerFromPreset(preset.layers.A, defaultSynthLayer(current.enabled))
      const layer: SynthLayerState = { ...loaded, enabled: current.enabled, level: current.level, octave: current.octave, zone: current.zone }
      this.patch(
        {
          synth: { ...this.state.synth, layers: { ...this.state.synth.layers, [id]: layer } },
          synthChains: { ...this.state.synthChains, [id]: chainFromPreset(preset.layers.A.chain) },
          presetBrowse: { ...browse, index: clamped, loaded: true },
        },
        `${label} → Layer ${id}`,
      )
      return
    }
    const layers = {} as Record<SynthLayerId, SynthLayerState>
    const synthChains = {} as Record<SynthLayerId, EffectChainState>
    for (const id of SYNTH_LAYER_IDS) {
      const spec = preset.layers[id]
      layers[id] = spec ? synthLayerFromPreset(spec, defaultSynthLayer(true)) : defaultSynthLayer(false)
      synthChains[id] = chainFromPreset(spec?.chain)
    }
    this.patch(
      {
        synth: { ...this.state.synth, sectionOn: true, focusedLayer: 'A', layers, arp: { ...defaultArp(), ...preset.arp } },
        synthChains,
        scenes: this.scenesWithSectionOff('synth'),
        presetBrowse: { ...browse, index: clamped, loaded: true },
      },
      label,
    )
  }

  /** Loads ORGAN_PRESETS[index] — ALWAYS whole-Section (manual p. 41 note:
   *  both Organ layers share one effect chain, so there is no single-layer
   *  variant): both layers' registrations, the shared percussion/scanner/
   *  rotary routing and the shared Organ chain; undeclared layer B resets
   *  off. SUSTPED/PSTICK stay untouched (performance routing, not the
   *  preset's sound — the layerInitOrganAB convention). */
  loadOrganPreset(index: number): void {
    const browse = this.state.presetBrowse
    if (!browse || browse.section !== 'organ') return
    const clamped = Math.max(0, Math.min(ORGAN_PRESETS.length - 1, Math.round(index)))
    const preset = ORGAN_PRESETS[clamped]!
    this.patch(
      {
        organ: {
          ...this.state.organ,
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: organLayerFromPreset(preset.layers.A, true),
            B: preset.layers.B ? organLayerFromPreset(preset.layers.B, true) : initOrganLayer(false),
          },
          percussion: { on: false, soft: false, fast: false, third: false, poly: false, ...preset.percussion },
          vibratoType: preset.vibratoType ?? 'C3',
          toRotary: preset.toRotary ?? false,
        },
        organChain: chainFromPreset(preset.chain),
        scenes: this.scenesWithSectionOff('organ'),
        presetBrowse: { ...browse, index: clamped, loaded: true },
      },
      `Organ Preset ${clamped + 1}/${ORGAN_PRESETS.length}: ${preset.name}`,
    )
  }

  /** Loads PIANO_PRESETS[index]. Section mode configures layer A plus any
   *  declared B (undeclared B resets off) with per-layer chains and the
   *  section-shared Piano parameters over reset defaults; SINGLE LAYER
   *  (manual p. 42) writes only the focused layer's instrument and its own
   *  chain, keeping the other layer and the section on/off intact. Declared
   *  adaptation: KB Touch/Dyn Comp/Timbre/Unison/Acoustics are
   *  section-shared in this model (the layerInitPiano convention), so a
   *  Single Layer load still applies the preset's shared settings. */
  loadPianoPreset(index: number): void {
    const browse = this.state.presetBrowse
    if (!browse || browse.section !== 'piano') return
    const clamped = Math.max(0, Math.min(PIANO_PRESETS.length - 1, Math.round(index)))
    const preset = PIANO_PRESETS[clamped]!
    const label = `Piano Preset ${clamped + 1}/${PIANO_PRESETS.length}: ${preset.name}`
    const shared: PianoSharedState = {
      ...this.state.piano,
      kbTouch: 0,
      dynComp: 0,
      timbre: 0,
      unison: 0,
      softRelease: false,
      stringRes: false,
      pedNoise: false,
      ...preset.shared,
    }
    if (browse.singleLayer) {
      const id = this.state.focusedLayer
      const current = this.state.layers[id]
      // The instrument is the preset's sound; enabled/level/octave/zone are
      // the player's performance setup and stay untouched (the synth
      // single-layer convention).
      const loaded = pianoLayerFromPreset(preset.layers.A, defaultPianoLayer(current.enabled))
      const layer: PianoLayerState = { ...loaded, level: current.level, octave: current.octave, zone: current.zone }
      this.patch(
        {
          layers: { ...this.state.layers, [id]: layer },
          piano: shared,
          chains: { ...this.state.chains, [id]: chainFromPreset(preset.layers.A.chain) },
          pianoNotFound: null,
          presetBrowse: { ...browse, index: clamped, loaded: true },
        },
        `${label} → Layer ${id}`,
      )
      return
    }
    this.patch(
      {
        layers: {
          A: pianoLayerFromPreset(preset.layers.A, defaultPianoLayer(true)),
          B: preset.layers.B ? pianoLayerFromPreset(preset.layers.B, defaultPianoLayer(true)) : defaultPianoLayer(false),
        },
        piano: { ...shared, sectionOn: true },
        focusedLayer: 'A',
        chains: { A: chainFromPreset(preset.layers.A.chain), B: chainFromPreset(preset.layers.B?.chain) },
        scenes: this.scenesWithSectionOff('piano'),
        pianoNotFound: null,
        presetBrowse: { ...browse, index: clamped, loaded: true },
      },
      label,
    )
  }

  /** KB ZONE ◂ ▸ (Shift + Octave, manual p. 39): steps the focused layer
   *  through every contiguous zone range the active split points allow. */
  cycleLayerZone(section: SectionKey, layer: LayerId | SynthLayerId, direction: -1 | 1): void {
    const zoneCount = splitBoundaries(this.state.split).length + 1
    if (zoneCount === 1) {
      this.setLastEdit('KB Zone: no active split')
      return
    }
    const ranges = contiguousZoneRanges(zoneCount)
    const currentZone =
      section === 'piano'
        ? this.state.layers[layer as LayerId].zone
        : section === 'synth'
          ? this.state.synth.layers[layer as SynthLayerId].zone
          : this.state.organ.layers[layer as LayerId].zone
    const clamped = {
      from: Math.min(currentZone.from, zoneCount - 1),
      to: Math.min(currentZone.to, zoneCount - 1),
    }
    const index = ranges.findIndex((r) => r.from === clamped.from && r.to === clamped.to)
    const next = ranges[Math.max(0, Math.min(ranges.length - 1, index + direction))]!
    const sectionLabel = section === 'piano' ? 'Piano' : section === 'synth' ? 'Synth' : 'Organ'
    const label = `${sectionLabel} ${layer} KB Zone ${next.from + 1}–${next.to + 1}`
    if (section === 'piano') {
      this.patchPianoLayer(layer as LayerId, { zone: next }, label)
    } else if (section === 'synth') {
      this.patchSynthLayer(layer as SynthLayerId, { zone: next }, label)
    } else {
      this.patchOrganLayer(layer as LayerId, { zone: next }, label)
    }
  }

  /* --------------------------------------------------------------- morphs -- */

  /** Latches/unlatches a morph source button for assignment (manual p. 38). */
  toggleMorphArming(source: MorphSource): void {
    const arming = this.state.morphArming === source ? null : source
    this.patch(
      { morphArming: arming },
      arming
        ? `Morph ${morphSourceLabel(source)}: move a control start→end · press again when done`
        : `Morph ${morphSourceLabel(source)} assignment done`,
    )
    // Leaving assignment mode re-applies the interpolation at the source's
    // current position (destinations snap back from their end values).
    if (!arming) this.applyMorphNow(source)
  }

  /** Interpolates every destination of a source at its current position. */
  private applyMorphNow(source: MorphSource): void {
    const t = this.state.morphValues[source] / 127
    let next = this.state
    for (const assignment of this.state.morph[source]) next = applyMorphWrite(next, assignment, t)
    if (next !== this.state) this.commit(next)
  }

  /** Shift + source button clears every assignment of that source (manual p. 39). */
  clearMorph(source: MorphSource): void {
    this.patch(
      { morph: { ...this.state.morph, [source]: [] }, morphArming: null },
      `Morph ${morphSourceLabel(source)} cleared`,
    )
  }

  /**
   * Records a destination edit made while a source is armed: the first edit
   * captures start (the value before the edit) and end; later edits move the
   * end; returning a control to its start removes that single assignment.
   */
  recordMorphEdit(source: MorphSource, control: string, layer: MorphAssignment['layer'], previousValue: number, newValue: number): void {
    if (!MORPH_DESTINATIONS.has(control)) return
    const list = [...this.state.morph[source]]
    const index = list.findIndex((a) => a.control === control && a.layer === layer)
    const label = getControl(control).label
    if (index >= 0) {
      const existing = list[index]!
      if (newValue === existing.start) {
        list.splice(index, 1)
        this.patch(
          { morph: { ...this.state.morph, [source]: list } },
          `Morph ${morphSourceLabel(source)} ✕ ${label}`,
        )
        return
      }
      list[index] = { ...existing, end: newValue }
    } else {
      if (newValue === previousValue) return
      list.push({ control, layer, start: previousValue, end: newValue })
    }
    const entry = list[index >= 0 ? index : list.length - 1]!
    this.patch(
      { morph: { ...this.state.morph, [source]: list } },
      `Morph ${morphSourceLabel(source)} → ${label} ${entry.start}→${entry.end}`,
    )
  }

  /**
   * A morph source moved (mod wheel, on-screen control pedal, MIDI CC11):
   * interpolate every assigned destination. This is a performance input — it
   * never marks the program edited and never auto-stores a Live slot.
   */
  setMorphSource(source: MorphSource, value: number): void {
    const clamped = clamp(value)
    if (this.state.morphValues[source] === clamped) return
    this.commit({ ...this.state, morphValues: { ...this.state.morphValues, [source]: clamped } })
    this.applyMorphNow(source)
  }

  /** Sources with an assignment for a control (destination indicator data). */
  morphSourcesFor(control: string): MorphSource[] {
    // Filter by the same layer resolution the range read-back uses, so the
    // green dot and the LED range can never disagree about an assignment.
    const layer = this.morphLayerFor(control)
    const sources: MorphSource[] = []
    for (const source of ['wheel', 'pedal'] as const) {
      if (this.state.morph[source].some((a) => a.control === control && a.layer === layer)) sources.push(source)
    }
    return sources
  }

  /** The layer context a morph edit to `control` captures — THE single
   *  resolver shared by `setValue`'s capture path (presentation.ts), the
   *  indicator read-backs and `applyMorphWrite`'s own id-encoded branches.
   *  Controls that encode their layer in the id (piano/organ/synth level
   *  faders) resolve from the id, NEVER from focus — a fader is bolted to
   *  its layer on the panel (manual p. 38's "Piano B Level" example), so
   *  capturing focus here used to store assignments the interpolator (which
   *  reads the id) and the indicators (which re-resolved via focus) each
   *  understood differently. */
  morphLayerFor(control: string): MorphAssignment['layer'] {
    if (control === 'piano-level-a' || control === 'organ-level-a') return 'A'
    if (control === 'piano-level-b' || control === 'organ-level-b') return 'B'
    if (
      control === 'osc-ctrl' ||
      control === 'filter-freq' ||
      control === 'filter-res' ||
      control === 'lfo-rate' ||
      control === 'lfo-mod-amt'
    ) {
      return `S${this.state.synth.focusedLayer}` as 'SA' | 'SB' | 'SC'
    }
    if (control === 'synth-level-a' || control === 'synth-level-b' || control === 'synth-level-c') return 'SA'
    if (control === 'arp-rate') return 'SA'
    if (control.startsWith('organ')) return this.state.organ.focusedLayer
    if (this.state.fxSection === 'organ') return 'organ'
    if (this.state.fxSection === 'synth') return `S${this.state.synth.focusedLayer}` as 'SA' | 'SB' | 'SC'
    return this.state.focusedLayer
  }

  /** The first assignment (any source) for `control` on its currently
   *  resolved layer — raw start/end panel values (0..127), not LED indices. */
  morphAssignmentFor(control: string): MorphAssignment | null {
    const layer = this.morphLayerFor(control)
    for (const source of ['wheel', 'pedal'] as const) {
      const found = this.state.morph[source].find((a) => a.control === control && a.layer === layer)
      if (found) return found
    }
    return null
  }

  /* ------------------------------------------------------------ programs -- */

  private patchPrograms(partial: Partial<ProgramsState>, lastEdit?: string): void {
    this.commit({
      ...this.state,
      programs: { ...this.state.programs, ...partial },
      lastEdit: lastEdit ?? this.state.lastEdit,
    })
  }

  private activeBank(state: InstrumentState = this.state): ProgramSlot[] {
    return state.programs.liveMode ? state.programs.live : state.programs.bank
  }

  currentProgramLabel(): string {
    const programs = this.state.programs
    return programLabel(programs.current, programs.liveMode)
  }

  /**
   * Loads a program slot. Unsaved edits are discarded (manual p. 13) but kept
   * once for the single-level undo. During an ongoing Store, navigation
   * selects and auditions the store destination instead.
   */
  selectProgram(index: number): void {
    const programs = this.state.programs
    const bank = this.activeBank()
    const clamped = Math.max(0, Math.min(bank.length - 1, Math.round(index)))
    if (programs.storePending) {
      this.auditionStoreDestination(clamped, programs.liveMode)
      return
    }
    const undo = programs.dirty
      ? { slot: programs.current, liveMode: programs.liveMode, snapshot: snapshotOf(this.state) }
      : programs.undo
    const slot = bank[clamped]!
    this.commit({
      ...this.state,
      ...cloneSnapshot(slot.snapshot),
      pianoNotFound: null,
      // A program load replaces the whole sound: the Preset Library browse
      // screen closes (its loaded-preset edit was just discarded like any
      // other edit) and the Preset Name display state resets (manual p. 42).
      presetBrowse: null,
      programs: { ...programs, current: clamped, dirty: false, undo, naming: null, presetName: false },
      lastEdit: `${programLabel(clamped, programs.liveMode)} ${slot.name}`,
    })
    this.persistPrograms(this.state)
  }

  /** One of the eight Program buttons, within the current page (or Live slot). */
  selectProgramButton(button: number): void {
    const programs = this.state.programs
    if (programs.liveMode) {
      // Live programs are ALWAYS directly selected with 1-8, regardless of
      // the Num Pad mode (manual p. 44).
      this.selectProgram(button)
      return
    }
    if (programs.numPad) {
      // Num Pad mode (manual p. 44): two-digit page.slot entry.
      if (programs.numPadPending === null) {
        // First digit = page. This bank is 4 pages × 8 slots (numbers 11-48);
        // the manual's 11-88 range presumes the hardware's 8-page banks, so
        // 5-8 name no page here and the press is ignored.
        if (button <= 3) this.patchPrograms({ numPadPending: button + 1 }, `Num Pad ${button + 1}–`)
        return
      }
      const page = programs.numPadPending
      this.patchPrograms({ numPadPending: null })
      this.selectProgram((page - 1) * 8 + button)
      return
    }
    const reference = programs.storePending ? programs.storePending.destination : programs.current
    this.selectProgram(Math.floor(reference / 8) * 8 + button)
  }

  /** NUM PAD (Shift + Live Mode, manual p. 44): toggles two-digit page.slot
   *  entry on the PROGRAM 1-8 buttons. Not program state. */
  toggleNumPad(): void {
    const numPad = !this.state.programs.numPad
    this.patchPrograms({ numPad, numPadPending: null }, `Num Pad ${numPad ? 'On' : 'Off'}`)
  }

  /** Shift/Exit clears a pending Num Pad page digit; true when one was pending. */
  clearNumPadPending(): boolean {
    if (this.state.programs.numPadPending === null) return false
    this.patchPrograms({ numPadPending: null }, 'Num Pad entry cancelled')
    return true
  }

  /** PROG VIEW (manual p. 42): cycles the four display view modes. */
  cycleProgView(): void {
    const progView = ((this.state.programs.progView + 1) % 4) as 0 | 1 | 2 | 3
    this.patchPrograms({ progView }, `Prog View ${progView + 1}/4`)
  }

  /** PRESET NAME (Shift + Prog View, manual p. 42): layer lines show the
   *  underlying sound source; the flag resets when a Program is loaded. */
  togglePresetName(): void {
    const presetName = !this.state.programs.presetName
    this.patchPrograms({ presetName }, `Preset Name ${presetName ? 'On' : 'Off'}`)
  }

  /** PAGE ◂ ▸ — moves between the four bank pages; moves the naming cursor while naming. */
  shiftProgramPage(delta: -1 | 1): void {
    const programs = this.state.programs
    if (programs.naming) {
      const cursor = Math.max(0, Math.min(15, programs.naming.cursor + delta))
      this.patchPrograms({ naming: { ...programs.naming, cursor } }, `Name: cursor ${cursor + 1}`)
      return
    }
    if (programs.liveMode) return // Live slots have a single page
    const reference = programs.storePending ? programs.storePending.destination : programs.current
    const page = Math.max(0, Math.min(3, Math.floor(reference / 8) + delta))
    this.selectProgram(page * 8 + (reference % 8))
  }

  /** Program dial (0..127 panel value): browses slots; sets characters while
   *  naming; steps and LOADS presets while the Preset Library is open. */
  dialProgram(value: number): void {
    if (this.state.presetBrowse) {
      this.dialPreset(value)
      return
    }
    const programs = this.state.programs
    if (programs.naming) {
      const index = Math.round((value / 127) * (NAMING_CHARSET.length - 1))
      const chars = programs.naming.name.padEnd(programs.naming.cursor + 1, ' ').split('')
      chars[programs.naming.cursor] = NAMING_CHARSET[index]!
      const name = chars.join('').slice(0, 16)
      this.patchPrograms({ naming: { ...programs.naming, name } }, `Name: ${name}`)
      return
    }
    const count = this.activeBank().length
    this.selectProgram(Math.round((value / 127) * (count - 1)))
  }

  /** Panel value of the program dial derived from the selected slot. */
  programDialValue(): number {
    const programs = this.state.programs
    const reference = programs.storePending ? programs.storePending.destination : programs.current
    const count = this.activeBank().length
    return Math.round((reference / (count - 1)) * 127)
  }

  /** Numeric list view flag (Shift + Program dial, manual p. 41). */
  setProgramListView(on: boolean): void {
    if (this.state.programs.listView !== on) this.patchPrograms({ listView: on })
  }

  /**
   * STORE: first press captures the sound and starts destination selection;
   * the second press confirms (manual p. 13). While naming (Store As), the
   * press confirms the name and moves on to destination selection.
   */
  storePress(): void {
    // Declared limitation: storing back INTO the preset bank (manual p. 42
    // "Storing Presets to the Preset Library") is out of scope — the bank is
    // read-only factory content, so STORE always targets program slots. A
    // Store started from the Preset screen first leaves it, keeping the
    // loaded sound (which the capture below then stores like any edit).
    if (this.state.presetBrowse) this.exitPresetBrowse(true)
    const programs = this.state.programs
    if (programs.storePending) {
      this.confirmStore()
      return
    }
    const name = programs.naming ? programs.naming.name.trim() || 'Unnamed' : this.activeBank()[programs.current]!.name
    const captured: ProgramSlot = { name, snapshot: snapshotOf(this.state) }
    this.patchPrograms(
      {
        naming: null,
        storePending: {
          origin: programs.current,
          originDirty: programs.dirty,
          originLiveMode: programs.liveMode,
          destination: programs.current,
          captured,
        },
      },
      `Store "${name}" to ${programLabel(programs.current, programs.liveMode)}? STORE confirms`,
    )
  }

  /** STORE AS: opens naming before the destination step (manual p. 41). */
  storeAsPress(): void {
    const programs = this.state.programs
    if (programs.storePending) return
    const name = programs.naming ? programs.naming.name : this.activeBank()[programs.current]!.name
    this.patchPrograms({ naming: { name, cursor: 0 } }, `Name: ${name} (dial = letter, PAGE = cursor)`)
  }

  /** Navigating during a Store auditions the destination slot (manual p. 13). */
  private auditionStoreDestination(index: number, liveMode: boolean): void {
    const programs = this.state.programs
    const pending = programs.storePending!
    const bank = liveMode ? programs.live : programs.bank
    const clamped = Math.max(0, Math.min(bank.length - 1, index))
    const slot = bank[clamped]!
    this.commit({
      ...this.state,
      ...cloneSnapshot(slot.snapshot),
      pianoNotFound: null,
      programs: { ...programs, liveMode, storePending: { ...pending, destination: clamped } },
      lastEdit: `Store "${pending.captured.name}" to ${programLabel(clamped, liveMode)}? STORE confirms`,
    })
  }

  private confirmStore(): void {
    const programs = this.state.programs
    const pending = programs.storePending!
    const bankKey = programs.liveMode ? 'live' : 'bank'
    const bank = [...this.activeBank()]
    bank[pending.destination] = {
      name: pending.captured.name,
      snapshot: cloneSnapshot(pending.captured.snapshot),
    }
    this.commit({
      ...this.state,
      ...cloneSnapshot(pending.captured.snapshot),
      pianoNotFound: null,
      programs: {
        ...programs,
        [bankKey]: bank,
        current: pending.destination,
        dirty: false,
        storePending: null,
      },
      lastEdit: `Stored ${programLabel(pending.destination, programs.liveMode)} ${pending.captured.name}`,
    })
    this.persistPrograms(this.state)
  }

  /** Shift/Exit aborts an ongoing Store or naming step (manual p. 13). */
  cancelStoreFlow(): boolean {
    const programs = this.state.programs
    if (programs.naming) {
      this.patchPrograms({ naming: null }, 'Store As cancelled')
      return true
    }
    const pending = programs.storePending
    if (!pending) return false
    // Restore the captured (edited) sound and the origin slot selection.
    this.commit({
      ...this.state,
      ...cloneSnapshot(pending.captured.snapshot),
      pianoNotFound: null,
      programs: {
        ...programs,
        storePending: null,
        current: pending.origin,
        dirty: pending.originDirty,
        // The origin index is only valid in the origin bank: restore the
        // bank mode too, or a Live toggle during destination selection
        // strands a bank index on the 8-slot Live array (crash + silent
        // auto-store loss).
        liveMode: pending.originLiveMode,
      },
      lastEdit: 'Store cancelled',
    })
    return true
  }

  /** LIVE MODE: switches the eight Program buttons to the auto-storing Live slots. */
  toggleLiveMode(): void {
    const programs = this.state.programs
    if (programs.naming) return
    const liveMode = !programs.liveMode
    if (programs.storePending) {
      // Store continues across banks — this is how programs are copied
      // between Live and regular slots (manual p. 13, 44).
      this.auditionStoreDestination(Math.min(liveMode ? 7 : 31, programs.storePending.destination), liveMode)
      return
    }
    const target = liveMode ? programs.lastLive : programs.lastBank
    const undo = programs.dirty
      ? { slot: programs.current, liveMode: programs.liveMode, snapshot: snapshotOf(this.state) }
      : programs.undo
    const bank = liveMode ? programs.live : programs.bank
    const slot = bank[target]!
    this.commit({
      ...this.state,
      ...cloneSnapshot(slot.snapshot),
      pianoNotFound: null,
      // Switching banks loads a program — the preset browse screen closes.
      presetBrowse: null,
      programs: {
        ...programs,
        liveMode,
        current: target,
        dirty: false,
        undo,
        lastBank: liveMode ? programs.current : programs.lastBank,
        lastLive: liveMode ? programs.lastLive : programs.current,
        // Switching modes loads a program: Preset Name resets (manual p. 42)
        // and any half-entered Num Pad digit is dropped.
        presetName: false,
        numPadPending: null,
      },
      lastEdit: `${liveMode ? 'Live Mode' : 'Program Mode'} — ${programLabel(target, liveMode)} ${slot.name}`,
    })
    this.persistPrograms(this.state)
  }

  /** Single-level undo: restores the edited state a program change discarded. */
  undoProgramChange(): void {
    const programs = this.state.programs
    const undo = programs.undo
    if (!undo || programs.storePending || programs.naming) {
      this.setLastEdit('Nothing to undo')
      return
    }
    this.commit({
      ...this.state,
      ...cloneSnapshot(undo.snapshot),
      pianoNotFound: null,
      programs: { ...programs, liveMode: undo.liveMode, current: undo.slot, dirty: true, undo: null },
      lastEdit: `Undo — back to ${programLabel(undo.slot, undo.liveMode)} (edited)`,
    })
  }

  /* ------------------------------------------------ monitor / copy / paste -- */

  /** MON/COPY / PASTE latch (manual p. 43) — pointer-first adaptation of the
   *  hardware's hold gestures (declared; like SOLO's click convention): a
   *  Mon/Copy click latches monitor/copy mode, Shift + click latches Paste;
   *  clicking again or Shift/Exit leaves. While latched, presentation.ts
   *  routes continuous controls to a read-only monitor readout and the
   *  Layer / effect ON / Morph Assign / PROGRAM buttons to the copy/paste
   *  presses below. Mutually exclusive with the Program-OLED edit modes and
   *  preset browsing; opening the latch is panel-only state, not an edit. */
  setMonCopyMode(mode: 'copy' | 'paste' | null): void {
    if (mode === this.state.monCopy) return
    this.patch(
      {
        monCopy: mode,
        ...(mode ? { clockEdit: false, transposeEdit: false, splitEdit: null, layerInitEdit: false, presetBrowse: null } : {}),
      },
      mode === 'copy'
        ? 'Mon/Copy — turn a knob: monitor · Layer/FX On/Morph/Program: copy'
        : mode === 'paste'
          ? 'Paste — press a Layer / FX On / Morph / Program target'
          : 'Mon/Copy off',
    )
  }

  /** Truthful refusal shared by every incompatible (or empty) paste press:
   *  prints what the clipboard holds and writes nothing. */
  private monCopyRefuse(): void {
    const clip = this.state.clipboard
    this.setLastEdit(clip ? `Cannot paste ${clip.label} here` : 'Paste — clipboard empty')
  }

  /** A LAYER button pressed while a Mon/Copy latch is on (manual p. 43 "To
   *  copy a Layer, press any Layer A, B or C buttons"): copy captures the
   *  layer's full state plus its effect chain; paste writes a SAME-SECTION
   *  clipboard layer into the pressed one as one ordinary edit. Cross-
   *  section layer pastes are refused — the Piano/Organ/Synth layer schemas
   *  genuinely differ. Both Organ layers share one chain (manual p. 18), so
   *  an Organ layer copy carries — and its paste rewrites — the shared chain. */
  monCopyLayerPress(section: SectionKey, layer: LayerId | SynthLayerId): void {
    const label = `${presetSectionName(section)} ${layer}`
    if (this.state.monCopy === 'copy') {
      const clipboard: MonCopyClipboard =
        section === 'piano'
          ? { kind: 'piano-layer', label, payload: deepClone({ layer: this.state.layers[layer as LayerId], chain: this.state.chains[layer as LayerId] }) }
          : section === 'organ'
            ? { kind: 'organ-layer', label, payload: deepClone({ layer: this.state.organ.layers[layer as LayerId], chain: this.state.organChain }) }
            : { kind: 'synth-layer', label, payload: deepClone({ layer: this.state.synth.layers[layer as SynthLayerId], chain: this.state.synthChains[layer as SynthLayerId] }) }
      this.patch({ clipboard }, `Copied: ${label}`)
      return
    }
    const clip = this.state.clipboard
    if (section === 'piano' && clip?.kind === 'piano-layer') {
      const payload = deepClone(clip.payload)
      this.patch(
        { layers: { ...this.state.layers, [layer]: payload.layer }, chains: { ...this.state.chains, [layer]: payload.chain } },
        `Pasted → ${label}`,
      )
      return
    }
    if (section === 'organ' && clip?.kind === 'organ-layer') {
      const payload = deepClone(clip.payload)
      this.patch(
        {
          organ: { ...this.state.organ, layers: { ...this.state.organ.layers, [layer]: payload.layer } },
          organChain: payload.chain,
        },
        `Pasted → ${label}`,
      )
      return
    }
    if (section === 'synth' && clip?.kind === 'synth-layer') {
      const payload = deepClone(clip.payload)
      this.patch(
        {
          synth: { ...this.state.synth, layers: { ...this.state.synth.layers, [layer]: payload.layer } },
          synthChains: { ...this.state.synthChains, [layer]: payload.chain },
        },
        `Pasted → ${label}`,
      )
      return
    }
    this.monCopyRefuse()
  }

  /** An effect unit's ON button while a latch is on (manual p. 43 "To copy
   *  an Effect, press any Effect ON button"): copy captures the focused
   *  chain's unit settings; paste writes them back through updateUnit — the
   *  same one-ordinary-edit path a knob edit uses (honoring FX focus and
   *  Group/Global targeting). Same-unit pastes only: the unit schemas differ. */
  monCopyEffectPress(unit: keyof EffectChainState): void {
    if (this.state.monCopy === 'copy') {
      const clipboard: MonCopyClipboard = { kind: 'effect', label: unitLabel(unit), unit, payload: deepClone(this.focusedChain()[unit]) }
      this.patch({ clipboard }, `Copied: ${unitLabel(unit)}`)
      return
    }
    const clip = this.state.clipboard
    if (clip?.kind === 'effect' && clip.unit === unit) {
      this.updateUnit(unit, deepClone(clip.payload) as never, `Pasted → ${unitLabel(unit)}`)
      return
    }
    this.monCopyRefuse()
  }

  /** A Morph Assign source button while a latch is on (manual p. 43 "To
   *  copy a Morph, press the WHEEL, A.T. or CTRLPED buttons" — A.T. stays
   *  spec-excluded): copy captures that source's assignments; paste writes
   *  them onto the PRESSED source (the assignment lists share one schema). */
  monCopyMorphPress(source: MorphSource): void {
    if (this.state.monCopy === 'copy') {
      const clipboard: MonCopyClipboard = { kind: 'morph', label: `Morph ${morphSourceLabel(source)}`, payload: deepClone(this.state.morph[source]) }
      this.patch({ clipboard }, `Copied: Morph ${morphSourceLabel(source)}`)
      return
    }
    const clip = this.state.clipboard
    if (clip?.kind === 'morph') {
      this.patch({ morph: { ...this.state.morph, [source]: deepClone(clip.payload) } }, `Pasted → Morph ${morphSourceLabel(source)}`)
      return
    }
    this.monCopyRefuse()
  }

  /** A PROGRAM 1-8 button while a latch is on (manual p. 43 "To copy a
   *  Program, press one of the PROGRAM 1-8 buttons"): copy captures that
   *  slot of the current page (or Live bank); paste writes the clipboard
   *  into the pressed slot and loads it there — like a confirmed Store. */
  monCopyProgramPress(button: number): void {
    const programs = this.state.programs
    const index = programs.liveMode ? button : Math.floor(programs.current / 8) * 8 + button
    const slotLabel = programLabel(index, programs.liveMode)
    if (this.state.monCopy === 'copy') {
      const slot = this.activeBank()[index]!
      const clipboard: MonCopyClipboard = { kind: 'program', label: `Program ${slotLabel} ${slot.name}`, payload: deepClone(slot) }
      this.patch({ clipboard }, `Copied: ${slotLabel} ${slot.name}`)
      return
    }
    const clip = this.state.clipboard
    if (clip?.kind === 'program') {
      const bankKey = programs.liveMode ? 'live' : 'bank'
      const bank = [...this.activeBank()]
      bank[index] = deepClone(clip.payload)
      this.commit({
        ...this.state,
        ...cloneSnapshot(clip.payload.snapshot),
        pianoNotFound: null,
        programs: { ...programs, [bankKey]: bank, current: index, dirty: false },
        lastEdit: `Pasted → ${slotLabel} ${clip.payload.name}`,
      })
      this.persistPrograms(this.state)
      return
    }
    this.monCopyRefuse()
  }

  /* -------------------------------------------------------------- organ -- */

  private patchOrgan(partial: Partial<OrganState>, lastEdit: string): void {
    this.patch({ organ: { ...this.state.organ, ...partial } }, lastEdit)
  }

  /** SECTION EDIT-aware Organ layer patch (manual p. 43): the partial fans
   *  out to BOTH Organ layers while the latch is on (level, octave, model,
   *  Preset/Drawbar-Live, vibrato on/off, SYNC, zones). Layer On/Off
   *  (toggleOrganLayerEnabled) and Mon/Copy layer paste stay deliberately
   *  un-fanned — layer selection / clipboard operations, not parameter
   *  edits. Percussion and the scanner type are already section-shared. */
  private patchOrganLayer(layer: LayerId, partial: Partial<OrganLayerState>, lastEdit: string): void {
    const targets: readonly LayerId[] = this.state.sectionEdit ? ['A', 'B'] : [layer]
    const layers = { ...this.state.organ.layers }
    for (const id of targets) layers[id] = { ...layers[id], ...partial }
    this.patchOrgan({ layers }, targets.length > 1 ? `${lastEdit} — both Organ layers` : lastEdit)
  }

  setOrganSectionOn(on: boolean): void {
    this.patchOrgan({ sectionOn: on }, `Organ Section ${on ? 'On' : 'Off'}`)
  }

  toggleOrganLayerEnabled(layer: LayerId): void {
    const enabled = !this.state.organ.layers[layer].enabled
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], enabled } }
    // Focus follows the layer being switched on (manual p. 18).
    const focusedLayer = enabled ? layer : this.state.organ.focusedLayer
    this.patch(
      { organ: { ...this.state.organ, layers, focusedLayer }, fxSection: enabled ? 'organ' : this.state.fxSection },
      `Organ ${layer} ${enabled ? 'On' : 'Off'}`,
    )
  }

  /** Canonical Layer-button press for Organ (manual p. 12/18) — see pressLayer. */
  pressOrganLayer(layer: LayerId): void {
    if (!this.state.organ.layers[layer].enabled) this.toggleOrganLayerEnabled(layer)
    else this.setOrganFocusedLayer(layer)
  }

  /** Hold an Organ Layer button (manual p. 18) — see holdOffLayer. */
  holdOffOrganLayer(layer: LayerId): void {
    if (!this.state.organ.layers[layer].enabled) return
    const other: LayerId = layer === 'A' ? 'B' : 'A'
    if (!this.state.organ.layers[other].enabled) {
      this.patch({}, `Organ ${layer} is the only active Layer`)
      return
    }
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], enabled: false } }
    this.patch(
      {
        organ: {
          ...this.state.organ,
          layers,
          focusedLayer: this.state.organ.focusedLayer === layer ? other : this.state.organ.focusedLayer,
        },
      },
      `Organ ${layer} Off (hold)`,
    )
  }

  setOrganLayerLevel(layer: LayerId, level: number): void {
    const clamped = clamp(level)
    this.patchOrganLayer(layer, { level: clamped }, `Organ ${layer} Level ${clamped}`)
  }

  setOrganFocusedLayer(layer: LayerId): void {
    this.patch({ organ: { ...this.state.organ, focusedLayer: layer }, fxSection: 'organ' }, `Organ Focus ${layer}`)
  }

  shiftOrganOctave(layer: LayerId, delta: -1 | 1): void {
    const current = this.state.organ.layers[layer].octave
    const next = Math.max(-1, Math.min(1, current + delta)) as -1 | 0 | 1
    this.patchOrganLayer(layer, { octave: next }, `Organ ${layer} Octave ${next > 0 ? `+${next}` : next}`)
  }

  cycleOrganModel(): void {
    const layer = this.state.organ.focusedLayer
    const current = this.state.organ.layers[layer].model
    const next = ORGAN_MODELS[(ORGAN_MODELS.indexOf(current) + 1) % ORGAN_MODELS.length]!
    this.patchOrganLayer(layer, { model: next }, `Organ ${layer}: ${organModelLabel(next)}`)
  }

  setOrganDrawbar(index: number, value: number): void {
    const layer = this.state.organ.focusedLayer
    const clamped = Math.max(0, Math.min(8, Math.round(value)))
    // Dragging a drawbar always moves the ONE physical pose (there is one
    // physical set of drawbars on the hardware).
    const organDrawbarPose = [...this.state.organDrawbarPose]
    organDrawbarPose[index] = clamped
    const layerState = this.state.organ.layers[layer]
    if (!layerState.presetOn) {
      // Drawbar Live (manual p. 19/21): the physical pose drives the sound;
      // the Program's stored registration stays untouched — a pose move is
      // not a program edit (no dirty flag, no Live auto-store).
      this.patch({ organDrawbarPose }, `Drawbar ${index + 1}: ${clamped} (Live)`)
      return
    }
    // SECTION EDIT (manual p. 43): the registration edit fans out to both
    // layers' stored drawbars. The Drawbar-Live path above is untouched —
    // a pose move is not a parameter edit, so there is nothing to fan.
    const targets: readonly LayerId[] = this.state.sectionEdit ? ['A', 'B'] : [layer]
    const layers = { ...this.state.organ.layers }
    for (const id of targets) {
      const drawbars = [...layers[id].drawbars]
      drawbars[index] = clamped
      layers[id] = { ...layers[id], drawbars }
    }
    this.patch(
      { organDrawbarPose, organ: { ...this.state.organ, layers } },
      targets.length > 1 ? `Drawbar ${index + 1}: ${clamped} — both Organ layers` : `Drawbar ${index + 1}: ${clamped}`,
    )
  }

  /** PRESET On/Off for the focused layer (manual p. 21). Off = "Drawbar
   *  Live": the physical drawbar pose drives the sound and the drawbar LED
   *  graphs go dark (manual p. 19). Per-layer, program-stored. */
  toggleOrganPreset(): void {
    const layer = this.state.organ.focusedLayer
    const presetOn = !this.state.organ.layers[layer].presetOn
    this.patchOrganLayer(layer, { presetOn }, `Organ ${layer} Preset ${presetOn ? 'On' : 'Off — Drawbar Live'}`)
  }

  /** SYNC (Shift + Preset, manual p. 21): synchronizes the focused layer's
   *  Preset settings with the physical positions of the drawbars — one
   *  ordinary dirty (or Live auto-stored) edit. p. 21 specifies only the
   *  copy, so the layer's Preset On/Off state is left untouched. (The
   *  manual's press-hold PRESET alternative for SYNC is not modeled —
   *  declared adaptation; Shift + Preset is the one way in.) */
  syncOrganDrawbars(): void {
    const layer = this.state.organ.focusedLayer
    this.patchOrganLayer(layer, { drawbars: [...this.state.organDrawbarPose] }, `Organ ${layer} SYNC: Preset ← drawbars`)
  }

  cycleOrganVibratoType(): void {
    const next = VIBRATO_TYPES[(VIBRATO_TYPES.indexOf(this.state.organ.vibratoType) + 1) % VIBRATO_TYPES.length]!
    this.patchOrgan({ vibratoType: next }, `Vib/Chorus ${next}`)
  }

  toggleOrganVibrato(): void {
    const layer = this.state.organ.focusedLayer
    const vibrato = !this.state.organ.layers[layer].vibrato
    this.patchOrganLayer(layer, { vibrato }, `Organ ${layer} Vib/Chorus ${vibrato ? 'On' : 'Off'}`)
  }

  toggleOrganPercussion(flag: 'on' | 'soft' | 'fast' | 'third' | 'poly'): void {
    const percussion = { ...this.state.organ.percussion, [flag]: !this.state.organ.percussion[flag] }
    const label =
      flag === 'on'
        ? `Percussion ${percussion.on ? 'On' : 'Off'}`
        : flag === 'soft'
          ? `Percussion Volume ${percussion.soft ? 'Soft' : 'Normal'}`
          : flag === 'fast'
            ? `Percussion Decay ${percussion.fast ? 'Fast' : 'Slow'}`
            : flag === 'third'
              ? `Percussion Harmonic ${percussion.third ? 'Third' : 'Second'}`
              : `Percussion Poly ${percussion.poly ? 'On' : 'Off'}`
    this.patchOrgan({ percussion }, label)
  }

  toggleOrganRotary(): void {
    const toRotary = !this.state.organ.toRotary
    this.patchOrgan({ toRotary }, `Organ → Rotary ${toRotary ? 'On' : 'Off'}`)
  }

  toggleOrganSustped(): void {
    const sustped = !this.state.organ.sustped
    this.patchOrgan({ sustped }, `Organ SUSTPED ${sustped ? 'On' : 'Off'}`)
  }

  toggleOrganPstick(): void {
    const pstick = !this.state.organ.pstick
    this.patchOrgan({ pstick }, `Organ PSTICK ${pstick ? 'On' : 'Off'}`)
  }

  /* -------------------------------------------------------------- synth -- */

  private patchSynth(partial: Partial<SynthState>, lastEdit: string): void {
    this.patch({ synth: { ...this.state.synth, ...partial } }, lastEdit)
  }

  /** SECTION EDIT-aware Synth layer patch (manual p. 43: "especially useful
   *  for synchronizing Synth parameters across Layers"): `partialFor` sees
   *  each target layer, so nested objects (filter/lfo/voice/envelopes/
   *  oscPitch) merge against that layer's OWN state and only the edited
   *  fields fan out. Layer On/Off (toggleSynthLayerEnabled) and Mon/Copy
   *  layer paste stay deliberately un-fanned — layer selection / clipboard
   *  operations, not parameter edits. */
  private patchSynthLayers(layer: SynthLayerId, partialFor: (current: SynthLayerState) => Partial<SynthLayerState>, lastEdit: string): void {
    const targets: readonly SynthLayerId[] = this.state.sectionEdit ? SYNTH_LAYER_IDS : [layer]
    const layers = { ...this.state.synth.layers }
    for (const id of targets) layers[id] = { ...layers[id], ...partialFor(layers[id]) }
    this.patchSynth({ layers }, targets.length > 1 ? `${lastEdit} — all Synth layers` : lastEdit)
  }

  private patchSynthLayer(layer: SynthLayerId, partial: Partial<SynthLayerState>, lastEdit: string): void {
    this.patchSynthLayers(layer, () => partial, lastEdit)
  }

  setSynthSectionOn(on: boolean): void {
    this.patchSynth({ sectionOn: on }, `Synth Section ${on ? 'On' : 'Off'}`)
  }

  /** SOLO (manual p. 18): holding a section's ON button for ~half a second
   *  activates only that section, turning the other two off. */
  /** SOLO button (manual quick guide p. 13): latches solo monitoring of
   *  the FX-focused layer; pressing another Layer button retargets it.
   *  Solo again (or Shift/Exit) exits. A live gain gate in the engine —
   *  layer enables and program state are never touched. */
  toggleProgramSolo(): void {
    if (this.state.soloLayer) {
      this.patch({ soloLayer: null }, 'Solo Off')
      return
    }
    const section = this.state.fxSection === 'organ' ? ('organ' as const) : this.state.fxSection === 'synth' ? ('synth' as const) : ('piano' as const)
    const layer = section === 'organ' ? this.state.organ.focusedLayer : section === 'synth' ? this.state.synth.focusedLayer : this.state.focusedLayer
    this.patch({ soloLayer: { section, layer } }, `Solo ${sectionShort(section)} ${layer} — Layer buttons retarget`)
  }

  /** While the Solo latch is on, Layer buttons retarget the monitor instead
   *  of toggling enables (manual: "pressing the button for that Layer"). */
  retargetProgramSolo(section: 'piano' | 'organ' | 'synth', layer: 'A' | 'B' | 'C'): boolean {
    if (!this.state.soloLayer) return false
    this.patch({ soloLayer: { section, layer } }, `Solo ${sectionShort(section)} ${layer}`)
    return true
  }

  soloSection(section: 'piano' | 'organ' | 'synth'): void {
    const label = `Solo ${section.charAt(0).toUpperCase()}${section.slice(1)}`
    this.patch(
      {
        piano: { ...this.state.piano, sectionOn: section === 'piano' },
        organ: { ...this.state.organ, sectionOn: section === 'organ' },
        synth: { ...this.state.synth, sectionOn: section === 'synth' },
      },
      label,
    )
  }

  toggleSynthLayerEnabled(layer: SynthLayerId): void {
    const enabled = !this.state.synth.layers[layer].enabled
    const layers = { ...this.state.synth.layers, [layer]: { ...this.state.synth.layers[layer], enabled } }
    // Focus follows the layer being switched on (mirrors the Organ/Piano pattern).
    const focusedLayer = enabled ? layer : this.state.synth.focusedLayer
    this.patch({ synth: { ...this.state.synth, layers, focusedLayer } }, `Synth ${layer} ${enabled ? 'On' : 'Off'}`)
  }

  setSynthFocusedLayer(layer: SynthLayerId): void {
    this.patchSynth({ focusedLayer: layer }, `Synth Focus ${layer}`)
  }

  /** FX FOCUS SYNTH (mirrors setFocusedLayer for Piano): moves FX focus onto
   *  the given synth layer's own chain. */
  setSynthFxFocus(layer: SynthLayerId): void {
    this.patch({ synth: { ...this.state.synth, focusedLayer: layer }, fxSection: 'synth' }, `FX Focus Synth ${layer}`)
  }

  /** Canonical Layer-button press for Synth (manual p. 12/18) — see pressLayer. */
  pressSynthLayer(layer: SynthLayerId): void {
    if (!this.state.synth.layers[layer].enabled) this.toggleSynthLayerEnabled(layer)
    else this.setSynthFocusedLayer(layer)
  }

  /** Hold a Synth Layer button (manual p. 18) — see holdOffLayer. */
  holdOffSynthLayer(layer: SynthLayerId): void {
    if (!this.state.synth.layers[layer].enabled) return
    const others = SYNTH_LAYER_IDS.filter((id) => id !== layer && this.state.synth.layers[id].enabled)
    if (others.length === 0) {
      this.patch({}, `Synth ${layer} is the only active Layer`)
      return
    }
    const layers = { ...this.state.synth.layers, [layer]: { ...this.state.synth.layers[layer], enabled: false } }
    this.patchSynth(
      { layers, focusedLayer: this.state.synth.focusedLayer === layer ? others[0]! : this.state.synth.focusedLayer },
      `Synth ${layer} Off (hold)`,
    )
  }

  setSynthLayerLevel(layer: SynthLayerId, level: number): void {
    const clamped = clamp(level)
    this.patchSynthLayer(layer, { level: clamped }, `Synth ${layer} Level ${clamped}`)
  }

  shiftSynthOctave(layer: SynthLayerId, delta: -1 | 1): void {
    const current = this.state.synth.layers[layer].octave
    const next = Math.max(-1, Math.min(1, current + delta)) as -1 | 0 | 1
    this.patchSynthLayer(layer, { octave: next }, `Synth ${layer} Octave ${next > 0 ? `+${next}` : next}`)
  }

  /** WAVEFORM SELECT: cycles the focused layer to the first waveform of the
   *  next category (manual p. 28: category button steps Pure→Sync→Multi→Super→FM-H). */
  cycleSynthWaveformCategory(): void {
    const layer = this.state.synth.focusedLayer
    const current = SYNTH_WAVEFORMS[this.state.synth.layers[layer].waveform]!
    const nextCategory =
      SYNTH_WAVEFORM_CATEGORIES[(SYNTH_WAVEFORM_CATEGORIES.indexOf(current.category) + 1) % SYNTH_WAVEFORM_CATEGORIES.length]!
    const index = SYNTH_WAVEFORMS.findIndex((w) => w.category === nextCategory)
    this.selectSynthWaveform(index)
  }

  /** Synth OLED dial 2 (or the piano-model-style encoder mapping): selects a
   *  waveform by its absolute index in SYNTH_WAVEFORMS. */
  selectSynthWaveform(index: number): void {
    const layer = this.state.synth.focusedLayer
    const clamped = Math.max(0, Math.min(SYNTH_WAVEFORMS.length - 1, Math.round(index)))
    const waveform = SYNTH_WAVEFORMS[clamped]!
    this.patchSynthLayer(layer, { waveform: clamped }, `Synth ${layer}: ${waveform.name}`)
  }

  setSynthOscCtrl(value: number): void {
    const layer = this.state.synth.focusedLayer
    const clamped = clamp(value)
    this.patchSynthLayer(layer, { oscCtrl: clamped }, `Synth ${layer} Osc Ctrl ${(clamped / 12.7).toFixed(1)}`)
  }

  /** SYNTH MODE (spec.scope.optional "Samples mode"): cycles Analog <-> Samples
   *  for the focused layer. EXTERN is spec-excluded and never a stop on this
   *  cycle (manual's third position stays decorative). */
  cycleSynthLayerMode(): void {
    const layer = this.state.synth.focusedLayer
    const next: SynthLayerMode = this.state.synth.layers[layer].mode === 'Analog' ? 'Samples' : 'Analog'
    this.patchSynthLayer(layer, { mode: next }, `Synth ${layer} Mode: ${next}`)
  }

  /** SOUND INIT (spec.scope.optional): resets the focused layer's sound
   *  parameters (waveform, Osc Ctrl, envelopes, filter, LFO, voice) to init
   *  defaults, mirroring defaultSynthLayer's sound fields, while PRESERVING
   *  enabled/level/octave/zone (manual's Layer Init resets a whole layer;
   *  Sound Init is the Synth-specific sound-only variant of that idea). */
  synthSoundInit(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer]
    const defaults = defaultSynthLayer(current.enabled)
    this.patchSynthLayer(
      layer,
      {
        waveform: defaults.waveform,
        oscCtrl: defaults.oscCtrl,
        oscPitch: defaults.oscPitch,
        ampEnvelope: defaults.ampEnvelope,
        filter: defaults.filter,
        oscEnvelope: defaults.oscEnvelope,
        lfo: defaults.lfo,
        voice: defaults.voice,
        mode: defaults.mode,
      },
      `Sound Init — Synth ${layer}`,
    )
  }

  setSynthAmpEnvelope(partial: Partial<SynthAmpEnvelopeState>): void {
    const layer = this.state.synth.focusedLayer
    const envelope = { ...this.state.synth.layers[layer].ampEnvelope, ...partial }
    const label =
      'attack' in partial
        ? `Synth ${layer} Amp Attack ${envelope.attack}`
        : 'decay' in partial
          ? `Synth ${layer} Amp Decay ${envelope.decay}`
          : 'release' in partial
            ? `Synth ${layer} Amp Release ${envelope.release}`
            : `Synth ${layer} Amp Velocity ${envelope.velocity}`
    this.patchSynthLayers(layer, (l) => ({ ampEnvelope: { ...l.ampEnvelope, ...partial } }), label)
  }

  cycleSynthAmpVelocity(): void {
    const layer = this.state.synth.focusedLayer
    const next = ((this.state.synth.layers[layer].ampEnvelope.velocity + 1) % 4) as 0 | 1 | 2 | 3
    this.setSynthAmpEnvelope({ velocity: next })
  }

  /** AMP/FILTER/OSC ENVELOPE button: latches the synth OLED dials onto that
   *  envelope's A/D/R editing (manual p. 27: three dials share every menu).
   *  Engaging an envelope edit closes the Vibrato Menu and Osc Pitch edits
   *  (mutually exclusive dial-repurposing modes). */
  setSynthEnvEdit(edit: 'amp' | 'filter' | 'osc' | null): void {
    if (edit === this.state.synthEnvEdit) return
    const label =
      edit === 'amp'
        ? 'Synth Amp Envelope — dials: A · D · R'
        : edit === 'filter'
          ? 'Synth Filter Envelope — dials: A · D · R'
          : edit === 'osc'
            ? 'Synth Osc Envelope — dials: A · D · R'
            : 'Synth Envelope closed'
    this.patch(
      {
        synthEnvEdit: edit,
        synthVibratoEdit: edit ? false : this.state.synthVibratoEdit,
        synthOscPitchEdit: edit ? false : this.state.synthOscPitchEdit,
        synthArpMenuEdit: edit ? false : this.state.synthArpMenuEdit,
      },
      label,
    )
  }

  /* --------------------------------------------------------- synth filter -- */

  private patchSynthFilter(partial: Partial<SynthFilterState>, lastEdit: string): void {
    const layer = this.state.synth.focusedLayer
    this.patchSynthLayers(layer, (l) => ({ filter: { ...l.filter, ...partial } }), lastEdit)
  }

  toggleSynthFilterOn(): void {
    const layer = this.state.synth.focusedLayer
    const on = !this.state.synth.layers[layer].filter.on
    this.patchSynthFilter({ on }, `Synth ${layer} Filter ${on ? 'On' : 'Off'}`)
  }

  cycleSynthFilterType(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].filter.type
    const next = SYNTH_FILTER_TYPES[(SYNTH_FILTER_TYPES.indexOf(current) + 1) % SYNTH_FILTER_TYPES.length]!
    this.patchSynthFilter({ type: next }, `Synth ${layer} Filter: ${next}`)
  }

  /** Shift + FILTER TYPE (manual adaptation — the hardware's Group-mode
   *  legend has no dedicated Tracking button): cycles keyboard tracking
   *  Off -> 1/3 -> 2/3 -> 1 -> Off. */
  cycleSynthFilterTracking(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].filter.tracking
    const next = ((current + 1) % 4) as 0 | 1 | 2 | 3
    const labels = ['Off', '1/3', '2/3', '1']
    this.patchSynthFilter({ tracking: next }, `Synth ${layer} Filter Tracking: ${labels[next]}`)
  }

  /** Shift + FILTER ENVELOPE (manual adaptation, same pairing convention as
   *  Tracking above): cycles the pre-filter drive stage Off -> 1 -> 2 -> 3. */
  cycleSynthFilterDrive(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].filter.drive
    const next = ((current + 1) % 4) as 0 | 1 | 2 | 3
    const labels = ['Off', '1', '2', '3']
    this.patchSynthFilter({ drive: next }, `Synth ${layer} Filter Drive: ${labels[next]}`)
  }

  setSynthFilterParam(field: 'freq' | 'res' | 'envAmount', value: number): void {
    const clamped = clamp(value)
    const layer = this.state.synth.focusedLayer
    const label =
      field === 'freq'
        ? `Synth ${layer} Filter Freq ${Math.round(mappings.filterFreqHz(clamped))} Hz`
        : field === 'res'
          ? `Synth ${layer} Filter Res ${clamped}`
          : `Synth ${layer} Filter Env Amt ${clamped}`
    this.patchSynthFilter({ [field]: clamped } as Partial<SynthFilterState>, label)
  }

  setSynthFilterEnvelope(partial: Partial<SynthEnvelopeState>): void {
    const layer = this.state.synth.focusedLayer
    const envelope = { ...this.state.synth.layers[layer].filter.envelope, ...partial }
    const label =
      'attack' in partial
        ? `Synth ${layer} Filter Attack ${envelope.attack}`
        : 'decay' in partial
          ? `Synth ${layer} Filter Decay ${envelope.decay}`
          : 'release' in partial
            ? `Synth ${layer} Filter Release ${envelope.release}`
            : `Synth ${layer} Filter Velocity ${envelope.velocity ? 'On' : 'Off'}`
    // Two-level merge so a fanned Section Edit write syncs only the edited
    // envelope fields against each layer's own filter envelope.
    this.patchSynthLayers(layer, (l) => ({ filter: { ...l.filter, envelope: { ...l.filter.envelope, ...partial } } }), label)
  }

  toggleSynthFilterEnvVelocity(): void {
    const layer = this.state.synth.focusedLayer
    this.setSynthFilterEnvelope({ velocity: !this.state.synth.layers[layer].filter.envelope.velocity })
  }

  /* ------------------------------------------------------ synth osc envelope -- */

  setSynthOscEnvelope(partial: Partial<SynthOscEnvelopeState>): void {
    const layer = this.state.synth.focusedLayer
    const envelope = { ...this.state.synth.layers[layer].oscEnvelope, ...partial }
    const label =
      'attack' in partial
        ? `Synth ${layer} Osc Attack ${envelope.attack}`
        : 'decay' in partial
          ? `Synth ${layer} Osc Decay ${envelope.decay}`
          : 'release' in partial
            ? `Synth ${layer} Osc Release ${envelope.release}`
            : 'amount' in partial
              ? `Synth ${layer} Osc Env Amt ${envelope.amount}`
              : `Synth ${layer} Osc Velocity ${envelope.velocity ? 'On' : 'Off'}`
    this.patchSynthLayers(layer, (l) => ({ oscEnvelope: { ...l.oscEnvelope, ...partial } }), label)
  }

  toggleOscEnvToPitch(): void {
    const layer = this.state.synth.focusedLayer
    const toPitch = !this.state.synth.layers[layer].oscEnvelope.toPitch
    this.setSynthOscEnvelope({ toPitch })
  }

  /* --------------------------------------------------------------- synth lfo -- */

  private patchSynthLfo(partial: Partial<SynthLfoState>, lastEdit: string): void {
    const layer = this.state.synth.focusedLayer
    this.patchSynthLayers(layer, (l) => ({ lfo: { ...l.lfo, ...partial } }), lastEdit)
  }

  cycleSynthLfoWaveform(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].lfo.waveform
    const next = SYNTH_LFO_WAVEFORMS[(SYNTH_LFO_WAVEFORMS.indexOf(current) + 1) % SYNTH_LFO_WAVEFORMS.length]!
    this.patchSynthLfo({ waveform: next }, `Synth ${layer} LFO: ${next}`)
  }

  setSynthLfoRate(value: number): void {
    const clamped = clamp(value)
    const layer = this.state.synth.focusedLayer
    const label = this.state.synth.layers[layer].lfo.mstClk
      ? `Synth ${layer} LFO Rate ${mappings.clockRateDivision(clamped).label} (MST CLK)`
      : `Synth ${layer} LFO Rate ${mappings.lfoRateHz(clamped).toFixed(2)} Hz`
    this.patchSynthLfo({ rate: clamped }, label)
  }

  setSynthLfoAmount(value: number): void {
    const clamped = clamp(value)
    const layer = this.state.synth.focusedLayer
    this.patchSynthLfo({ amount: clamped }, `Synth ${layer} LFO Mod Amt ${clamped}`)
  }

  /** LFO destination LED cycle (manual p. 34): Off -> Osc Pitch -> Osc Ctrl
   *  -> Filter Freq -> Off; no lit LED means off but settings are kept. */
  cycleSynthLfoDestination(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].lfo.destination
    const index = current === null ? -1 : SYNTH_LFO_DESTINATIONS.indexOf(current)
    // +1 for the 0-based Off slot, +1 to advance; wrap past the last
    // destination back to Off (the clamp used to pin the cycle at the end).
    this.selectSynthLfoDestination((index + 2) % (SYNTH_LFO_DESTINATIONS.length + 1))
  }

  /** Selects the LFO destination by absolute list position: 0 = Off,
   *  1..SYNTH_LFO_DESTINATIONS.length = each destination in order. Driven
   *  by the LFO box's clickable printed destination rows (the panel has no
   *  dedicated per-destination button, manual p. 34's LEDs sit beside Mod
   *  Amt; clicking the lit row selects Off, spec lfo.offState). */
  selectSynthLfoDestination(index: number): void {
    const layer = this.state.synth.focusedLayer
    const clamped = Math.max(0, Math.min(SYNTH_LFO_DESTINATIONS.length, Math.round(index)))
    const next = clamped === 0 ? null : SYNTH_LFO_DESTINATIONS[clamped - 1]!
    this.patchSynthLfo({ destination: next }, `Synth ${layer} LFO Dest: ${next ?? 'Off'}`)
  }

  /** Shift + LFO WAVEFORM (manual adaptation — Shift + Rate is awkward on a
   *  knob): toggles master-clock rate substitution, same convention as
   *  Mod 1/Delay MST CLK. */
  toggleSynthLfoClockSync(): void {
    const layer = this.state.synth.focusedLayer
    const mstClk = !this.state.synth.layers[layer].lfo.mstClk
    this.patchSynthLfo({ mstClk }, `Synth ${layer} LFO MST CLK ${mstClk ? 'On' : 'Off'}`)
  }

  toggleSynthSustped(): void {
    const sustped = !this.state.synth.sustped
    this.patchSynth({ sustped }, `Synth SUSTPED ${sustped ? 'On' : 'Off'}`)
  }

  toggleSynthPstick(): void {
    const pstick = !this.state.synth.pstick
    this.patchSynth({ pstick }, `Synth PSTICK ${pstick ? 'On' : 'Off'}`)
  }

  /* ------------------------------------------------------------- synth voice -- */

  private patchSynthVoice(partial: Partial<SynthVoiceState>, lastEdit: string): void {
    const layer = this.state.synth.focusedLayer
    this.patchSynthLayers(layer, (l) => ({ voice: { ...l.voice, ...partial } }), lastEdit)
  }

  /** VOICE MODE (manual p. 35): cycles Poly -> Mono -> Legato -> Poly. */
  cycleSynthVoiceMode(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].voice.mode
    const next = SYNTH_VOICE_MODES[(SYNTH_VOICE_MODES.indexOf(current) + 1) % SYNTH_VOICE_MODES.length]!
    this.patchSynthVoice({ mode: next }, `Synth ${layer} Voice: ${next}`)
  }

  /** Shift + VOICE MODE (manual adaptation — Priority shares the Voice
   *  button's menu, no dedicated panel control here): cycles note priority
   *  Off -> Low -> High -> Off. */
  cycleSynthVoicePriority(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].voice.priority
    const next = SYNTH_VOICE_PRIORITIES[(SYNTH_VOICE_PRIORITIES.indexOf(current) + 1) % SYNTH_VOICE_PRIORITIES.length]!
    this.patchSynthVoice({ priority: next }, `Synth ${layer} Priority: ${next}`)
  }

  setSynthGlide(value: number): void {
    const clamped = clamp(value)
    const layer = this.state.synth.focusedLayer
    this.patchSynthVoice({ glide: clamped }, `Synth ${layer} Glide ${clamped}`)
  }

  /** SYNTH UNISON (manual p. 35): cycles Off -> 1 -> 2 -> 3 -> Off. */
  cycleSynthUnison(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].voice.unison
    const next = ((current + 1) % 4) as 0 | 1 | 2 | 3
    this.patchSynthVoice({ unison: next }, `Synth ${layer} Unison: ${next === 0 ? 'Off' : next}`)
  }

  /** VIBRATO MODE (manual p. 35): cycles Off -> On -> Wheel -> Off. */
  cycleSynthVibratoMode(): void {
    const layer = this.state.synth.focusedLayer
    const current = this.state.synth.layers[layer].voice.vibrato
    const next = SYNTH_VIBRATO_MODES[(SYNTH_VIBRATO_MODES.indexOf(current) + 1) % SYNTH_VIBRATO_MODES.length]!
    this.patchSynthVoice({ vibrato: next }, `Synth ${layer} Vibrato: ${next}`)
  }

  setSynthVibratoAmount(value: number): void {
    const clamped = clamp(value)
    const layer = this.state.synth.focusedLayer
    this.patchSynthVoice({ vibratoAmount: clamped }, `Synth ${layer} Vibrato Amount ${clamped}`)
  }

  setSynthVibratoRate(value: number): void {
    const clamped = clamp(value)
    const layer = this.state.synth.focusedLayer
    this.patchSynthVoice({ vibratoRate: clamped }, `Synth ${layer} Vibrato Rate ${mappings.vibratoRateHz(clamped).toFixed(1)} Hz`)
  }

  /** VIBRATO MENU button (spec voice.vibrato.menu): latches the Synth OLED
   *  dials 1/2 onto Rate/Amount editing, mirroring setSynthEnvEdit's
   *  dial-repurposing pattern. Mutually exclusive with synthEnvEdit. */
  setSynthVibratoEdit(edit: boolean): void {
    if (edit === this.state.synthVibratoEdit) return
    this.patch(
      {
        synthVibratoEdit: edit,
        synthEnvEdit: edit ? null : this.state.synthEnvEdit,
        synthOscPitchEdit: edit ? false : this.state.synthOscPitchEdit,
        synthArpMenuEdit: edit ? false : this.state.synthArpMenuEdit,
      },
      edit ? 'Synth Vibrato Menu — dials: Rate · Amount' : 'Synth Vibrato Menu closed',
    )
  }

  /* ---------------------------------------------------------- osc pitch -- */

  /** PITCH/SMP button (manual p. 28 "Pitch and Fine Tune"): latches the
   *  Synth OLED dials 1/2 onto Osc Pitch semitones / Fine Tune cents,
   *  mirroring setSynthEnvEdit's dial-repurposing pattern. Mutually
   *  exclusive with synthEnvEdit and synthVibratoEdit. */
  setSynthOscPitchEdit(edit: boolean): void {
    if (edit === this.state.synthOscPitchEdit) return
    this.patch(
      {
        synthOscPitchEdit: edit,
        synthEnvEdit: edit ? null : this.state.synthEnvEdit,
        synthVibratoEdit: edit ? false : this.state.synthVibratoEdit,
        synthArpMenuEdit: edit ? false : this.state.synthArpMenuEdit,
      },
      edit ? 'Synth Osc Pitch — dials: Pitch · Fine Tune' : 'Synth Osc Pitch closed',
    )
  }

  /** Osc Pitch semitones (manual p. 28: "Pitch can be set between -24 and
   *  +24 semitones"), per focused layer. */
  setSynthOscPitchSemis(semis: number): void {
    const layer = this.state.synth.focusedLayer
    const clamped = Math.max(-24, Math.min(24, Math.round(semis)))
    this.patchSynthLayers(layer, (l) => ({ oscPitch: { ...l.oscPitch, semis: clamped } }), `Synth ${layer} Osc Pitch ${fmtSemitones(clamped)} st`)
  }

  /** Osc Pitch fine tune (manual p. 28: "Fine Tune has a range of ± 50
   *  cents"), per focused layer. */
  setSynthOscPitchCents(cents: number): void {
    const layer = this.state.synth.focusedLayer
    const clamped = Math.max(-50, Math.min(50, Math.round(cents)))
    this.patchSynthLayers(layer, (l) => ({ oscPitch: { ...l.oscPitch, cents: clamped } }), `Synth ${layer} Fine Tune ${fmtSemitones(clamped)} c`)
  }

  /* --------------------------------------------------------- arpeggiator -- */

  private patchArp(partial: Partial<ArpState>, lastEdit: string): void {
    this.patchSynth({ arp: { ...this.state.synth.arp, ...partial } }, lastEdit)
  }

  toggleArpRun(): void {
    const run = !this.state.synth.arp.run
    this.patchArp({ run }, `Arp ${run ? 'Run' : 'Stop'}`)
  }

  /** ARP MODE (manual p. 36): cycles Arp -> Poly -> Gate -> Arp. */
  cycleArpMode(): void {
    const current = this.state.synth.arp.mode
    const next = ARP_MODES[(ARP_MODES.indexOf(current) + 1) % ARP_MODES.length]!
    this.patchArp({ mode: next }, `Arp Mode: ${next}`)
  }

  /** Shift + ARP MODE (manual adaptation — Direction shares the Mode
   *  button's menu, no dedicated panel control here): cycles Up -> Down ->
   *  Up/Down -> Random -> Up. */
  cycleArpDirection(): void {
    const current = this.state.synth.arp.direction
    const next = ARP_DIRECTIONS[(ARP_DIRECTIONS.indexOf(current) + 1) % ARP_DIRECTIONS.length]!
    this.patchArp({ direction: next }, `Arp Direction: ${next}`)
  }

  /** Arpeggiator MENU dial 2 (manual p. 35, page 1): Direction by absolute
   *  list position — the panel's "dial = absolute list position" convention. */
  selectArpDirection(index: number): void {
    const clamped = Math.max(0, Math.min(ARP_DIRECTIONS.length - 1, Math.round(index)))
    const direction = ARP_DIRECTIONS[clamped]!
    if (direction === this.state.synth.arp.direction) return
    this.patchArp({ direction }, `Arp Direction: ${direction}`)
  }

  /** Arpeggiator MENU dial 3 (manual p. 35, page 1): Zig Zag on/off. */
  setArpZigZag(zigZag: boolean): void {
    if (zigZag === this.state.synth.arp.zigZag) return
    this.patchArp({ zigZag }, `Arp Zig Zag ${zigZag ? 'On' : 'Off'}`)
  }

  /** Arpeggiator MENU button (manual p. 35): latches the Synth OLED dials
   *  onto page / Direction / Zig Zag, mirroring setSynthEnvEdit's
   *  dial-repurposing pattern. Only page 1 is implemented (the Pattern
   *  pages need preset-pattern semantics the panel cannot honor yet), so
   *  the menu truthfully reads 1/1. Mutually exclusive with synthEnvEdit,
   *  synthVibratoEdit and synthOscPitchEdit. */
  setSynthArpMenuEdit(edit: boolean): void {
    if (edit === this.state.synthArpMenuEdit) return
    this.patch(
      {
        synthArpMenuEdit: edit,
        synthEnvEdit: edit ? null : this.state.synthEnvEdit,
        synthVibratoEdit: edit ? false : this.state.synthVibratoEdit,
        synthOscPitchEdit: edit ? false : this.state.synthOscPitchEdit,
      },
      edit ? 'Arp Menu — dials: Page · Direction · Zig Zag' : 'Arp Menu closed',
    )
  }

  setArpRate(value: number): void {
    const clamped = clamp(value)
    const label = this.state.synth.arp.mstClk
      ? `Arp Rate ${mappings.clockRateDivision(clamped).label} (MST CLK)`
      : `Arp Rate ${Math.round(mappings.arpRateBpm(clamped))} BPM`
    this.patchArp({ rate: clamped }, label)
  }

  /** Shift + ARP RUN (manual adaptation — the brief's own note: Shift +
   *  ARP RATE is impossible on a knob, so clock sync moves to the Run
   *  button): toggles master-clock rate substitution. */
  toggleArpClockSync(): void {
    const mstClk = !this.state.synth.arp.mstClk
    this.patchArp({ mstClk }, `Arp MST CLK ${mstClk ? 'On' : 'Off'}`)
  }

  /** ARP RANGE knob (1..4 octaves in half steps — manual p. 35 allows
   *  values in between whole octaves, adding a fifth on top: 2.5 = "2
   *  octaves and a fifth"; or gate hardness in Gate mode — spec
   *  arpeggiatorGate.range). Gate mode's engine-side interpretation
   *  repurposes the same stored value as hardness. */
  setArpRange(value: number): void {
    const range = 1 + Math.round((clamp(value) / 127) * 6) * 0.5
    const whole = Math.floor(range)
    const octaves = `${whole} octave${whole > 1 ? 's' : ''}${range % 1 ? ' + a 5th' : ''}`
    const label = this.state.synth.arp.mode === 'Gate' ? `Arp Gate Hardness ${range}` : `Arp Range ${octaves}`
    this.patchArp({ range }, label)
  }

  /** KB HOLD (manual p. 36): held notes (and the arp's held-note set) keep
   *  sounding after key-up. The single panel button drives both the
   *  section-wide `kbHold` flag and the arp's own `hold` field (spec:
   *  arpeggiatorGate.hold) in lockstep — one control, one truth. */
  toggleKbHold(): void {
    const kbHold = !this.state.kbHold
    this.patch({ kbHold, synth: { ...this.state.synth, arp: { ...this.state.synth.arp, hold: kbHold } } }, `KB Hold ${kbHold ? 'On' : 'Off'}`)
  }

  /** EXCLUDE = Shift + KB Hold (manual p. 36: "If a Layer should not be
   *  included in the KB Hold functionality, press EXCLUDE"): toggles the
   *  focused synth layer's opt-out. */
  toggleKbHoldExclude(): void {
    const layer = this.state.synth.focusedLayer
    const kbHoldExclude = !this.state.synth.layers[layer].kbHoldExclude
    this.patchSynthLayer(layer, { kbHoldExclude }, `KB Hold Exclude ${layer} ${kbHoldExclude ? 'On' : 'Off'}`)
  }

  /* ------------------------------------------------------------ effects -- */

  /** The chain the panel currently edits: the shared Organ chain when FX
   *  focus is on the Organ section, the focused Synth layer's own chain when
   *  focus is on Synth, otherwise the focused Piano layer's chain (manual
   *  p. 18: "Both Organ Layers share the same effects chain"). */
  focusedChain(): EffectChainState {
    if (this.state.fxSection === 'organ') return this.state.organChain
    if (this.state.fxSection === 'synth') return this.state.synthChains[this.state.synth.focusedLayer]
    return this.state.chains[this.state.focusedLayer]
  }

  /** Chains an effect edit targets: focused layer, or both in Group/global
   *  mode — or while SECTION EDIT is latched (manual p. 43: "setting up just
   *  some of the effects the same for a whole Section"). */
  private targetLayers(_unit: keyof EffectChainState): LayerId[] {
    // Global units are fanned out in updateUnit before reaching here.
    if (this.state.fxGroupPiano || this.state.sectionEdit) return ['A', 'B']
    return [this.state.focusedLayer]
  }

  updateUnit<K extends keyof EffectChainState>(unit: K, partial: Partial<EffectChainState[K]>, label?: string): void {
    const globalUnit =
      (unit === 'delay' && this.state.fxGlobal.delay) ||
      (unit === 'comp' && this.state.fxGlobal.comp) ||
      (unit === 'reverb' && this.state.fxGlobal.reverb)
    if (globalUnit) {
      // GLOBAL mode (manual p. 48): the edit applies to all Layers of all
      // Sections, no matter which section holds FX focus.
      const applyTo = (chain: EffectChainState): EffectChainState => ({
        ...chain,
        [unit]: { ...chain[unit], ...partial },
      })
      this.patch(
        {
          chains: { A: applyTo(this.state.chains.A), B: applyTo(this.state.chains.B) },
          organChain: applyTo(this.state.organChain),
          synthChains: {
            A: applyTo(this.state.synthChains.A),
            B: applyTo(this.state.synthChains.B),
            C: applyTo(this.state.synthChains.C),
          },
        },
        label,
      )
      return
    }
    if (this.state.fxSection === 'organ') {
      // The single shared Organ chain is already section-wide (manual
      // p. 18), so SECTION EDIT changes nothing here.
      const organChain = {
        ...this.state.organChain,
        [unit]: { ...this.state.organChain[unit], ...partial },
      }
      this.patch({ organChain }, label)
      return
    }
    if (this.state.fxSection === 'synth') {
      // SECTION EDIT (manual p. 43) fans the unit edit to all three synth
      // layer chains, like Group mode.
      const targets = this.fxGroupSynth || this.state.sectionEdit ? SYNTH_LAYER_IDS : [this.state.synth.focusedLayer]
      const synthChains = { ...this.state.synthChains }
      for (const layer of targets) {
        synthChains[layer] = { ...synthChains[layer], [unit]: { ...synthChains[layer][unit], ...partial } }
      }
      this.patch({ synthChains }, label && this.state.sectionEdit && targets.length > 1 ? `${label} — all Synth chains` : label)
      return
    }
    const targets = this.targetLayers(unit)
    const chains = { ...this.state.chains }
    for (const layer of targets) {
      chains[layer] = { ...chains[layer], [unit]: { ...chains[layer][unit], ...partial } }
    }
    this.patch({ chains }, label && this.state.sectionEdit && targets.length > 1 ? `${label} — both Piano chains` : label)
  }

  private get fxGroupSynth(): boolean {
    return this.state.fxGroupSynth
  }

  toggleUnitOn(unit: keyof EffectChainState): void {
    const on = !this.focusedChain()[unit].on
    this.updateUnit(unit, { on } as never, `${unitLabel(unit)} ${on ? 'On' : 'Off'}`)
  }

  /** COMP FAST (manual p. 52: Shift + Amount knob on hardware — a knob
   *  can't take a shifted press here, so the FAST print is the clickable
   *  legend, the LAYER INIT ▽ convention): shorter compressor release. */
  toggleCompFast(): void {
    const fast = !this.focusedChain().comp.fast
    this.updateUnit('comp', { fast } as never, `Comp Fast ${fast ? 'On' : 'Off'}`)
  }

  cycleMod1Type(): void {
    const current = this.focusedChain().mod1.type
    const next = MOD1_TYPES[(MOD1_TYPES.indexOf(current) + 1) % MOD1_TYPES.length]!
    this.updateUnit('mod1', { type: next }, `Mod 1: ${next}`)
  }

  cycleMod2Type(): void {
    const current = this.focusedChain().mod2.type
    const next = MOD2_TYPES[(MOD2_TYPES.indexOf(current) + 1) % MOD2_TYPES.length]!
    this.updateUnit('mod2', { type: next }, `Mod 2: ${next}`)
  }

  cycleAmpType(): void {
    const current = this.focusedChain().ampEq.type
    const next = AMP_TYPES[(AMP_TYPES.indexOf(current) + 1) % AMP_TYPES.length]!
    this.updateUnit('ampEq', { type: next }, `Amp Sim/EQ: ${next}`)
  }

  cycleReverbType(): void {
    const current = this.focusedChain().reverb.type
    const next = REVERB_TYPES[(REVERB_TYPES.indexOf(current) + 1) % REVERB_TYPES.length]!
    this.updateUnit('reverb', { type: next }, `Reverb: ${next}`)
  }

  cycleDelayFilter(): void {
    const current = this.focusedChain().delay.filter
    const next = DELAY_FILTERS[(DELAY_FILTERS.indexOf(current) + 1) % DELAY_FILTERS.length]!
    this.updateUnit('delay', { filter: next }, `Delay Filter: ${next}`)
  }

  cycleDelayEffect(): void {
    const current = this.focusedChain().delay.effect
    const next = DELAY_EFFECTS[(DELAY_EFFECTS.indexOf(current) + 1) % DELAY_EFFECTS.length]!
    this.updateUnit('delay', { effect: next }, `Delay FX: ${next}`)
  }

  toggleDelayAnalog(): void {
    const analog = !this.focusedChain().delay.analog
    this.updateUnit('delay', { analog }, `Delay Analog ${analog ? 'On' : 'Off'}`)
  }

  /** PED = Shift + Mod 1 Selector (manual p. 49): in PED mode the Wah /
   *  A-Wah filter position follows the control pedal instead of the LFO /
   *  envelope follower. Kept per-chain like every Mod 1 setting. */
  toggleMod1Ped(): void {
    const ped = !this.focusedChain().mod1.ped
    const type = this.focusedChain().mod1.type
    const note = type === 'Wah' || type === 'A-Wah' ? '' : ' (drives Wah types)'
    this.updateUnit('mod1', { ped } as never, `Mod 1 PED ${ped ? 'On' : 'Off'}${note}`)
  }

  /** PING PONG = Shift + Delay Filter (manual p. 51): repeats alternate L/R. */
  toggleDelayPingPong(): void {
    const pingPong = !this.focusedChain().delay.pingPong
    this.updateUnit('delay', { pingPong }, `Delay Ping Pong ${pingPong ? 'On' : 'Off'}`)
  }

  toggleReverbBright(): void {
    const bright = !this.focusedChain().reverb.bright
    this.updateUnit('reverb', { bright }, `Reverb ${bright ? 'Bright' : 'Dark'}`)
  }

  setDelayTempoMs(ms: number): void {
    // Inverse of delayTempoMs mapping; used by tap tempo.
    const clampedMs = Math.max(20, Math.min(1400, ms))
    const value = mappings.msToDelayTempo(clampedMs)
    this.updateUnit('delay', { tempo: value }, `Delay Tempo ${Math.round(clampedMs)} ms`)
  }

  toggleFxGroupPiano(): void {
    const fxGroupPiano = !this.state.fxGroupPiano
    if (fxGroupPiano) {
      // Entering group mode applies the focused layer's chain to the group
      // (manual p.48) and moves FX focus back onto the Piano section.
      const focused = this.state.chains[this.state.focusedLayer]
      this.patch(
        {
          fxGroupPiano,
          fxSection: 'piano',
          chains: { A: structuredCloneChain(focused), B: structuredCloneChain(focused) },
        },
        'Piano FX Group On',
      )
    } else {
      this.patch({ fxGroupPiano }, 'Piano FX Group Off')
    }
  }

  /** FX FOCUS SYNTH's 4th step (mirrors Piano's Group step): applies the
   *  focused synth layer's chain to all three synth layer chains. */
  toggleFxGroupSynth(): void {
    const fxGroupSynth = !this.state.fxGroupSynth
    if (fxGroupSynth) {
      const focused = this.state.synthChains[this.state.synth.focusedLayer]
      this.patch(
        {
          fxGroupSynth,
          fxSection: 'synth',
          synthChains: { A: structuredCloneChain(focused), B: structuredCloneChain(focused), C: structuredCloneChain(focused) },
        },
        'Synth FX Group On',
      )
    } else {
      this.patch({ fxGroupSynth }, 'Synth FX Group Off')
    }
  }

  toggleFxGlobal(unit: 'delay' | 'comp' | 'reverb'): void {
    const value = !this.state.fxGlobal[unit]
    const fxGlobal = { ...this.state.fxGlobal, [unit]: value }
    if (value) {
      // Entering global mode mirrors the focused layer's unit settings
      // everywhere — piano A/B, the shared Organ chain AND all three synth
      // chains (manual p. 48: "all Layers of all Sections").
      const focused = this.state.chains[this.state.focusedLayer][unit]
      const chains = {
        A: { ...this.state.chains.A, [unit]: { ...focused } },
        B: { ...this.state.chains.B, [unit]: { ...focused } },
      }
      const organChain = { ...this.state.organChain, [unit]: { ...focused } }
      const synthChains = {
        A: { ...this.state.synthChains.A, [unit]: { ...focused } },
        B: { ...this.state.synthChains.B, [unit]: { ...focused } },
        C: { ...this.state.synthChains.C, [unit]: { ...focused } },
      }
      this.patch({ fxGlobal, chains, organChain, synthChains }, `${unitLabel(unit)} Global On`)
    } else {
      this.patch({ fxGlobal }, `${unitLabel(unit)} Global Off`)
    }
  }

  toggleAllFxOff(): void {
    const allFxOff = !this.state.allFxOff
    this.patch({ allFxOff }, allFxOff ? 'All FX Off' : 'All FX Restored')
  }

  /* ------------------------------------------------------------- rotary -- */

  toggleRotarySpeed(): void {
    const speed = this.state.rotary.speed === 'fast' ? 'slow' : 'fast'
    this.patch({ rotary: { ...this.state.rotary, speed } }, `Rotary ${speed === 'fast' ? 'Fast' : 'Slow'}`)
  }

  toggleRotaryStop(): void {
    const speed: RotarySpeed = this.state.rotary.speed === 'stop' ? 'slow' : 'stop'
    this.patch({ rotary: { ...this.state.rotary, speed } }, `Rotary ${speed === 'stop' ? 'Stop' : 'Slow'}`)
  }

  setRotaryDrive(value: number): void {
    const clamped = clamp(value)
    this.patch({ rotary: { ...this.state.rotary, drive: clamped } }, `Rotary Drive ${clamped}`)
  }

  setLastEdit(text: string): void {
    this.patch({}, text)
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

/** Deep-clones a Mon/Copy payload (manual p. 43): the clipboard must never
 *  share references with live state, in either direction. Every payload is
 *  plain JSON-serializable state, like the program snapshots. */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Backfills a persisted synth layer's filter/oscEnvelope/lfo sub-objects
 *  with the current defaults when a snapshot from before those fields
 *  existed is loaded — the existing top-level "missing `synth` key
 *  entirely" tolerance (plain object-spread) does not reach inside a
 *  *present* `synth.layers.X` that merely lacks these newer keys. */
function normalizeSynthLayer(layer: Partial<SynthLayerState> | null | undefined): SynthLayerState {
  const defaults = defaultSynthLayer(layer?.enabled ?? true)
  return {
    ...defaults,
    ...layer,
    filter: { ...defaults.filter, ...layer?.filter, envelope: { ...defaults.filter.envelope, ...layer?.filter?.envelope } },
    oscEnvelope: { ...defaults.oscEnvelope, ...layer?.oscEnvelope },
    lfo: { ...defaults.lfo, ...layer?.lfo },
    voice: { ...defaults.voice, ...layer?.voice },
    oscPitch: { ...defaults.oscPitch, ...layer?.oscPitch },
  }
}

function normalizeSynthState(synth: Partial<SynthState> | null | undefined): SynthState | undefined {
  if (!synth) return undefined
  const layers = synth.layers as Partial<Record<SynthLayerId, Partial<SynthLayerState>>> | undefined
  return {
    sectionOn: false,
    focusedLayer: 'A',
    sustped: true,
    pstick: true,
    ...synth,
    layers: {
      A: normalizeSynthLayer(layers?.A),
      B: normalizeSynthLayer(layers?.B),
      C: normalizeSynthLayer(layers?.C),
    },
    arp: { ...defaultArp(), ...synth.arp },
  }
}

/** Deep-clones a program snapshot and backfills any synth layer sub-object
 *  (filter/oscEnvelope/lfo/voice, section-level arp) missing from a
 *  pre-existing-field persisted payload, plus the per-layer synthChains
 *  record — every snapshot spread in the store routes through this so old
 *  programs never crash the engine on a missing nested key. */
function cloneSnapshot(snapshot: ProgramSnapshot): ProgramSnapshot {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as ProgramSnapshot
  // Organ layers persisted before the PRESET / Drawbar Live field existed
  // (manual p. 21) lack `presetOn`: backfill the hardware default (On).
  const backfillOrganLayer = (layer: OrganLayerState): OrganLayerState => ({
    ...layer,
    presetOn: (layer as Partial<OrganLayerState>).presetOn ?? true,
  })
  const normalizedOrgan = cloned.organ
    ? {
        ...cloned.organ,
        layers: {
          A: backfillOrganLayer(cloned.organ.layers.A),
          B: backfillOrganLayer(cloned.organ.layers.B),
        },
      }
    : cloned.organ
  const normalizedSynth = normalizeSynthState(cloned.synth)
  const synthChains = cloned.synthChains as Partial<Record<SynthLayerId, EffectChainState>> | undefined
  const normalizedSynthChains: Record<SynthLayerId, EffectChainState> = {
    A: synthChains?.A ?? defaultChain(),
    B: synthChains?.B ?? defaultChain(),
    C: synthChains?.C ?? defaultChain(),
  }
  return {
    ...cloned,
    ...(normalizedOrgan ? { organ: normalizedOrgan } : {}),
    ...(normalizedSynth ? { synth: normalizedSynth } : {}),
    synthChains: normalizedSynthChains,
    fxGroupSynth: cloned.fxGroupSynth ?? false,
    kbHold: cloned.kbHold ?? false,
  }
}

/** Builds one synth layer from a preset spec (src/model/presets.ts) over an
 *  init-layer base: waveform names resolve against SYNTH_WAVEFORMS, a
 *  declared sampleSet switches the layer to Samples mode (the index reuses
 *  the waveform field, the panel's existing Samples convention). */
function synthLayerFromPreset(spec: SynthLayerPresetSpec, base: SynthLayerState): SynthLayerState {
  const waveform =
    spec.sampleSet !== undefined
      ? Math.max(0, Math.min(SYNTH_SAMPLE_SETS.length - 1, Math.round(spec.sampleSet)))
      : spec.waveform !== undefined
        ? Math.max(0, SYNTH_WAVEFORMS.findIndex((w) => w.name === spec.waveform))
        : base.waveform
  return {
    ...base,
    mode: spec.sampleSet !== undefined ? 'Samples' : 'Analog',
    waveform,
    level: spec.level ?? base.level,
    oscCtrl: spec.oscCtrl ?? base.oscCtrl,
    oscPitch: { ...base.oscPitch, ...spec.oscPitch },
    ampEnvelope: { ...base.ampEnvelope, ...spec.ampEnvelope },
    filter: { ...base.filter, ...spec.filter, envelope: { ...base.filter.envelope, ...spec.filter?.envelope } },
    oscEnvelope: { ...base.oscEnvelope, ...spec.oscEnvelope },
    lfo: { ...base.lfo, ...spec.lfo },
    voice: { ...base.voice, ...spec.voice },
  }
}

/** Display name for a Preset Library section (manual p. 41 headers). */
export function presetSectionName(section: SectionKey): string {
  return section === 'organ' ? 'Organ' : section === 'piano' ? 'Piano' : 'Synth'
}

/** Builds one organ layer from a preset spec over the init B3 layer: model,
 *  registration (clamped 0..8 per drawbar), per-layer vibrato and balance. */
function organLayerFromPreset(spec: OrganLayerPresetSpec, enabled: boolean): OrganLayerState {
  const base = initOrganLayer(enabled)
  return {
    ...base,
    model: spec.model,
    drawbars: base.drawbars.map((value, i) => Math.max(0, Math.min(8, Math.round(spec.drawbars[i] ?? value)))),
    vibrato: spec.vibrato ?? false,
    level: spec.level !== undefined ? clamp(spec.level) : base.level,
  }
}

/** Builds one piano layer from a preset spec over the default layer: the
 *  bundled instrument (model index clamped to the type's list) and balance. */
function pianoLayerFromPreset(spec: PianoLayerPresetSpec, base: PianoLayerState): PianoLayerState {
  const models = instrumentsOfType(spec.type)
  return {
    ...base,
    type: spec.type,
    model: Math.max(0, Math.min(Math.max(0, models.length - 1), Math.round(spec.model ?? 0))),
    level: spec.level !== undefined ? clamp(spec.level) : base.level,
  }
}

/** A reset effect chain with a preset's unit overrides applied (presets are
 *  "complete sounds, including their effect configurations", manual p. 41). */
function chainFromPreset(spec: EffectChainPresetSpec | undefined): EffectChainState {
  const chain = defaultChain()
  if (!spec) return chain
  return {
    mod1: { ...chain.mod1, ...spec.mod1 },
    mod2: { ...chain.mod2, ...spec.mod2 },
    delay: { ...chain.delay, ...spec.delay },
    ampEq: { ...chain.ampEq, ...spec.ampEq },
    comp: { ...chain.comp, ...spec.comp },
    reverb: { ...chain.reverb, ...spec.reverb },
  }
}

function morphSourceLabel(source: MorphSource): string {
  return source === 'wheel' ? 'Wheel' : 'Ctrl Pedal'
}

/** Signed semitone display: leading '+' for >= 0 (e.g. '+2', '-3', '+0'). */
function fmtSemitones(semitones: number): string {
  return semitones >= 0 ? `+${semitones}` : `${semitones}`
}

const MORPH_EFFECT_FIELDS: Record<string, { unit: keyof EffectChainState; field: string }> = {
  'mod1-rate': { unit: 'mod1', field: 'rate' },
  'mod1-amount': { unit: 'mod1', field: 'amount' },
  'mod2-amount': { unit: 'mod2', field: 'amount' },
  'delay-tempo': { unit: 'delay', field: 'tempo' },
  'delay-feedback': { unit: 'delay', field: 'feedback' },
  'delay-mix': { unit: 'delay', field: 'mix' },
  'amp-freq': { unit: 'ampEq', field: 'freq' },
  'amp-drive': { unit: 'ampEq', field: 'drive' },
  'reverb-mix': { unit: 'reverb', field: 'mix' },
}

/** Pure interpolation write for one morph assignment at source position t (0..1). */
function applyMorphWrite(state: InstrumentState, assignment: MorphAssignment, t: number): InstrumentState {
  const spec = getControl(assignment.control)
  const min = spec.min ?? 0
  const max = spec.max ?? 127
  const value = Math.max(min, Math.min(max, Math.round(assignment.start + (assignment.end - assignment.start) * t)))
  const { control, layer } = assignment
  if (control.startsWith('organ-drawbar-') && (layer === 'A' || layer === 'B')) {
    const index = Number(control.slice('organ-drawbar-'.length)) - 1
    const organLayer = state.organ.layers[layer]
    // "Morphs are not applicable in Drawbar Live mode" (manual p. 39): a
    // Live layer sounds from the physical pose, so a drawbar morph write to
    // its stored registration would be inaudible AND untruthful — skip it.
    if (!organLayer.presetOn) return state
    if ((organLayer.drawbars[index] ?? 0) === value) return state
    const drawbars = [...organLayer.drawbars]
    drawbars[index] = value
    return {
      ...state,
      organ: { ...state.organ, layers: { ...state.organ.layers, [layer]: { ...organLayer, drawbars } } },
    }
  }
  switch (control) {
    case 'piano-level-a':
    case 'piano-level-b': {
      const id: LayerId = control.endsWith('a') ? 'A' : 'B'
      if (state.layers[id].level === value) return state
      return { ...state, layers: { ...state.layers, [id]: { ...state.layers[id], level: value } } }
    }
    case 'organ-level-a':
    case 'organ-level-b': {
      const id: LayerId = control.endsWith('a') ? 'A' : 'B'
      if (state.organ.layers[id].level === value) return state
      return {
        ...state,
        organ: { ...state.organ, layers: { ...state.organ.layers, [id]: { ...state.organ.layers[id], level: value } } },
      }
    }
    case 'rotary-speed': {
      // Morphable rotary speed (spec organ.rotary): below half slow, above fast.
      const speed: RotarySpeed = value >= 64 ? 'fast' : 'slow'
      if (state.rotary.speed === speed) return state
      return { ...state, rotary: { ...state.rotary, speed } }
    }
    case 'synth-level-a':
    case 'synth-level-b':
    case 'synth-level-c': {
      // The synth layer is encoded in the control id itself, not `layer`.
      const id: SynthLayerId = control.endsWith('a') ? 'A' : control.endsWith('b') ? 'B' : 'C'
      const synthLayer = state.synth.layers[id]
      if (synthLayer.level === value) return state
      return { ...state, synth: { ...state.synth, layers: { ...state.synth.layers, [id]: { ...synthLayer, level: value } } } }
    }
    case 'osc-ctrl':
    case 'filter-freq':
    case 'filter-res':
    case 'lfo-rate':
    case 'lfo-mod-amt': {
      const synthLayer = layer === 'SA' ? 'A' : layer === 'SB' ? 'B' : layer === 'SC' ? 'C' : null
      if (!synthLayer) return state
      const layerState = state.synth.layers[synthLayer]
      if (control === 'osc-ctrl') {
        if (layerState.oscCtrl === value) return state
        return { ...state, synth: { ...state.synth, layers: { ...state.synth.layers, [synthLayer]: { ...layerState, oscCtrl: value } } } }
      }
      if (control === 'filter-freq' || control === 'filter-res') {
        const field = control === 'filter-freq' ? 'freq' : 'res'
        if (layerState.filter[field] === value) return state
        return {
          ...state,
          synth: {
            ...state.synth,
            layers: { ...state.synth.layers, [synthLayer]: { ...layerState, filter: { ...layerState.filter, [field]: value } } },
          },
        }
      }
      // lfo-rate / lfo-mod-amt
      const field = control === 'lfo-rate' ? 'rate' : 'amount'
      if (layerState.lfo[field] === value) return state
      return {
        ...state,
        synth: {
          ...state.synth,
          layers: { ...state.synth.layers, [synthLayer]: { ...layerState, lfo: { ...layerState.lfo, [field]: value } } },
        },
      }
    }
    case 'arp-rate': {
      if (state.synth.arp.rate === value) return state
      return { ...state, synth: { ...state.synth, arp: { ...state.synth.arp, rate: value } } }
    }
    default: {
      const target = MORPH_EFFECT_FIELDS[control]
      if (!target) return state
      const synthLayer = layer === 'SA' ? 'A' : layer === 'SB' ? 'B' : layer === 'SC' ? 'C' : null
      const chain = layer === 'organ' ? state.organChain : synthLayer ? state.synthChains[synthLayer] : state.chains[layer as LayerId]
      const unit = chain[target.unit] as unknown as Record<string, number>
      if (unit[target.field] === value) return state
      const nextChain = { ...chain, [target.unit]: { ...chain[target.unit], [target.field]: value } }
      if (layer === 'organ') return { ...state, organChain: nextChain }
      if (synthLayer) return { ...state, synthChains: { ...state.synthChains, [synthLayer]: nextChain } }
      return { ...state, chains: { ...state.chains, [layer]: nextChain } }
    }
  }
}

function structuredCloneChain(chain: EffectChainState): EffectChainState {
  return {
    mod1: { ...chain.mod1 },
    mod2: { ...chain.mod2 },
    delay: { ...chain.delay },
    ampEq: { ...chain.ampEq },
    comp: { ...chain.comp },
    reverb: { ...chain.reverb },
  }
}

function unitLabel(unit: keyof EffectChainState): string {
  return { mod1: 'Mod 1', mod2: 'Mod 2', delay: 'Delay', ampEq: 'Amp Sim/EQ', comp: 'Comp', reverb: 'Reverb' }[unit]
}

export function useInstrumentState(store: InstrumentStore): InstrumentState {
  return useSyncExternalStore(store.subscribe, store.getState)
}

/** Master-clock subdivisions (manual p. 17/35/49/51): while MST CLK is lit
 *  a unit's own Rate/Tempo knob selects a musical division of the master
 *  quarter-note beat instead of a free rate. `beats` is the division's
 *  length in quarter-note beats (1/4 = 1, 1/8T = 1/3, …). Ordered short to
 *  long so each caller can match its knob's unsynced direction. */
export const CLOCK_SUBDIVISIONS: ReadonlyArray<{ label: string; beats: number }> = [
  { label: '1/32', beats: 1 / 8 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/16', beats: 1 / 4 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/8', beats: 1 / 2 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/4', beats: 1 },
  { label: '1/2T', beats: 4 / 3 },
  { label: '1/2', beats: 2 },
  { label: '1/1', beats: 4 },
]

/** Mapped physical values used by both the engine and the display readouts. */
export const mappings = {
  /** 0..127 -> gain (squared taper). */
  levelToGain(value: number): number {
    const x = value / 127
    return x * x
  },
  delayTempoMs(value: number): number {
    return 20 + (value / 127) * (1400 - 20)
  },
  /** Inverse of delayTempoMs: milliseconds -> 0..127 panel value. */
  msToDelayTempo(ms: number): number {
    const clamped = Math.max(20, Math.min(1400, ms))
    return Math.max(0, Math.min(127, Math.round(((clamped - 20) / (1400 - 20)) * 127)))
  },
  lfoRateHz(value: number): number {
    return 0.1 + Math.pow(value / 127, 2) * 9.9
  },
  /** Inverse of lfoRateHz: Hz -> 0..127 panel value. */
  hzToLfoRate(hz: number): number {
    const clamped = Math.max(0.1, Math.min(10, hz))
    return Math.max(0, Math.min(127, Math.round(127 * Math.sqrt((clamped - 0.1) / 9.9))))
  },
  eqGainDb(value: number): number {
    return ((value - 64) / 63.5) * 15
  },
  midFreqHz(value: number): number {
    return 200 * Math.pow(8000 / 200, value / 127)
  },
  filterFreqHz(value: number): number {
    return 40 * Math.pow(16000 / 40, value / 127)
  },
  /** 0..127 -> 30..300 quarter-note BPM (spec arpeggiatorGate.rate). */
  arpRateBpm(value: number): number {
    return 30 + (value / 127) * 270
  },
  /** Inverse of arpRateBpm: BPM -> 0..127 panel value. */
  bpmToArpRate(bpm: number): number {
    const clamped = Math.max(30, Math.min(300, bpm))
    return Math.max(0, Math.min(127, Math.round(((clamped - 30) / 270) * 127)))
  },
  /** MST CLK subdivision for knobs whose unsynced direction is "up = longer"
   *  (Delay Tempo): knob up selects a longer division. */
  clockDelayDivision(value: number): { label: string; beats: number } {
    const index = Math.min(CLOCK_SUBDIVISIONS.length - 1, Math.floor((value / 128) * CLOCK_SUBDIVISIONS.length))
    return CLOCK_SUBDIVISIONS[index]!
  },
  /** MST CLK subdivision for knobs whose unsynced direction is "up = faster"
   *  (Mod 1 Rate, synth LFO Rate, Arp Rate): knob up selects a shorter one. */
  clockRateDivision(value: number): { label: string; beats: number } {
    const index = Math.min(CLOCK_SUBDIVISIONS.length - 1, Math.floor((value / 128) * CLOCK_SUBDIVISIONS.length))
    return CLOCK_SUBDIVISIONS[CLOCK_SUBDIVISIONS.length - 1 - index]!
  },
  /** 0..127 -> a portamento time constant in seconds (constant-rate glide). */
  glideTimeConstant(value: number): number {
    return 0.001 + Math.pow(value / 127, 2) * 0.6
  },
  /** 0..127 -> 2.0..8.0 Hz, linear (spec voice.vibrato.menu: "Rate 2.0-8.0 Hz"). */
  vibratoRateHz(value: number): number {
    return 2 + (value / 127) * 6
  },
  /** Inverse of vibratoRateHz: Hz -> 0..127 panel value. */
  hzToVibratoRate(hz: number): number {
    const clamped = Math.max(2, Math.min(8, hz))
    return Math.max(0, Math.min(127, Math.round(((clamped - 2) / 6) * 127)))
  },
  /** 0..127 -> displayed 0..10 with one decimal (spec voice.vibrato.menu: "Amount 0-10"). */
  vibratoAmountDisplay(value: number): number {
    return (value / 127) * 10
  },
}

export { INSTRUMENTS }
