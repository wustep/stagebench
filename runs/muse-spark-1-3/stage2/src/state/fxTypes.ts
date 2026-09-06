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
export type RotarySpeed = 'slow' | 'fast';

export const MOD1_TYPES: Mod1Type[] = ['a-pan', 'tremolo', 'ring-mod', 'a-wah', 'wah', 'pump'];
export const MOD2_TYPES: Mod2Type[] = ['chorus', 'flanger', 'phaser', 'vibe', 'ensemble', 'spin'];
export const AMP_TYPES: AmpType[] = ['eq', 'twin', 'jc', 'small', 'lp24', 'hp24', 'to-rotary'];
export const REVERB_TYPES: ReverbType[] = ['room', 'booth', 'spring', 'stage', 'hall', 'cathedral'];

export interface Mod1State {
  on: boolean;
  type: Mod1Type;
  rate: number; // 0..10 → 0.1..12 Hz
  amount: number; // 0..10
}

export interface Mod2State {
  on: boolean;
  type: Mod2Type;
  rate: number; // 0..10 → 0.05..8 Hz
  amount: number; // 0..10
}

export interface DelayState {
  on: boolean;
  timeMs: number; // 20..1500
  feedback: number; // 0..10
  wet: number; // 0..10 dry/wet
  filter: 'off' | 'lp' | 'hp' | 'bp';
  global: boolean;
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

export interface FocusState {
  /** Which section's chain the panel edits. */
  focus: FxFocus;
  /** Manual override: when true, panel focus stays put instead of following. */
  manual: boolean;
  /** Piano group mode: A+B share one setting (A is the source). */
  pianoGroup: boolean;
  /** Which layer the panel knob edits show. */
  layer: LayerId;
  /** All-effects bypass (Layer Effects ON button). */
  allBypass: boolean;
}

export const DEFAULT_CHAIN: ChainState = {
  mod1: { on: false, type: 'a-pan', rate: 4, amount: 4 },
  mod2: { on: false, type: 'chorus', rate: 3, amount: 3 },
  delay: { on: false, timeMs: 320, feedback: 3, wet: 3, filter: 'off', global: false },
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
  layer: 'A',
  allBypass: false,
};

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
