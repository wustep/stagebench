/**
 * Phase 3 canonical program state: one serializable `InstrumentProgram`
 * covering every supported control (piano, organ, synth, effects, splits,
 * scenes, morphs, clock, transpose). Pure types + helpers + factory content,
 * so tests and the UI share one truth. No React, no audio.
 *
 * Manual refs: programs pp. 13, 38-45; splits p. 39; morphs pp. 38-39;
 * clock/transpose/panic p. 40; scenes p. 43.
 */

import type { LayerPianoState } from '../audio/pianoTypes';
import { defaultLayerPiano } from '../audio/pianoTypes';
import type { OrganLayerState } from '../audio/organTypes';
import { defaultOrganLayer } from '../audio/organTypes';
import type { SynthLayerId, SynthLayerState } from '../audio/synthTypes';
import { defaultSynthLayer } from '../audio/synthTypes';
import { defaultChain, type ChainState } from './fxTypes';
import type { PianoTypeId } from '../audio/pianoTypes';

// --- Slots / pages -----------------------------------------------------------

export const PROGRAM_SLOTS = 32;
export const PROGRAM_PAGES = 4;
export const PROGRAMS_PER_PAGE = 8;
export const LIVE_SLOTS = 8;

export function slotPage(slot: number): number {
  return Math.floor(slot / PROGRAMS_PER_PAGE) + 1;
}

export function slotButton(slot: number): number {
  return (slot % PROGRAMS_PER_PAGE) + 1;
}

/** Display form `page.button`, e.g. slot 17 → "3.2". */
export function slotLabel(slot: number): string {
  return `${slotPage(slot)}.${slotButton(slot)}`;
}

// --- Splits / zones ----------------------------------------------------------

/** The 11 documented split positions (manual p. 39). */
export const SPLIT_POSITIONS = [
  { id: 'C2', midi: 36 },
  { id: 'F2', midi: 41 },
  { id: 'C3', midi: 48 },
  { id: 'F3', midi: 53 },
  { id: 'C4', midi: 60 },
  { id: 'F4', midi: 65 },
  { id: 'C5', midi: 72 },
  { id: 'F5', midi: 77 },
  { id: 'C6', midi: 84 },
  { id: 'F6', midi: 89 },
  { id: 'C7', midi: 96 },
] as const;

export type SplitPosId = (typeof SPLIT_POSITIONS)[number]['id'];
export type CrossfadeWidth = 0 | 6 | 12;

export interface SplitPointState {
  active: boolean;
  pos: SplitPosId;
  xfade: CrossfadeWidth;
}

export interface SplitState {
  on: boolean;
  low: SplitPointState;
  mid: SplitPointState;
  high: SplitPointState;
}

/** A layer's zone assignment: contiguous zone range (manual p. 39). */
export interface ZoneRange {
  lo: number; // 0..3
  hi: number; // 0..3, >= lo
}

export function defaultSplit(): SplitState {
  return {
    on: false,
    low: { active: false, pos: 'C3', xfade: 0 },
    mid: { active: true, pos: 'C4', xfade: 0 },
    high: { active: false, pos: 'C5', xfade: 0 },
  };
}

export function fullZone(): ZoneRange {
  return { lo: 0, hi: 3 };
}

export function clampZone(z: ZoneRange): ZoneRange {
  const lo = Math.min(3, Math.max(0, Math.round(z.lo)));
  const hi = Math.min(3, Math.max(0, Math.round(z.hi)));
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

function posMidi(pos: SplitPosId): number {
  return SPLIT_POSITIONS.find((p) => p.id === pos)!.midi;
}

/** Sorted active boundary midis (low→high). */
export function activeBoundaries(split: SplitState): Array<{ midi: number; xfade: CrossfadeWidth }> {
  if (!split.on) return [];
  const pts = [split.low, split.mid, split.high].filter((p) => p.active);
  return pts.map((p) => ({ midi: posMidi(p.pos), xfade: p.xfade })).sort((a, b) => a.midi - b.midi);
}

/**
 * Crossfade gain for one note through one layer zone.
 * Off (w=0) switches immediately at the split; ±6/±12 fade linearly across
 * that many semitones on each side (manual p. 39).
 */
export function zoneGain(midi: number, zone: ZoneRange, split: SplitState): number {
  const bounds = activeBoundaries(split);
  if (bounds.length === 0) return 1;
  const z = clampZone(zone);
  let gain = 1;
  // Lower edge of zone lo (boundary index lo-1): layer must fade in above it.
  if (z.lo > 0 && z.lo - 1 < bounds.length) {
    const b = bounds[z.lo - 1];
    if (midi < b.midi) {
      gain *= b.xfade === 0 ? 0 : Math.min(1, Math.max(0, (midi - (b.midi - b.xfade)) / (2 * b.xfade)));
    }
  } else if (z.lo > bounds.length) {
    return 0; // zone starts above every boundary: unreachable range
  }
  // Upper edge of zone hi (boundary index hi): layer must fade out below it.
  if (z.hi < bounds.length) {
    const b = bounds[z.hi];
    if (midi > b.midi) {
      gain *= b.xfade === 0 ? 0 : Math.min(1, Math.max(0, (b.midi + b.xfade - midi) / (2 * b.xfade)));
    }
  } else if (z.hi < 3 && z.hi >= bounds.length) {
    void 0; // zone extends past the last boundary: open at the top
  }
  // Notes strictly outside the zone with hard edges are silent.
  return gain;
}

/** Zone index (0..3) of a note under the current split. */
export function zoneIndexOf(midi: number, split: SplitState): number {
  const bounds = activeBoundaries(split);
  let zone = 0;
  for (const b of bounds) {
    if (midi > b.midi) zone += 1;
  }
  return Math.min(3, zone);
}

// --- Scenes ------------------------------------------------------------------

export type SceneId = 'I' | 'II';

export interface EnableMap {
  pianoOn: boolean;
  organOn: boolean;
  synthOn: boolean;
  pianoA: boolean;
  pianoB: boolean;
  organA: boolean;
  organB: boolean;
  synthA: boolean;
  synthB: boolean;
  synthC: boolean;
}

export function defaultEnableMap(): EnableMap {
  return {
    pianoOn: true,
    organOn: true,
    synthOn: true,
    pianoA: true,
    pianoB: false,
    organA: false,
    organB: false,
    synthA: false,
    synthB: false,
    synthC: false,
  };
}

// --- Morphs ------------------------------------------------------------------

export type MorphSource = 'wheel' | 'pedal';

export interface MorphAssign {
  /** Canonical target id, e.g. "piano.A.level", "organ.drawbar.3", "fx.A.delay.fb". */
  target: string;
  start: number;
  end: number;
}

export type MorphAssignments = Record<MorphSource, MorphAssign[]>;

/**
 * Every morphable destination (programs spec `morph.destinations`). Values
 * are normalized per-target UI units (0..10 unless noted); `resolveMorphs`
 * maps them onto concrete state.
 */
export const MORPH_TARGET_INFO: Record<string, { label: string; min: number; max: number }> = {
  // Organ.
  'organ.A.level': { label: 'Organ A level', min: 0, max: 10 },
  'organ.B.level': { label: 'Organ B level', min: 0, max: 10 },
  'rotary.speed': { label: 'Rotary speed', min: 0, max: 1 },
  // Piano.
  'piano.A.level': { label: 'Piano A level', min: 0, max: 10 },
  'piano.B.level': { label: 'Piano B level', min: 0, max: 10 },
  // Synth.
  'synth.A.level': { label: 'Synth A level', min: 0, max: 10 },
  'synth.B.level': { label: 'Synth B level', min: 0, max: 10 },
  'synth.C.level': { label: 'Synth C level', min: 0, max: 10 },
  'synth.A.lfoRate': { label: 'Synth A LFO rate', min: 0, max: 10 },
  'synth.A.oscCtrl': { label: 'Synth A Osc Ctrl', min: 0, max: 10 },
  'synth.A.lfoAmt': { label: 'Synth A LFO amount', min: 0, max: 10 },
  'synth.A.filterFreq': { label: 'Synth A filter freq', min: 0, max: 10 },
  'synth.A.filterRes': { label: 'Synth A filter resonance', min: 0, max: 10 },
  'synth.A.arpRate': { label: 'Synth A arp rate', min: 0, max: 10 },
  // Effects (per chain key below).
  'fx.mod1Rate': { label: 'Mod 1 rate', min: 0, max: 10 },
  'fx.mod1Amt': { label: 'Mod 1 amount', min: 0, max: 10 },
  'fx.mod2Amt': { label: 'Mod 2 amount', min: 0, max: 10 },
  'fx.delayTempo': { label: 'Delay tempo', min: 0, max: 10 },
  'fx.delayFb': { label: 'Delay feedback', min: 0, max: 10 },
  'fx.delayWet': { label: 'Delay dry/wet', min: 0, max: 10 },
  'fx.eqFreq': { label: 'EQ mid / filter freq', min: 0, max: 10 },
  'fx.drive': { label: 'Drive amount', min: 0, max: 10 },
  'fx.reverbWet': { label: 'Reverb dry/wet', min: 0, max: 10 },
};

for (let i = 1; i <= 9; i += 1) {
  MORPH_TARGET_INFO[`organ.drawbar.${i}`] = { label: `Organ drawbar ${i}`, min: 0, max: 8 };
}

/** Linear interpolation of every assignment of one source at position 0..1. */
export function morphValues(assigns: MorphAssign[], pos: number): Record<string, number> {
  const p = Math.min(1, Math.max(0, pos));
  const out: Record<string, number> = {};
  for (const a of assigns) out[a.target] = a.start + (a.end - a.start) * p;
  return out;
}

/**
 * Read the current canonical value of a morph target from a program.
 * Used to finalize morph captures (start = value at first touch, end =
 * value at release) and to resolve live interpolation.
 */
export function readMorphTarget(p: InstrumentProgram, target: string): number | null {
  const organDraw = /^organ\.drawbar\.(\d)$/.exec(target);
  if (organDraw) {
    const i = Number(organDraw[1]) - 1;
    // Drawbars are shared per focused-layer family; read the focused layer.
    return p.organ.layers[p.organ.focus].drawbars[i] ?? null;
  }
  const organLvl = /^organ\.([AB])\.level$/.exec(target);
  if (organLvl) return p.organ.layers[organLvl[1] as 'A' | 'B'].level;
  if (target === 'rotary.speed') return 0.5;
  const pianoLvl = /^piano\.([AB])\.level$/.exec(target);
  if (pianoLvl) return p.piano.layers[pianoLvl[1] as 'A' | 'B'].level;
  const synthP = /^synth\.([ABC])\.(level|lfoRate|oscCtrl|lfoAmt|filterFreq|filterRes|arpRate)$/.exec(target);
  if (synthP) {
    const layer = p.synth.layers[synthP[1] as 'A' | 'B' | 'C'];
    const key = synthP[2];
    if (key === 'arpRate') return layer.arp.rate;
    return layer[key as 'level' | 'lfoRate' | 'oscCtrl' | 'lfoAmt' | 'filterFreq' | 'filterRes'];
  }
  const chainOf = (section: 'piano' | 'organ' | 'synth'): ChainStateLike => {
    if (section === 'organ') return p.organ.chain;
    if (section === 'synth') return p.synth.chains[p.synth.focus];
    return p.piano.chains[p.piano.layerFocus];
  };
  const fx = /^(piano|organ|synth)\/fx\.(.+)$/.exec(target);
  void fx;
  switch (target) {
    case 'fx.mod1Rate': return chainOf('piano').mod1.rate;
    case 'fx.mod1Amt': return chainOf('piano').mod1.amount;
    case 'fx.mod2Amt': return chainOf('piano').mod2.amount;
    case 'fx.delayTempo': return (chainOf('piano').delay.timeMs - 20) / 148;
    case 'fx.delayFb': return chainOf('piano').delay.feedback;
    case 'fx.delayWet': return chainOf('piano').delay.wet;
    case 'fx.eqFreq': return (chainOf('piano').ampEq.freq - 200) / 780;
    case 'fx.drive': return chainOf('piano').ampEq.drive;
    case 'fx.reverbWet': return chainOf('piano').reverb.wet;
    default: return null;
  }
}

interface ChainStateLike {
  mod1: { rate: number; amount: number };
  mod2: { amount: number };
  delay: { timeMs: number; feedback: number; wet: number };
  ampEq: { freq: number; drive: number };
  reverb: { wet: number };
}

// --- Clock / transpose -------------------------------------------------------

export const CLOCK_MIN = 30;
export const CLOCK_MAX = 300;

export function clampBpm(bpm: number): number {
  return Math.min(CLOCK_MAX, Math.max(CLOCK_MIN, Math.round(bpm)));
}

/** Quarter-note BPM → ms per quarter. */
export function bpmToMs(bpm: number): number {
  return 60000 / clampBpm(bpm);
}

export type ClockSubdiv = '1/2' | '1/4' | '1/8' | '1/8T' | '1/16' | '1/16T';

export const CLOCK_SUBDIVS: ClockSubdiv[] = ['1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T'];

/** Subdivision of the master clock in quarter-note multiples. */
export function subdivQuarters(sub: ClockSubdiv): number {
  switch (sub) {
    case '1/2': return 2;
    case '1/4': return 1;
    case '1/8': return 0.5;
    case '1/8T': return 1 / 3;
    case '1/16': return 0.25;
    case '1/16T': return 1 / 6;
  }
}

export function subdivMs(bpm: number, sub: ClockSubdiv): number {
  return bpmToMs(bpm) * subdivQuarters(sub);
}

export const TRANSPOSE_MIN = -6;
export const TRANSPOSE_MAX = 6;

export function clampTranspose(st: number): number {
  return Math.min(TRANSPOSE_MAX, Math.max(TRANSPOSE_MIN, Math.round(st)));
}

// --- Canonical program -------------------------------------------------------

export type PianoLayerId = 'A' | 'B';
export type OrganLayerId = 'A' | 'B';
export type ChainKey = 'pianoA' | 'pianoB' | 'organ' | 'synthA' | 'synthB' | 'synthC';

export interface PianoSectionState {
  sectionOn: boolean;
  layerFocus: PianoLayerId;
  layers: Record<PianoLayerId, LayerPianoState>;
  chains: Record<PianoLayerId, ChainState>;
  pianoGroup: boolean;
}

export interface OrganSectionState {
  sectionOn: boolean;
  focus: OrganLayerId;
  layers: Record<OrganLayerId, OrganLayerState>;
  chain: ChainState;
  /** ORGAN button in the Rotary group routes organ to the shared rotary. */
  organRotary: boolean;
}

export interface SynthSectionState {
  sectionOn: boolean;
  focus: SynthLayerId;
  group: boolean;
  layers: Record<SynthLayerId, SynthLayerState>;
  chains: Record<SynthLayerId, ChainState>;
}

export interface InstrumentProgram {
  name: string;
  piano: PianoSectionState;
  organ: OrganSectionState;
  synth: SynthSectionState;
  split: SplitState;
  zones: {
    piano: Record<PianoLayerId, ZoneRange>;
    organ: Record<OrganLayerId, ZoneRange>;
    synth: Record<SynthLayerId, ZoneRange>;
  };
  scenes: { I: EnableMap; II: EnableMap };
  morphs: MorphAssignments;
  clockBpm: number;
  kbSync: boolean;
  transpose: number;
}

export function defaultPianoSection(): PianoSectionState {
  return {
    sectionOn: true,
    layerFocus: 'A',
    layers: { A: defaultLayerPiano(), B: defaultLayerPiano({ enabled: false, level: 0 }) },
    chains: { A: defaultChain(), B: defaultChain() },
    pianoGroup: false,
  };
}

export function defaultOrganSection(): OrganSectionState {
  return {
    sectionOn: true,
    focus: 'A',
    layers: { A: defaultOrganLayer(), B: defaultOrganLayer({ enabled: false, level: 0 }) },
    chain: defaultChain(),
    organRotary: true,
  };
}

export function defaultSynthSection(): SynthSectionState {
  return {
    sectionOn: true,
    focus: 'A',
    group: false,
    layers: {
      A: defaultSynthLayer(),
      B: defaultSynthLayer({ enabled: false, level: 0 }),
      C: defaultSynthLayer({ enabled: false, level: 0 }),
    },
    chains: { A: defaultChain(), B: defaultChain(), C: defaultChain() },
  };
}

export function defaultProgram(name: string): InstrumentProgram {
  return {
    name,
    piano: defaultPianoSection(),
    organ: defaultOrganSection(),
    synth: defaultSynthSection(),
    split: defaultSplit(),
    zones: {
      piano: { A: fullZone(), B: fullZone() },
      organ: { A: fullZone(), B: fullZone() },
      synth: { A: fullZone(), B: fullZone(), C: fullZone() },
    },
    scenes: { I: defaultEnableMap(), II: defaultEnableMap() },
    morphs: { wheel: [], pedal: [] },
    clockBpm: 120,
    kbSync: false,
    transpose: 0,
  };
}

export function cloneProgram(p: InstrumentProgram): InstrumentProgram {
  return JSON.parse(JSON.stringify(p)) as InstrumentProgram;
}

// --- Factory content (≥8 programs: piano, organ, synth, split, layered) ------

function pianoOnly(name: string, type: PianoTypeId, extra?: (p: InstrumentProgram) => void): InstrumentProgram {
  const p = defaultProgram(name);
  p.piano.layers.A = { ...p.piano.layers.A, enabled: true, type, model: 0, level: 8 };
  p.piano.layers.B = { ...p.piano.layers.B, enabled: false, level: 0 };
  p.organ.layers.A = { ...p.organ.layers.A, enabled: false, level: 0 };
  p.synth.layers.A = { ...p.synth.layers.A, enabled: false, level: 0 };
  p.scenes.I = { ...defaultEnableMap(), pianoA: true, organA: false, synthA: false };
  p.scenes.II = { ...defaultEnableMap(), pianoA: true, organA: false, synthA: false };
  extra?.(p);
  return p;
}

export function factoryPrograms(): InstrumentProgram[] {
  const out: InstrumentProgram[] = [];
  // 1.1 Stage Grand — plain piano.
  out.push(pianoOnly('Stage Grand', 'grand'));
  // 1.2 Upright Ballad — upright with hall reverb.
  out.push(
    pianoOnly('Upright Ballad', 'upright', (p) => {
      p.piano.chains.A = { ...p.piano.chains.A, reverb: { ...p.piano.chains.A.reverb, on: true, type: 'hall', wet: 5 } };
    }),
  );
  // 1.3 Tine Stack — electric + digital layered, chorus.
  out.push(
    pianoOnly('Tine Stack', 'electric', (p) => {
      p.piano.layers.B = { ...p.piano.layers.B, enabled: true, type: 'digital', model: 0, level: 6 };
      p.piano.chains.A = { ...p.piano.chains.A, mod2: { ...p.piano.chains.A.mod2, on: true, type: 'chorus', rate: 3, amount: 4 } };
      p.scenes.I = { ...p.scenes.I, pianoB: true };
      p.scenes.II = { ...p.scenes.II, pianoB: true };
    }),
  );
  // 1.4 B3 Soul — B3 with rotary, percussion, C3.
  {
    const p = defaultProgram('B3 Soul');
    p.piano.layers.A = { ...p.piano.layers.A, enabled: false, level: 0 };
    p.organ.layers.A = {
      ...p.organ.layers.A,
      enabled: true,
      model: 'B3',
      level: 8,
      drawbars: [8, 6, 8, 8, 6, 4, 2, 2, 4],
      percussion: { ...p.organ.layers.A.percussion, on: true, soft: false, fast: true, third: false },
      vibChorus: 'C3',
      vibOn: true,
    };
    p.organ.organRotary = true;
    p.scenes.I = { ...defaultEnableMap(), pianoA: false, organA: true };
    p.scenes.II = { ...defaultEnableMap(), pianoA: false, organA: true };
    out.push(p);
  }
  // 1.5 Vox Farf Split — Vox lower / Farf upper at Mid C4.
  {
    const p = defaultProgram('Vox Farf Split');
    p.piano.layers.A = { ...p.piano.layers.A, enabled: false, level: 0 };
    p.organ.layers.A = { ...p.organ.layers.A, enabled: true, model: 'Vox', level: 8 };
    p.organ.layers.B = { ...p.organ.layers.B, enabled: true, model: 'Farf', level: 8 };
    p.split = { ...defaultSplit(), on: true, mid: { active: true, pos: 'C4', xfade: 0 } };
    p.zones.organ = { A: { lo: 0, hi: 1 }, B: { lo: 2, hi: 3 } };
    p.scenes.I = { ...defaultEnableMap(), pianoA: false, organA: true, organB: true };
    p.scenes.II = { ...defaultEnableMap(), pianoA: false, organA: true, organB: true };
    out.push(p);
  }
  // 1.6 Analog Brass — Super Saw through LP24.
  {
    const p = defaultProgram('Analog Brass');
    p.piano.layers.A = { ...p.piano.layers.A, enabled: false, level: 0 };
    p.synth.layers.A = {
      ...p.synth.layers.A,
      enabled: true,
      wave: 'Super Saw',
      oscCtrl: 5,
      filterType: 'LP24',
      filterFreq: 6,
      filterRes: 3,
      filterEnvAmt: 4,
      ampEnv: { attack: 1, decay: 5, release: 3 },
      ampSustain: 8,
      level: 8,
    };
    p.scenes.I = { ...defaultEnableMap(), pianoA: false, synthA: true };
    p.scenes.II = { ...defaultEnableMap(), pianoA: false, synthA: true };
    out.push(p);
  }
  // 1.7 Arp Motion — clock-synced 16th arpeggiator.
  {
    const p = defaultProgram('Arp Motion');
    p.piano.layers.A = { ...p.piano.layers.A, enabled: false, level: 0 };
    p.synth.layers.A = {
      ...p.synth.layers.A,
      enabled: true,
      wave: 'Multi Saw',
      oscCtrl: 4,
      filterType: 'LP12',
      filterFreq: 7,
      arp: { mode: 'Arp', rate: 5, sync: true, subdiv: '1/16', range: 2, direction: 'Up', hold: true, run: true },
      level: 8,
    };
    p.clockBpm = 120;
    p.scenes.I = { ...defaultEnableMap(), pianoA: false, synthA: true };
    p.scenes.II = { ...defaultEnableMap(), pianoA: false, synthA: true };
    out.push(p);
  }
  // 1.8 Full Stage — piano + B3 + pad across a split, wheel morph on filter.
  {
    const p = defaultProgram('Full Stage');
    p.piano.layers.A = { ...p.piano.layers.A, enabled: true, type: 'grand', level: 7 };
    p.organ.layers.B = {
      ...p.organ.layers.B,
      enabled: true,
      model: 'B3',
      level: 6,
      drawbars: [8, 8, 8, 6, 4, 4, 2, 0, 2],
    };
    p.synth.layers.C = {
      ...p.synth.layers.C,
      enabled: true,
      wave: 'Sine',
      filterType: 'LP12',
      filterFreq: 4,
      ampEnv: { attack: 3, decay: 6, release: 4 },
      ampSustain: 8,
      level: 6,
    };
    p.split = { ...defaultSplit(), on: true, mid: { active: true, pos: 'F3', xfade: 6 } };
    p.zones.piano = { A: fullZone(), B: fullZone() };
    p.zones.organ = { A: fullZone(), B: { lo: 0, hi: 1 } };
    p.zones.synth = { A: fullZone(), B: fullZone(), C: { lo: 2, hi: 3 } };
    p.morphs = {
      wheel: [{ target: 'synth.C.filterFreq', start: 4, end: 9 }],
      pedal: [],
    };
    p.scenes.I = { ...defaultEnableMap(), pianoA: true, organA: false, organB: true, synthA: false, synthC: true };
    p.scenes.II = { ...p.scenes.I, organB: false, synthC: false, synthA: false, pianoA: true };
    out.push(p);
  }
  return out;
}

// --- Unsupported (spec-excluded) controls ------------------------------------

export interface UnsupportedEntry {
  id: string;
  label: string;
  reason: string;
}

/**
 * Every spec-excluded control: it exists visually, moves/presses, and is
 * listed here (rendered in the UI notes strip). Source specs in `reason`.
 */
export const UNSUPPORTED_CONTROLS: UnsupportedEntry[] = [
  { id: 'program-morph-3', label: 'Aftertouch morph', reason: 'programs spec excluded: no aftertouch on browser keyboards; stays decorative.' },
  { id: 'menu:preset-library', label: 'Organ/Piano/Synth preset library', reason: 'programs spec excluded (cut benchmark-wide); use Store/Store As on programs instead.' },
  { id: 'menu:banks-2plus', label: 'Banks beyond one / 512-program layout / Organize swap-move', reason: 'programs spec excluded: one bank of 32 programs.' },
  { id: 'menu:num-pad', label: 'Num Pad mode', reason: 'programs spec excluded (manual p. 43-44).' },
  { id: 'menu:monitor-copy-paste', label: 'Monitor/Copy/Paste/Swap', reason: 'programs spec excluded (manual p. 43-44).' },
  { id: 'menu:section-edit', label: 'Section Edit', reason: 'programs spec excluded (manual p. 43-44).' },
  { id: 'menu:layer-init', label: 'Layer Init', reason: 'programs spec excluded (manual p. 43-44).' },
  { id: 'menu:auxkb-extern', label: 'Aux KB / Extern', reason: 'programs + synth specs excluded (manual ch. 8).' },
  { id: 'menu:shift-menus', label: 'System/Sound/Organize/Output/Pedal/MIDI Shift-menus + memory protection', reason: 'programs spec excluded (manual p. 44, 57-63).' },
  { id: 'menu:ext-clock', label: 'External MIDI clock sync + pedal tap', reason: 'programs spec excluded (manual p. 40); Master Clock is internal only.' },
  { id: 'menu:prog-view-modes', label: 'Prog View multi-modes (extra credit)', reason: 'programs spec optional; the display shows slot, name, and edit state.' },
  { id: 'menu:categories', label: 'Alphabetic list sorting / program categories', reason: 'programs spec optional; the list view is numeric.' },
  { id: 'organ:drawbar-live', label: 'Preset/Drawbar Live modes + drawbar sync', reason: 'organ spec excluded: virtual drawbars always show live values.' },
  { id: 'organ:swell', label: 'Swell pedal input', reason: 'organ spec excluded (manual p. 21-22).' },
  { id: 'organ:tonewheel', label: 'Tonewheel wear modes / keyboard trigger point / Sound-menu rotary tuning', reason: 'organ spec excluded (manual p. 58).' },
  { id: 'synth:extern', label: 'Synth Extern mode + MIDI-out', reason: 'synth spec excluded (manual ch. 8).' },
  { id: 'synth:arp-pattern', label: 'Arpeggiator pattern editing / zig-zag / accent / pan / per-layer KB Hold exclude', reason: 'synth spec excluded (manual p. 35-36).' },
  { id: 'synth:groups', label: 'Filter/LFO/Arp Group modes', reason: 'synth spec excluded (manual p. 32, 34, 35); FX group modes for chains are supported instead.' },
  { id: 'synth:samples', label: 'Samples mode + bundled sample set / Sub Osc / Shape / Wave / Misc categories / FM Inharmonic / LP M / LP+HP / Sound Init', reason: 'synth spec optional extras; Analog + FM-H ship instead.' },
  { id: 'piano:excluded', label: 'Pedal noise / half-pedaling / Triple Pedal config / size classes / INFO / downloads / piano preset library', reason: 'piano spec excluded (manual p. 25-26).' },
  { id: 'fx:excluded', label: 'Per-type Variations / Reverb Chorale / delay loop FX + Analog / Pump-Wah pedal modes / rotary close mic + stop angle / post-rotary reverb', reason: 'effects spec excluded (manual p. 49-53).' },
];
