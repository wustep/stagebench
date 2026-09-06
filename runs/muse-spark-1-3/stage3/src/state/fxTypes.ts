/**
 * Phase 2 effect state: per-layer chains (Piano A/B), shared Rotary, focus /
 * group / global routing. Pure types + initial state + resolution helpers so
 * both the UI and the engines share one routing truth.
 */

import type { LayerId } from '../audio/pianoTypes';

export type Mod1Type = 'off' | 'a-pan' | 'tremolo' | 'ring-mod' | 'a-wah' | 'wah' | 'pump';
export type Mod2Type = 'off' | 'chorus' | 'flanger' | 'phaser' | 'vibe' | 'ensemble' | 'spin';
export type AmpType = 'eq' | 'twin' | 'jc' | 'small' | 'lp24' | 'hp24' | 'to-rotary';
export type ReverbType = 'room' | 'booth' | 'spring' | 'stage' | 'hall' | 'cathedral';
/** Phase 3: rotary adds morphable Stop (effects spec optional, claimed + working). */
export type RotarySpeed = 'slow' | 'fast' | 'stop';

export const MOD1_TYPES: Mod1Type[] = ['a-pan', 'tremolo', 'ring-mod', 'a-wah', 'wah', 'pump'];
export const MOD2_TYPES: Mod2Type[] = ['chorus', 'flanger', 'phaser', 'vibe', 'ensemble', 'spin'];
export const AMP_TYPES: AmpType[] = ['eq', 'twin', 'jc', 'small', 'lp24', 'hp24', 'to-rotary'];
export const REVERB_TYPES: ReverbType[] = ['room', 'booth', 'spring', 'stage', 'hall', 'cathedral'];

export interface Mod1State {
  on: boolean;
  type: Mod1Type;
  rate: number; // 0..10 → 0.1..12 Hz (or subdivision index when sync)
  amount: number; // 0..10
  /** Phase 3: Master Clock sync for LFO types (manual p. 49). */
  sync: boolean;
  subdiv: import('./program').ClockSubdiv;
}

export interface Mod2State {
  on: boolean;
  type: Mod2Type;
  rate: number; // 0..10 → 0.05..8 Hz
  amount: number; // 0..10
}

export interface DelayState {
  on: boolean;
  timeMs: number; // 20..1500 (manual dial; sync subdiv overrides when sync)
  feedback: number; // 0..10
  wet: number; // 0..10 dry/wet
  filter: 'off' | 'lp' | 'hp' | 'bp';
  global: boolean;
  /** Phase 3: Master Clock sync (manual p. 51). */
  sync: boolean;
  subdiv: import('./program').ClockSubdiv;
}

export interface AmpEqState {
  on: boolean;
  type: AmpType;
  drive: number; // 0..10
  bass: number; // -15..15 dB
  mid: number; // gain -15..15 dB, or resonance for filters
  freq: number; // mid freq / filter cutoff Hz
  treble: number; // -15..15 dB
}

export interface CompState {
  on: boolean;
  amount: number; // 0..10
  fast: boolean;
  global: boolean;
}

export interface ReverbState {
  on: boolean;
  type: ReverbType;
  wet: number; // 0..10 (fully wet at max)
  bright: boolean;
  global: boolean;
}

/** One full chain owned by a piano layer. */
export interface ChainState {
  mod1: Mod1State;
  mod2: Mod2State;
  delay: DelayState;
  ampEq: AmpEqState;
  comp: CompState;
  reverb: ReverbState;
  /** This layer routes into the shared Rotary (AmpEQ To Rotary). */
  rotaryOn: boolean;
}

export type FxFocus = 'organ' | 'piano' | 'synth';

export type ChainEditLayer = 'A' | 'B' | 'C';

export interface FocusState {
  /** Which section's chain the panel edits. */
  focus: FxFocus;
  /** Manual override: when true, panel focus stays put instead of following. */
  manual: boolean;
  /** Piano group mode: A+B share one setting (A is the source). */
  pianoGroup: boolean;
  /** Phase 3: Synth group mode: A+B+C share layer A's chain. */
  synthGroup: boolean;
  /** Which layer the panel knob edits show. */
  layer: LayerId;
  /** Phase 3: synth edit layer (synth has A/B/C). */
  synthLayer: ChainEditLayer;
  /** All-effects bypass (Layer Effects ON button). */
  allBypass: boolean;
}

export const DEFAULT_CHAIN: ChainState = {
  mod1: { on: false, type: 'a-pan', rate: 4, amount: 4, sync: false, subdiv: '1/8' },
  mod2: { on: false, type: 'chorus', rate: 3, amount: 3 },
  delay: { on: false, timeMs: 320, feedback: 3, wet: 3, filter: 'off', global: false, sync: false, subdiv: '1/8' },
  ampEq: { on: false, type: 'eq', drive: 2, bass: 0, mid: 0, freq: 1200, treble: 0 },
  comp: { on: false, amount: 0, fast: false, global: false },
  reverb: { on: false, type: 'room', wet: 3, bright: false, global: false },
  rotaryOn: false,
};

export function defaultChain(): ChainState {
  return JSON.parse(JSON.stringify(DEFAULT_CHAIN)) as ChainState;
}

export const DEFAULT_FOCUS: FocusState = {
  focus: 'piano',
  manual: false,
  pianoGroup: false,
  synthGroup: false,
  layer: 'A',
  synthLayer: 'A',
  allBypass: false,
};

/**
 * Phase 3 chain registry: 6 chains per program — Piano A/B, Organ (shared),
 * Synth A/B/C — plus the single shared Rotary (effects spec `routing`).
 */
export type ChainKey = 'pianoA' | 'pianoB' | 'organ' | 'synthA' | 'synthB' | 'synthC';

export const CHAIN_KEYS: ChainKey[] = ['pianoA', 'pianoB', 'organ', 'synthA', 'synthB', 'synthC'];

export function defaultChains(): Record<ChainKey, ChainState> {
  return {
    pianoA: defaultChain(),
    pianoB: defaultChain(),
    organ: defaultChain(),
    synthA: defaultChain(),
    synthB: defaultChain(),
    synthC: defaultChain(),
  };
}

/**
 * Phase 3 global resolution: a global flag on ANY chain wins for the unit
 * across every layer of every section (manual p. 48).
 */
export function effectiveDelayAll(key: ChainKey, chains: Record<ChainKey, ChainState>): DelayState {
  const own = chains[key].delay;
  if (own.global) return own;
  for (const k of CHAIN_KEYS) {
    if (chains[k].delay.global) return chains[k].delay;
  }
  return own;
}

export function effectiveCompAll(key: ChainKey, chains: Record<ChainKey, ChainState>): CompState {
  const own = chains[key].comp;
  if (own.global) return own;
  for (const k of CHAIN_KEYS) {
    if (chains[k].comp.global) return chains[k].comp;
  }
  return own;
}

export function effectiveReverbAll(key: ChainKey, chains: Record<ChainKey, ChainState>): ReverbState {
  const own = chains[key].reverb;
  if (own.global) return own;
  for (const k of CHAIN_KEYS) {
    if (chains[k].reverb.global) return chains[k].reverb;
  }
  return own;
}

/**
 * Phase 3 clock-synced resolution: Mod1 rate, Delay time, Synth LFO, and
 * arp/gate lock to the Master Clock subdivisions (manual pp. 34, 36, 49).
 */
export function mod1RateHzSync(rate: number, sync: boolean, subdiv: import('./program').ClockSubdiv, bpm: number): number {
  if (!sync) return mod1RateHz(rate);
  const quarters: Record<string, number> = { '1/2': 2, '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6 };
  const q = quarters[subdiv] ?? 0.5;
  return bpm / 60 / q;
}

export function delayMsSync(delay: DelayState, bpm: number): number {
  if (!delay.sync) return delay.timeMs;
  const quarters: Record<string, number> = { '1/2': 2, '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6 };
  const q = quarters[delay.subdiv] ?? 0.5;
  return Math.min(1500, Math.max(20, Math.round((60000 / bpm) * q)));
}

/** Focus follows piano layer focus unless the user overrode it manually. */
export function focusForLayer(layer: LayerId, prev: FocusState): FocusState {
  if (prev.manual) return { ...prev, layer };
  return { ...prev, focus: 'piano', layer };
}

/**
 * Resolve which stored chain a layer actually plays through: in piano group
 * mode both layers share layer A's chain; otherwise each owns its chain.
 */
export function effectiveChain(layer: LayerId, chains: Record<LayerId, ChainState>, focus: FocusState): ChainState {
  if (focus.pianoGroup) return chains.A;
  return chains[layer];
}

/** Global-capable units apply to all layers when their global flag is set. */
export function effectiveDelay(layer: LayerId, chains: Record<LayerId, ChainState>, focus: FocusState): DelayState {
  const own = effectiveChain(layer, chains, focus);
  if (own.delay.global) return own.delay;
  // A global flag on either layer wins for both.
  if (chains.A.delay.global) return chains.A.delay;
  if (chains.B.delay.global) return chains.B.delay;
  return own.delay;
}

export function effectiveComp(layer: LayerId, chains: Record<LayerId, ChainState>, focus: FocusState): CompState {
  const own = effectiveChain(layer, chains, focus);
  if (own.comp.global) return own.comp;
  if (chains.A.comp.global) return chains.A.comp;
  if (chains.B.comp.global) return chains.B.comp;
  return own.comp;
}

export function effectiveReverb(layer: LayerId, chains: Record<LayerId, ChainState>, focus: FocusState): ReverbState {
  const own = effectiveChain(layer, chains, focus);
  if (own.reverb.global) return own.reverb;
  if (chains.A.reverb.global) return chains.A.reverb;
  if (chains.B.reverb.global) return chains.B.reverb;
  return own.reverb;
}

export function mod1RateHz(rate: number): number {
  return 0.1 + (Math.min(10, Math.max(0, rate)) / 10) * 11.9;
}

export function mod2RateHz(rate: number): number {
  return 0.05 + (Math.min(10, Math.max(0, rate)) / 10) * 7.95;
}
