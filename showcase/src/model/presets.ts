import type {
  ArpState,
  EffectChainState,
  OrganModelId,
  OrganState,
  PianoSharedState,
  SynthAmpEnvelopeState,
  SynthEnvelopeState,
  SynthFilterState,
  SynthLfoState,
  SynthOscEnvelopeState,
  SynthOscPitchState,
  SynthVoiceState,
  VibratoType,
} from '../state/instrument'
import type { PianoType } from '../audio/library'

/**
 * PRESET LIBRARY factory content (manual p. 41-42): the ORGAN, PIANO and
 * SYNTH preset banks.
 *
 * Every preset is a named partial snapshot built ONLY from parameters the
 * engine really implements — synth waveforms from SYNTH_WAVEFORMS (referenced
 * by exact name and resolved at load time), the two bundled Samples-mode
 * sets, the eight bundled piano instruments (by type + model index), organ
 * registrations across the six modeled engines, and the real effect-chain
 * units. Names are original (not Nord's preset names).
 *
 * A Section preset configures layer A and, when declared, B (and C for
 * Synth) (manual p. 41: Section presets can be "made up of multiple
 * Layers"); SINGLE LAYER (Shift + Piano/Synth preset button, manual p. 42)
 * loads only the primary (A) layer definition into the focused layer. Organ
 * presets are always whole-Section (manual p. 41 note: "Organ presets are
 * always loaded for the entire Organ Section, since the Organ A and B
 * layers share the same effects chain"). Declared limitation: the banks are
 * read-only factory content — storing back INTO the preset library (manual
 * p. 42 "Storing Presets") is out of scope.
 */

/** Effect-chain unit overrides for a preset, applied over a reset chain. */
export type EffectChainPresetSpec = { [K in keyof EffectChainState]?: Partial<EffectChainState[K]> }

/** One layer of a preset: partial sound state applied over the init synth
 *  layer, plus optional overrides for that layer's own effect chain (applied
 *  over a reset chain). */
export interface SynthLayerPresetSpec {
  /** Analog-mode waveform, by exact SYNTH_WAVEFORMS name. */
  waveform?: string
  /** Samples-mode set index (SYNTH_SAMPLE_SETS); switches the layer to Samples. */
  sampleSet?: number
  /** Layer level 0..127 (section loads only — SINGLE LAYER keeps the layer's own). */
  level?: number
  oscCtrl?: number
  oscPitch?: Partial<SynthOscPitchState>
  ampEnvelope?: Partial<SynthAmpEnvelopeState>
  filter?: Partial<Omit<SynthFilterState, 'envelope'>> & { envelope?: Partial<SynthEnvelopeState> }
  oscEnvelope?: Partial<SynthOscEnvelopeState>
  lfo?: Partial<SynthLfoState>
  voice?: Partial<SynthVoiceState>
  /** Effect-chain unit overrides for this layer's own chain. */
  chain?: EffectChainPresetSpec
}

export interface SynthPreset {
  name: string
  category: string
  /** Layer A is the primary sound (and the SINGLE LAYER payload); B/C are
   *  optional extra layers a Section load also configures. */
  layers: { A: SynthLayerPresetSpec; B?: SynthLayerPresetSpec; C?: SynthLayerPresetSpec }
  /** Section-level arpeggiator/gate overrides (Section loads only). */
  arp?: Partial<ArpState>
}

export const SYNTH_PRESETS: readonly SynthPreset[] = [
  {
    name: 'Stacked Saw Wall',
    category: 'Pad',
    layers: {
      A: {
        waveform: 'Super Saw',
        oscCtrl: 96,
        ampEnvelope: { attack: 34, decay: 127, release: 58 },
        filter: { type: 'LP24', freq: 98 },
        voice: { unison: 2 },
        chain: { mod2: { on: true, type: 'Ensemble', amount: 70 }, reverb: { on: true, type: 'Stage', mix: 52 } },
      },
      B: {
        waveform: 'Saw Sub',
        level: 88,
        ampEnvelope: { attack: 34, decay: 127, release: 58 },
        filter: { type: 'LP12', freq: 60 },
      },
    },
  },
  {
    name: 'Glass Pad',
    category: 'Pad',
    layers: {
      A: {
        waveform: 'Shape Sine',
        oscCtrl: 72,
        ampEnvelope: { attack: 78, decay: 127, release: 92 },
        filter: { type: 'LP12', freq: 74 },
        lfo: { waveform: 'Triangle', rate: 40, amount: 36, destination: 'Osc Ctrl' },
        chain: { reverb: { on: true, type: 'Cathedral', mix: 78 } },
      },
    },
  },
  {
    name: 'Velvet Strings',
    category: 'Strings',
    layers: {
      A: {
        sampleSet: 0,
        ampEnvelope: { attack: 44, decay: 127, release: 84 },
        chain: { reverb: { on: true, type: 'Hall', mix: 62 } },
      },
    },
  },
  {
    name: 'Vaulted Choir',
    category: 'Vocal',
    layers: {
      A: {
        sampleSet: 1,
        ampEnvelope: { attack: 52, decay: 127, release: 96 },
        chain: { reverb: { on: true, type: 'Cathedral', mix: 84 } },
      },
    },
  },
  {
    name: 'Round Bass',
    category: 'Bass',
    layers: {
      A: {
        waveform: 'Square Sub',
        ampEnvelope: { attack: 0, decay: 96, release: 12 },
        filter: { type: 'LP24', freq: 52, res: 30, envAmount: 88, envelope: { attack: 0, decay: 54, release: 12 } },
        voice: { mode: 'Mono' },
        chain: { comp: { on: true, amount: 72 } },
      },
    },
  },
  {
    name: 'Acid Wire',
    category: 'Bass',
    layers: {
      A: {
        waveform: 'Saw',
        ampEnvelope: { attack: 0, decay: 110, release: 10 },
        filter: { type: 'LP M', freq: 44, res: 92, drive: 2, envAmount: 100, envelope: { attack: 0, decay: 48, release: 10 } },
        voice: { mode: 'Mono', glide: 36 },
        chain: { delay: { on: true, tempo: 58, feedback: 52, mix: 34 } },
      },
    },
  },
  {
    name: 'Torn Sync Lead',
    category: 'Lead',
    layers: {
      A: {
        waveform: 'Sync Saw',
        oscCtrl: 84,
        ampEnvelope: { attack: 0, decay: 127, release: 24 },
        filter: { type: 'LP24', freq: 104 },
        oscEnvelope: { amount: 96, decay: 44, release: 20 },
        voice: { mode: 'Legato', glide: 22, vibrato: 'Wheel' },
        chain: { delay: { on: true, mix: 30 } },
      },
    },
  },
  {
    name: 'Formant Drift',
    category: 'Misc',
    layers: {
      A: {
        waveform: 'Wave Formant',
        filter: { type: 'BP', freq: 66, res: 48 },
        lfo: { waveform: 'Triangle', rate: 52, amount: 58, destination: 'Osc Ctrl' },
        chain: { mod2: { on: true, type: 'Phaser', rate: 40, amount: 60 } },
      },
    },
  },
  {
    name: 'Bell Court',
    category: 'Keys',
    layers: {
      A: {
        waveform: 'FM 2-op',
        oscCtrl: 52,
        ampEnvelope: { attack: 0, decay: 104, release: 62 },
        oscEnvelope: { amount: 92, decay: 38, release: 20 },
        chain: {
          delay: { on: true, tempo: 72, feedback: 44, mix: 32 },
          reverb: { on: true, type: 'Booth', mix: 40 },
        },
      },
    },
  },
  {
    name: 'Organ Wheel',
    category: 'Keys',
    layers: {
      A: {
        waveform: 'Wave Organ',
        ampEnvelope: { attack: 4, decay: 127, release: 8 },
        voice: { vibrato: 'Delayed', vibratoAmount: 34 },
        chain: { mod2: { on: true, type: 'Spin', rate: 70, amount: 66 } },
      },
    },
  },
  {
    name: 'Static Bloom',
    category: 'FX',
    layers: {
      A: {
        waveform: 'White Noise',
        ampEnvelope: { attack: 92, decay: 127, release: 88 },
        filter: { type: 'HP', freq: 46, res: 24 },
        lfo: { waveform: 'Triangle', rate: 30, amount: 44, destination: 'Filter Freq' },
        chain: { reverb: { on: true, type: 'Hall', mix: 70 } },
      },
    },
  },
  {
    name: 'Cascade Arp',
    category: 'Arp',
    layers: {
      A: {
        waveform: 'Pulse 33',
        ampEnvelope: { attack: 0, decay: 70, release: 20 },
        filter: { type: 'LP24', freq: 86 },
        chain: { delay: { on: true, mstClk: true, feedback: 56, mix: 38 } },
      },
    },
    arp: { run: true, mode: 'Arp', direction: 'UpDown', range: 2, rate: 88 },
  },
  {
    name: 'Whistle Stop',
    category: 'Lead',
    layers: {
      A: {
        waveform: 'Sine',
        ampEnvelope: { attack: 10, decay: 127, release: 30 },
        voice: { mode: 'Legato', glide: 18, vibrato: 'On', vibratoAmount: 52, vibratoRate: 88 },
        chain: { delay: { on: true, tempo: 66, mix: 26 } },
      },
    },
  },
  {
    name: 'Pulse Gate',
    category: 'Rhythmic',
    layers: {
      A: {
        waveform: 'Square',
        ampEnvelope: { attack: 0, decay: 127, release: 14 },
        filter: { type: 'LP+HP', freq: 78 },
        chain: { comp: { on: true, amount: 64 } },
      },
    },
    arp: { run: true, mode: 'Gate', mstClk: true, range: 3 },
  },
]

/* ---------------------------------------------------------- ORGAN bank -- */

/** One Organ layer of a preset: a registration on one of the six modeled
 *  engines. Level is a section-load balance; per-layer vibrato on/off
 *  matches the hardware's per-manual VIB/CHORUS button (manual p. 19). */
export interface OrganLayerPresetSpec {
  model: OrganModelId
  /** Nine drawbar values 0 (in) .. 8 (out); Farf treats >4 as register-on. */
  drawbars: number[]
  vibrato?: boolean
  level?: number
}

/** An Organ Section preset (manual p. 41): ALWAYS whole-Section — both
 *  layers plus the single shared Organ effect chain. Percussion applies to
 *  the B3 engine only (manual p. 20); vibratoType picks the shared scanner
 *  position; toRotary routes the section through the rotary speaker. */
export interface OrganPreset {
  name: string
  category: string
  layers: { A: OrganLayerPresetSpec; B?: OrganLayerPresetSpec }
  percussion?: Partial<OrganState['percussion']>
  vibratoType?: VibratoType
  toRotary?: boolean
  /** Overrides for the SHARED Organ chain (both layers, manual p. 41 note). */
  chain?: EffectChainPresetSpec
}

/** Factory Organ registrations. Honesty notes: percussion only on B3
 *  presets (the other engines have none, manual p. 20); the Vox presets use
 *  V1/V3 (p. 20: V3 models the original) and the Farf ones V1/V2/C3 (p. 21);
 *  Vox drawbar 8 is the tone mix and 7 is unused (p. 21). */
export const ORGAN_PRESETS: readonly OrganPreset[] = [
  {
    name: 'Jazz Trio',
    category: 'Jazz',
    // The classic 888000000 with 3rd-harmonic percussion, through the rotary.
    layers: { A: { model: 'B3', drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0] } },
    percussion: { on: true, third: true },
    toRotary: true,
  },
  {
    name: 'Full Gospel',
    category: 'Gospel',
    layers: { A: { model: 'B3', drawbars: [8, 8, 8, 8, 8, 8, 8, 8, 8], vibrato: true } },
    vibratoType: 'C3',
    toRotary: true,
    chain: { reverb: { on: true, type: 'Stage', mix: 30 } },
  },
  {
    name: 'Blues Shout',
    category: 'Blues',
    layers: { A: { model: 'B3', drawbars: [8, 8, 8, 8, 8, 8, 0, 0, 0] } },
    percussion: { on: true, fast: true },
    toRotary: true,
    chain: { ampEq: { on: true, type: 'Twin', drive: 92 } },
  },
  {
    name: 'Sixteen & One',
    category: 'B3',
    // Bottom-and-top whistle registration: 16' against the bare 1'.
    layers: { A: { model: 'B3', drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 8], vibrato: true } },
    vibratoType: 'V2',
  },
  {
    name: 'Manuals & Bass',
    category: 'Split',
    // B3 manual over the B3 Bass 16'+8' drawbars (manual p. 19/21 pairing).
    layers: {
      A: { model: 'B3', drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0] },
      B: { model: 'B3Bass', drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0], level: 110 },
    },
    percussion: { on: true },
    chain: { comp: { on: true, amount: 48 } },
  },
  {
    name: 'Combo Shimmer',
    category: 'Vox',
    // Full flute levels with the tone mix wide open (bright, p. 21).
    layers: { A: { model: 'Vox', drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 8], vibrato: true } },
    vibratoType: 'V3',
    chain: { reverb: { on: true, type: 'Spring', mix: 32 } },
  },
  {
    name: 'Reedy Duo',
    category: 'Vox',
    // Two mid footages, tone mix mostly dark (filtered, p. 21).
    layers: { A: { model: 'Vox', drawbars: [0, 8, 8, 0, 8, 0, 6, 0, 2] } },
  },
  {
    name: 'Buzz Combo',
    category: 'Farf',
    // Register switches: BASS16 + FLUTE8 + TRMP8 (p. 21-22).
    layers: { A: { model: 'Farf', drawbars: [8, 0, 8, 0, 8, 0, 0, 0, 0], vibrato: true } },
    vibratoType: 'V2',
  },
  {
    name: 'Flute Duet',
    category: 'Farf',
    // FLUTE8 + FLUTE4 only — the soft pair of Farf voices.
    layers: { A: { model: 'Farf', drawbars: [0, 0, 8, 0, 0, 0, 8, 0, 0] } },
    chain: { reverb: { on: true, type: 'Room', mix: 26 } },
  },
  {
    name: 'Chapel Principal',
    category: 'Pipe',
    layers: { A: { model: 'Pipe1', drawbars: [8, 0, 8, 8, 0, 8, 0, 0, 0] } },
    chain: { reverb: { on: true, type: 'Hall', mix: 50 } },
  },
  {
    name: 'Grand Diapason',
    category: 'Pipe',
    layers: {
      A: { model: 'Pipe1', drawbars: [8, 8, 8, 8, 8, 8, 8, 8, 8] },
      B: { model: 'Pipe1', drawbars: [8, 0, 8, 0, 8, 0, 8, 0, 8], level: 92 },
    },
    chain: { reverb: { on: true, type: 'Cathedral', mix: 64 } },
  },
  {
    name: 'Bright Principal',
    category: 'Pipe',
    layers: { A: { model: 'Pipe2', drawbars: [8, 0, 8, 8, 8, 8, 8, 8, 8] } },
    chain: { reverb: { on: true, type: 'Hall', mix: 44 } },
  },
]

/* ---------------------------------------------------------- PIANO bank -- */

/** One Piano layer of a preset: a bundled instrument (type + model index
 *  into instrumentsOfType), plus its own effect chain. Level is a
 *  section-load balance (SINGLE LAYER keeps the layer's own). */
export interface PianoLayerPresetSpec {
  type: PianoType
  /** Model index within instrumentsOfType(type) (clamped at load). */
  model?: number
  level?: number
  /** Effect-chain unit overrides for this layer's own chain. */
  chain?: EffectChainPresetSpec
}

/** A Piano Section preset: layer A (+ optional B), plus the section-shared
 *  Piano parameters (KB Touch / Dyn Comp / Timbre / Unison / Acoustics,
 *  manual p. 23-25) applied over reset defaults. */
export interface PianoPreset {
  name: string
  category: string
  layers: { A: PianoLayerPresetSpec; B?: PianoLayerPresetSpec }
  shared?: Partial<
    Pick<PianoSharedState, 'kbTouch' | 'dynComp' | 'timbre' | 'unison' | 'softRelease' | 'stringRes' | 'pedNoise'>
  >
}

/** Factory Piano presets over the eight bundled instruments. Timbre indexes
 *  the focused family's list (Off/Soft/Mid/Bright, + Dyno 1/2 for Electric);
 *  kbTouch 0..2 = Heavy/Mid/Light; dynComp/unison 0..3. */
export const PIANO_PRESETS: readonly PianoPreset[] = [
  {
    name: 'Concert Grand',
    category: 'Grand',
    layers: { A: { type: 'Grand', chain: { reverb: { on: true, type: 'Hall', mix: 38 } } } },
    shared: { stringRes: true, pedNoise: true },
  },
  {
    name: 'Bright Stage Grand',
    category: 'Grand',
    layers: { A: { type: 'Grand', chain: { comp: { on: true, amount: 52 } } } },
    shared: { timbre: 3, dynComp: 2 },
  },
  {
    name: 'Felt Ballad Grand',
    category: 'Grand',
    layers: { A: { type: 'Grand', chain: { reverb: { on: true, type: 'Room', mix: 46 } } } },
    shared: { timbre: 1, kbTouch: 2, softRelease: true },
  },
  {
    name: 'Saloon Tack',
    category: 'Upright',
    layers: { A: { type: 'Upright', chain: { ampEq: { on: true, type: 'Small', drive: 78 } } } },
    shared: { timbre: 2 },
  },
  {
    name: 'Suitcase Tine',
    category: 'Electric',
    layers: {
      A: {
        type: 'Electric',
        chain: {
          mod1: { on: true, type: 'A-Pan', rate: 58, amount: 72 },
          reverb: { on: true, type: 'Stage', mix: 28 },
        },
      },
    },
    shared: { timbre: 4 },
  },
  {
    name: 'Phased Tine',
    category: 'Electric',
    layers: { A: { type: 'Electric', chain: { mod2: { on: true, type: 'Phaser', rate: 44, amount: 66 } } } },
  },
  {
    name: 'Dyno Ballad',
    category: 'Electric',
    layers: {
      A: {
        type: 'Electric',
        chain: {
          mod2: { on: true, type: 'Chorus', rate: 48, amount: 54 },
          reverb: { on: true, type: 'Hall', mix: 42 },
        },
      },
    },
    shared: { timbre: 5, unison: 2 },
  },
  {
    name: 'Funk Clav',
    category: 'Clav',
    layers: {
      A: {
        type: 'Clav',
        chain: { mod1: { on: true, type: 'A-Wah', rate: 64, amount: 92 }, comp: { on: true, amount: 70 } },
      },
    },
    shared: { dynComp: 1 },
  },
  {
    name: 'Court Harpsichord',
    category: 'Clav',
    // Second Clav model: the bundled Harpsichord.
    layers: { A: { type: 'Clav', model: 1, chain: { reverb: { on: true, type: 'Room', mix: 44 } } } },
  },
  {
    name: 'FM Ballad',
    category: 'Digital',
    layers: {
      A: {
        type: 'Digital',
        chain: {
          mod2: { on: true, type: 'Chorus', rate: 42, amount: 58 },
          reverb: { on: true, type: 'Hall', mix: 50 },
        },
      },
    },
    shared: { kbTouch: 1 },
  },
  {
    name: 'Night Vibes',
    category: 'Mallet',
    layers: { A: { type: 'Misc', chain: { delay: { on: true, tempo: 70, feedback: 42, mix: 34 } } } },
  },
  {
    name: 'Marimba Run',
    category: 'Mallet',
    // Second Misc model: the bundled Marimba.
    layers: { A: { type: 'Misc', model: 1, chain: { comp: { on: true, amount: 56 } } } },
    shared: { kbTouch: 2 },
  },
  {
    name: 'Grand & Tine',
    category: 'Layer',
    layers: {
      A: { type: 'Grand', chain: { reverb: { on: true, type: 'Stage', mix: 30 } } },
      B: { type: 'Electric', level: 86, chain: { mod1: { on: true, type: 'Tremolo', rate: 60, amount: 48 } } },
    },
  },
]

/** The three factory banks by section, for browse counting/naming (the
 *  loaders use the typed arrays directly). */
export const PRESET_BANKS: Record<'organ' | 'piano' | 'synth', readonly { name: string; category: string }[]> = {
  organ: ORGAN_PRESETS,
  piano: PIANO_PRESETS,
  synth: SYNTH_PRESETS,
}
