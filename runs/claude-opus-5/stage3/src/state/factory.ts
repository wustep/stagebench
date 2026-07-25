import type { LayerKey } from '../audio/settings'
import type { MenuPage, SplitPoint } from './program'

/**
 * The factory bank.
 *
 * The programs spec asks for "at least 8 stored factory programs demonstrating piano, organ,
 * synth, split and layered setups" (`storage.factoryContent`). These are plain data: a name, the
 * panel values to write, optional per-layer overrides, and optional split / zone / scene state.
 * `initialDeckState` plays each patch through the real reducer path, so a factory program is
 * exactly what you would get by moving the controls by hand — it cannot describe a state the
 * panel could not reach.
 *
 * Slot 1.1 is deliberately empty of overrides: it is the panel's printed power-up state, so what
 * the silk screen shows is what the instrument starts from.
 */

export interface FactoryPatch {
  readonly name: string
  readonly values?: Readonly<Record<string, number>>
  /** The three display dials per page, for the focused synth layer: see `MENU_LABELS`. */
  readonly menu?: Partial<Record<MenuPage, readonly number[]>>
  readonly perLayer?: Partial<Record<LayerKey, Readonly<Record<string, number>>>>
  readonly split?: { readonly on: boolean; readonly points: readonly SplitPoint[] }
  readonly zones?: Partial<Record<LayerKey, { readonly from: number; readonly to: number }>>
  readonly transpose?: number
  readonly bpm?: number
}

const SPLIT_C4: readonly SplitPoint[] = [
  { note: 48, crossfade: 0, enabled: false },
  { note: 60, crossfade: 6, enabled: true },
  { note: 72, crossfade: 0, enabled: false },
]

const SPLIT_THREE: readonly SplitPoint[] = [
  { note: 48, crossfade: 0, enabled: true },
  { note: 60, crossfade: 6, enabled: true },
  { note: 72, crossfade: 12, enabled: true },
]

export const FACTORY_PATCHES: readonly FactoryPatch[] = [
  {
    name: 'Grand Piano',
  },
  {
    name: 'Tine Stack',
    values: {
      'piano.type': 2,
      'piano.timbre': 4,
      'piano.b.on': 1,
      'piano.b.level': 4.5,
      'fx.mod2.on': 1,
      'fx.mod2.type': 0,
      'fx.reverb.on': 1,
      'fx.reverb.dry-wet': 4.5,
    },
  },
  {
    name: 'B3 Perc Fast',
    values: {
      'organ.section-on': 1,
      'piano.section-on': 0,
      'organ.model': 0,
      'organ.perc.on': 1,
      'organ.perc.decay': 1,
      'organ.perc.harmonic': 1,
      'organ.vibchorus.on': 1,
      'organ.vibchorus.type': 1,
      'perf.rotary.speed': 1,
      'perf.rotary.drive': 4.5,
    },
  },
  {
    name: 'Vox Combo',
    values: {
      'organ.section-on': 1,
      'piano.section-on': 0,
      'organ.model': 1,
      'organ.drawbar.1': 8,
      'organ.drawbar.2': 6,
      'organ.drawbar.3': 8,
      'organ.drawbar.4': 4,
      'organ.drawbar.9': 8,
      'organ.vibchorus.on': 1,
    },
  },
  {
    name: 'Pipe Chorale',
    values: {
      'organ.section-on': 1,
      'piano.section-on': 0,
      'organ.model': 3,
      'organ.drawbar.1': 8,
      'organ.drawbar.2': 8,
      'organ.drawbar.4': 6,
      'organ.drawbar.6': 5,
      'fx.reverb.on': 1,
      'fx.reverb.type': 5,
      'fx.reverb.dry-wet': 7.5,
    },
  },
  {
    name: 'Super Saw Lead',
    // Category 3 is Super, waveform 0 is Super Saw (see WAVEFORMS in synthVoice.ts).
    menu: { osc: [0, 3, 0], ampEnv: [1, 10, 3] },
    values: {
      'synth.section-on': 1,
      'piano.section-on': 0,
      'synth.osc.ctrl': 6.5,
      'synth.filter.freq': 5.2,
      'synth.filter.res': 4,
      'synth.voice.mode': 1,
      'synth.voice.glide': 2.4,
      'synth.unison': 2,
      'fx.delay.on': 1,
    },
  },
  {
    name: 'FM Bell Arp',
    // Category 4 is FM-H, the 2-operator algorithm.
    menu: { osc: [0, 4, 0], ampEnv: [0, 5, 2] },
    values: {
      'synth.section-on': 1,
      'piano.section-on': 0,
      'synth.osc.ctrl': 4.5,
      'synth.arp.mode': 1,
      'synth.arp.rate': 5,
      'synth.arp.range': 2,
      'synth.arp-run': 1,
      'synth.filter.freq': 8,
      'fx.delay.on': 1,
      'fx.reverb.on': 1,
    },
    bpm: 132,
  },
  {
    name: 'Split B3 + Piano',
    values: {
      'organ.section-on': 1,
      'piano.section-on': 1,
      'organ.model': 0,
      'organ.perc.on': 1,
    },
    split: { on: true, points: SPLIT_C4 },
    zones: {
      'organ.a': { from: 0, to: 0 },
      'piano.a': { from: 1, to: 1 },
    },
  },
  {
    name: 'Three Zone Rig',
    // Category 1 is Sync.
    menu: { osc: [0, 1, 0] },
    values: {
      'organ.section-on': 1,
      'piano.section-on': 1,
      'synth.section-on': 1,
      'organ.model': 5,
      'synth.osc.ctrl': 5,
    },
    split: { on: true, points: SPLIT_THREE },
    zones: {
      'organ.a': { from: 0, to: 0 },
      'piano.a': { from: 1, to: 2 },
      'synth.a': { from: 3, to: 3 },
    },
  },
  {
    name: 'Layer Pad Piano',
    // Category 2 is Multi; a slow attack and a full sustain make it a pad.
    menu: { osc: [1, 2, 0], ampEnv: [6, 10, 6] },
    values: {
      'piano.section-on': 1,
      'synth.section-on': 1,
      'synth.a.level': 4,
      'synth.filter.freq': 4.2,
      'synth.amp.envelope': 0,
      'fx.reverb.on': 1,
      'fx.reverb.dry-wet': 7,
    },
    transpose: 0,
  },
]
