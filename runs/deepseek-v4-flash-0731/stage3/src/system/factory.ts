/**
 * Defaults and factory programs for the Nord Stage 4 (73).
 *
 * `defaultProgramState()` returns a sensible, fully-stored starting program
 * (Piano lead, Organ B3, a layering synth) with truthful default control
 * positions throughout. `factoryPrograms()` ships the required "at least 8
 * stored factory programs demonstrating piano, organ, synth, split, and
 * layered setups".
 */

import type {
  LayerRef, MorphAssignment, OrganModel, OrganState, PianoLayerState, PianoState,
  ProgramState, SceneState, SplitState, SynthLayerState, SynthState,
} from './program'
import { ALL_LAYER_REFS } from './program'
import type { LayerChainState } from '../audio/chain'

function allSceneEnabled(): Record<LayerRef, boolean> {
  const m = {} as Record<LayerRef, boolean>
  for (const ref of ALL_LAYER_REFS) m[ref] = true
  return m
}

export function defaultScene(): SceneState {
  return {
    active: 'I',
    I: allSceneEnabled(),
    II: allSceneEnabled(),
  }
}

export function defaultSplit(): SplitState {
  return {
    on: false,
    points: { low: 48, mid: 60, high: 72 }, // C3 / C4 / C5
    crossfade: { low: 0, mid: 0, high: 0 },
    zones: { 'organ.A': 'full', 'synth.B': 'full' },
  }
}

function baseChain(): LayerChainState {
  return {
    on: { mod1: false, mod2: false, delay: false, ampEq: true, compressor: false, reverb: false },
    params: {
      mod1: { type: 0, rate: 0.3, amount: 0.4 },
      mod2: { type: 0, rate: 0.3, amount: 0.4 },
      delay: { rate: 0.3, feedback: 0.3, mix: 0.2, filter: 0 },
      ampEq: { type: 0, amount: 0.2, bass: 0.5, res: 0.5, treble: 0.5, freq: 0.5 },
      compressor: { amount: 0.3, fast: false },
      reverb: { type: 0, mix: 0.3, bright: 0.5 },
    },
    allBypass: false,
    toRotary: false,
  }
}

export function defaultPianoLayer(overrides: Partial<PianoLayerState> = {}): PianoLayerState {
  return {
    enabled: true, focus: false, level: 0.8, octave: 0, sustped: true, pstick: false,
    type: 'Grand', kbTouch: 1, dynComp: 0, timbre: 0, unison: 0, softRelease: false, stringRes: false,
    ...overrides,
  }
}

export function defaultPiano(): PianoState {
  return {
    sectionOn: true,
    layers: [defaultPianoLayer({ focus: true }), defaultPianoLayer({ enabled: false, level: 0.6, type: 'Upright' })],
    chains: [baseChain(), baseChain()],
  }
}

export function defaultOrganLayer(overrides: Partial<{ enabled: boolean; focus: boolean; level: number; octave: number; model: OrganModel; sustped: boolean; vibratoOn: boolean }> = {}): OrganState['layers'][number] {
  return { enabled: false, focus: false, level: 0.7, octave: 0, model: 'B3', sustped: true, vibratoOn: false, ...overrides }
}

export function defaultOrgan(): OrganState {
  return {
    sectionOn: true,
    layers: [defaultOrganLayer({ model: 'B3' }), defaultOrganLayer({ model: 'B3' })],
    chain: baseChain(),
    drawbars: [4, 3, 8, 6, 4, 2, 0, 0, 0],
    percussion: { on: false, soft: false, fast: true, third: true },
    keyClick: true,
    vibratoChorus: 0,
    toRotary: false,
    rotarySpeed: 0,
    rotaryDrive: 0.2,
  }
}

export function defaultSynthLayer(overrides: Partial<SynthLayerState> = {}): SynthLayerState {
  return {
    enabled: false, focus: false, level: 0.7, octave: 0,
    category: 'Pure', wave: 0, oscCtrl: 0, oscOctave: 0, oscFine: 0,
    filterType: 0, cutoff: 0.7, res: 0.15, filterEnvAmt: 0.3, keytrack: 0.5, drive: 0,
    envOsc: { a: 0.01, d: 0.25, r: 0.2, velocity: false, amount: 0 },
    envFilt: { a: 0.05, d: 0.3, r: 0.25, velocity: false, amount: 0.3 },
    envAmp: { a: 0.01, d: 0.3, r: 0.3, velocity: true, amount: 1 },
    lfo: { wave: 0, rate: 0.2, dest: 2, modAmt: 0, sync: true },
    voice: { mode: 0, priority: 0, glide: 0, unison: 0, vibratoOn: false, vibratoAmount: 0 },
    arp: { mode: 0, rate: 0.5, range: 1, direction: 0, hold: false, run: false, sync: true },
    ...overrides,
  }
}

export function defaultSynth(): SynthState {
  return {
    sectionOn: true,
    layers: [defaultSynthLayer({ focus: true }), defaultSynthLayer(), defaultSynthLayer()],
    chains: [baseChain(), baseChain(), baseChain()],
  }
}

export function defaultProgramState(name = 'A:001 Grand'): ProgramState {
  return {
    name,
    piano: defaultPiano(),
    organ: defaultOrgan(),
    synth: defaultSynth(),
    split: defaultSplit(),
    scenes: defaultScene(),
    morph: { wheel: [], pedal: [] },
    clock: { tempo: 120, sync: true, kbSync: false },
    transpose: 0,
  }
}

function assignment(path: string, from: number, to: number): MorphAssignment {
  return { path, from, to }
}

/**
 * The >8 factory programs. Each demonstrates a distinct setup: piano lead,
 * upright layers, electric, organ B3, pipe, synth (pure, super, FM), split,
 * and a layered band. They are stored in the program bank so selecting any is
 * a real round-trip of state.
 */
export function factoryPrograms(): ProgramState[] {
  const mk = (name: string, mutate: (p: ProgramState) => void): ProgramState => {
    const p = defaultProgramState(name)
    mutate(p)
    return p
  }
  return [
    mk('1.1 Grand Piano', (p) => {
      p.piano.layers[0].type = 'Grand'
      p.piano.layers[0].enabled = true
    }),
    mk('2.1 Upright Combo', (p) => {
      p.piano.layers[0].type = 'Upright'; p.piano.layers[0].level = 0.7
      p.piano.layers[1].type = 'Electric'; p.piano.layers[1].enabled = true; p.piano.layers[1].level = 0.6
    }),
    mk('2.5 Tine Stack', (p) => {
      p.piano.layers[0].type = 'Electric'; p.piano.layers[0].level = 0.8
      p.piano.layers[1].type = 'Electric'; p.piano.layers[1].enabled = true; p.piano.layers[1].octave = 12
    }),
    mk('3.2 B3 Organ', (p) => {
      p.organ.layers[0].enabled = true; p.organ.layers[0].model = 'B3'; p.organ.layers[0].vibratoOn = true
      p.organ.vibratoChorus = 2; p.organ.percussion = { on: true, soft: false, fast: true, third: true }
      p.organ.drawbars = [6, 4, 8, 6, 4, 2, 1, 0, 0]
    }),
    mk('3.4 Pipe Organ', (p) => {
      p.organ.layers[0].enabled = true; p.organ.layers[0].model = 'Pipe1'; p.organ.layers[0].level = 0.8
      p.organ.drawbars = [6, 0, 8, 0, 0, 6, 0, 4, 2]
    }),
    mk('4.1 Synth Pad', (p) => {
      p.synth.layers[0].enabled = true; p.synth.layers[0].category = 'Super'; p.synth.layers[0].wave = 0
      p.synth.layers[0].cutoff = 0.5; p.synth.layers[0].envAmp = { a: 0.3, d: 0.6, r: 0.6, velocity: true, amount: 1 }
    }),
    mk('4.4 FM Bell', (p) => {
      p.synth.layers[0].enabled = true; p.synth.layers[0].category = 'FM-H'; p.synth.layers[0].wave = 0
      p.synth.layers[0].oscCtrl = 0.6; p.synth.layers[0].envAmp = { a: 0.001, d: 0.8, r: 0.4, velocity: true, amount: 1 }
    }),
    mk('5.1 Split', (p) => {
      p.split.on = true; p.split.points.mid = 60
      p.piano.layers[0].enabled = true
      p.organ.layers[0].enabled = true; p.organ.layers[0].model = 'B3'
      // piano gets the ≥ split range, organ the < split range
      p.split.zones = { 'piano.A': { low: 1, high: 3 }, 'organ.A': { low: 0, high: 1 } }
    }),
    mk('5.5 Band Layered', (p) => {
      p.piano.layers[0].enabled = true; p.piano.layers[0].type = 'Grand'
      p.organ.layers[0].enabled = true; p.organ.layers[0].model = 'B3'
      p.synth.layers[0].enabled = true; p.synth.layers[0].category = 'Pure'; p.synth.layers[0].wave = 2 // saw
      p.split.on = true; p.split.zones = { 'piano.A': 'full', 'organ.A': 'full', 'synth.A': 'full' }
      p.morph.wheel = [assignment('synth.layers.0.lfo.modAmt', 0, 0.8), assignment('organ.layers.0.level', 0.7, 1)]
    }),
  ]
}