/**
 * Factory content: 32 program slots and the 8 Live slots (copies of the first eight programs, manual p. 13).
 * Program 1.1 mirrors the panel's initial control values (src/hardware/controls.ts) so the sealed Phase 1/2 panel
 * state is exactly what a fresh instrument shows. The other programs demonstrate piano, organ, synth, split, layered,
 * morphed and scene setups (programs spec `storage.factoryContent`). Without the sample library (tests, generated-only
 * mode) every piano layer uses the generated Additive Piano — truthfully labelled, never called a recording.
 */
import { GENERATED_MODEL_ID, defaultPianoSettings } from '../audio/engine'
import { DEFAULT_MODEL_ID } from '../audio/pianoModels'
import { defaultEffectsState, type ChainSettings } from './instrumentState'
import { defaultOrganState, defaultSplit, defaultSynthState, defaultZones, emptyEnables, sceneEnables, type ProgramState } from './programState'

type Patch = (p: ProgramState) => ProgramState

function pianoModel(library: boolean, id: string): string {
  return library ? id : GENERATED_MODEL_ID
}

/** The initialised program: panel defaults, Piano A on, everything else at its printed default. */
export function initProgram(library: boolean, name = 'Init Grand'): ProgramState {
  const piano = defaultPianoSettings(library)
  const program: ProgramState = {
    name,
    piano: { ...piano, focus: 'A' },
    organ: defaultOrganState(),
    synth: { ...defaultSynthState(), on: false },
    effects: defaultEffectsState(),
    rotary: { speed: 0, stop: false, drive: 2, organ: false },
    split: defaultSplit(),
    zones: defaultZones(),
    scenes: { active: 'I', other: emptyEnables() },
    morph: { wheel: [], pedal: [] },
    clock: { bpm: 120, kbSync: false },
    transpose: { on: false, semitones: 0 },
  }
  // Scene II starts as a copy of scene I so switching scenes on a fresh program changes nothing audible.
  return { ...program, scenes: { active: 'I', other: sceneEnables(program) } }
}

function chain(patch: Partial<{ [K in keyof ChainSettings]: Partial<ChainSettings[K]> }>): (c: ChainSettings) => ChainSettings {
  return (c) => {
    const out = { ...c }
    for (const key of Object.keys(patch) as (keyof ChainSettings)[]) (out as Record<string, unknown>)[key] = { ...c[key], ...patch[key] }
    return out
  }
}

function make(library: boolean, name: string, ...patches: Patch[]): ProgramState {
  let p = initProgram(library, name)
  for (const patch of patches) p = patch(p)
  return { ...p, scenes: p.scenes.active === 'I' && patches.length === 0 ? p.scenes : p.scenes }
}

/** Sets scene II from the current live enables unless a patch defined it explicitly. */
const withSceneCopy: Patch = (p) => ({ ...p, scenes: { active: 'I', other: sceneEnables(p) } })

export function createFactoryBank(library: boolean): { programs: ProgramState[]; live: ProgramState[] } {
  const grand = pianoModel(library, DEFAULT_MODEL_ID)
  const upright = pianoModel(library, 'upright-kw')
  const wurli = pianoModel(library, 'electric-wurlitzer-200')
  const cp80 = pianoModel(library, 'electric-cp80')
  const harpsi = pianoModel(library, 'clav-harpsichord')
  const marimba = pianoModel(library, 'misc-marimba')

  const programs: ProgramState[] = [
    // 1.1 — the panel defaults (Piano A, Grand)
    make(library, 'Init Grand'),
    // 1.2 — electric piano with tremolo and a Twin amp
    make(library, 'Wurli Tremolo', (p) => ({
      ...p,
      piano: { ...p.piano, layers: { ...p.piano.layers, A: { ...p.piano.layers.A, modelId: wurli, timbre: 1 } } },
      effects: { ...p.effects, chains: { ...p.effects.chains, pianoA: chain({ mod1: { on: true, type: 1, rate: 5.5, amount: 6 }, amp: { on: true, model: 3, drive: 2.5 }, reverb: { on: true, type: 0, dryWet: 3 } })(p.effects.chains.pianoA) } },
    }), withSceneCopy),
    // 1.3 — B3 with percussion, chorus and the rotary
    make(library, 'B3 Soulful', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      organ: { ...p.organ, on: true, vibratoMode: 5, percussion: { on: true, soft: false, fast: true, third: true, poly: false }, layers: { A: { ...p.organ.layers.A, on: true, model: 0, drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], vibrato: true }, B: { ...p.organ.layers.B, on: true, model: 0, drawbars: [8, 6, 8, 6, 4, 0, 0, 0, 2], vibrato: false, octave: -1 } } },
      rotary: { ...p.rotary, organ: true, speed: 0 },
      effects: { ...p.effects, focus: 'organ', chains: { ...p.effects.chains, organ: chain({ reverb: { on: true, type: 3, dryWet: 3 } })(p.effects.chains.organ) } },
      morph: { wheel: [{ path: 'rotary.speed', start: 0, end: 1 }], pedal: [] },
    }), withSceneCopy),
    // 1.4 — Vox with vibrato
    make(library, 'Vox Combo', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      organ: { ...p.organ, on: true, vibratoMode: 4, layers: { A: { ...p.organ.layers.A, on: true, model: 1, drawbars: [8, 8, 6, 4, 5, 3, 0, 0, 5], vibrato: true }, B: { ...p.organ.layers.B, on: false, model: 1 } } },
      effects: { ...p.effects, focus: 'organ', chains: { ...p.effects.chains, organ: chain({ amp: { on: true, model: 1, drive: 3 }, reverb: { on: true, type: 2, dryWet: 4 } })(p.effects.chains.organ) } },
    }), withSceneCopy),
    // 1.5 — Farfisa registers
    make(library, 'Farf Buzz', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      organ: { ...p.organ, on: true, vibratoMode: 0, layers: { A: { ...p.organ.layers.A, on: true, model: 2, drawbars: [8, 0, 8, 0, 8, 8, 0, 8, 0], vibrato: true }, B: { ...p.organ.layers.B, on: false, model: 2 } } },
      effects: { ...p.effects, focus: 'organ', chains: { ...p.effects.chains, organ: chain({ mod2: { on: true, type: 0, rate: 3, amount: 5 }, reverb: { on: true, type: 3, dryWet: 4 } })(p.effects.chains.organ) } },
    }), withSceneCopy),
    // 1.6 — Pipe organ in a cathedral
    make(library, 'Pipe Chapel', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      organ: { ...p.organ, on: true, vibratoMode: 1, layers: { A: { ...p.organ.layers.A, on: true, model: 3, drawbars: [8, 0, 8, 6, 0, 4, 0, 0, 2], vibrato: true }, B: { ...p.organ.layers.B, on: true, model: 4, drawbars: [0, 0, 8, 5, 0, 3, 0, 0, 0], level: 60 } } },
      effects: { ...p.effects, focus: 'organ', chains: { ...p.effects.chains, organ: chain({ reverb: { on: true, type: 5, dryWet: 7, tone: 2 } })(p.effects.chains.organ) } },
    }), withSceneCopy),
    // 1.7 — Super Saw pad with a wheel morph on the filter
    make(library, 'Super Saw Pad', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      synth: { ...p.synth, on: true, layers: { ...p.synth.layers, A: { ...p.synth.layers.A, on: true, wave: { type: 0, category: 3, index: 0, partial: 1 }, oscCtrl: 5, unison: 2, filter: { ...p.synth.layers.A.filter, type: 1, freq: 4.5, res: 2.5, envAmount: 4 }, ampEnv: { attack: 70, decay: 127, release: 90, velocity: 1 }, filterEnv: { attack: 60, decay: 100, release: 90, velocity: false }, lfo: { wave: 0, rate: 2.5, sync: false, amount: 2, destination: 2 } } } },
      effects: { ...p.effects, focus: 'synth', chains: { ...p.effects.chains, synthA: chain({ mod2: { on: true, type: 0, rate: 2.5, amount: 5 }, reverb: { on: true, type: 4, dryWet: 6 } })(p.effects.chains.synthA) } },
      morph: { wheel: [{ path: 'synth.layers.A.filter.freq', start: 4.5, end: 9 }], pedal: [] },
    }), withSceneCopy),
    // 1.8 — mono legato sync lead with glide
    make(library, 'Sync Lead', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      synth: { ...p.synth, on: true, layers: { ...p.synth.layers, A: { ...p.synth.layers.A, on: true, wave: { type: 0, category: 1, index: 0, partial: 1 }, oscCtrl: 3, voice: { mode: 2, priority: 0, glide: 4 }, filter: { ...p.synth.layers.A.filter, type: 0, freq: 7, res: 3, envAmount: 5 }, oscEnv: { attack: 0, decay: 80, release: 40, velocity: true, toPitch: false, amount: 6 }, ampEnv: { attack: 2, decay: 127, release: 30, velocity: 2 }, vibrato: { mode: 1, rate: 5.5, amount: 6, delay: 1 } } } },
      effects: { ...p.effects, focus: 'synth', chains: { ...p.effects.chains, synthA: chain({ delay: { on: true, tempo: 5, feedback: 4, dryWet: 3, sync: true }, reverb: { on: true, type: 3, dryWet: 3 } })(p.effects.chains.synthA) } },
      morph: { wheel: [], pedal: [{ path: 'synth.layers.A.oscCtrl', start: 3, end: 8 }] },
    }), withSceneCopy),
    // 2.1 — split: synth bass below C4, electric piano above, ±6 crossfade
    make(library, 'Bass / EP Split', (p) => ({
      ...p,
      piano: { ...p.piano, focus: 'B', layers: { A: { ...p.piano.layers.A, on: false }, B: { ...p.piano.layers.B, on: true, level: 85, modelId: cp80 } } },
      synth: { ...p.synth, on: true, layers: { ...p.synth.layers, A: { ...p.synth.layers.A, on: true, wave: { type: 0, category: 0, index: 2, partial: 1 }, voice: { mode: 1, priority: 1, glide: 0 }, octave: -1, filter: { ...p.synth.layers.A.filter, type: 1, freq: 4, res: 3, envAmount: 6 }, ampEnv: { attack: 0, decay: 100, release: 30, velocity: 2 } } } },
      split: { on: true, points: { low: { note: null, xfade: 0 }, mid: { note: 60, xfade: 6 }, high: { note: null, xfade: 0 } } },
      zones: { ...p.zones, synthA: { from: 1, to: 2 }, pianoB: { from: 3, to: 4 } },
    }), withSceneCopy),
    // 2.2 — grand layered with a pad; the wheel fades the pad in
    make(library, 'Grand + Pad', (p) => ({
      ...p,
      synth: { ...p.synth, on: true, layers: { ...p.synth.layers, A: { ...p.synth.layers.A, on: true, level: 0, wave: { type: 0, category: 2, index: 1, partial: 1 }, oscCtrl: 4, filter: { ...p.synth.layers.A.filter, type: 1, freq: 4, res: 1, envAmount: 2 }, ampEnv: { attack: 80, decay: 127, release: 95, velocity: 1 } } } },
      morph: { wheel: [{ path: 'synth.layers.A.level', start: 0, end: 70 }], pedal: [] },
      effects: { ...p.effects, chains: { ...p.effects.chains, synthA: chain({ reverb: { on: true, type: 4, dryWet: 7 } })(p.effects.chains.synthA) } },
    }), withSceneCopy),
    // 2.3 — arpeggiated pluck synced to the Master Clock with a synced delay
    make(library, 'Arp Pluck', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      synth: { ...p.synth, on: true, kbHold: true, layers: { ...p.synth.layers, A: { ...p.synth.layers.A, on: true, wave: { type: 0, category: 0, index: 3, partial: 1 }, filter: { ...p.synth.layers.A.filter, type: 1, freq: 3.5, res: 4, envAmount: 6 }, filterEnv: { attack: 0, decay: 55, release: 40, velocity: true }, ampEnv: { attack: 0, decay: 60, release: 35, velocity: 2 }, arp: { run: true, mode: 0, rate: 5, sync: true, range: 2, direction: 2, kbHold: true, kbSync: true } } } },
      clock: { bpm: 118, kbSync: true },
      effects: { ...p.effects, focus: 'synth', chains: { ...p.effects.chains, synthA: chain({ delay: { on: true, tempo: 6, feedback: 5, dryWet: 4, sync: true, pingPong: true }, reverb: { on: true, type: 3, dryWet: 3 } })(p.effects.chains.synthA) } },
    }), withSceneCopy),
    // 2.4 — scenes: I = piano, II = piano + B3 (Layer Scene II adds the organ)
    make(library, 'Scene Piano/B3', (p) => {
      const base: ProgramState = { ...p, organ: { ...p.organ, on: false, layers: { A: { ...p.organ.layers.A, on: true, model: 0, drawbars: [8, 8, 8, 5, 0, 0, 0, 0, 0], vibrato: true }, B: { ...p.organ.layers.B, on: false } } }, rotary: { ...p.rotary, organ: true } }
      const sceneII = sceneEnables(base)
      sceneII.sections.organ = true
      return { ...base, scenes: { active: 'I', other: sceneII } }
    }),
    // 2.5 — FM bells
    make(library, 'FM Bells', (p) => ({
      ...p,
      piano: { ...p.piano, on: false },
      synth: { ...p.synth, on: true, layers: { ...p.synth.layers, A: { ...p.synth.layers.A, on: true, wave: { type: 1, category: 0, index: 0, partial: 6 }, oscCtrl: 4, oscEnv: { attack: 0, decay: 90, release: 60, velocity: true, toPitch: false, amount: -7 }, filter: { ...p.synth.layers.A.filter, on: false }, ampEnv: { attack: 0, decay: 110, release: 100, velocity: 2 } } } },
      effects: { ...p.effects, focus: 'synth', chains: { ...p.effects.chains, synthA: chain({ delay: { on: true, tempo: 4, feedback: 4, dryWet: 3 }, reverb: { on: true, type: 4, dryWet: 6 } })(p.effects.chains.synthA) } },
    }), withSceneCopy),
    // 2.6 — upright in a small room
    make(library, 'Upright Room', (p) => ({
      ...p,
      piano: { ...p.piano, layers: { ...p.piano.layers, A: { ...p.piano.layers.A, modelId: upright, kbTouch: 2, softRelease: true } } },
      effects: { ...p.effects, chains: { ...p.effects.chains, pianoA: chain({ reverb: { on: true, type: 0, dryWet: 4 }, comp: { on: true, amount: 3 } })(p.effects.chains.pianoA) } },
    }), withSceneCopy),
    // 2.7 — harpsichord with a phaser
    make(library, 'Harpsi Phase', (p) => ({
      ...p,
      piano: { ...p.piano, layers: { ...p.piano.layers, A: { ...p.piano.layers.A, modelId: harpsi, softRelease: false, stringRes: false } } },
      effects: { ...p.effects, chains: { ...p.effects.chains, pianoA: chain({ mod2: { on: true, type: 2, rate: 2, amount: 5 }, reverb: { on: true, type: 1, dryWet: 3 } })(p.effects.chains.pianoA) } },
    }), withSceneCopy),
    // 2.8 — marimba with a transposition and a synced delay
    make(library, 'Marimba Echo', (p) => ({
      ...p,
      piano: { ...p.piano, layers: { ...p.piano.layers, A: { ...p.piano.layers.A, modelId: marimba, unison: 1 } } },
      transpose: { on: true, semitones: -2 },
      clock: { bpm: 96, kbSync: false },
      effects: { ...p.effects, chains: { ...p.effects.chains, pianoA: chain({ delay: { on: true, tempo: 5, feedback: 5, dryWet: 4, sync: true }, reverb: { on: true, type: 3, dryWet: 3 } })(p.effects.chains.pianoA) } },
    }), withSceneCopy),
  ]
  const grandInit = make(library, 'Init Grand', (p) => ({ ...p, piano: { ...p.piano, layers: { ...p.piano.layers, A: { ...p.piano.layers.A, modelId: grand } } } }), withSceneCopy)
  while (programs.length < 32) programs.push({ ...grandInit, name: `Init ${Math.floor(programs.length / 8) + 1}.${(programs.length % 8) + 1}` })
  const live = programs.slice(0, 8).map((p) => ({ ...p }))
  return { programs, live }
}
