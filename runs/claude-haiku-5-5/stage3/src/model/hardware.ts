// Normalized hardware model: every visible panel input, with a stable ID and an accessible name.
//
// The reducer below is the only writer of panel values. Phase 1 controls only moved presentation
// state; Phase 3 binds them. Each control is bound to a canonical state path or listed as
// unsupported in bindings.ts, so no control can silently do nothing.
//
// Scoping: organ and synth sound settings keep one value per layer, and effect settings keep one
// value per effect chain. The focused layer (or chain) decides which value the panel shows and edits.

import type { SectionId } from './sections'

export type ControlKind =
  | 'knob' // continuous rotary, 0..1
  | 'dial' // large continuous program dial, 0..1
  | 'fader' // tall linear slider with LED graph, 0..1
  | 'drawbar' // tall drawbar with LED ladder, 0..1
  | 'wheel' // modulation wheel or pedal, 0..1
  | 'pitch' // pitch stick, 0..1 with centre at 0.5
  | 'button' // lit toggle, 0 or 1
  | 'cycle' // steps through named positions, lighting one LED per step

export type ControlSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface ControlSpec {
  /** Stable ID, `<section>.<name>`. Used as the DOM id and the presentation key. */
  id: string
  section: SectionId
  /** Legend as printed on the panel; also the accessible name. */
  label: string
  kind: ControlKind
  size?: ControlSize
  /** Named positions for `cycle` controls. */
  steps?: readonly string[]
  /** Initial presentation value: 0..1 for continuous kinds, 0/1 for buttons, index for cycles. */
  initial?: number
}

export interface GroupSpec {
  id: string
  section: SectionId
  /** Printed group heading. */
  label: string
  controls: readonly ControlSpec[]
}

export interface OledSpec {
  id: string
  section: SectionId
  label: string
}

const SPLIT_POSITIONS = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
const ZONE_RANGES = ['1', '2', '3', '4', '1-2', '2-3', '3-4', '1-3', '2-4', '1-4'] as const

/** Layer IDs of each engine. Piano layers share their sound settings; organ and synth layers do not. */
export const PIANO_LAYERS = ['A', 'B'] as const
export const ORGAN_LAYERS = ['A', 'B'] as const
export const SYNTH_LAYERS = ['A', 'B', 'C'] as const

/** Effect chains: piano A and B, the shared organ chain, and synth A, B, C. */
export type ChainKey = 'A' | 'B' | 'O' | 'SA' | 'SB' | 'SC'
export const EFFECT_CHAINS: readonly ChainKey[] = ['A', 'B', 'O', 'SA', 'SB', 'SC']

/** Layer-scoped sound and effect values are stored under `<id>@<layer>`. */
export type LayerKey = string

export const GROUPS: readonly GroupSpec[] = [
  // ---- Performance: exposed red chassis, no dark plate ----
  {
    id: 'performance.master',
    section: 'performance',
    label: 'Master',
    controls: [{ id: 'performance.master-level', section: 'performance', label: 'Master level', kind: 'knob', size: 'xl', initial: 0.7 }],
  },
  {
    id: 'performance.rotary',
    section: 'performance',
    label: 'Rotary speaker',
    controls: [
      { id: 'performance.rotary-speed', section: 'performance', label: 'Rotary speed', kind: 'knob', size: 'sm', initial: 0 },
      { id: 'performance.rotary-brake', section: 'performance', label: 'Rotary brake', kind: 'button' },
      { id: 'performance.rotary-level', section: 'performance', label: 'Rotary level', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'performance.rotary-organ', section: 'performance', label: 'Organ to rotary', kind: 'button', initial: 1 },
    ],
  },
  {
    id: 'performance.expression',
    section: 'performance',
    label: 'Expression',
    controls: [
      { id: 'performance.pitch-stick', section: 'performance', label: 'Pitch stick', kind: 'pitch', size: 'lg', initial: 0.5 },
      { id: 'performance.mod-wheel', section: 'performance', label: 'Modulation wheel', kind: 'wheel', size: 'lg', initial: 0 },
      { id: 'performance.control-pedal', section: 'performance', label: 'Control pedal', kind: 'wheel', size: 'md', initial: 0 },
    ],
  },

  // ---- Organ: dark inset plate, two layers, nine drawbars, model switches, percussion ----
  {
    id: 'organ.layer-a',
    section: 'organ',
    label: 'Organ layer A',
    controls: [
      { id: 'organ.layer-a-on', section: 'organ', label: 'Organ A on', kind: 'button', initial: 1 },
      { id: 'organ.layer-a-focus', section: 'organ', label: 'Organ A focus', kind: 'button', initial: 1 },
      { id: 'organ.layer-a-level', section: 'organ', label: 'Organ A level', kind: 'fader', size: 'md', initial: 0.7 },
      { id: 'organ.layer-a-octave', section: 'organ', label: 'Organ A octave', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'organ.layer-a-zone', section: 'organ', label: 'Organ A zone', kind: 'cycle', steps: ZONE_RANGES, initial: 9 },
    ],
  },
  {
    id: 'organ.layer-b',
    section: 'organ',
    label: 'Organ layer B',
    controls: [
      { id: 'organ.layer-b-on', section: 'organ', label: 'Organ B on', kind: 'button' },
      { id: 'organ.layer-b-focus', section: 'organ', label: 'Organ B focus', kind: 'button' },
      { id: 'organ.layer-b-level', section: 'organ', label: 'Organ B level', kind: 'fader', size: 'md', initial: 0.5 },
      { id: 'organ.layer-b-octave', section: 'organ', label: 'Organ B octave', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'organ.layer-b-zone', section: 'organ', label: 'Organ B zone', kind: 'cycle', steps: ZONE_RANGES, initial: 9 },
    ],
  },
  {
    id: 'organ.drawbars',
    section: 'organ',
    label: 'Organ drawbars',
    controls: [
      { id: 'organ.drawbar-16', section: 'organ', label: '16′', kind: 'drawbar', initial: 0.8 },
      { id: 'organ.drawbar-5-1-3', section: 'organ', label: '5⅓′', kind: 'drawbar', initial: 0.6 },
      { id: 'organ.drawbar-8', section: 'organ', label: '8′', kind: 'drawbar', initial: 0.8 },
      { id: 'organ.drawbar-4', section: 'organ', label: '4′', kind: 'drawbar', initial: 0.5 },
      { id: 'organ.drawbar-2-2-3', section: 'organ', label: '2⅔′', kind: 'drawbar', initial: 0.3 },
      { id: 'organ.drawbar-2', section: 'organ', label: '2′', kind: 'drawbar', initial: 0.2 },
      { id: 'organ.drawbar-1-3-5', section: 'organ', label: '1⅗′', kind: 'drawbar', initial: 0.1 },
      { id: 'organ.drawbar-1-1-3', section: 'organ', label: '1⅓′', kind: 'drawbar', initial: 0 },
      { id: 'organ.drawbar-1', section: 'organ', label: '1′', kind: 'drawbar', initial: 0 },
    ],
  },
  {
    id: 'organ.model',
    section: 'organ',
    label: 'Organ model',
    controls: [
      { id: 'organ.model-b3', section: 'organ', label: 'B3', kind: 'button', initial: 1 },
      { id: 'organ.model-vox', section: 'organ', label: 'Vox', kind: 'button' },
      { id: 'organ.model-farf', section: 'organ', label: 'Farf', kind: 'button' },
      { id: 'organ.model-pipe-1', section: 'organ', label: 'Pipe 1', kind: 'button' },
      { id: 'organ.model-pipe-2', section: 'organ', label: 'Pipe 2', kind: 'button' },
    ],
  },
  {
    id: 'organ.vib-chorus',
    section: 'organ',
    label: 'Vib / Chorus',
    controls: [
      { id: 'organ.vib-depth', section: 'organ', label: 'Vibrato depth', kind: 'knob', size: 'sm', initial: 0.4 },
      { id: 'organ.vib-type', section: 'organ', label: 'Vibrato type', kind: 'cycle', steps: ['V1', 'V2', 'V3', 'C1', 'C2', 'C3'] },
      { id: 'organ.vib-on', section: 'organ', label: 'Vibrato on', kind: 'button' },
    ],
  },
  {
    id: 'organ.percussion',
    section: 'organ',
    label: '2nd/3rd percussion',
    controls: [
      { id: 'organ.perc-on', section: 'organ', label: 'Percussion on', kind: 'button' },
      { id: 'organ.perc-soft', section: 'organ', label: 'Percussion soft', kind: 'button' },
      { id: 'organ.perc-fast', section: 'organ', label: 'Percussion fast', kind: 'button' },
      { id: 'organ.perc-harmonic', section: 'organ', label: 'Percussion harmonic', kind: 'button' },
      { id: 'organ.perc-volume', section: 'organ', label: 'Percussion volume', kind: 'knob', size: 'sm', initial: 0.5 },
    ],
  },

  // ---- Piano: dark inset plate; layers, types, model, timbre and detail switches ----
  {
    id: 'piano.layer-a',
    section: 'piano',
    label: 'Layer A',
    controls: [
      { id: 'piano.layer-a-on', section: 'piano', label: 'Layer A on', kind: 'button', initial: 1 },
      { id: 'piano.layer-a-focus', section: 'piano', label: 'Layer A focus', kind: 'button', initial: 1 },
      { id: 'piano.layer-a-level', section: 'piano', label: 'Layer A level', kind: 'fader', size: 'md', initial: 0.75 },
      { id: 'piano.layer-a-octave', section: 'piano', label: 'Layer A octave', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'piano.layer-a-zone', section: 'piano', label: 'Layer A zone', kind: 'cycle', steps: ZONE_RANGES, initial: 9 },
    ],
  },
  {
    id: 'piano.layer-b',
    section: 'piano',
    label: 'Layer B',
    controls: [
      { id: 'piano.layer-b-on', section: 'piano', label: 'Layer B on', kind: 'button' },
      { id: 'piano.layer-b-focus', section: 'piano', label: 'Layer B focus', kind: 'button' },
      { id: 'piano.layer-b-level', section: 'piano', label: 'Layer B level', kind: 'fader', size: 'md', initial: 0.5 },
      { id: 'piano.layer-b-octave', section: 'piano', label: 'Layer B octave', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'piano.layer-b-zone', section: 'piano', label: 'Layer B zone', kind: 'cycle', steps: ZONE_RANGES, initial: 9 },
    ],
  },
  {
    id: 'piano.type',
    section: 'piano',
    label: 'Piano type',
    controls: [
      {
        id: 'piano.type',
        section: 'piano',
        label: 'Piano type',
        kind: 'cycle',
        steps: ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'],
      },
      { id: 'piano.model', section: 'piano', label: 'Piano model', kind: 'dial', size: 'md', initial: 0 },
    ],
  },
  {
    id: 'piano.timbre',
    section: 'piano',
    label: 'Timbre',
    controls: [
      { id: 'piano.timbre', section: 'piano', label: 'Timbre', kind: 'knob', size: 'sm', initial: 0 },
      { id: 'piano.kb-touch', section: 'piano', label: 'KB touch', kind: 'cycle', steps: ['Heavy', 'Medium', 'Light'], initial: 1 },
      { id: 'piano.dyn-comp', section: 'piano', label: 'Dyn comp', kind: 'cycle', steps: ['Off', '1', '2', '3'] },
      { id: 'piano.unison', section: 'piano', label: 'Unison', kind: 'cycle', steps: ['Off', '1', '2', '3'] },
    ],
  },
  {
    id: 'piano.details',
    section: 'piano',
    label: 'Piano detail',
    controls: [
      { id: 'piano.soft-release', section: 'piano', label: 'Soft release', kind: 'button' },
      { id: 'piano.string-res', section: 'piano', label: 'String res', kind: 'button' },
      { id: 'piano.sustped', section: 'piano', label: 'Sustain pedal routing', kind: 'button', initial: 1 },
      { id: 'piano.pstick', section: 'piano', label: 'Pitch stick routing', kind: 'button' },
      { id: 'piano.section-on', section: 'piano', label: 'Piano section on', kind: 'button', initial: 1 },
    ],
  },

  // ---- Program and morph: primary OLED, dial, program buttons, store/split, morph assigns ----
  {
    id: 'program.dial',
    section: 'program',
    label: 'Program',
    controls: [{ id: 'program.dial', section: 'program', label: 'Program dial', kind: 'dial', size: 'xl', initial: 0 }],
  },
  {
    id: 'program.buttons',
    section: 'program',
    label: 'Program buttons',
    controls: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      id: `program.button-${n}`,
      section: 'program' as const,
      label: `Program ${n}`,
      kind: 'button' as const,
      size: 'xs' as const,
    })),
  },
  {
    id: 'program.navigation',
    section: 'program',
    label: 'Page',
    controls: [
      { id: 'program.page-up', section: 'program', label: 'Page up', kind: 'button', size: 'xs' },
      { id: 'program.page-down', section: 'program', label: 'Page down', kind: 'button', size: 'xs' },
      { id: 'program.live-mode', section: 'program', label: 'Live mode', kind: 'button', size: 'sm' },
      { id: 'program.layer-scene', section: 'program', label: 'Layer scene', kind: 'button', size: 'sm' },
    ],
  },
  {
    id: 'program.store-split',
    section: 'program',
    label: 'Store and split',
    controls: [
      { id: 'program.store', section: 'program', label: 'Store', kind: 'button', size: 'sm' },
      { id: 'program.split', section: 'program', label: 'Split', kind: 'button', size: 'sm' },
    ],
  },
  {
    id: 'program.split-points',
    section: 'program',
    label: 'Split points',
    controls: [
      { id: 'program.split-low', section: 'program', label: 'Low split point', kind: 'cycle', steps: ['Off', ...SPLIT_POSITIONS], initial: 0 },
      { id: 'program.split-mid', section: 'program', label: 'Mid split point', kind: 'cycle', steps: ['Off', ...SPLIT_POSITIONS], initial: 5 },
      { id: 'program.split-high', section: 'program', label: 'High split point', kind: 'cycle', steps: ['Off', ...SPLIT_POSITIONS], initial: 0 },
      { id: 'program.xfade-low', section: 'program', label: 'Low crossfade', kind: 'cycle', steps: ['Off', '±6', '±12'] },
      { id: 'program.xfade-mid', section: 'program', label: 'Mid crossfade', kind: 'cycle', steps: ['Off', '±6', '±12'] },
      { id: 'program.xfade-high', section: 'program', label: 'High crossfade', kind: 'cycle', steps: ['Off', '±6', '±12'] },
    ],
  },
  {
    id: 'program.clock',
    section: 'program',
    label: 'Master clock',
    controls: [
      { id: 'program.tap', section: 'program', label: 'Master clock tap', kind: 'button', size: 'xs' },
      { id: 'program.clock-bpm', section: 'program', label: 'Master clock tempo', kind: 'knob', size: 'sm', initial: 0.4 },
      { id: 'program.clock-sync', section: 'program', label: 'Keyboard clock sync', kind: 'button', size: 'xs' },
      { id: 'program.transpose', section: 'program', label: 'Transpose', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'program.panic', section: 'program', label: 'Panic', kind: 'button', size: 'xs' },
    ],
  },
  {
    id: 'program.morph',
    section: 'program',
    label: 'Morph assign',
    controls: [
      { id: 'program.morph-1', section: 'program', label: 'Wheel morph', kind: 'button', size: 'xs' },
      { id: 'program.morph-2', section: 'program', label: 'Control pedal morph', kind: 'button', size: 'xs' },
      { id: 'program.morph-3', section: 'program', label: 'Aftertouch morph', kind: 'button', size: 'xs' },
    ],
  },

  // ---- Synth: single narrow OLED; three layers, oscillators, filter, envelopes, LFO, voice, arpeggiator ----
  {
    id: 'synth.layer-a',
    section: 'synth',
    label: 'Synth layer A',
    controls: [
      { id: 'synth.layer-a-on', section: 'synth', label: 'Synth A on', kind: 'button', initial: 1 },
      { id: 'synth.layer-a-focus', section: 'synth', label: 'Synth A focus', kind: 'button', initial: 1 },
      { id: 'synth.layer-a-level', section: 'synth', label: 'Synth A level', kind: 'fader', size: 'md', initial: 0.6 },
      { id: 'synth.layer-a-octave', section: 'synth', label: 'Synth A octave', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'synth.layer-a-zone', section: 'synth', label: 'Synth A zone', kind: 'cycle', steps: ZONE_RANGES, initial: 9 },
    ],
  },
  {
    id: 'synth.layer-b',
    section: 'synth',
    label: 'Synth layer B',
    controls: [
      { id: 'synth.layer-b-on', section: 'synth', label: 'Synth B on', kind: 'button' },
      { id: 'synth.layer-b-focus', section: 'synth', label: 'Synth B focus', kind: 'button' },
      { id: 'synth.layer-b-level', section: 'synth', label: 'Synth B level', kind: 'fader', size: 'md', initial: 0.5 },
      { id: 'synth.layer-b-octave', section: 'synth', label: 'Synth B octave', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'synth.layer-b-zone', section: 'synth', label: 'Synth B zone', kind: 'cycle', steps: ZONE_RANGES, initial: 9 },
    ],
  },
  {
    id: 'synth.layer-c',
    section: 'synth',
    label: 'Synth layer C',
    controls: [
      { id: 'synth.layer-c-on', section: 'synth', label: 'Synth C on', kind: 'button' },
      { id: 'synth.layer-c-focus', section: 'synth', label: 'Synth C focus', kind: 'button' },
      { id: 'synth.layer-c-level', section: 'synth', label: 'Synth C level', kind: 'fader', size: 'md', initial: 0.5 },
      { id: 'synth.layer-c-octave', section: 'synth', label: 'Synth C octave', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'synth.layer-c-zone', section: 'synth', label: 'Synth C zone', kind: 'cycle', steps: ZONE_RANGES, initial: 9 },
    ],
  },
  {
    id: 'synth.oscillators',
    section: 'synth',
    label: 'Oscillators',
    controls: [
      {
        id: 'synth.osc-type',
        section: 'synth',
        label: 'Oscillator type',
        kind: 'cycle',
        steps: [
          'Sine',
          'Triangle',
          'Saw',
          'Square',
          'Pulse 33',
          'Pulse 10',
          'White Noise',
          'Sync Saw',
          'Sync Square',
          'Multi Saw',
          'Multi Saw 8ve',
          'Super Saw',
          'Super Square',
          'FM 2-op (algorithm A)',
        ],
      },
      { id: 'synth.osc-ctrl', section: 'synth', label: 'Osc ctrl', kind: 'knob', size: 'md', initial: 0.3 },
    ],
  },
  {
    id: 'synth.filter',
    section: 'synth',
    label: 'Filter',
    controls: [
      { id: 'synth.filter-type', section: 'synth', label: 'Filter type', kind: 'cycle', steps: ['LP12', 'LP24', 'HP', 'BP'] },
      { id: 'synth.filter-track', section: 'synth', label: 'Filter tracking', kind: 'cycle', steps: ['Off', '1/3', '2/3', '1'] },
      { id: 'synth.filter-drive', section: 'synth', label: 'Filter drive', kind: 'cycle', steps: ['Off', '1', '2', '3'] },
      { id: 'synth.filter-cutoff', section: 'synth', label: 'Filter cutoff', kind: 'knob', size: 'lg', initial: 0.7 },
      { id: 'synth.filter-resonance', section: 'synth', label: 'Filter resonance', kind: 'knob', size: 'lg', initial: 0.2 },
      { id: 'synth.filter-env', section: 'synth', label: 'Filter envelope amount', kind: 'knob', size: 'lg', initial: 0.4 },
    ],
  },
  {
    id: 'synth.env-amp',
    section: 'synth',
    label: 'Amp envelope',
    controls: [
      { id: 'synth.env-attack', section: 'synth', label: 'Amp attack', kind: 'knob', size: 'xs', initial: 0 },
      { id: 'synth.env-decay', section: 'synth', label: 'Amp decay', kind: 'knob', size: 'xs', initial: 0.4 },
      { id: 'synth.env-release', section: 'synth', label: 'Amp release', kind: 'knob', size: 'xs', initial: 0.3 },
      { id: 'synth.env-velocity', section: 'synth', label: 'Amp velocity', kind: 'cycle', steps: ['Off', '1', '2', '3'], initial: 2 },
    ],
  },
  {
    id: 'synth.env-filter',
    section: 'synth',
    label: 'Filter envelope',
    controls: [
      { id: 'synth.fenv-attack', section: 'synth', label: 'Filter attack', kind: 'knob', size: 'xs', initial: 0 },
      { id: 'synth.fenv-decay', section: 'synth', label: 'Filter decay', kind: 'knob', size: 'xs', initial: 0.3 },
      { id: 'synth.fenv-release', section: 'synth', label: 'Filter release', kind: 'knob', size: 'xs', initial: 0.3 },
      { id: 'synth.fenv-velocity', section: 'synth', label: 'Filter velocity', kind: 'button' },
    ],
  },
  {
    id: 'synth.env-osc',
    section: 'synth',
    label: 'Oscillator envelope',
    controls: [
      { id: 'synth.oenv-attack', section: 'synth', label: 'Osc attack', kind: 'knob', size: 'xs', initial: 0 },
      { id: 'synth.oenv-decay', section: 'synth', label: 'Osc decay', kind: 'knob', size: 'xs', initial: 0.2 },
      { id: 'synth.oenv-release', section: 'synth', label: 'Osc release', kind: 'knob', size: 'xs', initial: 0.2 },
      { id: 'synth.oenv-velocity', section: 'synth', label: 'Osc velocity', kind: 'button' },
      { id: 'synth.oenv-pitch', section: 'synth', label: 'Osc env to pitch', kind: 'knob', size: 'xs', initial: 0.5 },
    ],
  },
  {
    id: 'synth.lfo',
    section: 'synth',
    label: 'LFO',
    controls: [
      { id: 'synth.lfo-rate', section: 'synth', label: 'LFO rate', kind: 'knob', size: 'md', initial: 0.3 },
      { id: 'synth.lfo-amount', section: 'synth', label: 'LFO amount', kind: 'knob', size: 'md', initial: 0 },
      {
        id: 'synth.lfo-wave',
        section: 'synth',
        label: 'LFO wave',
        kind: 'cycle',
        steps: ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'],
      },
      { id: 'synth.lfo-to-pitch', section: 'synth', label: 'LFO to osc pitch', kind: 'button' },
      { id: 'synth.lfo-to-ctrl', section: 'synth', label: 'LFO to osc ctrl', kind: 'button' },
      { id: 'synth.lfo-to-filter', section: 'synth', label: 'LFO to filter freq', kind: 'button' },
    ],
  },
  {
    id: 'synth.voice',
    section: 'synth',
    label: 'Voice',
    controls: [
      { id: 'synth.voice-mode', section: 'synth', label: 'Voice mode', kind: 'cycle', steps: ['Poly', 'Mono', 'Legato'] },
      { id: 'synth.voice-priority', section: 'synth', label: 'Note priority', kind: 'cycle', steps: ['Off', 'Low', 'High'] },
      { id: 'synth.voice-glide', section: 'synth', label: 'Glide', kind: 'knob', size: 'xs', initial: 0 },
      { id: 'synth.voice-unison', section: 'synth', label: 'Unison', kind: 'cycle', steps: ['Off', '1', '2', '3'] },
      { id: 'synth.vib-mode', section: 'synth', label: 'Vibrato mode', kind: 'cycle', steps: ['On', 'Wheel'] },
      { id: 'synth.vib-rate', section: 'synth', label: 'Vibrato rate', kind: 'knob', size: 'xs', initial: 0.4 },
      { id: 'synth.vib-amount', section: 'synth', label: 'Vibrato amount', kind: 'knob', size: 'xs', initial: 0.3 },
    ],
  },
  {
    id: 'synth.arp',
    section: 'synth',
    label: 'Arpeggiator',
    controls: [
      { id: 'synth.arp-mode', section: 'synth', label: 'Arpeggiator mode', kind: 'cycle', steps: ['Arp', 'Poly', 'Gate'] },
      { id: 'synth.arp-rate', section: 'synth', label: 'Arpeggiator rate', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'synth.arp-range', section: 'synth', label: 'Arpeggiator range', kind: 'knob', size: 'xs', initial: 0.3 },
      { id: 'synth.arp-direction', section: 'synth', label: 'Arpeggiator direction', kind: 'cycle', steps: ['Up', 'Down', 'Up/Down', 'Random'] },
      { id: 'synth.arp-hold', section: 'synth', label: 'Arpeggiator hold', kind: 'button' },
      { id: 'synth.arp-run', section: 'synth', label: 'Arpeggiator run', kind: 'button' },
    ],
  },

  // ---- Layer effects: two groups of unit controls, plus focus, group, and the all-effects switch ----
  {
    id: 'effects.mod',
    section: 'effects',
    label: 'Mod',
    controls: [
      { id: 'effects.mod1-type', section: 'effects', label: 'Mod 1 type', kind: 'cycle', steps: ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] },
      { id: 'effects.mod1-rate', section: 'effects', label: 'Mod 1 rate', kind: 'knob', size: 'md', initial: 0.3 },
      { id: 'effects.mod1-amount', section: 'effects', label: 'Mod 1 amount', kind: 'knob', size: 'md', initial: 0.4 },
      { id: 'effects.mod1-on', section: 'effects', label: 'Mod 1 on', kind: 'button' },
      { id: 'effects.mod2-type', section: 'effects', label: 'Mod 2 type', kind: 'cycle', steps: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] },
      { id: 'effects.mod2-rate', section: 'effects', label: 'Mod 2 rate', kind: 'knob', size: 'md', initial: 0.2 },
      { id: 'effects.mod2-amount', section: 'effects', label: 'Mod 2 amount', kind: 'knob', size: 'md', initial: 0.5 },
      { id: 'effects.mod2-on', section: 'effects', label: 'Mod 2 on', kind: 'button' },
    ],
  },
  {
    id: 'effects.amp-eq',
    section: 'effects',
    label: 'Amp sim and EQ',
    controls: [
      {
        id: 'effects.amp-type',
        section: 'effects',
        label: 'Amp type',
        kind: 'cycle',
        steps: ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'],
      },
      { id: 'effects.amp-drive', section: 'effects', label: 'Amp drive', kind: 'knob', size: 'xs', initial: 0.3 },
      { id: 'effects.amp-tone', section: 'effects', label: 'Amp mid freq', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'effects.amp-level', section: 'effects', label: 'Amp output', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'effects.eq-low', section: 'effects', label: 'EQ bass', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'effects.eq-mid', section: 'effects', label: 'EQ mid gain or res', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'effects.eq-high', section: 'effects', label: 'EQ treble', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'effects.amp-on', section: 'effects', label: 'Amp on', kind: 'button' },
    ],
  },
  {
    id: 'effects.delay',
    section: 'effects',
    label: 'Delay',
    controls: [
      { id: 'effects.delay-time', section: 'effects', label: 'Delay time', kind: 'knob', size: 'md', initial: 0.4 },
      { id: 'effects.delay-feedback', section: 'effects', label: 'Delay feedback', kind: 'knob', size: 'md', initial: 0.3 },
      { id: 'effects.delay-level', section: 'effects', label: 'Delay mix', kind: 'knob', size: 'md', initial: 0.4 },
      { id: 'effects.delay-filter', section: 'effects', label: 'Delay filter', kind: 'cycle', steps: ['Off', 'LP', 'HP', 'BP'] },
      { id: 'effects.delay-on', section: 'effects', label: 'Delay on', kind: 'button' },
    ],
  },
  {
    id: 'effects.comp-reverb',
    section: 'effects',
    label: 'Compressor and reverb',
    controls: [
      { id: 'effects.comp-amount', section: 'effects', label: 'Compressor amount', kind: 'knob', size: 'sm', initial: 0.3 },
      { id: 'effects.comp-fast', section: 'effects', label: 'Compressor fast', kind: 'button' },
      { id: 'effects.comp-on', section: 'effects', label: 'Compressor on', kind: 'button' },
      {
        id: 'effects.reverb-type',
        section: 'effects',
        label: 'Reverb type',
        kind: 'cycle',
        steps: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'],
      },
      { id: 'effects.reverb-size', section: 'effects', label: 'Reverb bright', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'effects.reverb-level', section: 'effects', label: 'Reverb mix', kind: 'knob', size: 'sm', initial: 0.3 },
      { id: 'effects.reverb-on', section: 'effects', label: 'Reverb on', kind: 'button' },
    ],
  },
  {
    id: 'effects.focus',
    section: 'effects',
    label: 'Effect focus',
    controls: [
      { id: 'effects.section-organ', section: 'effects', label: 'Effect focus organ', kind: 'button' },
      { id: 'effects.section-piano', section: 'effects', label: 'Effect focus piano', kind: 'button', initial: 1 },
      { id: 'effects.section-synth', section: 'effects', label: 'Effect focus synth', kind: 'button' },
      { id: 'effects.focus-a', section: 'effects', label: 'Effect focus A', kind: 'button', initial: 1 },
      { id: 'effects.focus-b', section: 'effects', label: 'Effect focus B', kind: 'button' },
      { id: 'effects.group', section: 'effects', label: 'Section group', kind: 'button' },
      { id: 'effects.all-on', section: 'effects', label: 'Layer effects on', kind: 'button', initial: 1 },
    ],
  },
]

/** Printed displays. Their text is computed from the bank and the panel, never from a static string. */
export const OLEDS: readonly OledSpec[] = [
  { id: 'program.oled', section: 'program', label: 'Program display' },
  { id: 'synth.oled', section: 'synth', label: 'Synth display' },
]

export const CONTROLS: readonly ControlSpec[] = GROUPS.flatMap((group) => group.controls)

const CONTROLS_BY_ID = new Map(CONTROLS.map((control) => [control.id, control] as const))

export function getControl(id: string): ControlSpec | undefined {
  return CONTROLS_BY_ID.get(id)
}

/** Piano layer keys (kept for the piano and its layer-level code). */
export const LAYER_KEYS: readonly LayerKey[] = PIANO_LAYERS

/** Sound settings per layer for the organ (two layers) and synth (three layers). */
const ORGAN_SCOPED = /^organ\.(drawbar-|model-|vib-|perc-)/
const SYNTH_SCOPED = /^synth\.(osc-|filter-(?!$)|fenv-|env-|oenv-|lfo-(?!$)|voice-|vib-)/

/** Effect controls are scoped per chain, except the focus, section, group, and all-effects switches. */
const UNSCOPED_EFFECTS = new Set([
  'effects.focus-a',
  'effects.focus-b',
  'effects.group',
  'effects.all-on',
  'effects.section-organ',
  'effects.section-piano',
  'effects.section-synth',
])

export type ScopeId = 'effects' | 'organ' | 'synth'

/** Which focus a layer-scoped control follows, or undefined for controls that keep one value. */
export function scopeOf(id: string): ScopeId | undefined {
  if (id.startsWith('effects.') && !UNSCOPED_EFFECTS.has(id)) return 'effects'
  if (ORGAN_SCOPED.test(id)) return 'organ'
  if (SYNTH_SCOPED.test(id)) return 'synth'
  return undefined
}

export function isLayerScoped(id: string): boolean {
  return scopeOf(id) !== undefined
}

/** The layer keys one scoped control stores values for. */
export function layersOf(scope: ScopeId): readonly LayerKey[] {
  if (scope === 'effects') return EFFECT_CHAINS
  if (scope === 'organ') return ORGAN_LAYERS
  return SYNTH_LAYERS
}

/** Storage key of a control's value for one layer. Unscoped controls use their own ID. */
export function layerKey(id: string, layer: LayerKey): string {
  return isLayerScoped(id) ? `${id}@${layer}` : id
}

export type PresentationState = Readonly<Record<string, number>>

/** Whether a unit's global flag is on, so its settings apply to every layer. */
export const GLOBAL_UNITS: Readonly<Record<string, string>> = {
  'effects.delay-on': 'effects.delay-global',
  'effects.comp-on': 'effects.comp-global',
  'effects.reverb-on': 'effects.reverb-global',
}

export function initialPresentation(controls: readonly ControlSpec[] = CONTROLS): PresentationState {
  const state: Record<string, number> = {}
  for (const control of controls) {
    const initial = control.initial ?? 0
    const scope = scopeOf(control.id)
    if (scope) {
      for (const layer of layersOf(scope)) state[layerKey(control.id, layer)] = initial
    } else {
      state[control.id] = initial
    }
  }
  for (const flag of Object.values(GLOBAL_UNITS)) state[flag] = 0
  // Scene records start as copies of the layer enable state, so Scene I and II begin identical.
  for (const id of LAYER_ON_IDS) {
    state[sceneKey(0, id)] = state[id] ?? 0
    state[sceneKey(1, id)] = state[id] ?? 0
  }
  state['program.scene'] = 0
  return state
}

/** Layer enable switches. Each one has a per-scene record. */
export const LAYER_ON_IDS: readonly string[] = [
  'piano.layer-a-on',
  'piano.layer-b-on',
  'organ.layer-a-on',
  'organ.layer-b-on',
  'synth.layer-a-on',
  'synth.layer-b-on',
  'synth.layer-c-on',
]

export function sceneKey(scene: 0 | 1, id: string): string {
  return `scene.${scene}.${id}`
}

/** The layer whose piano settings the effect panel edits by default: piano focus. */
export function effectFocus(state: PresentationState): 'A' | 'B' {
  return (state['effects.focus-b'] ?? 0) >= 0.5 ? 'B' : 'A'
}

/** The organ layer whose sound settings the panel shows and edits. */
export function organFocus(state: PresentationState): 'A' | 'B' {
  return (state['organ.layer-b-focus'] ?? 0) >= 0.5 ? 'B' : 'A'
}

/** The synth layer whose sound settings the panel shows and edits. */
export function synthFocus(state: PresentationState): 'A' | 'B' | 'C' {
  if ((state['synth.layer-c-focus'] ?? 0) >= 0.5) return 'C'
  if ((state['synth.layer-b-focus'] ?? 0) >= 0.5) return 'B'
  return 'A'
}

/** The effect chain the Layer Effects panel edits: the chosen section, and within it the focused layer. */
export function effectChain(state: PresentationState): ChainKey {
  if ((state['effects.section-organ'] ?? 0) >= 0.5) return 'O'
  if ((state['effects.section-synth'] ?? 0) >= 0.5) return (['SA', 'SB', 'SC'] as const)[SYNTH_LAYERS.indexOf(synthFocus(state))]
  return effectFocus(state)
}

/** The layer key a scoped control's value is read from or written to, for the current focus. */
export function focusedKey(state: PresentationState, scope: ScopeId): LayerKey {
  if (scope === 'effects') return effectChain(state)
  if (scope === 'organ') return organFocus(state)
  return synthFocus(state)
}

/** The value the panel shows for a control: the focused layer's value for scoped controls. */
export function readValue(state: PresentationState, id: string): number {
  const scope = scopeOf(id)
  if (!scope) return state[id] ?? 0
  return state[layerKey(id, focusedKey(state, scope))] ?? 0
}

/** Whether a unit's global flag is on, so its settings apply to every layer. */
export function isGlobal(state: PresentationState, flag: string): boolean {
  return (state[flag] ?? 0) >= 0.5
}

export type ControlAction =
  | { type: 'set'; id: string; value: number }
  | { type: 'nudge'; id: string; delta: number }
  /** Shift is carried for the buttons that use it: Store As, morph clear, and the Shift-menu on program controls. */
  | { type: 'toggle'; id: string; shiftKey?: boolean }
  | { type: 'advance'; id: string }
  | { type: 'reset'; id: string }
  /** Shift + On on a global-capable unit: its settings apply to all layers. */
  | { type: 'global'; id: string }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** The layer keys one action on a scoped control writes. Group and global mode write more than the focus. */
function writeKeys(state: PresentationState, id: string): string[] {
  const scope = scopeOf(id)
  if (!scope) return [id]
  const focus = focusedKey(state, scope) as ChainKey
  if (scope !== 'effects') return [layerKey(id, focus)]
  const unitFlag = Object.entries(GLOBAL_UNITS).find(([on]) => id === on || id.startsWith(on.replace(/-on$/, '-')))?.[1]
  if (unitFlag !== undefined && isGlobal(state, unitFlag)) return EFFECT_CHAINS.map((chain) => layerKey(id, chain))
  if (isGroupMode(state)) return groupOf(focus).map((chain) => layerKey(id, chain))
  return [layerKey(id, focus)]
}

/** Group mode is only meaningful for the piano and synth sections. */
export function isGroupMode(state: PresentationState): boolean {
  return (state['effects.group'] ?? 0) >= 0.5
}

/** The chains a group-mode edit writes: piano A and B together, or the three synth chains together. */
export function groupOf(chain: ChainKey): readonly ChainKey[] {
  if (chain === 'A' || chain === 'B') return ['A', 'B']
  if (chain === 'SA' || chain === 'SB' || chain === 'SC') return ['SA', 'SB', 'SC']
  return [chain]
}

/** Every layer-scoped key that belongs to one unit, e.g. all `effects.delay-*` controls. */
function unitKeys(prefix: string): string[] {
  return CONTROLS.filter((control) => isLayerScoped(control.id) && control.id.startsWith(prefix)).map((control) => control.id)
}

/** Copies the focused chain's settings onto the chains in `targets`, so turning a shared mode on changes nothing audible. */
function copyFocusTo(state: PresentationState, ids: readonly string[], targets: readonly ChainKey[]): PresentationState {
  const from = effectChain(state)
  const next: Record<string, number> = { ...state }
  for (const id of ids) {
    for (const to of targets) {
      if (to !== from) next[layerKey(id, to)] = state[layerKey(id, from)] ?? 0
    }
  }
  return next
}

function allScopedEffectIds(): string[] {
  return CONTROLS.filter((control) => scopeOf(control.id) === 'effects').map((control) => control.id)
}

function setIfChanged(state: PresentationState, updates: Record<string, number>): PresentationState {
  const changed = Object.entries(updates).some(([key, value]) => (state[key] ?? 0) !== value)
  return changed ? { ...state, ...updates } : state
}

/** Radio sets: one member lit at a time. Pressing a member selects it; pressing the lit one keeps it. */
const RADIOS: Readonly<Record<string, readonly string[]>> = {
  'piano.layer-a-focus': ['piano.layer-a-focus', 'piano.layer-b-focus'],
  'piano.layer-b-focus': ['piano.layer-a-focus', 'piano.layer-b-focus'],
  'organ.layer-a-focus': ['organ.layer-a-focus', 'organ.layer-b-focus'],
  'organ.layer-b-focus': ['organ.layer-a-focus', 'organ.layer-b-focus'],
  'synth.layer-a-focus': ['synth.layer-a-focus', 'synth.layer-b-focus', 'synth.layer-c-focus'],
  'synth.layer-b-focus': ['synth.layer-a-focus', 'synth.layer-b-focus', 'synth.layer-c-focus'],
  'synth.layer-c-focus': ['synth.layer-a-focus', 'synth.layer-b-focus', 'synth.layer-c-focus'],
  'effects.focus-a': ['effects.focus-a', 'effects.focus-b'],
  'effects.focus-b': ['effects.focus-a', 'effects.focus-b'],
  'effects.section-organ': ['effects.section-organ', 'effects.section-piano', 'effects.section-synth'],
  'effects.section-piano': ['effects.section-organ', 'effects.section-piano', 'effects.section-synth'],
  'effects.section-synth': ['effects.section-organ', 'effects.section-piano', 'effects.section-synth'],
}

/** Organ model switches: one model per organ layer, chosen for the focused layer. */
const ORGAN_MODELS = ['organ.model-b3', 'organ.model-vox', 'organ.model-farf', 'organ.model-pipe-1', 'organ.model-pipe-2'] as const

/** Synth LFO destinations are independent lights: any mix may be lit, and none lit means the LFO is off. */
export const LFO_DESTINATIONS = ['synth.lfo-to-pitch', 'synth.lfo-to-ctrl', 'synth.lfo-to-filter'] as const

/** Focus for the piano layers and the effect focus that follows them. */
function setPianoFocus(state: PresentationState, wantB: boolean): PresentationState {
  return setIfChanged(state, {
    'piano.layer-a-focus': wantB ? 0 : 1,
    'piano.layer-b-focus': wantB ? 1 : 0,
    'effects.focus-a': wantB ? 0 : 1,
    'effects.focus-b': wantB ? 1 : 0,
  })
}

/**
 * Presentation-state reducer. It is the only writer of panel values; the audio side derives its
 * settings from the same state. Unknown IDs and actions that do not fit the control's kind are
 * ignored. It returns a new object only when a value changes.
 */
export function presentationReducer(state: PresentationState, action: ControlAction): PresentationState {
  if (action.type === 'global') {
    const flag = GLOBAL_UNITS[action.id]
    if (!flag) return state
    const turningOn = !isGlobal(state, flag)
    const next = { ...state, [flag]: turningOn ? 1 : 0 }
    return turningOn ? copyFocusTo(next, unitKeys(action.id.replace(/-on$/, '-')), EFFECT_CHAINS) : next
  }

  const control = getControl(action.id)
  if (!control) return state

  // Radio sets: pressing a member selects it and clears the others. Piano focus also moves effect focus.
  const radio = RADIOS[control.id]
  if (radio && action.type === 'toggle') {
    if (control.id === 'piano.layer-a-focus' || control.id === 'piano.layer-b-focus') {
      return setPianoFocus(state, control.id === 'piano.layer-b-focus')
    }
    const updates: Record<string, number> = {}
    for (const member of radio) updates[member] = member === control.id ? 1 : 0
    return setIfChanged(state, updates)
  }

  // The layer scene button switches the layer enable switches to the other scene's record.
  if (control.id === 'program.layer-scene' && action.type === 'toggle') {
    const nextScene: 0 | 1 = sceneOf(state) === 0 ? 1 : 0
    const updates: Record<string, number> = { 'program.scene': nextScene, 'program.layer-scene': nextScene }
    for (const id of LAYER_ON_IDS) updates[id] = state[sceneKey(nextScene, id)] ?? 0
    return setIfChanged(state, updates)
  }

  // Organ model switches are radios per layer; the model applies to the focused organ layer.
  if ((ORGAN_MODELS as readonly string[]).includes(control.id) && action.type === 'toggle') {
    const key = (id: string) => layerKey(id, organFocus(state))
    const updates: Record<string, number> = {}
    for (const model of ORGAN_MODELS) updates[key(model)] = model === control.id ? 1 : 0
    return setIfChanged(state, updates)
  }

  const current = readValue(state, control.id)
  let next: number

  switch (action.type) {
    case 'set':
      if (!isContinuous(control.kind)) return state
      next = clamp01(action.value)
      break
    case 'nudge':
      if (!isContinuous(control.kind)) return state
      next = clamp01(current + action.delta)
      break
    case 'toggle':
      if (control.kind !== 'button') return state
      next = current >= 0.5 ? 0 : 1
      break
    case 'advance':
      if (control.kind !== 'cycle' || !control.steps) return state
      next = (current + 1) % control.steps.length
      break
    case 'reset':
      next = control.initial ?? 0
      break
  }

  const keys =
    action.type === 'reset'
      ? isLayerScoped(control.id)
        ? layersOf(scopeOf(control.id)!).map((layer) => layerKey(control.id, layer))
        : [control.id]
      : writeKeys(state, control.id)
  let changed = false
  const updated: Record<string, number> = { ...state }
  for (const key of keys) {
    if ((state[key] ?? 0) !== next) {
      updated[key] = next
      changed = true
    }
  }

  // Group mode turns on: the chains of the focused section take the focused chain's settings first.
  if (control.id === 'effects.group') {
    if (!changed) return state
    if (next === 1) {
      const focus = effectChain(state)
      return copyFocusTo({ ...updated, 'effects.group': 1 }, allScopedEffectIds(), groupOf(focus))
    }
    return updated
  }

  // A layer enable switch also writes the active scene's record, so Scene I and II keep their own layer sets.
  if (changed && LAYER_ON_IDS.includes(control.id)) {
    const scene = sceneOf(state)
    updated[sceneKey(scene, control.id)] = next
  }

  return changed ? updated : state
}

/** The active layer scene, 0 for Scene I and 1 for Scene II. */
export function sceneOf(state: PresentationState): 0 | 1 {
  return (state['program.scene'] ?? 0) >= 0.5 ? 1 : 0
}

export function isContinuous(kind: ControlKind): boolean {
  return kind === 'knob' || kind === 'dial' || kind === 'fader' || kind === 'drawbar' || kind === 'wheel' || kind === 'pitch'
}
