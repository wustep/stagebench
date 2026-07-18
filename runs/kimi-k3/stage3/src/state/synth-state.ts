/**
 * Canonical synth state (Phase 3, specs/nord-stage-4.synth.json).
 *
 * Three layers (A, B, C) with independent effect chains. All values are
 * integers on panel scale so programs round-trip exactly. Knob-scale is
 * 0..127; Osc Ctrl is shown 0..10 on the display.
 */

export type SynthLayerId = 'A' | 'B' | 'C'
export const SYNTH_LAYERS: readonly SynthLayerId[] = ['A', 'B', 'C']

/** The exact required waveform list, in selector order (Analog mode). */
export const SYNTH_WAVES = [
  // Pure
  'Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise',
  // Sync
  'Sync Saw', 'Sync Square',
  // Multi
  'Multi Saw', 'Multi Saw 8ve',
  // Super
  'Super Saw', 'Super Square',
  // FM-H
  'FM 2-op A',
] as const

export type SynthWaveCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'

export const WAVE_CATEGORY: Record<number, SynthWaveCategory> = {
  0: 'Pure', 1: 'Pure', 2: 'Pure', 3: 'Pure', 4: 'Pure', 5: 'Pure', 6: 'Pure',
  7: 'Sync', 8: 'Sync',
  9: 'Multi', 10: 'Multi',
  11: 'Super', 12: 'Super',
  13: 'FM-H',
}

export const FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const
export const KB_TRACK_MODES = ['Off', '1/3', '2/3', '1'] as const
export const DRIVE_LEVELS = ['Off', '1', '2', '3'] as const
export const LFO_WAVES = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const
export const LFO_DESTS = ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const
export const VOICE_MODES = ['Poly', 'Mono', 'Legato'] as const
export const PRIORITY_MODES = ['Off', 'Low', 'High'] as const
export const ARP_MODES = ['Arp', 'Poly', 'Gate'] as const
export const ARP_DIRECTIONS = ['Up', 'Down', 'Up/Down', 'Random'] as const
export const VIBRATO_MODES = ['Off', 'On', 'Wheel'] as const
/** Master-clock subdivision list for arp/LFO sync (beats per step, 1 = quarter note). */
export const SYNC_DIVISIONS = ['1/2', '1/4T', '1/4', '1/8T', '1/8', '1/16T', '1/16'] as const
/** Beats per step for each SYNC_DIVISIONS entry. */
export const SYNC_DIVISION_BEATS = [2, 4 / 3, 1, 2 / 3, 0.5, 1 / 3, 0.25] as const

export interface EnvState {
  attack: number // 0..127
  decay: number // 0..127; 127 = sustain mode (held)
  release: number // 0..127
  velocity: number // amp: 0..3 (Off/1/2/3); others: 0/1 toggle
}

export interface SynthLayerState {
  enabled: boolean
  /** Level fader 0..127 (morphable). */
  level: number
  octave: number // −12/0/+12
  sustainPedal: boolean
  pitchStick: boolean
  oscWave: number // index into SYNTH_WAVES
  oscCtrl: number // 0..127 (displayed 0..10; morphable)
  oscCoarse: number // semitones −24..+24
  oscFine: number // cents −50..+50
  /** Osc env: retargets to pitch with bipolar amount when envToPitch is on. */
  envToPitch: boolean
  oscEnv: EnvState & { amount: number } // amount −64..+63 bipolar
  filterType: number // index into FILTER_TYPES
  filterFreq: number // 0..127 (morphable)
  filterRes: number // 0..127 (morphable)
  filterEnvAmt: number // 0..127
  filterKbTrack: number // index into KB_TRACK_MODES
  filterDrive: number // index into DRIVE_LEVELS
  filterEnv: EnvState
  ampEnv: EnvState
  lfoWave: number // index into LFO_WAVES
  lfoRate: number // 0..127 (morphable; sync subdivision index when lfoSync)
  lfoAmount: number // 0..127 (morphable)
  lfoDest: number // index into LFO_DESTS; 0 = off (settings kept)
  lfoSync: boolean
  voiceMode: number // index into VOICE_MODES
  priority: number // index into PRIORITY_MODES
  glide: number // 0..127 constant-rate portamento time (0 = off)
  unison: number // 0..3 (Off/1/2/3)
  vibrato: number // index into VIBRATO_MODES
  vibratoRate: number // 0..127 → 2..8 Hz
  vibratoAmount: number // 0..127 → 0..10
  arpMode: number // index into ARP_MODES
  arpRate: number // 0..127 free BPM (quarter-note 30..300), or sync subdivision index when arpSync
  arpSync: boolean
  arpRange: number // 1..4 octaves (Gate: hardness 1..4)
  arpDirection: number // index into ARP_DIRECTIONS
  arpHold: boolean
  arpRun: boolean
}

export interface SynthState {
  sectionOn: boolean
  focusLayer: SynthLayerId
  layers: Record<SynthLayerId, SynthLayerState>
}

function defaultEnv(a: number, d: number, r: number): EnvState {
  return { attack: a, decay: d, release: r, velocity: 0 }
}

export function defaultSynthLayer(enabled: boolean): SynthLayerState {
  return {
    enabled,
    level: 100,
    octave: 0,
    sustainPedal: true,
    pitchStick: false,
    oscWave: 2, // Saw
    oscCtrl: 0,
    oscCoarse: 0,
    oscFine: 0,
    envToPitch: false,
    oscEnv: { ...defaultEnv(0, 60, 30), amount: 0 },
    filterType: 0, // LP12
    filterFreq: 127,
    filterRes: 0,
    filterEnvAmt: 0,
    filterKbTrack: 0,
    filterDrive: 0,
    filterEnv: defaultEnv(0, 60, 30),
    ampEnv: defaultEnv(0, 127, 24), // decay max = sustain mode (held notes sustain)
    lfoWave: 0,
    lfoRate: 64,
    lfoAmount: 0,
    lfoDest: 0,
    lfoSync: false,
    voiceMode: 0, // Poly
    priority: 0,
    glide: 0,
    unison: 0,
    vibrato: 0,
    vibratoRate: 64,
    vibratoAmount: 40,
    arpMode: 0,
    arpRate: 90,
    arpSync: false,
    arpRange: 1,
    arpDirection: 0,
    arpHold: false,
    arpRun: false,
  }
}

export function defaultSynthState(): SynthState {
  return {
    sectionOn: false,
    focusLayer: 'A',
    layers: { A: defaultSynthLayer(true), B: defaultSynthLayer(false), C: defaultSynthLayer(false) },
  }
}

/** Chain id for a synth layer (independent chain per layer). */
export function synthChainFor(layer: SynthLayerId): 'synthA' | 'synthB' | 'synthC' {
  return layer === 'A' ? 'synthA' : layer === 'B' ? 'synthB' : 'synthC'
}
