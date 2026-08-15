/**
 * Phase 3 — canonical, serializable program state for the Nord Stage 4 (73).
 *
 * Everything a Program carries is declared here as plain JSON-able data: the
 * Piano (2 layers + chains), Organ (2 layers sharing one effect chain +
 * drawbars/percussion/vibrato/rotary), Synth (3 layers + independent chains),
 * splits/zones/crossfades, zone assignments, Layer Scenes I/II (enable masks
 * only — sound parameters are shared), morph assignments (Wheel + Control
 * Pedal), and the master clock tempo together with Transpose.
 *
 * Master Level is deliberately excluded (spec: programState.excludes).
 * The shape is the round-trip contract: storing/reloading a program must
 * restore every field here.
 */

import type { LayerChainState } from '../audio/chain'
import type { PianoType } from '../audio/samples'

/* ------------------------------------------------------------------ *
 * Piano
 * ------------------------------------------------------------------ */

export interface PianoLayerState {
  enabled: boolean
  focus: boolean
  level: number
  octave: number // semitones (-12, 0, 12)
  sustped: boolean
  pstick: boolean
  type: PianoType
  kbTouch: number // 0 Heavy, 1 Medium, 2 Light
  dynComp: number // 0..3
  timbre: number // 0..1
  unison: number // 0..3
  softRelease: boolean
  stringRes: boolean
}

export interface PianoState {
  sectionOn: boolean
  layers: [PianoLayerState, PianoLayerState]
  chains: [LayerChainState, LayerChainState]
}

/* ------------------------------------------------------------------ *
 * Organ — two layers, one shared effect chain.
 * ------------------------------------------------------------------ */

export type OrganModel = 'B3' | 'Bass' | 'Vox' | 'Farf' | 'Pipe1' | 'Pipe2'

export interface OrganLayerState {
  enabled: boolean
  focus: boolean
  level: number
  octave: number
  /** per-layer model — layers A and B may differ simultaneously. */
  model: OrganModel
  sustped: boolean
  /** per-layer vibrato/chorus on/off (B3). */
  vibratoOn: boolean
}

export interface OrganState {
  sectionOn: boolean
  layers: [OrganLayerState, OrganLayerState]
  /** both layers share ONE effect chain. */
  chain: LayerChainState
  /** nine drawbars, integer 0..8. */
  drawbars: [number, number, number, number, number, number, number, number, number]
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean }
  keyClick: boolean
  /** vibrato/chorus selector 0..5 → C1 C2 C3 V1 V2 V3. */
  vibratoChorus: number
  /** route organ into the shared Rotary. */
  toRotary: boolean
  /** shared rotary target: 0 slow, 1 fast, 2 stop (per-program state). */
  rotarySpeed: number
  /** shared rotary drive 0..1. */
  rotaryDrive: number
}

/* ------------------------------------------------------------------ *
 * Synth — three layers, each with its own effect chain.
 * ------------------------------------------------------------------ */

export type SynthCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'

export type SynthFilterType = 0 | 1 | 2 | 3 // LP12 LP24 HP BP

export type SynthVoiceMode = 0 | 1 | 2 // Poly Mono Legato

export type SynthEnvelope = { a: number; d: number; r: number; velocity: boolean; amount: number }

export type LfoWaveform = 0 | 1 | 2 | 3 | 4 // Triangle SawDown SawUp Square SampleHold
export type LfoDestination = 0 | 1 | 2 // OscPitch OscCtrl FilterFreq

export type ArpMode = 0 | 1 | 2 // Arp Poly Gate
export type ArpDirection = 0 | 1 | 2 | 3 // Up Down UpDown Random

export interface SynthLayerState {
  enabled: boolean
  focus: boolean
  level: number
  octave: number
  category: SynthCategory
  /** waveform index within the category's list. */
  wave: number
  oscCtrl: number // 0..10 → category-specific behaviour
  oscOctave: number // -2..2
  oscFine: number // cents -50..50
  filterType: SynthFilterType
  cutoff: number // 0..1
  res: number // 0..1
  filterEnvAmt: number // -1..1
  keytrack: number // -1..1
  drive: number // 0..3 (Off,1,2,3)
  envOsc: SynthEnvelope
  envFilt: SynthEnvelope
  envAmp: SynthEnvelope
  lfo: { wave: LfoWaveform; rate: number; dest: LfoDestination; modAmt: number; sync: boolean }
  voice: { mode: SynthVoiceMode; priority: number; glide: number; unison: number; vibratoOn: boolean; vibratoAmount: number }
  arp: { mode: ArpMode; rate: number; range: number; direction: ArpDirection; hold: boolean; run: boolean; sync: boolean }
}

export interface SynthState {
  sectionOn: boolean
  layers: [SynthLayerState, SynthLayerState, SynthLayerState]
  /** one chain per layer (fully independent). */
  chains: [LayerChainState, LayerChainState, LayerChainState]
}

/* ------------------------------------------------------------------ *
 * Splits, Zones, Scenes, Morphs, Clock, Transpose
 * ------------------------------------------------------------------ */

/** Layer reference used for zone/scene/morph targeting. */
export type LayerRef =
  | 'piano.A' | 'piano.B'
  | 'organ.A' | 'organ.B'
  | 'synth.A' | 'synth.B' | 'synth.C'

export const ALL_LAYER_REFS: readonly LayerRef[] = [
  'piano.A', 'piano.B', 'organ.A', 'organ.B', 'synth.A', 'synth.B', 'synth.C',
]

/** Contiguous zone range a layer is assigned to (0..3); 0 means "global"/full. */
export type ZoneRange = { low: number; high: number } | 'full'

export interface SplitState {
  on: boolean
  points: { low: number; mid: number; high: number } // midi notes
  /** per-split-point crossfade width in semitones: 0, 6, or 12. */
  crossfade: { low: number; mid: number; high: number }
  /** zone assignment per layer. */
  zones: Partial<Record<LayerRef, ZoneRange>>
}

export interface SceneState {
  active: 'I' | 'II'
  /** per-scene layer enable masks (only enable state differs between scenes). */
  I: Partial<Record<LayerRef, boolean>>
  II: Partial<Record<LayerRef, boolean>>
}

/** A morph destination: a state path moved from `from` to `to` as the source
 *  goes 0 → 1. `path` uses dot notation into the program state (e.g.
 *  "synth.layers.0.lfo.rate"). */
export interface MorphAssignment {
  path: string
  from: number
  to: number
}

export interface MorphState {
  wheel: MorphAssignment[]
  pedal: MorphAssignment[]
}

export interface ClockState {
  tempo: number // BPM 30..300
  sync: boolean // LFO/arp/delay/mod1 lock to master clock
  kbSync: boolean // keyboard sync (re-trigger LFOs on note)
}

/* ------------------------------------------------------------------ *
 * The Program
 * ------------------------------------------------------------------ */

export interface ProgramState {
  name: string
  piano: PianoState
  organ: OrganState
  synth: SynthState
  split: SplitState
  scenes: SceneState
  morph: MorphState
  clock: ClockState
  transpose: number // -6..6
}

/** unsupported (spec-excluded) controls text, kept in one place for the audit. */
export const UNSUPPORTED = [
  'Banks beyond one (32 stored programs only); Organize swap/move',
  'Organ/Piano/Synth preset library',
  'Aftertouch morph source (A.T. decorative)',
  'Num Pad, Monitor/Copy/Paste/Swap, Section Edit, Layer Init',
  'Aux KB, Extern, memory protection, all Shift-menus',
  'External MIDI clock sync and pedal tap',
  'Percussion poly mode, Swell pedal input',
  'Arpeggiator pattern editing, zig-zag, accent, pan, per-layer KB hold',
  'Filter/LFO/Arp Group modes, Synth preset library',
] as const
