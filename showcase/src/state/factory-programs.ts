import type { InstrumentState, ProgramSlot, ProgramSnapshot } from './instrument'
import { SYNTH_WAVEFORMS } from './instrument'

function synthWaveformIndex(name: string): number {
  const index = SYNTH_WAVEFORMS.findIndex((w) => w.name === name)
  return index < 0 ? 0 : index
}

/**
 * Factory program content (spec: nord-stage-4.programs.json storage
 * .factoryContent — ship at least 8 stored programs demonstrating the
 * instrument). Every program is an honest snapshot of currently-functional
 * state: piano models, organ engines, synth layers/sources, effects and
 * rotary routing.
 */

/** Keys of InstrumentState captured by a program — the single source of
 *  truth for snapshots and dirty tracking (re-exported by instrument.ts). */
export const PROGRAM_SNAPSHOT_KEYS: readonly (keyof ProgramSnapshot)[] = [
  'piano',
  'layers',
  'focusedLayer',
  'organ',
  'synth',
  'chains',
  'organChain',
  'synthChains',
  'fxSection',
  'fxGroupPiano',
  'fxGroupSynth',
  'allFxOff',
  'fxGlobal',
  'rotary',
  'split',
  'scenes',
  'morph',
  'masterClock',
  'transpose',
  'kbHold',
]

export function snapshotOf(state: InstrumentState): ProgramSnapshot {
  const picked: Record<string, unknown> = {}
  for (const key of PROGRAM_SNAPSHOT_KEYS) picked[key] = state[key]
  // Plain JSON state; structuredClone is faster than the JSON round-trip and
  // this runs 40× at factory-content construction plus once per program edit.
  return structuredClone(picked) as ProgramSnapshot
}

function makeProgram(base: InstrumentState, name: string, mutate: (draft: ProgramSnapshot) => void): ProgramSlot {
  const draft = snapshotOf(base)
  mutate(draft)
  return { name, snapshot: draft }
}

export function buildFactoryContent(base: InstrumentState): { bank: ProgramSlot[]; live: ProgramSlot[] } {
  const bank: ProgramSlot[] = [
    makeProgram(base, 'Royal Grand', (draft) => {
      draft.chains.A.reverb = { ...draft.chains.A.reverb, on: true, type: 'Hall', mix: 70 }
    }),
    makeProgram(base, 'Tine Stack', (draft) => {
      draft.layers.A = { ...draft.layers.A, type: 'Electric' }
      draft.layers.B = { ...draft.layers.B, enabled: true, type: 'Upright', level: 78 }
      draft.chains.A.mod2 = { ...draft.chains.A.mod2, on: true, type: 'Chorus' }
      draft.chains.A.comp = { ...draft.chains.A.comp, on: true, amount: 74 }
    }),
    makeProgram(base, 'Full House B3', (draft) => {
      draft.piano.sectionOn = false
      draft.organ.sectionOn = true
      draft.organ.layers.A = { ...draft.organ.layers.A, model: 'B3', drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 6] }
      draft.organ.percussion = { on: true, soft: false, fast: false, third: false, poly: false }
      draft.organ.layers.A.vibrato = true
      draft.organ.vibratoType = 'C3'
      draft.organ.toRotary = true
    }),
    makeProgram(base, 'Continental Vox', (draft) => {
      draft.piano.sectionOn = false
      draft.organ.sectionOn = true
      draft.organ.layers.A = { ...draft.organ.layers.A, model: 'Vox', drawbars: [8, 6, 8, 4, 6, 0, 8, 0, 6], vibrato: true }
      draft.organ.vibratoType = 'V3'
    }),
    makeProgram(base, 'Chapel Pipes', (draft) => {
      draft.piano.sectionOn = false
      draft.organ.sectionOn = true
      draft.organ.layers.A = { ...draft.organ.layers.A, model: 'Pipe1', drawbars: [8, 0, 8, 8, 0, 6, 0, 0, 4] }
      // Pipes want a building around them — the dry principal chorus sounded
      // like a toy next to the reference.
      draft.organChain.reverb = { ...draft.organChain.reverb, on: true, type: 'Cathedral', mix: 58 }
    }),
    makeProgram(base, 'Clav Funk', (draft) => {
      draft.layers.A = { ...draft.layers.A, type: 'Clav' }
      // A-Wah (envelope follower) instead of the cyclic LFO Wah: the filter
      // opens with playing dynamics — the classic funk-clav touch response —
      // rather than sweeping on its own clock under the comping.
      draft.chains.A.mod1 = { ...draft.chains.A.mod1, on: true, type: 'A-Wah', rate: 76, amount: 88 }
      draft.chains.A.comp = { ...draft.chains.A.comp, on: true, amount: 84 }
    }),
    makeProgram(base, 'FM Ballad', (draft) => {
      draft.layers.A = { ...draft.layers.A, type: 'Digital' }
      draft.chains.A.delay = { ...draft.chains.A.delay, on: true, tempo: 74, mix: 44 }
      draft.chains.A.reverb = { ...draft.chains.A.reverb, on: true, type: 'Stage', mix: 56 }
    }),
    makeProgram(base, 'Night Vibes', (draft) => {
      draft.layers.A = { ...draft.layers.A, type: 'Misc', level: 92 }
      draft.chains.A.delay = { ...draft.chains.A.delay, on: true, tempo: 88, feedback: 74, mix: 40 }
      draft.chains.A.reverb = { ...draft.chains.A.reverb, on: true, type: 'Booth', mix: 48 }
    }),
    makeProgram(base, 'Bass & Tines', (draft) => {
      // Split demo: B3 bass registration below C3, tine EP above, ±6 crossfade.
      draft.split = {
        on: true,
        points: [
          { active: false, note: 48, xf: 0 },
          { active: true, note: 48, xf: 6 },
          { active: false, note: 72, xf: 0 },
        ],
      }
      draft.organ.sectionOn = true
      draft.organ.layers.A = {
        ...draft.organ.layers.A,
        drawbars: [8, 8, 4, 0, 0, 0, 0, 0, 0],
        zone: { from: 0, to: 0 },
      }
      draft.layers.A = { ...draft.layers.A, type: 'Electric', zone: { from: 1, to: 1 } }
      draft.chains.A.reverb = { ...draft.chains.A.reverb, on: true, type: 'Stage', mix: 40 }
    }),
    makeProgram(base, 'Super Saw Pad', (draft) => {
      // 2.2 — a slow-attack Super Saw pad with a spacious reverb tail
      // (spec voice: unison thickens the stack further; vibrato adds motion).
      draft.piano.sectionOn = false
      draft.synth.sectionOn = true
      const a = draft.synth.layers.A
      draft.synth.layers.A = {
        ...a,
        waveform: synthWaveformIndex('Super Saw'),
        oscCtrl: 90,
        ampEnvelope: { ...a.ampEnvelope, attack: 70, decay: 110, release: 70 },
        voice: { ...a.voice, unison: 2, vibrato: 'On', vibratoAmount: 30 },
      }
      draft.synthChains.A = {
        ...draft.synthChains.A,
        // Ensemble adds the three cross-modulated lines on top of the stack.
        mod2: { ...draft.synthChains.A.mod2, on: true, type: 'Ensemble', rate: 52, amount: 64 },
        reverb: { ...draft.synthChains.A.reverb, on: true, type: 'Cathedral', mix: 88 },
      }
    }),
    makeProgram(base, 'FM Keys', (draft) => {
      // 2.3 — FM 2-op through a synced delay (spec oscillator FM-H; Osc Ctrl
      // is the modulation index).
      draft.piano.sectionOn = false
      draft.synth.sectionOn = true
      const a = draft.synth.layers.A
      draft.synth.layers.A = {
        ...a,
        waveform: synthWaveformIndex('FM 2-op'),
        oscCtrl: 46,
        ampEnvelope: { ...a.ampEnvelope, attack: 0, decay: 90, release: 40 },
      }
      draft.synthChains.A = { ...draft.synthChains.A, delay: { ...draft.synthChains.A.delay, on: true, mstClk: true, mix: 50, feedback: 60 } }
    }),
    makeProgram(base, 'Gate Pulse', (draft) => {
      // 2.4 — a Square voice driven by the arpeggiator's Gate mode, synced
      // to the master clock (spec arpeggiatorGate: run/mode/mstClk/range).
      draft.piano.sectionOn = false
      draft.synth.sectionOn = true
      const a = draft.synth.layers.A
      draft.synth.layers.A = {
        ...a,
        waveform: synthWaveformIndex('Square'),
        ampEnvelope: { ...a.ampEnvelope, attack: 0, decay: 127, release: 15 },
      }
      draft.synth.arp = { ...draft.synth.arp, run: true, mode: 'Gate', rate: 64, mstClk: true, range: 3, direction: 'Up', hold: true }
      draft.kbHold = true
    }),
    makeProgram(base, 'Trem Tines', (draft) => {
      // A:25 — Wurli-style EP: sine tremolo into the small amp model (the
      // manual's Tremolo blurb calls it "a very common effect to use with
      // electric pianos", p. 49).
      draft.layers.A = { ...draft.layers.A, type: 'Electric' }
      draft.chains.A.mod1 = { ...draft.chains.A.mod1, on: true, type: 'Tremolo', rate: 80, amount: 92 }
      draft.chains.A.ampEq = { ...draft.chains.A.ampEq, on: true, type: 'Small', drive: 40 }
      draft.chains.A.reverb = { ...draft.chains.A.reverb, on: true, type: 'Room', mix: 32 }
    }),
    makeProgram(base, 'Farf Combo', (draft) => {
      // A:26 — 60s combo organ: Farfisa registers (BASS16 + FLUTE8 + TRMP8 +
      // FLUTE4), fast scanner vibrato, spring reverb.
      draft.piano.sectionOn = false
      draft.organ.sectionOn = true
      draft.organ.layers.A = { ...draft.organ.layers.A, model: 'Farf', drawbars: [8, 0, 8, 0, 8, 0, 8, 0, 0], vibrato: true }
      draft.organ.vibratoType = 'V2'
      draft.organChain.reverb = { ...draft.organChain.reverb, on: true, type: 'Spring', mix: 42 }
    }),
    makeProgram(base, 'Glide Lead Whl', (draft) => {
      // A:27 — mono sync-saw lead: legato + glide, wheel vibrato (the
      // factory-bank "Whl" label convention, manual p. 14), synced-feel delay.
      draft.piano.sectionOn = false
      draft.synth.sectionOn = true
      const a = draft.synth.layers.A
      draft.synth.layers.A = {
        ...a,
        waveform: synthWaveformIndex('Sync Saw'),
        oscCtrl: 58,
        ampEnvelope: { ...a.ampEnvelope, attack: 4, decay: 127, release: 30 },
        filter: { ...a.filter, freq: 104, res: 34 },
        voice: { ...a.voice, mode: 'Legato', glide: 48, unison: 1, vibrato: 'Wheel', vibratoAmount: 96 },
      }
      draft.synthChains.A = {
        ...draft.synthChains.A,
        delay: { ...draft.synthChains.A.delay, on: true, tempo: 72, feedback: 52, mix: 34 },
        reverb: { ...draft.synthChains.A.reverb, on: true, type: 'Stage', mix: 30 },
      }
    }),
    makeProgram(base, 'Grand & Strings', (draft) => {
      // A:28 — the classic stage layer: grand piano with a sampled string
      // section swelling underneath (Synth Samples mode, Strings set).
      draft.synth.sectionOn = true
      const a = draft.synth.layers.A
      draft.synth.layers.A = {
        ...a,
        mode: 'Samples',
        waveform: 0, // SYNTH_SAMPLE_SETS[0] = Strings
        level: 84,
        ampEnvelope: { ...a.ampEnvelope, attack: 52, decay: 127, release: 88 },
      }
      draft.synthChains.A = { ...draft.synthChains.A, reverb: { ...draft.synthChains.A.reverb, on: true, type: 'Hall', mix: 52 } }
      draft.chains.A.reverb = { ...draft.chains.A.reverb, on: true, type: 'Hall', mix: 36 }
    }),
  ]
  while (bank.length < 32) bank.push(makeProgram(base, 'Init Grand', () => undefined))
  const live: ProgramSlot[] = Array.from({ length: 8 }, (_, i) => makeProgram(base, `Live ${i + 1}`, () => undefined))
  return { bank, live }
}
