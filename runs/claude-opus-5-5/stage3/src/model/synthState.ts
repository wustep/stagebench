// Canonical Synth section state (synth spec): three layers, Analog mode with the exact required
// waveform list, Osc Ctrl, pitch, three ADR envelopes, the four required filters, LFO, voice
// modes, unison, vibrato and the arpeggiator/gate. Knob values are 0…127 like the panel.
import { commonDefaults, type CommonLayer } from './layerCommon'

export type WaveCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'

export interface WaveDef {
  id: string
  name: string
  category: WaveCategory
}

/** The required Analog-mode waveform list, in display order (synth spec oscillator.requiredWaveforms). */
export const SYNTH_WAVES: readonly WaveDef[] = [
  { id: 'sine', name: 'Sine', category: 'Pure' },
  { id: 'triangle', name: 'Triangle', category: 'Pure' },
  { id: 'saw', name: 'Saw', category: 'Pure' },
  { id: 'square', name: 'Square', category: 'Pure' },
  { id: 'pulse33', name: 'Pulse 33', category: 'Pure' },
  { id: 'pulse10', name: 'Pulse 10', category: 'Pure' },
  { id: 'noise', name: 'White Noise', category: 'Pure' },
  { id: 'syncSaw', name: 'Sync Saw', category: 'Sync' },
  { id: 'syncSquare', name: 'Sync Square', category: 'Sync' },
  { id: 'multiSaw', name: 'Multi Saw', category: 'Multi' },
  { id: 'multiSaw8', name: 'Multi Saw 8ve', category: 'Multi' },
  { id: 'superSaw', name: 'Super Saw', category: 'Super' },
  { id: 'superSquare', name: 'Super Square', category: 'Super' },
  { id: 'fm', name: 'FM 2-op A', category: 'FM-H' },
]

export const WAVE_CATEGORIES: readonly WaveCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']

export const waveDef = (index: number): WaveDef => SYNTH_WAVES[Math.min(SYNTH_WAVES.length - 1, Math.max(0, Math.round(index)))]

export const FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
export type FilterType = (typeof FILTER_TYPES)[number]
export const KB_TRACK = ['Off', '1/3', '2/3', '1'] as const
export const DRIVE_LEVELS = ['Off', '1', '2', '3'] as const

export const LFO_WAVES = ['triangle', 'sawDown', 'sawUp', 'square', 'sh'] as const
export type LfoWave = (typeof LFO_WAVES)[number]
export const LFO_WAVE_NAMES: Record<LfoWave, string> = { triangle: 'Triangle', sawDown: 'Saw down', sawUp: 'Saw up', square: 'Square', sh: 'S&H' }
/** LFO destination button order (panel states 0…3; 0 = no LED lit = LFO off, settings kept). */
export const LFO_DESTS = ['off', 'pitch', 'ctrl', 'filter'] as const
export type LfoDest = (typeof LFO_DESTS)[number]

export const VOICE_MODES = ['poly', 'mono', 'legato'] as const
export type VoiceMode = (typeof VOICE_MODES)[number]
export const PRIORITIES = ['last', 'low', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Vibrato button order (panel states 0…3): unlit, WHL, DLY, ON. */
export const VIBRATO_MODES = ['off', 'wheel', 'delay', 'on'] as const
export type VibratoMode = (typeof VIBRATO_MODES)[number]

/** Arp mode button (panel states 1…3): POLY, ARP, GATE. */
export const ARP_MODES = ['poly', 'arp', 'gate'] as const
export type ArpMode = (typeof ARP_MODES)[number]
export const ARP_DIRECTIONS = ['up', 'down', 'upDown', 'random'] as const
export type ArpDirection = (typeof ARP_DIRECTIONS)[number]

export interface Envelope {
  attack: number
  /** 127 = sustain mode (manual p. 33). */
  decay: number
  release: number
}

export interface SynthLayerState extends CommonLayer {
  /** Index into SYNTH_WAVES. */
  wave: number
  oscCtrl: number
  pitch: { coarse: number; fine: number }
  oscEnv: Envelope & { velocity: boolean }
  /** Bipolar 0…127 (64 = none). */
  oscEnvAmt: number
  /** Env To Pitch: the oscillator envelope modulates pitch instead of Osc Ctrl. */
  envToPitch: boolean
  filter: {
    on: boolean
    type: FilterType
    freq: number
    res: number
    envAmt: number
    track: number
    drive: number
  }
  filterEnv: Envelope & { velocity: boolean }
  ampEnv: Envelope & { velocity: number }
  lfo: { wave: LfoWave; dest: LfoDest; rate: number; amount: number; sync: boolean }
  voice: { mode: VoiceMode; priority: Priority; glide: number }
  unison: number
  vibrato: { mode: VibratoMode; rate: number; amount: number }
  arp: {
    mode: ArpMode
    run: boolean
    rate: number
    range: number
    direction: ArpDirection
    sync: boolean
  }
}

export type SynthLayerId = 'A' | 'B' | 'C'
export const SYNTH_LAYERS: readonly SynthLayerId[] = ['A', 'B', 'C']

export interface SynthSection {
  on: boolean
  focus: SynthLayerId
  /** KB HOLD: synth notes keep sounding (and arpeggios keep running) after the keys are lifted. */
  kbHold: boolean
  layers: Record<SynthLayerId, SynthLayerState>
}

export function defaultSynthLayer(enabled: boolean, level = 100): SynthLayerState {
  return {
    ...commonDefaults(enabled, level),
    wave: 2,
    oscCtrl: 50,
    pitch: { coarse: 0, fine: 0 },
    oscEnv: { attack: 0, decay: 50, release: 30, velocity: false },
    oscEnvAmt: 80,
    envToPitch: false,
    filter: { on: true, type: 'LP24', freq: 50, res: 70, envAmt: 60, track: 2, drive: 0 },
    filterEnv: { attack: 0, decay: 60, release: 40, velocity: false },
    ampEnv: { attack: 0, decay: 127, release: 35, velocity: 1 },
    lfo: { wave: 'triangle', dest: 'off', rate: 50, amount: 80, sync: false },
    voice: { mode: 'poly', priority: 'last', glide: 30 },
    unison: 0,
    vibrato: { mode: 'off', rate: 64, amount: 40 },
    arp: { mode: 'arp', run: false, rate: 70, range: 40, direction: 'up', sync: false },
  }
}

export function defaultSynth(): SynthSection {
  // Knob and fader defaults match the positions printed in the reference photo (panel parity).
  return { on: false, focus: 'A', kbHold: false, layers: { A: defaultSynthLayer(true, 118), B: defaultSynthLayer(false, 40), C: defaultSynthLayer(false, 90) } }
}

// ---- value mappings shared by the engine, the panel and the OLED ----

export const unit127 = (v: number) => Math.min(1, Math.max(0, v / 127))
const expMap = (v: number, lo: number, hi: number) => lo * Math.pow(hi / lo, unit127(v))

/** Envelope attack time (s). */
export const envAttack = (v: number) => (v <= 0 ? 0.0005 : expMap(v, 0.0008, 12))
/** Envelope decay time (s); Infinity = sustain mode at maximum. */
export const envDecay = (v: number) => (v >= 127 ? Infinity : expMap(v, 0.004, 20))
/** Envelope release time (s). */
export const envRelease = (v: number) => expMap(v, 0.004, 16)

/** Filter cutoff (Hz) for the Freq knob at note 60. */
export const filterHz = (v: number) => expMap(v, 25, 18000)
/** Resonance knob → Q. */
export const filterQ = (v: number) => 0.6 + 22 * unit127(v) ** 2
/** Filter envelope amount (cents at full envelope). */
export const filterEnvCents = (v: number) => 7200 * unit127(v)
export const KB_TRACK_AMOUNT = [0, 1 / 3, 2 / 3, 1]
export const DRIVE_GAIN = [1, 2.2, 4.5, 9]

/** Unsynced LFO rate (Hz). */
export const lfoHz = (v: number) => expMap(v, 0.05, 30)
/** Unsynced arpeggiator rate (steps per minute, shown as BPM). */
export const arpBpm = (v: number) => Math.round(expMap(v, 30, 960))
/** Glide knob → seconds per semitone (constant-rate portamento; 0 = off). */
export const glideSecondsPerSemitone = (v: number) => (v <= 0 ? 0 : expMap(v, 0.002, 0.25))
/** Vibrato menu rate 2.0–8.0 Hz and amount 0–10 (menu values stored as 0…127). */
export const vibratoHz = (v: number) => 2 + 6 * unit127(v)
export const vibratoCents = (v: number) => 60 * unit127(v)

/** Master-clock subdivisions (fraction of a whole note) selectable by a synced Rate knob. */
export const SYNC_DIVISIONS: readonly { label: string; wholeNotes: number }[] = [
  { label: '1/2', wholeNotes: 1 / 2 },
  { label: '1/4', wholeNotes: 1 / 4 },
  { label: '1/4T', wholeNotes: 1 / 6 },
  { label: '1/8', wholeNotes: 1 / 8 },
  { label: '1/8T', wholeNotes: 1 / 12 },
  { label: '1/16', wholeNotes: 1 / 16 },
  { label: '1/16T', wholeNotes: 1 / 24 },
]

export const syncDivision = (v: number) => SYNC_DIVISIONS[Math.min(SYNC_DIVISIONS.length - 1, Math.floor(unit127(v) * SYNC_DIVISIONS.length))]

/** Seconds per synced step at `bpm` (quarter note = one beat). */
export const divisionSeconds = (v: number, bpm: number) => (60 / bpm) * 4 * syncDivision(v).wholeNotes
