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
  return JSON.parse(JSON.stringify(picked)) as ProgramSnapshot
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
    }),
    makeProgram(base, 'Clav Funk', (draft) => {
      draft.layers.A = { ...draft.layers.A, type: 'Clav' }
      draft.chains.A.mod1 = { ...draft.chains.A.mod1, on: true, type: 'Wah', amount: 88 }
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
      draft.synthChains.A = { ...draft.synthChains.A, reverb: { ...draft.synthChains.A.reverb, on: true, type: 'Cathedral', mix: 88 } }
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
      draft.synth.arp = { run: true, mode: 'Gate', rate: 64, mstClk: true, range: 3, direction: 'Up', hold: true }
      draft.kbHold = true
    }),
  ]
  while (bank.length < 32) bank.push(makeProgram(base, 'Init Grand', () => undefined))
  const live: ProgramSlot[] = Array.from({ length: 8 }, (_, i) => makeProgram(base, `Live ${i + 1}`, () => undefined))
  return { bank, live }
}
