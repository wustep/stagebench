/**
 * Canonical Synth state (three layers A, B, C) and the pure control → parameter mappings the audio engine and the
 * panel share. Nothing here touches Web Audio.
 */
import type { Level3 } from './state'

export type SynthLayerId = 'A' | 'B' | 'C'
export const SYNTH_LAYER_IDS: readonly SynthLayerId[] = ['A', 'B', 'C']

export type WaveCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export interface WaveformInfo {
  id: string
  name: string
  category: WaveCategory
}

/** the exact required waveform list (synth spec `oscillator.requiredWaveforms`), in panel order */
export const SYNTH_WAVEFORMS: readonly WaveformInfo[] = [
  { id: 'sine', name: 'Sine', category: 'Pure' },
  { id: 'triangle', name: 'Triangle', category: 'Pure' },
  { id: 'saw', name: 'Saw', category: 'Pure' },
  { id: 'square', name: 'Square', category: 'Pure' },
  { id: 'pulse33', name: 'Pulse 33', category: 'Pure' },
  { id: 'pulse10', name: 'Pulse 10', category: 'Pure' },
  { id: 'noise', name: 'White Noise', category: 'Pure' },
  { id: 'sync-saw', name: 'Sync Saw', category: 'Sync' },
  { id: 'sync-square', name: 'Sync Square', category: 'Sync' },
  { id: 'multi-saw', name: 'Multi Saw', category: 'Multi' },
  { id: 'multi-saw-8ve', name: 'Multi Saw 8ve', category: 'Multi' },
  { id: 'super-saw', name: 'Super Saw', category: 'Super' },
  { id: 'super-square', name: 'Super Square', category: 'Super' },
  { id: 'fm-2op', name: 'FM 2-op (algorithm A)', category: 'FM-H' },
]
export const SYNTH_WAVE_CATEGORIES: readonly WaveCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']

export const FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
export type FilterType = (typeof FILTER_TYPES)[number]
export const FILTER_TRACKING = ['Off', '1/3', '2/3', '1'] as const
/** fraction of the played pitch (in octaves) that the cutoff follows */
export const TRACKING_AMOUNT: readonly number[] = [0, 1 / 3, 2 / 3, 1]

export const LFO_WAVEFORMS = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const
export type LfoDest = 'off' | 'pitch' | 'filter' | 'ctrl'
export const LFO_DESTS: readonly LfoDest[] = ['pitch', 'filter', 'ctrl', 'off'] // order of the panel button states

export type VoiceMode = 'poly' | 'mono' | 'legato'
export const VOICE_MODES: readonly VoiceMode[] = ['poly', 'mono', 'legato']
export type NotePriority = 'off' | 'low' | 'high'
export type VibratoMode = 'off' | 'wheel' | 'delay' | 'on'
export const VIBRATO_MODES: readonly VibratoMode[] = ['off', 'wheel', 'delay', 'on']

export type ArpMode = 'gate' | 'arp' | 'poly'
export const ARP_MODES: readonly ArpMode[] = ['gate', 'arp', 'poly'] // panel button states
export type ArpDirection = 'up' | 'down' | 'updown' | 'random'
export const ARP_DIRECTIONS: readonly ArpDirection[] = ['up', 'down', 'updown', 'random']

/** master-clock subdivisions (fractions of a quarter-note beat): 1/2 … 1/16 with triplet variants */
export const DIVISIONS = [
  { name: '1/2', beats: 2 },
  { name: '1/2T', beats: 4 / 3 },
  { name: '1/4', beats: 1 },
  { name: '1/4T', beats: 2 / 3 },
  { name: '1/8', beats: 0.5 },
  { name: '1/8T', beats: 1 / 3 },
  { name: '1/16', beats: 0.25 },
  { name: '1/16T', beats: 1 / 6 },
] as const
export const DIVISION_COUNT = DIVISIONS.length
export const divisionFromKnob = (v: number): number => Math.min(DIVISION_COUNT - 1, Math.max(0, Math.round(v * (DIVISION_COUNT - 1))))
export const knobFromDivision = (i: number): number => i / (DIVISION_COUNT - 1)
/** seconds of one subdivision at `bpm` quarter notes per minute */
export const divisionSeconds = (division: number, bpm: number): number => (60 / clampBpm(bpm)) * DIVISIONS[Math.min(DIVISION_COUNT - 1, Math.max(0, Math.round(division)))].beats

export const BPM_MIN = 30
export const BPM_MAX = 300
export const clampBpm = (bpm: number): number => Math.min(BPM_MAX, Math.max(BPM_MIN, bpm))

export interface EnvKnobs {
  /** attack, decay, release: knob positions 0..1 (see `envSeconds`) */
  attack: number
  decay: number
  release: number
}

export interface OscEnvState extends EnvKnobs {
  /** bipolar amount -1..1 (panel knob -10..+10) */
  amount: number
  velocity: boolean
  /** ENV TO PITCH: the envelope modulates pitch instead of Osc Ctrl */
  toPitch: boolean
}
export interface FilterState {
  on: boolean
  type: FilterType
  /** cutoff knob 0..1 */
  freq: number
  /** resonance knob 0..1 */
  res: number
  /** filter envelope amount 0..1 */
  envAmount: number
  /** 0 Off, 1 = 1/3, 2 = 2/3, 3 = 1 */
  tracking: Level3
  /** 0 Off, 1..3 */
  drive: Level3
  attack: number
  decay: number
  release: number
  velocity: boolean
}
export interface AmpEnvState extends EnvKnobs {
  /** velocity sensitivity 0 Off, 1..3 */
  velocity: Level3
}
export interface LfoState {
  waveform: number
  dest: LfoDest
  rate: number
  amount: number
  /** rate follows the master clock (see `division`) */
  sync: boolean
  division: number
}
export interface VoiceState {
  mode: VoiceMode
  priority: NotePriority
  /** glide time knob 0..1 (0 = off) */
  glide: number
  unison: Level3
  vibrato: { mode: VibratoMode; rate: number; amount: number }
}
export interface ArpState {
  mode: ArpMode
  run: boolean
  hold: boolean
  /** free rate knob 0..1 → 30..300 BPM (quarter-note tempo; steps are eighth notes) */
  rate: number
  sync: boolean
  division: number
  /** range knob 0..1 → 1..4 octaves (Gate mode: gate hardness) */
  range: number
  direction: ArpDirection
}

export interface SynthPatch {
  /** index into SYNTH_WAVEFORMS */
  waveform: number
  /** Osc Ctrl knob 0..1 (panel 0-10) */
  oscCtrl: number
  coarse: number
  fine: number
  oscEnv: OscEnvState
  filter: FilterState
  amp: AmpEnvState
  lfo: LfoState
  voice: VoiceState
  arp: ArpState
  /** KB SYNC: LFO phase and arpeggio restart on a fresh key press */
  kbSync: boolean
}

export interface SynthLayerState {
  enabled: boolean
  level: number
  octave: -1 | 0 | 1
  sustPed: boolean
  pitchStick: boolean
  patch: SynthPatch
}

export const defaultSynthPatch = (waveform = 2): SynthPatch => ({
  waveform,
  oscCtrl: 0.3,
  coarse: 0,
  fine: 0,
  oscEnv: { attack: 0.05, decay: 0.55, release: 0.3, amount: 0, velocity: false, toPitch: false },
  filter: { on: true, type: 'LP24', freq: 0.62, res: 0.2, envAmount: 0.3, tracking: 2, drive: 0, attack: 0.05, decay: 0.6, release: 0.3, velocity: false },
  amp: { attack: 0.04, decay: 1, release: 0.3, velocity: 2 },
  lfo: { waveform: 0, dest: 'off', rate: 0.4, amount: 0, sync: false, division: 4 },
  voice: { mode: 'poly', priority: 'off', glide: 0, unison: 0, vibrato: { mode: 'off', rate: 5, amount: 3 } },
  arp: { mode: 'arp', run: false, hold: false, rate: 0.4, sync: false, division: 4, range: 0.25, direction: 'up' },
  kbSync: false,
})

export const defaultSynthLayer = (level: number, enabled: boolean, waveform = 2): SynthLayerState => ({
  enabled,
  level,
  octave: 0,
  sustPed: true,
  pitchStick: true,
  patch: defaultSynthPatch(waveform),
})

// ---------------------------------------------------------------------------------------------------------------
// control → parameter mappings (pure)
// ---------------------------------------------------------------------------------------------------------------
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** envelope knob → seconds, exponential 2 ms … 10 s */
export const envSeconds = (knob: number): number => 0.002 * Math.pow(5000, clamp(knob, 0, 1))
/** decay knob at its maximum acts as sustain: the level is held while the key is down (manual p. 33) */
export const decayIsSustain = (knob: number): boolean => knob >= 0.995

/** Osc Ctrl knob → 0..10 as printed on the panel */
export const oscCtrlDisplay = (v: number): number => Math.round(clamp(v, 0, 1) * 100) / 10

/** cutoff knob → Hz, exponential 25 Hz … 18 kHz */
export const cutoffHz = (knob: number): number => 25 * Math.pow(720, clamp(knob, 0, 1))
/** resonance knob → filter Q (dB-ish) */
export const resonanceQ = (knob: number): number => 0.5 + 17 * Math.pow(clamp(knob, 0, 1), 2)
/** filter envelope amount 0..1 → octaves of cutoff sweep */
export const filterEnvOctaves = (amount: number): number => clamp(amount, 0, 1) * 7

export const glideSeconds = (knob: number): number => (knob <= 0.001 ? 0 : 0.01 * Math.pow(300, clamp(knob, 0, 1)))

/** LFO free rate 0.05 … 20 Hz */
export const lfoFreeHz = (knob: number): number => 0.05 * Math.pow(400, clamp(knob, 0, 1))
export const lfoHzFor = (lfo: Pick<LfoState, 'rate' | 'sync' | 'division'>, bpm: number): number => (lfo.sync ? 1 / divisionSeconds(lfo.division, bpm) : lfoFreeHz(lfo.rate))

/** arpeggiator step length in seconds */
export const arpStepSeconds = (arp: Pick<ArpState, 'rate' | 'sync' | 'division'>, bpm: number): number =>
  arp.sync ? divisionSeconds(arp.division, bpm) : 60 / (BPM_MIN + arp.rate * (BPM_MAX - BPM_MIN)) / 2
export const arpOctaves = (range: number): number => 1 + Math.min(3, Math.floor(clamp(range, 0, 1) * 4))

export const VIBRATO_DEPTH_CENTS_PER_UNIT = 8
/** vibrato menu amount 0..10 → cents of peak deviation */
export const vibratoCents = (amount: number): number => clamp(amount, 0, 10) * VIBRATO_DEPTH_CENTS_PER_UNIT

/** amplitude velocity sensitivity level → exponent applied to velocity/127 (0 = no sensitivity) */
export const velocitySensitivity = (level: number): number => [0, 0.5, 1, 1.7][clamp(Math.round(level), 0, 3)]

export const UNISON_VOICES: readonly number[] = [1, 2, 3, 5]
export const UNISON_DETUNE_CENTS: readonly number[] = [0, 9, 16, 26]

export const waveformInfo = (index: number): WaveformInfo => SYNTH_WAVEFORMS[clamp(Math.round(index), 0, SYNTH_WAVEFORMS.length - 1)]
