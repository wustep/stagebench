// Factory programs (programs spec storage.factoryContent): piano, organ, synth, split and layered
// setups. Program 1.1 is exactly the default sound, so the instrument boots as in Phase 2.
import { assignMorph } from './morph'
import {
  defaultSound,
  editUnit,
  focusSlot,
  syncScene,
  updateLayer,
  updateOrganLayer,
  updateSynthLayer,
  type SoundState,
} from './sound'
import type { ProgramRecord } from './programs'
import { SYNTH_WAVES } from './synthState'

const wave = (id: string) => SYNTH_WAVES.findIndex((w) => w.id === id)

type Edit = (s: SoundState) => SoundState
const pipe = (...edits: Edit[]): SoundState => syncScene(edits.reduce((s, e) => e(s), defaultSound()))

const pianoOff: Edit = (s) => ({ ...s, piano: { ...s.piano, on: false } })
const organOn: Edit = (s) => focusSlot({ ...s, organ: { ...s.organ, on: true } }, 'organA')
const synthOn: Edit = (s) => focusSlot({ ...s, synth: { ...s.synth, on: true } }, 'synthA')
const reverb = (type: SoundState['fx']['chains']['A']['reverb']['type'], dryWet: number): Edit => (s) => editUnit(s, 'reverb', { on: true, type, dryWet })

export function factoryPrograms(): ProgramRecord[] {
  return [
    { name: 'Grand Piano', sound: defaultSound() },
    {
      name: 'B3 Rock Rotary',
      sound: pipe(
        pianoOff,
        organOn,
        (s) => updateOrganLayer(s, 'A', { drawbars: [8, 8, 8, 6, 0, 0, 0, 0, 0], perc: { on: true, soft: false, fast: true, third: true }, vibOn: true }),
        (s) => ({ ...s, organ: { ...s.organ, vibType: 'C3' }, rotary: { ...s.rotary, organ: true, drive: 70 } }),
        (s) => assignMorph(s, 'wheel', 'rotary.speed', 1),
      ),
    },
    {
      name: 'Vox Continental',
      sound: pipe(pianoOff, organOn, (s) => updateOrganLayer(s, 'A', { model: 'vox', drawbars: [0, 8, 6, 4, 0, 5, 0, 0, 3], vibOn: true }), (s) => ({ ...s, organ: { ...s.organ, vibType: 'V2' }, rotary: { ...s.rotary, organ: false } }), reverb('room', 35)),
    },
    {
      name: 'Farf Surf',
      sound: pipe(pianoOff, organOn, (s) => updateOrganLayer(s, 'A', { model: 'farf', drawbars: [0, 0, 8, 8, 0, 8, 0, 0, 0], vibOn: true }), (s) => ({ ...s, organ: { ...s.organ, vibType: 'V3' }, rotary: { ...s.rotary, organ: false } }), reverb('spring', 55)),
    },
    {
      name: 'Pipe Cathedral',
      sound: pipe(pianoOff, organOn, (s) => updateOrganLayer(s, 'A', { model: 'pipe1', drawbars: [6, 0, 8, 6, 0, 4, 0, 0, 3] }), (s) => ({ ...s, rotary: { ...s.rotary, organ: false } }), reverb('cathedral', 70)),
    },
    {
      name: 'Super Saw Lead',
      sound: pipe(
        pianoOff,
        synthOn,
        (s) => updateSynthLayer(s, 'A', { wave: wave('superSaw'), oscCtrl: 70, unison: 1, filter: { ...s.synth.layers.A.filter, type: 'LP24', freq: 90, res: 35, envAmt: 45 }, voice: { mode: 'legato', priority: 'last', glide: 25 } }),
        (s) => editUnit(editUnit(s, 'delay', { on: true, sync: true, tempo: 60, dryWet: 35, feedback: 55 }), 'reverb', { on: true, type: 'hall', dryWet: 30 }),
        (s) => assignMorph(s, 'wheel', 'synth.A.filterFreq', 127),
      ),
    },
    {
      name: 'Bass/Piano Split',
      sound: pipe(
        synthOn,
        (s) => updateSynthLayer(s, 'A', { wave: wave('saw'), zone: [1, 2], octave: -1, voice: { mode: 'mono', priority: 'low', glide: 20 }, filter: { ...s.synth.layers.A.filter, type: 'LP24', freq: 55, res: 40, envAmt: 60 }, filterEnv: { attack: 0, decay: 45, release: 20, velocity: true } }),
        (s) => updateLayer(s, 'A', { zone: [3, 4] }),
        (s) => ({ ...s, split: { on: true, points: [{ pos: null, xfade: 0 }, { pos: 4, xfade: 0 }, { pos: null, xfade: 0 }] } }),
        (s) => focusSlot(s, 'A'),
      ),
    },
    {
      name: 'EP + Pad Scenes',
      sound: (() => {
        let s = pipe(
          synthOn,
          (x) => updateLayer(x, 'A', { type: 'electric' }),
          (x) => updateSynthLayer(x, 'A', { wave: wave('multiSaw'), oscCtrl: 60, level: 80, ampEnv: { attack: 70, decay: 127, release: 75, velocity: 0 }, filter: { ...x.synth.layers.A.filter, type: 'LP12', freq: 70, res: 20, envAmt: 20 }, lfo: { wave: 'triangle', dest: 'filter', rate: 40, amount: 30, sync: false } }),
          (x) => focusSlot(x, 'A'),
          (x) => editUnit(x, 'mod1', { on: true, type: 'trem', rate: 60, amount: 50 }),
          (x) => assignMorph(x, 'pedal', 'synth.A.level', 127),
        )
        // Scene II: electric piano alone (sound parameters are shared; only enables differ).
        s = { ...s, scenes: { ...s.scenes, enabled: { ...s.scenes.enabled, II: { ...s.scenes.enabled.I, synthA: false } } } }
        return s
      })(),
    },
    {
      name: 'Arp Pluck 110',
      sound: pipe(
        pianoOff,
        synthOn,
        (s) => ({ ...s, clock: { ...s.clock, bpm: 110 } }),
        (s) => updateSynthLayer(s, 'A', { wave: wave('pulse33'), ampEnv: { attack: 0, decay: 55, release: 30, velocity: 2 }, filter: { ...s.synth.layers.A.filter, type: 'LP24', freq: 60, res: 55, envAmt: 70 }, arp: { mode: 'arp', run: true, rate: 90, range: 40, direction: 'upDown', sync: true } }),
        (s) => ({ ...s, clock: { ...s.clock, kbSync: true } }),
        (s) => editUnit(s, 'delay', { on: true, sync: true, tempo: 75, dryWet: 40, feedback: 60 }),
      ),
    },
    {
      name: 'Organ/Pno/Syn 3Z',
      sound: pipe(
        organOn,
        synthOn,
        (s) => updateOrganLayer(s, 'A', { zone: [1, 1], drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0] }),
        (s) => updateLayer(s, 'A', { zone: [2, 3] }),
        (s) => updateSynthLayer(s, 'A', { zone: [4, 4], wave: wave('fm'), oscCtrl: 45 }),
        (s) => ({ ...s, split: { on: true, points: [{ pos: 2, xfade: 6 }, { pos: null, xfade: 0 }, { pos: 8, xfade: 12 }] } }),
        (s) => focusSlot(s, 'A'),
      ),
    },
  ]
}
