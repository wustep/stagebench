/**
 * Factory programs: 21 stored programs that demonstrate piano, organ, synth, split, layered, scene and morph setups.
 * They are ordinary `ProgramData` built from the same reducers the panel uses, so they load and round-trip like any other.
 */
import { setBpm, setScene, setSplitPoint } from './edits'
import { defaultOrganLayer, type OrganModel } from './organ'
import { programOf } from './programData'
import { defaultState, type EngineState, type LayerFx, type PianoLayerState, type ProgramData } from './state'
import { defaultSynthPatch, type SynthLayerId, type SynthPatch } from './synth'
import type { PianoType } from '../audio/library/catalog'
import type { ProgramSlot } from './programs'

type Edit = (s: EngineState) => EngineState

const piano = (id: 'A' | 'B', patch: Partial<PianoLayerState> & { type?: PianoType; model?: number }): Edit => (s) => {
  const base = s.layers[id]
  const type = patch.type ?? base.type
  const { model, ...rest } = patch
  const next: PianoLayerState = { ...base, ...rest, type, models: { ...base.models, [type]: model ?? base.models[type] } }
  return { ...s, pianoOn: true, layers: { ...s.layers, [id]: next } }
}
const organ = (id: 'A' | 'B', model: OrganModel, patch: Partial<ReturnType<typeof defaultOrganLayer>> = {}): Edit => (s) => ({
  ...s,
  organOn: true,
  organ: { ...s.organ, layers: { ...s.organ.layers, [id]: { ...defaultOrganLayer(0.7, true, model), ...patch, model } } },
})
const synth = (id: SynthLayerId, patch: (p: SynthPatch) => SynthPatch, layer: Partial<{ enabled: boolean; level: number; octave: -1 | 0 | 1 }> = {}): Edit => (s) => ({
  ...s,
  synthOn: true,
  synth: { ...s.synth, [id]: { ...s.synth[id], enabled: true, ...layer, patch: patch(s.synth[id].patch) } },
})
const fx = (chain: 'A' | 'B' | 'organ' | 'sA' | 'sB' | 'sC', patch: (f: LayerFx) => LayerFx): Edit => (s) => {
  const f = patch(chain === 'organ' ? s.organFx : chain === 'A' || chain === 'B' ? s.fx[chain] : s.synthFx[chain.slice(1) as SynthLayerId])
  if (chain === 'organ') return { ...s, organFx: f }
  if (chain === 'A' || chain === 'B') return { ...s, fx: { ...s.fx, [chain]: f } }
  return { ...s, synthFx: { ...s.synthFx, [chain.slice(1) as SynthLayerId]: f } }
}
const reverb = (type: LayerFx['reverb']['type'], dryWet: number): ((f: LayerFx) => LayerFx) => (f) => ({ ...f, reverb: { ...f.reverb, on: true, type, dryWet } })
const chorus = (amount = 0.5): ((f: LayerFx) => LayerFx) => (f) => ({ ...f, mod2: { ...f.mod2, on: true, type: 'Chorus', amount } })
const delay = (dryWet = 0.3, feedback = 0.4): ((f: LayerFx) => LayerFx) => (f) => ({ ...f, delay: { ...f.delay, on: true, dryWet, feedback } })
const only = (...edits: Edit[]): Edit => (s) => edits.reduce((acc, e) => e(acc), s)
const disableAll: Edit = (s) => ({
  ...s,
  organOn: false,
  synthOn: false,
  layers: { A: { ...s.layers.A, enabled: false }, B: { ...s.layers.B, enabled: false } },
  organ: { ...s.organ, layers: { A: { ...s.organ.layers.A, enabled: false }, B: { ...s.organ.layers.B, enabled: false } } },
  synth: { A: { ...s.synth.A, enabled: false }, B: { ...s.synth.B, enabled: false }, C: { ...s.synth.C, enabled: false } },
})
const zones = (entries: Record<string, [number, number]>): Edit => (s) => ({ ...s, zones: { ...s.zones, ...entries } })
const focus = (section: 'piano' | 'organ' | 'synth', layer: string): Edit => (s) => ({
  ...s,
  ...(section === 'piano' ? { focus: layer as 'A' | 'B', fxFocus: layer as 'A' | 'B' } : section === 'organ' ? { organFocus: layer as 'A' | 'B' } : { synthFocus: layer as SynthLayerId, synthFxFocus: layer as SynthLayerId }),
  fxSection: section,
})

const make = (name: string, edit: Edit): ProgramSlot => ({ name, data: programOf(only(disableAll, edit)(defaultState())) as ProgramData })

const p = (over: Partial<SynthPatch>, base = defaultSynthPatch()): SynthPatch => ({ ...base, ...over })

export function FACTORY_PROGRAMS(): ProgramSlot[] {
  const list = [
    // 1.x pianos
    make('Grand Piano', only(piano('A', { type: 'Grand', enabled: true, level: 0.95 }))),
    make('Concert Grand', only(piano('A', { type: 'Grand', enabled: true, level: 0.95, dynComp: 0, stringRes: true }), fx('A', reverb('Hall', 0.3)))),
    make('Upright Warm', only(piano('A', { type: 'Upright', enabled: true, level: 0.95, timbre: 'Soft', softRelease: true }), fx('A', reverb('Room', 0.25)))),
    make('Wurly and Grand', only(piano('A', { type: 'Grand', enabled: true, level: 0.8 }), piano('B', { type: 'Electric', enabled: true, level: 0.55, model: 0 }), fx('B', chorus(0.5)), fx('A', reverb('Stage', 0.25)))),
    make('Funky Clav', only(piano('A', { type: 'Clav', enabled: true, level: 0.9, model: 1 }), fx('A', (f) => ({ ...f, mod1: { ...f.mod1, on: true, type: 'A-Wah', rate: 0.7, amount: 0.5 } })))),
    // 1.5 - 1.8 organs
    make('B3 Drawbar Jam', only(organ('A', 'B3', { drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], vibOn: true }), (s) => ({ ...s, organ: { ...s.organ, vibMode: 'C3', perc: { ...s.organ.perc, on: true, third: true, fast: true } }, rotary: { ...s.rotary, organ: true, fast: false } }), focus('organ', 'A'))),
    make('Vox Continental', only(organ('A', 'Vox', { level: 0.95 }), fx('organ', reverb('Spring', 0.3)), focus('organ', 'A'))),
    make('Farfisa Fun', only(organ('A', 'Farf', { drawbars: [0, 8, 8, 0, 8, 0, 0, 8, 0], level: 0.6, vibOn: true }), (s) => ({ ...s, organ: { ...s.organ, vibMode: 'V2' } }), focus('organ', 'A'))),
    make('Pipe Cathedral', only(organ('A', 'Pipe 1', { drawbars: [6, 8, 5, 4, 3, 0, 0, 2, 3], level: 0.65 }), fx('organ', reverb('Cathedral', 0.5)), focus('organ', 'A'))),
    // 2.x synths
    make('Saw Lead', only(synth('A', (q) => p({ waveform: 2, filter: { ...q.filter, freq: 0.55, res: 0.35, envAmount: 0.5 }, voice: { ...q.voice, mode: 'legato', glide: 0.3, priority: 'high' }, amp: { ...q.amp, release: 0.35 } }, q)), fx('sA', delay(0.3, 0.4)), focus('synth', 'A'))),
    make('Super Pad', only(synth('A', (q) => p({ waveform: 11, oscCtrl: 0.5, amp: { ...q.amp, attack: 0.55, release: 0.7 }, filter: { ...q.filter, freq: 0.45, envAmount: 0.4, attack: 0.5 } }, q), { level: 0.7 }), fx('sA', reverb('Hall', 0.4)), focus('synth', 'A'))),
    make('FM Bells', only(synth('A', (q) => p({ waveform: 13, oscCtrl: 0.45, oscEnv: { ...q.oscEnv, amount: 0.7, decay: 0.55 }, amp: { ...q.amp, decay: 0.65, velocity: 3 }, filter: { ...q.filter, freq: 0.9, envAmount: 0 } }, q)), fx('sA', reverb('Cathedral', 0.3)), focus('synth', 'A'))),
    make('Arp Pulse', only(synth('A', (q) => p({ waveform: 4, arp: { ...q.arp, run: true, mode: 'arp', direction: 'updown', rate: 0.55, range: 0.5 }, filter: { ...q.filter, freq: 0.5, res: 0.4, envAmount: 0.6, decay: 0.4 }, amp: { ...q.amp, decay: 0.5 } }, q)), fx('sA', delay(0.35, 0.5)), (s) => setBpm(s, 110), focus('synth', 'A'))),
    // 2.5 - 2.8 splits, layers, scenes
    make(
      'Bass and Piano',
      only(
        synth('A', (q) => p({ waveform: 3, voice: { ...q.voice, mode: 'mono', priority: 'low' }, filter: { ...q.filter, freq: 0.32, res: 0.3, envAmount: 0.35 } }, q), { level: 0.9, octave: -1 }),
        piano('A', { type: 'Grand', enabled: true, level: 0.9 }),
        zones({ 'synth.A': [0, 0], 'piano.A': [1, 1] }),
        (s) => setSplitPoint(setSplitPoint(s, 'mid', { active: true, position: 2, crossfade: 6 }), 'low', { active: false }),
        focus('piano', 'A'),
      ),
    ),
    make(
      'Organ Lower Synth Upper',
      only(
        organ('A', 'B3', { drawbars: [8, 8, 8, 4, 0, 0, 0, 0, 0] }),
        synth('B', (q) => p({ waveform: 9, oscCtrl: 0.35, voice: { ...q.voice, mode: 'legato', glide: 0.2 } }, q), { level: 0.6 }),
        zones({ 'organ.A': [0, 0], 'synth.B': [1, 1] }),
        (s) => setSplitPoint(s, 'mid', { active: true, position: 4, crossfade: 0 }),
        (s) => ({ ...s, organ: { ...s.organ, perc: { ...s.organ.perc, on: true } } }),
        focus('organ', 'A'),
      ),
    ),
    make('Piano and Pad', only(piano('A', { type: 'Grand', enabled: true, level: 0.85 }), synth('C', (q) => p({ waveform: 12, oscCtrl: 0.4, amp: { ...q.amp, attack: 0.6, release: 0.8 }, filter: { ...q.filter, freq: 0.4 } }, q), { level: 0.45 }), fx('sC', reverb('Hall', 0.45)), focus('piano', 'A'))),
    make(
      'Scenes Piano Organ',
      only(
        piano('A', { type: 'Grand', enabled: true, level: 0.9 }),
        organ('A', 'B3', { enabled: false, drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0] }),
        // scene I (piano) is committed when we move to scene II, where the organ replaces the piano; then back to scene I
        (s) => setScene(s, 1),
        (s) => ({ ...s, organOn: true, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, enabled: true } } }, layers: { ...s.layers, A: { ...s.layers.A, enabled: false } } }),
        (s) => setScene(s, 0),
        focus('piano', 'A'),
      ),
    ),
    make(
      'Morph Swell',
      only(
        organ('A', 'B3', { drawbars: [4, 4, 6, 0, 0, 0, 0, 0, 0], level: 0.35 }),
        synth('A', (q) => p({ waveform: 11, filter: { ...q.filter, freq: 0.3, res: 0.3 } }, q), { level: 0.6 }),
        (s) => ({
          ...s,
          morph: { wheel: [{ dest: 'level.organ.A', to: 0.9 }, { dest: 'drawbar.organ.A.3', to: 8 }], pedal: [{ dest: 'synth.filterFreq.A', to: 0.85 }, { dest: 'level.synth.A', to: 0.2 }] },
        }),
        focus('organ', 'A'),
      ),
    ),
    // 3.2 the example from the programs spec
    make('Tine Stack', only(piano('A', { type: 'Electric', enabled: true, level: 0.8, model: 1 }), piano('B', { type: 'Electric', enabled: true, level: 0.6, model: 0 }), fx('A', chorus(0.4)), fx('B', reverb('Room', 0.2)))),
    make(
      'Four Zones',
      only(
        piano('A', { type: 'Upright', enabled: true, level: 0.85 }),
        organ('A', 'Vox', { level: 0.6 }),
        synth('A', (q) => p({ waveform: 2, voice: { ...q.voice, mode: 'mono' } }, q), { level: 0.7, octave: -1 }),
        synth('B', (q) => p({ waveform: 9 }, q), { level: 0.55 }),
        zones({ 'synth.A': [0, 0], 'piano.A': [1, 1], 'organ.A': [2, 2], 'synth.B': [3, 3] }),
        (s) => setSplitPoint(setSplitPoint(setSplitPoint(s, 'low', { active: true, position: 2 }), 'mid', { active: true, position: 4, crossfade: 6 }), 'high', { active: true, position: 6 }),
        focus('piano', 'A'),
      ),
    ),
    make('Rotary Duet', only(organ('A', 'B3', { drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 0], vibOn: true }), organ('B', 'Vox', { level: 0.45, octave: 1 }), (s) => ({ ...s, rotary: { ...s.rotary, organ: true, fast: true } }), focus('organ', 'A'))),
  ]
  // 3.2 is Tine Stack, the example in the programs spec
  const tine = list.findIndex((p) => p.name === 'Tine Stack')
  ;[list[17], list[tine]] = [list[tine], list[17]]
  return list
}
