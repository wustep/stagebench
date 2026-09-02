/**
 * Synth DSP contract (specs/nord-stage-4.synth.json, manual p. 27–37). One SynthLayerUnit (src/dsp/synth.ts) renders
 * one Synth layer: an "Analog mode only" Nord Wave 2-style engine with the exact required waveform list, four filter
 * types, three envelopes, an LFO, voice modes and a deterministic arpeggiator/gate driven by the sample clock. Every
 * value below is the canonical program value (knob 0..10, selector index in panel order, envelope index 0..127).
 */
import { clamp, knobLog } from './types'

export const SYNTH_LAYER_IDS = ['A', 'B', 'C'] as const
export type SynthLayerId = (typeof SYNTH_LAYER_IDS)[number]

/** Oscillator types offered by the display's TYPE dial (Analog waveforms and the harmonic FM algorithm). */
export const SYNTH_WAVE_TYPES = ['Analog', 'FM-H'] as const
/** Analog categories (manual p. 29–30) — the required list. */
export const ANALOG_CATEGORIES = ['Pure', 'Sync', 'Multi', 'Super'] as const
export const ANALOG_WAVEFORMS: readonly (readonly string[])[] = [
  ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  ['Sync Saw', 'Sync Square'],
  ['Multi Saw', 'Multi Saw 8ve'],
  ['Super Saw', 'Super Square'],
]
/** FM-H categories: one 2-operator harmonic algorithm (A) whose Partial sets the modulator ratio (0.5..24). */
export const FM_CATEGORIES = ['Harmonic'] as const
export const FM_WAVEFORMS: readonly (readonly string[])[] = [['FM 2-op A']]
export const FM_PARTIALS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 24] as const
/** Osc Ctrl behaviour per Analog category (manual p. 29–30). */
export const OSC_CTRL_LEGENDS = ['No effect', 'Sync pitch', 'Detune', 'Detune/width', 'FM amount'] as const

export const FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
export const FILTER_TRACKING = ['Off', '1/3', '2/3', '1'] as const
export const FILTER_TRACKING_AMOUNT = [0, 1 / 3, 2 / 3, 1] as const
export const FILTER_DRIVE = ['Off', '1', '2', '3'] as const
export const LFO_WAVEFORMS = ['Triangle', 'Saw down', 'Saw up', 'Square', 'S/H'] as const
/** LFO destination selector: three destinations plus the "no LED lit = off" position (manual p. 34). */
export const LFO_DESTINATIONS = ['Osc pitch', 'Osc ctrl', 'Filter', 'Off'] as const
export const VOICE_MODES = ['Poly', 'Mono', 'Legato'] as const
export const VOICE_PRIORITIES = ['Off', 'Low', 'High'] as const
/** Vibrato selector in panel option order (`synth.vibrato.mode`). Aftertouch is excluded (no aftertouch in a browser). */
export const SYNTH_VIBRATO_MODES = ['Off', 'Wheel', 'Delay', 'On', 'Aftertouch', 'Pedal'] as const
export const VIBRATO_DELAY_TIMES = [0.2, 0.7, 1.2, 2.0] as const
export const ARP_MODES = ['Arp', 'Poly', 'Gate'] as const
export const ARP_DIRECTIONS = ['Up', 'Down', 'Up/Down', 'Random'] as const
export const AMP_VELOCITY_LEVELS = ['Off', '1', '2', '3'] as const
export const SYNTH_MODES = ['Analog', 'Samples', 'Extern'] as const
export const MAX_SYNTH_VOICES = 16

/** Envelope time index 0..127 → seconds (0.5 ms .. 45 s, exponential). Decay at 127 = sustain (manual p. 33). */
export const ENV_INDEX_MAX = 127
export function envTimeSeconds(index: number): number {
  const i = clamp(Math.round(index), 0, ENV_INDEX_MAX) / ENV_INDEX_MAX
  return 0.0005 * Math.pow(45 / 0.0005, i)
}
export function formatEnvTime(index: number, decay = false): string {
  if (decay && Math.round(index) >= ENV_INDEX_MAX) return 'Sustain'
  const s = envTimeSeconds(index)
  return s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`
}

/** Filter FREQ knob 0..10 → Hz. */
export const filterKnobToHz = (v: number) => knobLog(v, 30, 16000)
/** RES knob 0..10 → SVF Q (0.5 .. 30: self-oscillation near the top). */
export const resonanceKnobToQ = (v: number) => 0.5 * Math.pow(60, clamp(v, 0, 10) / 10)
/** Arpeggiator RATE knob 0..10 → quarter-note BPM (30 .. 300). */
export const arpKnobToBpm = (v: number) => knobLog(v, 30, 300)
/** GLIDE knob 0..10 → seconds per octave of constant-rate portamento (0 = instant). */
export const glideKnobToSecondsPerOctave = (v: number) => (v <= 0 ? 0 : knobLog(v, 0.03, 3))
/** Vibrato amount 0..10 → peak deviation in cents. */
export const vibratoAmountToCents = (v: number) => clamp(v, 0, 10) * 5

/** Master Clock subdivisions: label and length in quarter-note beats (manual p. 36, 39, 51). */
export interface ClockSubdivision {
  label: string
  beats: number
}
export const ARP_SUBDIVISIONS: readonly ClockSubdivision[] = [
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16T', beats: 1 / 6 },
]
export const LFO_SUBDIVISIONS: readonly ClockSubdivision[] = [
  { label: '4/1', beats: 16 },
  { label: '2/1', beats: 8 },
  { label: '1/1', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
]
/** Knob 0..10 → subdivision of a table (clockwise = shorter notes). */
export function subdivisionFromKnob(table: readonly ClockSubdivision[], knob: number): ClockSubdivision {
  const i = Math.round((clamp(knob, 0, 10) / 10) * (table.length - 1))
  return table[i]
}
/** Seconds per step of a subdivision at a tempo. */
export const subdivisionSeconds = (sub: ClockSubdivision, bpm: number) => (60 / clamp(bpm, 30, 300)) * sub.beats

export interface SynthWaveSelection {
  /** Index into SYNTH_WAVE_TYPES (0 Analog, 1 FM-H). */
  type: number
  /** Category within the type (Analog: ANALOG_CATEGORIES index; FM-H: 0). */
  category: number
  /** Waveform within the category. */
  index: number
  /** FM-H partial: index into FM_PARTIALS. */
  partial: number
}

export interface EnvelopeTimes {
  attack: number
  decay: number
  release: number
}

export interface SynthLayerParams {
  on: boolean
  /** Level fader 0..100 (faderToGain taper, morphable). */
  level: number
  /** Octave shift −1..1. */
  octave: number
  /** Synth mode selector position (only Analog sounds; Samples / Extern are unsupported and silent-by-design → treated as Analog). */
  mode: number
  wave: SynthWaveSelection
  /** OSC CTRL knob 0..10 (morphable). */
  oscCtrl: number
  pitch: { coarse: number; fine: number }
  oscEnv: EnvelopeTimes & { velocity: boolean; toPitch: boolean; amount: number }
  filter: { on: boolean; type: number; tracking: number; drive: number; freq: number; res: number; envAmount: number }
  filterEnv: EnvelopeTimes & { velocity: boolean }
  ampEnv: EnvelopeTimes & { velocity: number }
  lfo: { wave: number; rate: number; sync: boolean; amount: number; destination: number }
  voice: { mode: number; priority: number; glide: number }
  unison: number
  vibrato: { mode: number; rate: number; amount: number; delay: number }
  arp: { run: boolean; mode: number; rate: number; sync: boolean; range: number; direction: number; kbHold: boolean; kbSync: boolean }
  /** Master Clock tempo (quarter notes per minute). */
  bpm: number
  /** Modulation wheel 0..1 (Wheel vibrato). */
  wheel: number
  /** Control pedal 0..1 (Pedal vibrato). */
  pedal: number
  /** Pitch stick position −1..1, honoured when pstick is on (±2 semitones). */
  pitchBend: number
  sustped: boolean
  pstick: boolean
}

export type SynthEvent =
  | { type: 'on'; midi: number; velocity: number; gain: number }
  | { type: 'off'; midi: number }
  | { type: 'sustain'; on: boolean }
  | { type: 'allOff' }
  /** Master Clock keyboard sync: restart the arpeggiator / gate / synced LFO phase. */
  | { type: 'clockReset' }

export function defaultSynthLayerParams(overrides: Partial<SynthLayerParams> = {}): SynthLayerParams {
  return {
    on: false,
    level: 82,
    octave: 0,
    mode: 0,
    wave: { type: 0, category: 0, index: 2, partial: 1 },
    oscCtrl: 6,
    pitch: { coarse: 0, fine: 0 },
    oscEnv: { attack: 0, decay: 60, release: 40, velocity: false, toPitch: false, amount: 0 },
    filter: { on: true, type: 1, tracking: 1, drive: 0, freq: 6, res: 2, envAmount: 6 },
    filterEnv: { attack: 0, decay: 70, release: 50, velocity: false },
    ampEnv: { attack: 5, decay: 127, release: 45, velocity: 2 },
    lfo: { wave: 0, rate: 5, sync: false, amount: 4, destination: 3 },
    voice: { mode: 0, priority: 0, glide: 3 },
    unison: 0,
    vibrato: { mode: 0, rate: 5.5, amount: 5, delay: 1 },
    arp: { run: false, mode: 0, rate: 4, sync: false, range: 2, direction: 0, kbHold: false, kbSync: false },
    bpm: 120,
    wheel: 0,
    pedal: 0,
    pitchBend: 0,
    sustped: true,
    pstick: true,
    ...overrides,
  }
}

/** Human name of a wave selection (Program / Synth display). */
export function waveName(w: SynthWaveSelection): string {
  if (w.type === 1) return `${FM_WAVEFORMS[0][0]} · P ${FM_PARTIALS[clamp(Math.round(w.partial), 0, FM_PARTIALS.length - 1)]}`
  const cat = ANALOG_WAVEFORMS[clamp(Math.round(w.category), 0, ANALOG_WAVEFORMS.length - 1)]
  return cat[clamp(Math.round(w.index), 0, cat.length - 1)]
}
export function waveCategoryName(w: SynthWaveSelection): string {
  return w.type === 1 ? FM_CATEGORIES[0] : ANALOG_CATEGORIES[clamp(Math.round(w.category), 0, ANALOG_CATEGORIES.length - 1)]
}
/** Osc Ctrl category index for a wave selection (0 Pure, 1 Sync, 2 Multi, 3 Super, 4 FM-H). */
export function oscCtrlCategory(w: SynthWaveSelection): number {
  return w.type === 1 ? 4 : clamp(Math.round(w.category), 0, 3)
}
