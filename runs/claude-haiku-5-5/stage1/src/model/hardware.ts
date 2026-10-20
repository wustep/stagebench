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

const NOT_ACTIVE = 'NOT ACTIVE IN PHASE 1'

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

  // ---- Piano: dark inset plate; layers, types, model, timbre, detail switches ----
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
      { id: 'piano.kb-touch', section: 'piano', label: 'KB touch', kind: 'cycle', steps: ['Heavy', 'Medium', 'Light'] },
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
      { id: 'piano.sustped', section: 'piano', label: 'Sustain pedal routing', kind: 'button' },
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

  // ---- Layer effects: two visibly separated groups plus layer focus ----
  {
    id: 'effects.mod',
    section: 'effects',
    label: 'Mod',
    controls: [
      { id: 'effects.mod1-rate', section: 'effects', label: 'Mod 1 rate', kind: 'knob', size: 'md', initial: 0.3 },
      { id: 'effects.mod1-amount', section: 'effects', label: 'Mod 1 amount', kind: 'knob', size: 'md', initial: 0.4 },
      { id: 'effects.mod2-rate', section: 'effects', label: 'Mod 2 rate', kind: 'knob', size: 'md', initial: 0.2 },
      { id: 'effects.mod2-amount', section: 'effects', label: 'Mod 2 amount', kind: 'knob', size: 'md', initial: 0.5 },
    ],
  },
  {
    id: 'effects.amp-eq',
    section: 'effects',
    label: 'Amp sim and EQ',
    controls: [
      { id: 'effects.amp-drive', section: 'effects', label: 'Amp drive', kind: 'knob', size: 'xs', initial: 0.3 },
      { id: 'effects.amp-tone', section: 'effects', label: 'Amp tone', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'effects.amp-level', section: 'effects', label: 'Amp level', kind: 'knob', size: 'xs', initial: 0.5 },
      { id: 'effects.amp-type', section: 'effects', label: 'Amp type', kind: 'cycle', steps: ['Clean', 'Crunch', 'Drive'] },
      { id: 'effects.eq-low', section: 'effects', label: 'EQ low', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'effects.eq-mid', section: 'effects', label: 'EQ mid', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'effects.eq-high', section: 'effects', label: 'EQ high', kind: 'knob', size: 'sm', initial: 0.5 },
    ],
  },
  {
    id: 'effects.delay',
    section: 'effects',
    label: 'Delay',
    controls: [
      { id: 'effects.delay-time', section: 'effects', label: 'Delay time', kind: 'knob', size: 'md', initial: 0.4 },
      { id: 'effects.delay-feedback', section: 'effects', label: 'Delay feedback', kind: 'knob', size: 'md', initial: 0.3 },
      { id: 'effects.delay-level', section: 'effects', label: 'Delay level', kind: 'knob', size: 'md', initial: 0.4 },
      { id: 'effects.delay-on', section: 'effects', label: 'Delay on', kind: 'button' },
    ],
  },
  {
    id: 'effects.comp-reverb',
    section: 'effects',
    label: 'Compressor and reverb',
    controls: [
      { id: 'effects.comp-amount', section: 'effects', label: 'Compressor amount', kind: 'knob', size: 'sm', initial: 0.3 },
      { id: 'effects.comp-on', section: 'effects', label: 'Compressor on', kind: 'button' },
      { id: 'effects.reverb-size', section: 'effects', label: 'Reverb size', kind: 'knob', size: 'sm', initial: 0.5 },
      { id: 'effects.reverb-level', section: 'effects', label: 'Reverb level', kind: 'knob', size: 'sm', initial: 0.3 },
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

export type PresentationState = Readonly<Record<string, number>>

export function initialPresentation(controls: readonly ControlSpec[] = CONTROLS): PresentationState {
  const state: Record<string, number> = {}
  for (const control of controls) {
    state[control.id] = control.initial ?? 0
  }
  return state
}

export type ControlAction =
  | { type: 'set'; id: string; value: number }
  | { type: 'nudge'; id: string; delta: number }
  | { type: 'toggle'; id: string }
  | { type: 'advance'; id: string }
  | { type: 'reset'; id: string }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Presentation-only reducer. Unknown IDs and actions that do not fit the control's kind are ignored.
 * It returns a new object only when a value changes.
 */
export function presentationReducer(state: PresentationState, action: ControlAction): PresentationState {
  const control = getControl(action.id)
  if (!control) return state
  const current = state[control.id] ?? 0
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
      next = current ? 0 : 1
      break
    case 'advance':
      if (control.kind !== 'cycle' || !control.steps) return state
      next = (current + 1) % control.steps.length
      break
    case 'reset':
      next = control.initial ?? 0
      break
  }

  return next === current ? state : { ...state, [control.id]: next }
}

export function isContinuous(kind: ControlKind): boolean {
  return kind === 'knob' || kind === 'dial' || kind === 'fader' || kind === 'drawbar' || kind === 'wheel' || kind === 'pitch'
}
