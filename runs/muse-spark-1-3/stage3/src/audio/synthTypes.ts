/**
 * Phase 3 synth type catalog: three layers (A, B, C) with independent state
 * and effect chains. Analog mode with the exact required waveform list plus
 * one FM Harmonic algorithm (spec `oscillator.requiredWaveforms`); four
 * filters; three ADR envelopes (decay-max = sustain); 5-wave/3-dest LFO with
 * clock sync; poly/mono/legato + priority + glide + unison + vibrato;
 * Arp/Poly/Gate with rate/sync/range/direction/hold/run. Pure catalog +
 * state; rendering lives in `synthRender.ts`.
 */

export type SynthLayerId = 'A' | 'B' | 'C';

export const SYNTH_LAYERS: SynthLayerId[] = ['A', 'B', 'C'];

// --- Oscillator --------------------------------------------------------------

export type WaveCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H';

export const REQUIRED_WAVES: Record<WaveCategory, string[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
};

export const ALL_WAVES: string[] = [
  ...REQUIRED_WAVES.Pure,
  ...REQUIRED_WAVES.Sync,
  ...REQUIRED_WAVES.Multi,
  ...REQUIRED_WAVES.Super,
  ...REQUIRED_WAVES['FM-H'],
];

export function waveCategory(wave: string): WaveCategory {
  for (const [cat, waves] of Object.entries(REQUIRED_WAVES) as Array<[WaveCategory, string[]]>) {
    if (waves.includes(wave)) return cat;
  }
  return 'Pure';
}

/**
 * Osc Ctrl by category (manual pp. 29-30): Pure = no effect; Sync = sync
 * osc relative pitch; Multi/Super = detune/width; FM-H = FM amount.
 */
export function oscCtrlKind(wave: string): 'none' | 'syncPitch' | 'detune' | 'fmAmount' {
  const cat = waveCategory(wave);
  if (cat === 'Pure') return 'none';
  if (cat === 'Sync') return 'syncPitch';
  if (cat === 'FM-H') return 'fmAmount';
  return 'detune';
}

// --- Filter ------------------------------------------------------------------

export type SynthFilterType = 'LP12' | 'LP24' | 'HP' | 'BP';
export const SYNTH_FILTERS: SynthFilterType[] = ['LP12', 'LP24', 'HP', 'BP'];

export type FilterTracking = 'Off' | '1/3' | '2/3' | '1';

export function trackingRatio(t: FilterTracking): number {
  if (t === '1/3') return 1 / 3;
  if (t === '2/3') return 2 / 3;
  if (t === '1') return 1;
  return 0;
}

// --- Envelopes ---------------------------------------------------------------

export interface AdrEnvelope {
  attack: number; // 0..10 UI
  decay: number; // 0..10 UI (max = sustain mode)
  release: number; // 0..10 UI
}

export function defaultAdr(attack = 0, decay = 4, release = 3): AdrEnvelope {
  return { attack, decay, release };
}

/** UI 0..10 → seconds (attack/release); decay-max (>=9.5) = sustain mode. */
export function envSeconds(v: number): number {
  const c = Math.min(10, Math.max(0, v));
  return 0.003 * Math.pow(2, (c / 10) * 12);
}

export function isSustainMode(decay: number): boolean {
  return decay >= 9.5;
}

// --- LFO ---------------------------------------------------------------------

export type LfoWave = 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold';
export const LFO_WAVES: LfoWave[] = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'];

export type LfoDest = 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq';
export const LFO_DESTS: LfoDest[] = ['Osc Pitch', 'Osc Ctrl', 'Filter Freq'];

// --- Voice -------------------------------------------------------------------

export type VoiceMode = 'Poly' | 'Mono' | 'Legato';
export type NotePriority = 'Off' | 'Low' | 'High';

export type VibratoMode = 'On' | 'Wheel' | 'Off';

export interface SynthVoiceState {
  mode: VoiceMode;
  priority: NotePriority;
  /** Glide rate 0..10 (constant-rate portamento, mono/legato legato-play). */
  glide: number;
  /** Unison extra copies 0..3. */
  unison: number;
  vibrato: VibratoMode;
  vibRate: number; // 2.0..8.0 Hz
  vibAmount: number; // 0..10
}

// --- Arp/gate ----------------------------------------------------------------

export type ArpMode = 'Arp' | 'Poly' | 'Gate' | 'Off';
export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random';

export interface ArpState {
  mode: ArpMode;
  /** Quarter-note BPM when unsynced, or subdivision index when synced. */
  rate: number; // 0..10 UI
  sync: boolean;
  subdiv: import('../state/program').ClockSubdiv;
  /** 1..4 octaves (Gate repurposes the knob as envelope hardness). */
  range: number;
  direction: ArpDirection;
  hold: boolean;
  run: boolean;
}

// --- Layer -------------------------------------------------------------------

export interface SynthLayerState {
  enabled: boolean;
  wave: string;
  /** Osc Ctrl 0..10 (morphable; category behavior per `oscCtrlKind`). */
  oscCtrl: number;
  /** Coarse semitones -24..24. */
  coarse: number;
  /** Fine cents -50..50. */
  fine: number;
  filterType: SynthFilterType;
  /** Filter Freq cutoff 0..10 UI (morphable). */
  filterFreq: number;
  /** Resonance 0..10 UI (morphable). */
  filterRes: number;
  /** Filter envelope amount 0..10 UI (bipolar visual, stored raw). */
  filterEnvAmt: number;
  tracking: FilterTracking;
  /** Drive Off/1/2/3. */
  drive: number;
  oscEnv: AdrEnvelope;
  oscVel: boolean;
  envToPitch: boolean;
  /** Bipolar osc env amount -5..5. */
  oscEnvAmt: number;
  filterEnv: AdrEnvelope;
  filterVel: boolean;
  ampEnv: AdrEnvelope;
  /** Amp velocity levels Off/1/2/3. */
  ampVel: number;
  /** Amp sustain level 0..10 (honest extension; ADR has no sustain knob). */
  ampSustain: number;
  lfoWave: LfoWave;
  /** null = off (no destination LED lit; keeps settings, manual p. 34). */
  lfoDest: LfoDest | null;
  lfoRate: number; // 0..10 UI (morphable, clock syncable)
  lfoSync: boolean;
  lfoSubdiv: import('../state/program').ClockSubdiv;
  lfoAmt: number; // 0..10 UI (morphable)
  voice: SynthVoiceState;
  arp: ArpState;
  level: number; // 0..10 UI fader (morphable)
  octave: number; // 0..4 index → ±12 st
  sustPed: boolean;
  pStick: boolean;
}

export const DEFAULT_SYNTH_LAYER: SynthLayerState = {
  enabled: true,
  wave: 'Saw',
  oscCtrl: 5,
  coarse: 0,
  fine: 0,
  filterType: 'LP24',
  filterFreq: 8,
  filterRes: 2,
  filterEnvAmt: 0,
  tracking: 'Off',
  drive: 0,
  oscEnv: defaultAdr(0, 4, 3),
  oscVel: false,
  envToPitch: false,
  oscEnvAmt: 0,
  filterEnv: defaultAdr(0, 4, 3),
  filterVel: false,
  ampEnv: defaultAdr(0, 4, 3),
  ampVel: 1,
  ampSustain: 8,
  lfoWave: 'Triangle',
  lfoDest: null,
  lfoRate: 4,
  lfoSync: false,
  lfoSubdiv: '1/8',
  lfoAmt: 0,
  voice: { mode: 'Poly', priority: 'Off', glide: 0, unison: 0, vibrato: 'Off', vibRate: 5.5, vibAmount: 5 },
  arp: { mode: 'Off', rate: 5, sync: false, subdiv: '1/8', range: 1, direction: 'Up', hold: false, run: false },
  level: 8,
  octave: 2,
  sustPed: true,
  pStick: true,
};

export function defaultSynthLayer(overrides: Partial<SynthLayerState> = {}): SynthLayerState {
  return {
    ...DEFAULT_SYNTH_LAYER,
    ...overrides,
    oscEnv: { ...DEFAULT_SYNTH_LAYER.oscEnv, ...(overrides.oscEnv ?? {}) },
    filterEnv: { ...DEFAULT_SYNTH_LAYER.filterEnv, ...(overrides.filterEnv ?? {}) },
    ampEnv: { ...DEFAULT_SYNTH_LAYER.ampEnv, ...(overrides.ampEnv ?? {}) },
    voice: { ...DEFAULT_SYNTH_LAYER.voice, ...(overrides.voice ?? {}) },
    arp: { ...DEFAULT_SYNTH_LAYER.arp, ...(overrides.arp ?? {}) },
  };
}

export function synthOctaveSemitones(index: number): number {
  return (Math.min(4, Math.max(0, index)) - 2) * 12;
}

/** Amp velocity level 0..3 → gain sensitivity. */
export function ampVelGain(velocity: number, level: number): number {
  if (level <= 0) return 1;
  const v = Math.min(127, Math.max(1, velocity)) / 127;
  const depth = [0, 0.4, 0.7, 1][Math.min(3, level)];
  return (1 - depth) + depth * v;
}
