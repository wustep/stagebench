// Normalized hardware model: every visible panel input, with a stable ID and an accessible name.
//
// Phase 1 contract: these controls change PRESENTATION state only (knob angle, LED/button lit,
// fader and drawbar position, cycle LED). They never reach audio, program, or effect state.
// The reducer below is the only writer of that presentation state.

import type { SectionId } from './sections'

export type ControlKind =
  | 'knob' // continuous rotary, 0..1
  | 'dial' // large continuous program dial, 0..1
  | 'fader' // tall linear slider with LED graph, 0..1
  | 'drawbar' // tall drawbar with LED ladder, 0..1
  | 'wheel' // modulation wheel, 0..1
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
  /** Honest status text. Phase 1 does not implement programs or synth, so it says so. */
  text: readonly string[]
}

const NOT_ACTIVE = 'NOT ACTIVE IN PHASE 2'

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
      { id: 'performance.rotary-speed', section: 'performance', label: 'Rotary speed', kind: 'button' },
      { id: 'performance.rotary-brake', section: 'performance', label: 'Rotary brake', kind: 'button' },
      { id: 'performance.rotary-level', section: 'performance', label: 'Rotary level', kind: 'knob', size: 'sm', initial: 0.5 },
    ],
  },
  {
    id: 'performance.expression',
    section: 'performance',
    label: 'Expression',
    controls: [
      { id: 'performance.pitch-stick', section: 'performance', label: 'Pitch stick', kind: 'pitch', size: 'lg', initial: 0.5 },
      { id: 'performance.mod-wheel', section: 'performance', label: 'Modulation wheel', kind: 'wheel', size: 'lg', initial: 0 },
    ],
  },

  // ---- Organ: dark inset plate, nine drawbars, model switches, percussion ----
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
      { id: 'piano.layer-a-level', section: 'piano', label: 'Layer A level', kind: 'fader', size: 'lg', initial: 0.75 },
      { id: 'piano.layer-a-octave', section: 'piano', label: 'Layer A octave', kind: 'knob', size: 'xs', initial: 0.5 },
    ],
  },
  {
    id: 'piano.layer-b',
    section: 'piano',
    label: 'Layer B',
    controls: [
      { id: 'piano.layer-b-on', section: 'piano', label: 'Layer B on', kind: 'button' },
      { id: 'piano.layer-b-focus', section: 'piano', label: 'Layer B focus', kind: 'button' },
      { id: 'piano.layer-b-level', section: 'piano', label: 'Layer B level', kind: 'fader', size: 'lg', initial: 0.5 },
      { id: 'piano.layer-b-octave', section: 'piano', label: 'Layer B octave', kind: 'knob', size: 'xs', initial: 0.5 },
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
    id: 'program.morph',
    section: 'program',
    label: 'Morph assign',
    controls: [1, 2, 3].map((n) => ({
      id: `program.morph-${n}`,
      section: 'program' as const,
      label: `Morph ${n}`,
      kind: 'button' as const,
      size: 'xs' as const,
    })),
  },

  // ---- Synth: single narrow OLED; oscillator, filter, envelope, LFO, arpeggiator ----
  {
    id: 'synth.layer',
    section: 'synth',
    label: 'Synth layer',
    controls: [{ id: 'synth.layer-level', section: 'synth', label: 'Synth layer level', kind: 'fader', size: 'lg', initial: 0.6 }],
  },
  {
    id: 'synth.oscillators',
    section: 'synth',
    label: 'Oscillators',
    controls: [
      { id: 'synth.osc-type', section: 'synth', label: 'Oscillator type', kind: 'cycle', steps: ['Saw', 'Square', 'Tri', 'Sine'] },
      { id: 'synth.osc-detune', section: 'synth', label: 'Oscillator detune', kind: 'knob', size: 'md', initial: 0.5 },
      { id: 'synth.osc-pulse', section: 'synth', label: 'Pulse width', kind: 'knob', size: 'md', initial: 0.5 },
      { id: 'synth.osc-mix', section: 'synth', label: 'Oscillator mix', kind: 'knob', size: 'md', initial: 0.5 },
    ],
  },
  {
    id: 'synth.filter',
    section: 'synth',
    label: 'Filter',
    controls: [
      { id: 'synth.filter-cutoff', section: 'synth', label: 'Filter cutoff', kind: 'knob', size: 'lg', initial: 0.7 },
      { id: 'synth.filter-resonance', section: 'synth', label: 'Filter resonance', kind: 'knob', size: 'lg', initial: 0.2 },
      { id: 'synth.filter-env', section: 'synth', label: 'Filter envelope amount', kind: 'knob', size: 'lg', initial: 0.4 },
    ],
  },
  {
    id: 'synth.envelope',
    section: 'synth',
    label: 'Envelope',
    controls: [
      { id: 'synth.env-attack', section: 'synth', label: 'Envelope attack', kind: 'knob', size: 'xs', initial: 0 },
      { id: 'synth.env-decay', section: 'synth', label: 'Envelope decay', kind: 'knob', size: 'xs', initial: 0.4 },
      { id: 'synth.env-sustain', section: 'synth', label: 'Envelope sustain', kind: 'knob', size: 'xs', initial: 0.8 },
      { id: 'synth.env-release', section: 'synth', label: 'Envelope release', kind: 'knob', size: 'xs', initial: 0.3 },
    ],
  },
  {
    id: 'synth.lfo',
    section: 'synth',
    label: 'LFO',
    controls: [
      { id: 'synth.lfo-rate', section: 'synth', label: 'LFO rate', kind: 'knob', size: 'md', initial: 0.3 },
      { id: 'synth.lfo-amount', section: 'synth', label: 'LFO amount', kind: 'knob', size: 'md', initial: 0 },
      { id: 'synth.lfo-wave', section: 'synth', label: 'LFO wave', kind: 'cycle', steps: ['Tri', 'Saw', 'Square', 'Random'] },
    ],
  },
  {
    id: 'synth.arp',
    section: 'synth',
    label: 'Arpeggiator',
    controls: [
      { id: 'synth.arp-on', section: 'synth', label: 'Arpeggiator on', kind: 'button' },
      { id: 'synth.arp-mode', section: 'synth', label: 'Arpeggiator mode', kind: 'cycle', steps: ['Up', 'Down', 'Up/Down', 'Random'] },
      { id: 'synth.arp-rate', section: 'synth', label: 'Arpeggiator rate', kind: 'knob', size: 'sm', initial: 0.5 },
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
      { id: 'effects.focus-a', section: 'effects', label: 'Effect focus A', kind: 'button', initial: 1 },
      { id: 'effects.focus-b', section: 'effects', label: 'Effect focus B', kind: 'button' },
      { id: 'effects.group', section: 'effects', label: 'Piano group', kind: 'button' },
      { id: 'effects.all-on', section: 'effects', label: 'Layer effects on', kind: 'button', initial: 1 },
    ],
  },
]

export const OLEDS: readonly OledSpec[] = [
  { id: 'program.oled', section: 'program', label: 'Program display', text: ['PROGRAMS', NOT_ACTIVE] },
  { id: 'synth.oled', section: 'synth', label: 'Synth display', text: ['SYNTH', NOT_ACTIVE] },
]

export const CONTROLS: readonly ControlSpec[] = GROUPS.flatMap((group) => group.controls)

const CONTROLS_BY_ID = new Map(CONTROLS.map((control) => [control.id, control] as const))

export function getControl(id: string): ControlSpec | undefined {
  return CONTROLS_BY_ID.get(id)
}

/** Layer-scoped effect controls keep one value per layer (A and B). Everything else keeps one value. */
export type LayerKey = 'A' | 'B'
export const LAYER_KEYS: readonly LayerKey[] = ['A', 'B']

/** Effect controls that are shared rather than per layer: the focus radio, the group and all-effects switches. */
const UNSCOPED_EFFECTS = new Set(['effects.focus-a', 'effects.focus-b', 'effects.group', 'effects.all-on'])

/** Effect unit whose On switch takes Shift for global mode, and the flag key that records it. */
export const GLOBAL_UNITS: Readonly<Record<string, string>> = {
  'effects.delay-on': 'effects.delay-global',
  'effects.comp-on': 'effects.comp-global',
  'effects.reverb-on': 'effects.reverb-global',
}

/** Scoped effect controls: all of the effect settings a layer owns. */
export function isLayerScoped(id: string): boolean {
  return id.startsWith('effects.') && !UNSCOPED_EFFECTS.has(id)
}

/** Storage key of a control's value for one layer. Unscoped controls use their own ID. */
export function layerKey(id: string, layer: LayerKey): string {
  return isLayerScoped(id) ? `${id}@${layer}` : id
}

export type PresentationState = Readonly<Record<string, number>>

export function initialPresentation(controls: readonly ControlSpec[] = CONTROLS): PresentationState {
  const state: Record<string, number> = {}
  for (const control of controls) {
    const initial = control.initial ?? 0
    if (isLayerScoped(control.id)) {
      for (const layer of LAYER_KEYS) state[layerKey(control.id, layer)] = initial
    } else {
      state[control.id] = initial
    }
  }
  for (const flag of Object.values(GLOBAL_UNITS)) state[flag] = 0
  return state
}

/** The layer whose effect settings the panel shows and edits. Effect focus follows layer focus. */
export function effectFocus(state: PresentationState): LayerKey {
  return (state['effects.focus-b'] ?? 0) >= 0.5 ? 'B' : 'A'
}

/** The value the panel shows for a control: the focused layer's value for effect controls. */
export function readValue(state: PresentationState, id: string): number {
  return state[layerKey(id, effectFocus(state))] ?? 0
}

/** Whether a unit's global flag is on, so its settings apply to every layer. */
export function isGlobal(state: PresentationState, flag: string): boolean {
  return (state[flag] ?? 0) >= 0.5
}

export type ControlAction =
  | { type: 'set'; id: string; value: number }
  | { type: 'nudge'; id: string; delta: number }
  | { type: 'toggle'; id: string }
  | { type: 'advance'; id: string }
  | { type: 'reset'; id: string }
  /** Shift + On on a global-capable unit: its settings apply to all layers. */
  | { type: 'global'; id: string }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Keys written by one action on a control. Group mode and global mode write both layers. */
function writeKeys(state: PresentationState, id: string): string[] {
  if (!isLayerScoped(id)) return [id]
  const unitFlag = Object.entries(GLOBAL_UNITS).find(([on]) => id === on || id.startsWith(on.replace(/-on$/, '-')))?.[1]
  const both = (state['effects.group'] ?? 0) >= 0.5 || (unitFlag !== undefined && isGlobal(state, unitFlag))
  return both ? LAYER_KEYS.map((layer) => layerKey(id, layer)) : [layerKey(id, effectFocus(state))]
}

/** Every layer-scoped key that belongs to one unit, e.g. all `effects.delay-*` controls. */
function unitKeys(prefix: string): string[] {
  return CONTROLS.filter((control) => isLayerScoped(control.id) && control.id.startsWith(prefix)).map((control) => control.id)
}

/** Copies the focused layer's settings onto the other layer, so turning a shared mode on changes nothing audible. */
function copyFocusToOther(state: PresentationState, ids: readonly string[]): PresentationState {
  const from = effectFocus(state)
  const to: LayerKey = from === 'A' ? 'B' : 'A'
  const next: Record<string, number> = { ...state }
  for (const id of ids) next[layerKey(id, to)] = state[layerKey(id, from)] ?? 0
  return next
}

function allScopedIds(): string[] {
  return CONTROLS.filter((control) => isLayerScoped(control.id)).map((control) => control.id)
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
    return turningOn ? copyFocusToOther(next, unitKeys(action.id.replace(/-on$/, '-'))) : next
  }

  const control = getControl(action.id)
  if (!control) return state

  // Layer focus and effect focus are radios: pressing one selects it; pressing it again keeps it.
  if (control.id === 'effects.focus-a' || control.id === 'effects.focus-b') {
    const wantB = control.id === 'effects.focus-b'
    const next = { ...state, 'effects.focus-a': wantB ? 0 : 1, 'effects.focus-b': wantB ? 1 : 0 }
    return next['effects.focus-a'] === state['effects.focus-a'] && next['effects.focus-b'] === state['effects.focus-b'] ? state : next
  }
  if (control.id === 'piano.layer-a-focus' || control.id === 'piano.layer-b-focus') {
    const wantB = control.id === 'piano.layer-b-focus'
    const next = {
      ...state,
      'piano.layer-a-focus': wantB ? 0 : 1,
      'piano.layer-b-focus': wantB ? 1 : 0,
      'effects.focus-a': wantB ? 0 : 1,
      'effects.focus-b': wantB ? 1 : 0,
    }
    return next['piano.layer-a-focus'] === state['piano.layer-a-focus'] &&
      next['piano.layer-b-focus'] === state['piano.layer-b-focus'] &&
      next['effects.focus-a'] === state['effects.focus-a']
      ? state
      : next
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

  const keys = action.type === 'reset' ? (isLayerScoped(control.id) ? LAYER_KEYS.map((layer) => layerKey(control.id, layer)) : [control.id]) : writeKeys(state, control.id)
  let changed = false
  const updated: Record<string, number> = { ...state }
  for (const key of keys) {
    if ((state[key] ?? 0) !== next) {
      updated[key] = next
      changed = true
    }
  }

  // Group mode turns on: the other layer takes the focused layer's settings before any writes apply.
  if (control.id === 'effects.group' && changed && next === 1) {
    return copyFocusToOther({ ...updated, 'effects.group': 1 }, allScopedIds())
  }
  if (control.id === 'effects.group' && !changed) return state
  if (control.id === 'piano.layer-a-focus' || control.id === 'piano.layer-b-focus') return state
  return changed ? updated : state
}

export function isContinuous(kind: ControlKind): boolean {
  return kind === 'knob' || kind === 'dial' || kind === 'fader' || kind === 'drawbar' || kind === 'wheel' || kind === 'pitch'
}
