import { useSyncExternalStore } from 'react'
import { INSTRUMENTS, instrumentsOfType, PIANO_TYPES, type PianoType } from '../audio/library'
import { DRAWBAR_INITIAL, getControl } from '../model/hardware'
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

export interface Mod1State { on: boolean; type: Mod1Type; rate: number; amount: number; mstClk: boolean }
export interface Mod2State { on: boolean; type: Mod2Type; rate: number; amount: number }
export interface DelayState {
  on: boolean
  tempo: number // 0..127 -> 20..1400 ms
  feedback: number // 0..127
  mix: number // 0..127 dry..wet
  filter: DelayFilter
  effect: DelayEffect
  analog: boolean
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
  /** Nine virtual drawbars, 0 (in) .. 8 (fully out). Always live (spec:
   *  Preset/Drawbar-Live modes are excluded — virtual drawbars show live values). */
  drawbars: number[]
  /** Per-layer vibrato/chorus on/off (manual p. 19). */
  vibrato: boolean
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

/** One waveform category (spec oscillator.requiredWaveforms); Osc Ctrl's
 *  meaning depends on which category the selected waveform belongs to. */
export type SynthWaveformCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'

export interface SynthWaveform {
  category: SynthWaveformCategory
  name: string
}

/** The exact Analog-mode waveform list (spec oscillator.requiredWaveforms),
 *  in panel order: Pure, Sync, Multi, Super, FM-H. */
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
]

/** Index of Saw within SYNTH_WAVEFORMS — the default waveform for layer A. */
const SYNTH_SAW_INDEX = SYNTH_WAVEFORMS.findIndex((w) => w.name === 'Saw')

export const SYNTH_WAVEFORM_CATEGORIES: readonly SynthWaveformCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']

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

export const SYNTH_FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
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

export type SynthVibratoMode = 'Off' | 'On' | 'Wheel'
export const SYNTH_VIBRATO_MODES: readonly SynthVibratoMode[] = ['Off', 'On', 'Wheel']

/** Voice behavior (spec voice): mode/priority/glide/unison/vibrato — governs
 *  how the layer's notes are triggered and held, not what they sound like. */
export interface SynthVoiceState {
  mode: SynthVoiceMode
  priority: SynthVoicePriority
  glide: number // 0..127 -> mappings.glideTimeConstant; active in Mono/Legato when played legato
  unison: 0 | 1 | 2 | 3
  vibrato: SynthVibratoMode
  /** Menu rate is fixed at 5.5 Hz (spec vibrato.menu); amount is the only
   *  panel-editable vibrato parameter here. */
  vibratoAmount: number // 0..127
}

function defaultSynthVoice(): SynthVoiceState {
  return { mode: 'Poly', priority: 'Off', glide: 0, unison: 0, vibrato: 'Off', vibratoAmount: 40 }
}

export interface SynthLayerState {
  enabled: boolean
  level: number // 0..127
  octave: -1 | 0 | 1
  zone: ZoneRange
  /** Index into SYNTH_WAVEFORMS. */
  waveform: number
  oscCtrl: number // 0..127, displayed 0..10 with one decimal
  ampEnvelope: SynthAmpEnvelopeState
  filter: SynthFilterState
  oscEnvelope: SynthOscEnvelopeState
  lfo: SynthLfoState
  voice: SynthVoiceState
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
  range: 1 | 2 | 3 | 4
  direction: ArpDirection
  hold: boolean
}

function defaultArp(): ArpState {
  return { run: false, mode: 'Arp', rate: 64, mstClk: false, range: 1, direction: 'Up', hold: false }
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
  storePending: { origin: number; originDirty: boolean; destination: number; captured: ProgramSlot } | null
  /** STORE AS naming step before destination selection (manual p. 41). */
  naming: { name: string; cursor: number } | null
  /** Single-level undo: the edited state discarded by the last program change. */
  undo: { slot: number; liveMode: boolean; snapshot: ProgramSnapshot } | null
  /** Numeric list view (Shift + Program dial, manual p. 41). */
  listView: boolean
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
  /** Transpose dial-edit panel mode (dial = semitones). Not program state. */
  transposeEdit: boolean
  /** Morph source being assigned (source button latched). Not program state. */
  morphArming: MorphSource | null
  /** AMP/FILTER/OSC ENVELOPE button latched: the three Synth OLED dials edit
   *  the focused layer's selected envelope's attack/decay/release instead of
   *  their normal waveform-list/menu roles. Not program state (panel mode only). */
  synthEnvEdit: 'amp' | 'filter' | 'osc' | null
  /** Live morph source positions (mod wheel, control pedal 0..127). Not program state. */
  morphValues: Record<MorphSource, number>
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
  }
}

function defaultChain(): EffectChainState {
  // Continuous defaults match the panel's initial knob pose (64 = 12 o'clock).
  return {
    mod1: { on: false, type: 'Tremolo', rate: 64, amount: 64, mstClk: false },
    mod2: { on: false, type: 'Chorus', rate: 64, amount: 64 },
    delay: { on: false, tempo: 64, feedback: 64, mix: 64, filter: 'Off', effect: 'Off', analog: false, mstClk: false },
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
      A: { enabled: true, level: 100, octave: 0, type: 'Grand', model: 0, zone: { from: 0, to: 3 } },
      B: { enabled: false, level: 100, octave: 0, type: 'Electric', model: 0, zone: { from: 0, to: 3 } },
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
    transposeEdit: false,
    morphArming: null,
    synthEnvEdit: null,
    morphValues: { wheel: 0, pedal: 0 },
    organ: {
      // The section starts off (Piano is the power-on sound); its layer A is
      // pre-enabled so the ON button makes it immediately audible.
      sectionOn: false,
      focusedLayer: 'A',
      layers: {
        // Layer A's registration matches the reference photo's drawbar pose.
        A: { enabled: true, level: 100, octave: 0, zone: { from: 0, to: 3 }, model: 'B3', drawbars: [...DRAWBAR_INITIAL], vibrato: false },
        B: { enabled: false, level: 100, octave: 0, zone: { from: 0, to: 3 }, model: 'B3', drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], vibrato: false },
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
    },
    lastEdit: '',
    pianoNotFound: null,
  }
}

/** Display label for a slot: page.button (1.1 … 4.8) or L1 … L8. */
export function programLabel(index: number, liveMode: boolean): string {
  return liveMode ? `L${index + 1}` : `${Math.floor(index / 8) + 1}.${(index % 8) + 1}`
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
      this.persistPrograms(result)
      return result
    }
    return programs.dirty ? next : { ...next, programs: { ...programs, dirty: true } }
  }

  /* ------------------------------------------------------ program storage -- */

  private persistPrograms(state: InstrumentState): void {
    if (!this.storage) return
    const { bank, live, liveMode, current } = state.programs
    this.storage.save(PROGRAMS_STORAGE_KEY, JSON.stringify({ version: 1, bank, live, liveMode, current }))
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
      return {
        ...base,
        ...cloneSnapshot(slot.snapshot),
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

  setLayerLevel(layer: LayerId, level: number): void {
    const clamped = clamp(level)
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], level: clamped } }
    this.patch({ layers }, `Piano ${layer} Level ${clamped}`)
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
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], octave: next } }
    this.patch({ layers }, `Piano ${layer} Octave ${next > 0 ? `+${next}` : next}`)
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
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], type, model: 0 } }
    this.patch(
      { layers, pianoNotFound: populated ? null : type },
      populated ? `Piano ${layer}: ${instrumentsOfType(type)[0]!.name}` : `Piano not found (${type})`,
    )
  }

  selectPianoModel(model: number): void {
    const layer = this.state.focusedLayer
    const models = instrumentsOfType(this.state.layers[layer].type)
    if (models.length === 0) return
    const clamped = Math.max(0, Math.min(models.length - 1, Math.round(model)))
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], model: clamped } }
    this.patch({ layers, pianoNotFound: null }, `Piano ${layer}: ${models[clamped]!.name}`)
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
    const clamped = Math.max(30, Math.min(300, Math.round(bpm)))
    this.patch({ masterClock: { bpm: clamped } }, `Mst Clk ${clamped} BPM`)
  }

  setClockEdit(on: boolean): void {
    if (on === this.state.clockEdit) return
    this.patch(
      { clockEdit: on, ...(on ? { transposeEdit: false, splitEdit: null } : {}) },
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
      { transposeEdit: on, ...(on ? { clockEdit: false, splitEdit: null } : {}) },
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
      { splitEdit: on ? { point: 1 } : null, ...(on ? { clockEdit: false, transposeEdit: false } : {}) },
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
      const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer as LayerId], zone: next } }
      this.patch({ layers }, label)
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
    const sources: MorphSource[] = []
    for (const source of ['wheel', 'pedal'] as const) {
      if (this.state.morph[source].some((a) => a.control === control)) sources.push(source)
    }
    return sources
  }

  /** The layer context a morph edit to `control` would capture right now —
   *  the same resolution `setValue`'s capture path uses, so a range read
   *  back later matches whichever layer/chain is currently focused. */
  private morphLayerFor(control: string): MorphAssignment['layer'] {
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
      programs: { ...programs, current: clamped, dirty: false, undo, naming: null },
      lastEdit: `${programLabel(clamped, programs.liveMode)} ${slot.name}`,
    })
    this.persistPrograms(this.state)
  }

  /** One of the eight Program buttons, within the current page (or Live slot). */
  selectProgramButton(button: number): void {
    const programs = this.state.programs
    if (programs.liveMode) {
      this.selectProgram(button)
      return
    }
    const reference = programs.storePending ? programs.storePending.destination : programs.current
    this.selectProgram(Math.floor(reference / 8) * 8 + button)
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

  /** Program dial (0..127 panel value): browses slots; sets characters while naming. */
  dialProgram(value: number): void {
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
      programs: { ...programs, storePending: null, current: pending.origin, dirty: pending.originDirty },
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
      programs: {
        ...programs,
        liveMode,
        current: target,
        dirty: false,
        undo,
        lastBank: liveMode ? programs.current : programs.lastBank,
        lastLive: liveMode ? programs.lastLive : programs.current,
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

  /* -------------------------------------------------------------- organ -- */

  private patchOrgan(partial: Partial<OrganState>, lastEdit: string): void {
    this.patch({ organ: { ...this.state.organ, ...partial } }, lastEdit)
  }

  private patchOrganLayer(layer: LayerId, partial: Partial<OrganLayerState>, lastEdit: string): void {
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], ...partial } }
    this.patchOrgan({ layers }, lastEdit)
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
    const drawbars = [...this.state.organ.layers[layer].drawbars]
    drawbars[index] = clamped
    this.patchOrganLayer(layer, { drawbars }, `Drawbar ${index + 1}: ${clamped}`)
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

  private patchSynthLayer(layer: SynthLayerId, partial: Partial<SynthLayerState>, lastEdit: string): void {
    const layers = { ...this.state.synth.layers, [layer]: { ...this.state.synth.layers[layer], ...partial } }
    this.patchSynth({ layers }, lastEdit)
  }

  setSynthSectionOn(on: boolean): void {
    this.patchSynth({ sectionOn: on }, `Synth Section ${on ? 'On' : 'Off'}`)
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
    this.patchSynthLayer(layer, { ampEnvelope: envelope }, label)
  }

  cycleSynthAmpVelocity(): void {
    const layer = this.state.synth.focusedLayer
    const next = ((this.state.synth.layers[layer].ampEnvelope.velocity + 1) % 4) as 0 | 1 | 2 | 3
    this.setSynthAmpEnvelope({ velocity: next })
  }

  /** AMP/FILTER/OSC ENVELOPE button: latches the synth OLED dials onto that
   *  envelope's A/D/R editing (manual p. 27: three dials share every menu). */
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
    this.patch({ synthEnvEdit: edit }, label)
  }

  /* --------------------------------------------------------- synth filter -- */

  private patchSynthFilter(partial: Partial<SynthFilterState>, lastEdit: string): void {
    const layer = this.state.synth.focusedLayer
    const filter = { ...this.state.synth.layers[layer].filter, ...partial }
    this.patchSynthLayer(layer, { filter }, lastEdit)
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
    this.patchSynthFilter({ envelope }, label)
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
    this.patchSynthLayer(layer, { oscEnvelope: envelope }, label)
  }

  toggleOscEnvToPitch(): void {
    const layer = this.state.synth.focusedLayer
    const toPitch = !this.state.synth.layers[layer].oscEnvelope.toPitch
    this.setSynthOscEnvelope({ toPitch })
  }

  /* --------------------------------------------------------------- synth lfo -- */

  private patchSynthLfo(partial: Partial<SynthLfoState>, lastEdit: string): void {
    const layer = this.state.synth.focusedLayer
    const lfo = { ...this.state.synth.layers[layer].lfo, ...partial }
    this.patchSynthLayer(layer, { lfo }, lastEdit)
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
    this.patchSynthLfo({ rate: clamped }, `Synth ${layer} LFO Rate ${mappings.lfoRateHz(clamped).toFixed(2)} Hz`)
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
    this.selectSynthLfoDestination(index + 2) // +1 for the 0-based Off slot, +1 to advance
  }

  /** Selects the LFO destination by absolute list position: 0 = Off,
   *  1..SYNTH_LFO_DESTINATIONS.length = each destination in order (the
   *  panel's synth-dial-3 "dial = absolute position" convention, mirroring
   *  synth-dial-2's waveform-list mapping — the panel has no dedicated
   *  per-destination button, manual p. 34's LEDs sit beside Mod Amt). */
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
    const voice = { ...this.state.synth.layers[layer].voice, ...partial }
    this.patchSynthLayer(layer, { voice }, lastEdit)
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

  setArpRate(value: number): void {
    const clamped = clamp(value)
    this.patchArp({ rate: clamped }, `Arp Rate ${Math.round(mappings.arpRateBpm(clamped))} BPM`)
  }

  /** Shift + ARP RUN (manual adaptation — the brief's own note: Shift +
   *  ARP RATE is impossible on a knob, so clock sync moves to the Run
   *  button): toggles master-clock rate substitution. */
  toggleArpClockSync(): void {
    const mstClk = !this.state.synth.arp.mstClk
    this.patchArp({ mstClk }, `Arp MST CLK ${mstClk ? 'On' : 'Off'}`)
  }

  /** ARP RANGE knob (1..4 octaves, or gate hardness in Gate mode — spec
   *  arpeggiatorGate.range). Always stored as 1..4; Gate mode's engine-side
   *  interpretation repurposes the same stored value as hardness. */
  setArpRange(value: number): void {
    const clamped = Math.max(1, Math.min(4, Math.round(1 + (clamp(value) / 127) * 3))) as 1 | 2 | 3 | 4
    const label =
      this.state.synth.arp.mode === 'Gate' ? `Arp Gate Hardness ${clamped}` : `Arp Range ${clamped} octave${clamped > 1 ? 's' : ''}`
    this.patchArp({ range: clamped }, label)
  }

  /** KB HOLD (manual p. 36): held notes (and the arp's held-note set) keep
   *  sounding after key-up. The single panel button drives both the
   *  section-wide `kbHold` flag and the arp's own `hold` field (spec:
   *  arpeggiatorGate.hold) in lockstep — one control, one truth. */
  toggleKbHold(): void {
    const kbHold = !this.state.kbHold
    this.patch({ kbHold, synth: { ...this.state.synth, arp: { ...this.state.synth.arp, hold: kbHold } } }, `KB Hold ${kbHold ? 'On' : 'Off'}`)
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

  /** Chains an effect edit targets: focused layer, or both in Group/global mode. */
  private targetLayers(unit: keyof EffectChainState): LayerId[] {
    const global = (unit === 'delay' && this.state.fxGlobal.delay) || (unit === 'comp' && this.state.fxGlobal.comp) || (unit === 'reverb' && this.state.fxGlobal.reverb)
    if (global || this.state.fxGroupPiano) return ['A', 'B']
    return [this.state.focusedLayer]
  }

  updateUnit<K extends keyof EffectChainState>(unit: K, partial: Partial<EffectChainState[K]>, label?: string): void {
    if (this.state.fxSection === 'organ') {
      const organChain = {
        ...this.state.organChain,
        [unit]: { ...this.state.organChain[unit], ...partial },
      }
      this.patch({ organChain }, label)
      return
    }
    if (this.state.fxSection === 'synth') {
      const synthChains = { ...this.state.synthChains }
      for (const layer of this.fxGroupSynth ? SYNTH_LAYER_IDS : [this.state.synth.focusedLayer]) {
        synthChains[layer] = { ...synthChains[layer], [unit]: { ...synthChains[layer][unit], ...partial } }
      }
      this.patch({ synthChains }, label)
      return
    }
    const chains = { ...this.state.chains }
    for (const layer of this.targetLayers(unit)) {
      chains[layer] = { ...chains[layer], [unit]: { ...chains[layer][unit], ...partial } }
    }
    this.patch({ chains }, label)
  }

  private get fxGroupSynth(): boolean {
    return this.state.fxGroupSynth
  }

  toggleUnitOn(unit: keyof EffectChainState): void {
    const on = !this.focusedChain()[unit].on
    this.updateUnit(unit, { on } as never, `${unitLabel(unit)} ${on ? 'On' : 'Off'}`)
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
      // everywhere — including onto the shared Organ chain (manual p. 18/48).
      const focused = this.state.chains[this.state.focusedLayer][unit]
      const chains = {
        A: { ...this.state.chains.A, [unit]: { ...focused } },
        B: { ...this.state.chains.B, [unit]: { ...focused } },
      }
      const organChain = { ...this.state.organChain, [unit]: { ...focused } }
      this.patch({ fxGlobal, chains, organChain }, `${unitLabel(unit)} Global On`)
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
  const normalizedSynth = normalizeSynthState(cloned.synth)
  const synthChains = cloned.synthChains as Partial<Record<SynthLayerId, EffectChainState>> | undefined
  const normalizedSynthChains: Record<SynthLayerId, EffectChainState> = {
    A: synthChains?.A ?? defaultChain(),
    B: synthChains?.B ?? defaultChain(),
    C: synthChains?.C ?? defaultChain(),
  }
  return {
    ...cloned,
    ...(normalizedSynth ? { synth: normalizedSynth } : {}),
    synthChains: normalizedSynthChains,
    fxGroupSynth: cloned.fxGroupSynth ?? false,
    kbHold: cloned.kbHold ?? false,
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
  /** 0..127 -> a portamento time constant in seconds (constant-rate glide). */
  glideTimeConstant(value: number): number {
    return 0.001 + Math.pow(value / 127, 2) * 0.6
  },
}

export { INSTRUMENTS }
