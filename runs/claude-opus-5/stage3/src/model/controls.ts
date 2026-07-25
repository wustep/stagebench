import type { SectionId } from './layout'

/**
 * Normalised inventory of every physical input on the Nord Stage 4 control deck, transcribed
 * from `reference/nord-stage-4-73.jpg`.
 *
 * Honesty contract: `functional` says, per control, whether moving it changes real audio or
 * engine state. In Phase 3 that is true for every control except the nine listed in
 * `UNSUPPORTED_CONTROL_IDS`, each of which is decorative because an assigned spec puts its
 * behaviour under `scope.excluded` — the reason is recorded next to the id. `data-functional`
 * renders this claim into the DOM so it can be inspected rather than merely promised.
 */

export type ControlKind =
  | 'button' // rocker / push button, optionally cycling through indicator options
  | 'knob' // indexed rotary with an end stop
  | 'encoder' // endless dial
  | 'fader' // level fader with an LED graph
  | 'drawbar' // organ drawbar, 0 (in) to 8 (out)
  | 'wheel' // modulation wheel
  | 'stick' // spring-returning pitch stick

export interface ControlSpec {
  readonly id: string
  readonly kind: ControlKind
  /** Accessible name. */
  readonly name: string
  readonly section: SectionId
  /** Printed group the control belongs to, used for grouping and for the audit. */
  readonly group: string
  /** Stepped options a button cycles through; the current index is the control value. */
  readonly options?: readonly string[]
  /** Latching on/off button. */
  readonly toggle?: boolean
  /** Momentary press button — visibly depresses, holds no state. */
  readonly momentary?: boolean
  readonly min: number
  readonly max: number
  readonly step: number
  readonly initial: number
  /** Optional printed scale, e.g. the 0–10 index ring on a knob. */
  readonly valueText?: (value: number) => string
  /** True when moving this control changes real audio or engine state. */
  readonly functional: boolean
}

/**
 * The controls that stay decorative in Phase 3, each because an assigned spec excludes its
 * behaviour. The value is the spec clause that excludes it, quoted in the audit and in the UI
 * notes. Nothing else is decorative: every other control is bound to engine state or audio.
 */
export const UNSUPPORTED_CONTROL_IDS: ReadonlyMap<string, string> = new Map([
  [
    'fx.delay.effects',
    'effects spec, scope.excluded — the delay feedback-loop effects (Chorus/Vibe/Ensemble/Flam/Space)',
  ],
  [
    'organ.preset',
    'organ spec, scope.excluded — Preset/Drawbar Live modes are physical-drawbar concepts; virtual drawbars always show live values',
  ],
  [
    'program.morph.aftertouch',
    'programs spec, scope.excluded — aftertouch as a morph source; browser keyboards have no aftertouch, so the A.T. button stays decorative',
  ],
  ['program.preset.organ', 'programs spec, scope.excluded — the Organ/Piano/Synth preset library'],
  ['program.preset.piano', 'programs spec, scope.excluded — the Organ/Piano/Synth preset library'],
  ['program.preset.synth', 'programs spec, scope.excluded — the Organ/Piano/Synth preset library'],
  [
    'program.solo',
    'programs spec, scope.optional — Solo and single-level Undo are optional, and neither is implemented',
  ],
  ['program.section-edit', 'programs spec, scope.excluded — Section Edit and Layer Init (manual p. 43-44)'],
  ['program.mon-copy', 'programs spec, scope.excluded — Monitor / Copy / Paste / Swap (manual p. 43-44)'],
])

/** Every control that really is wired to engine state or audio. */
export function isFunctionalControl(id: string): boolean {
  return !UNSUPPORTED_CONTROL_IDS.has(id)
}

type Draft = Omit<ControlSpec, 'section' | 'group' | 'functional' | 'min' | 'max' | 'step' | 'initial'> &
  Partial<Pick<ControlSpec, 'min' | 'max' | 'step' | 'initial'>>

function build(section: SectionId, group: string, drafts: readonly Draft[]): ControlSpec[] {
  return drafts.map((draft) => {
    const defaults = defaultRange(draft)
    return {
      min: defaults.min,
      max: defaults.max,
      step: defaults.step,
      initial: draft.initial ?? defaults.initial,
      ...draft,
      section,
      group,
      functional: isFunctionalControl(draft.id),
    } as ControlSpec
  })
}

function defaultRange(draft: Draft): { min: number; max: number; step: number; initial: number } {
  if (draft.options) return { min: 0, max: draft.options.length - 1, step: 1, initial: 0 }
  switch (draft.kind) {
    case 'button':
      return { min: 0, max: 1, step: 1, initial: 0 }
    case 'knob':
      return { min: 0, max: 10, step: 0.1, initial: 5 }
    case 'encoder':
      return { min: 0, max: 127, step: 1, initial: 0 }
    case 'fader':
      return { min: 0, max: 10, step: 0.1, initial: 8 }
    case 'drawbar':
      return { min: 0, max: 8, step: 1, initial: 0 }
    case 'wheel':
      return { min: 0, max: 1, step: 0.01, initial: 0 }
    case 'stick':
      return { min: -1, max: 1, step: 0.05, initial: 0 }
  }
}

const tenths = (value: number) => value.toFixed(1)

/* ------------------------------------------------------------------ performance */

const performance: ControlSpec[] = [
  ...build('performance', 'Master', [
    { id: 'perf.master-level', kind: 'knob', name: 'Master Level', initial: 7.5, valueText: tenths },
  ]),
  ...build('performance', 'Wheels', [
    { id: 'perf.pitch-stick', kind: 'stick', name: 'Pitch stick' },
    { id: 'perf.mod-wheel', kind: 'wheel', name: 'Modulation wheel' },
  ]),
  ...build('performance', 'Rotary Speaker', [
    { id: 'perf.rotary.drive', kind: 'knob', name: 'Rotary Speaker Drive', initial: 2, valueText: tenths },
    { id: 'perf.rotary.source', kind: 'button', name: 'Rotary Speaker source', options: ['Organ', 'Close Mic'] },
    { id: 'perf.rotary.stop-mode', kind: 'button', name: 'Rotary Speaker Stop Mode', options: ['Off', 'Stop Mode', 'Angle'] },
    { id: 'perf.rotary.speed', kind: 'button', name: 'Rotary Speaker speed', options: ['Slow', 'Fast', 'Morph'] },
  ]),
]

/* ------------------------------------------------------------------ organ */

export const DRAWBARS: readonly { id: string; upper: string; lower: string; footage: string }[] = [
  { id: 'organ.drawbar.1', upper: 'BASS16', lower: "16'", footage: "16'" },
  { id: 'organ.drawbar.2', upper: 'STR16', lower: "8'", footage: "5 1/3'" },
  { id: 'organ.drawbar.3', upper: 'FLUTE8', lower: "4'", footage: "8'" },
  { id: 'organ.drawbar.4', upper: 'OBOE8', lower: "2'", footage: "4'" },
  { id: 'organ.drawbar.5', upper: 'TRMP8', lower: 'II', footage: "2 2/3'" },
  { id: 'organ.drawbar.6', upper: 'STR8', lower: 'III', footage: "2'" },
  { id: 'organ.drawbar.7', upper: 'FLUTE4', lower: 'IV', footage: "1 3/5'" },
  { id: 'organ.drawbar.8', upper: 'STR4', lower: '', footage: "1 1/3'" },
  { id: 'organ.drawbar.9', upper: '2 2/3', lower: '', footage: "1'" },
]

const DRAWBAR_INITIAL = [8, 8, 8, 6, 4, 5, 3, 0, 7]

const organ: ControlSpec[] = [
  ...build('organ', 'Section', [
    { id: 'organ.section-on', kind: 'button', name: 'Organ Section On', toggle: true, initial: 0 },
  ]),
  ...build('organ', 'Layers', [
    { id: 'organ.a.level', kind: 'fader', name: 'Organ layer A level', initial: 7.5, valueText: tenths },
    { id: 'organ.b.level', kind: 'fader', name: 'Organ layer B level', initial: 3.5, valueText: tenths },
    { id: 'organ.a.on', kind: 'button', name: 'Organ layer A On/Off', toggle: true, initial: 1 },
    { id: 'organ.b.on', kind: 'button', name: 'Organ layer B On/Off', toggle: true, initial: 0 },
    { id: 'organ.preset', kind: 'button', name: 'Organ Preset', options: ['Preset I', 'Preset II'] },
    { id: 'organ.octave-down', kind: 'button', name: 'Organ Octave Shift down', momentary: true },
    { id: 'organ.octave-up', kind: 'button', name: 'Organ Octave Shift up', momentary: true },
  ]),
  ...build('organ', 'Organ Model', [
    {
      id: 'organ.model',
      kind: 'button',
      name: 'Organ Model',
      options: ['B3', 'Vox', 'Farf', 'Pipe1', 'Pipe2', 'B3 Bass'],
    },
  ]),
  ...build('organ', 'Vib/Chorus', [
    { id: 'organ.vibchorus.type', kind: 'button', name: 'Vibrato/Chorus type', options: ['V1', 'C1', 'V2', 'V3', 'C2', 'C3'] },
    { id: 'organ.vibchorus.on', kind: 'button', name: 'Vibrato/Chorus On', toggle: true },
  ]),
  ...build('organ', 'B3 Percussion', [
    { id: 'organ.perc.volume', kind: 'button', name: 'Percussion Volume Soft', toggle: true },
    { id: 'organ.perc.decay', kind: 'button', name: 'Percussion Decay Fast', toggle: true, initial: 1 },
    { id: 'organ.perc.harmonic', kind: 'button', name: 'Percussion Harmonic Third', toggle: true, initial: 1 },
    { id: 'organ.perc.on', kind: 'button', name: 'Percussion On', toggle: true },
  ]),
  ...build(
    'organ',
    'Drawbars',
    DRAWBARS.map((bar, index) => ({
      id: bar.id,
      kind: 'drawbar' as const,
      name: `Drawbar ${index + 1} ${bar.footage}`,
      initial: DRAWBAR_INITIAL[index],
    })),
  ),
]

/* ------------------------------------------------------------------ piano */

const piano: ControlSpec[] = [
  ...build('piano', 'Section', [
    { id: 'piano.section-on', kind: 'button', name: 'Piano Section On', toggle: true, initial: 1 },
  ]),
  ...build('piano', 'Layers', [
    { id: 'piano.a.level', kind: 'fader', name: 'Piano layer A level', initial: 8, valueText: tenths },
    { id: 'piano.b.level', kind: 'fader', name: 'Piano layer B level', initial: 5.5, valueText: tenths },
    { id: 'piano.a.on', kind: 'button', name: 'Piano layer A On/Off', toggle: true, initial: 1 },
    { id: 'piano.b.on', kind: 'button', name: 'Piano layer B On/Off', toggle: true, initial: 0 },
    { id: 'piano.sustped', kind: 'button', name: 'Piano SUSTPED routing', toggle: true, initial: 1 },
    { id: 'piano.timbre', kind: 'button', name: 'Piano Timbre', options: ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] },
    { id: 'piano.octave-down', kind: 'button', name: 'Piano Octave Shift down', momentary: true },
    { id: 'piano.octave-up', kind: 'button', name: 'Piano Octave Shift up', momentary: true },
  ]),
  ...build('piano', 'Acoustics', [
    { id: 'piano.acoustics', kind: 'button', name: 'Piano Acoustics', options: ['Off', 'Soft Release', 'String Res', 'Soft Release + String Res'], initial: 2 },
    { id: 'piano.unison', kind: 'button', name: 'Piano Unison', options: ['Off', '1', '2', '3'] },
    { id: 'piano.kb-touch', kind: 'button', name: 'Piano KB Touch', options: ['Normal', 'Heavy', 'Medium', 'Light'], initial: 2 },
    { id: 'piano.dyn-comp', kind: 'button', name: 'Piano Dyn Comp', options: ['Off', '1', '2', '3'] },
  ]),
  ...build('piano', 'Piano Select', [
    { id: 'piano.type', kind: 'button', name: 'Piano Type', options: ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] },
    { id: 'piano.model', kind: 'encoder', name: 'Piano Model select', min: 0, max: 8, step: 1 },
  ]),
]

/* ------------------------------------------------------------------ program */

export const PROGRAM_BUTTONS: readonly { id: string; index: number; label: string }[] = [
  { id: 'program.slot.1', index: 1, label: 'System' },
  { id: 'program.slot.2', index: 2, label: 'Sound' },
  { id: 'program.slot.3', index: 3, label: 'Organize' },
  { id: 'program.slot.4', index: 4, label: 'Aux KB' },
  { id: 'program.slot.5', index: 5, label: 'Output' },
  { id: 'program.slot.6', index: 6, label: 'Pedal' },
  { id: 'program.slot.7', index: 7, label: 'MIDI' },
  { id: 'program.slot.8', index: 8, label: 'Extern' },
]

const program: ControlSpec[] = [
  ...build('program', 'Morph Assign', [
    { id: 'program.morph.wheel', kind: 'button', name: 'Morph Assign Wheel', toggle: true },
    { id: 'program.morph.aftertouch', kind: 'button', name: 'Morph Assign Aftertouch', toggle: true },
    { id: 'program.morph.ctrl-pedal', kind: 'button', name: 'Morph Assign Control Pedal', toggle: true },
  ]),
  ...build('program', 'Master', [
    { id: 'program.split', kind: 'button', name: 'Split On/Set', toggle: true },
    { id: 'program.mst-clk', kind: 'button', name: 'Master Clock Tap/Set', momentary: true },
    { id: 'program.transpose', kind: 'button', name: 'Transpose On/Set', toggle: true },
    { id: 'program.prog-view', kind: 'button', name: 'Prog View', toggle: true },
    { id: 'program.store', kind: 'button', name: 'Store', momentary: true },
  ]),
  ...build('program', 'Preset Library', [
    { id: 'program.preset.organ', kind: 'button', name: 'Preset Library Organ', momentary: true },
    { id: 'program.preset.piano', kind: 'button', name: 'Preset Library Piano', momentary: true },
    { id: 'program.preset.synth', kind: 'button', name: 'Preset Library Synth', momentary: true },
  ]),
  ...build('program', 'Program', [
    { id: 'program.dial', kind: 'encoder', name: 'Program dial', min: 0, max: 300, step: 1, initial: 0 },
    { id: 'program.page-left', kind: 'button', name: 'Page/Cat left', momentary: true },
    { id: 'program.page-right', kind: 'button', name: 'Page/Cat right', momentary: true },
    { id: 'program.live-mode', kind: 'button', name: 'Live Mode', toggle: true },
    { id: 'program.layer-scene', kind: 'button', name: 'Layer Scene', options: ['Scene I', 'Scene II'] },
    ...PROGRAM_BUTTONS.map((slot) => ({
      id: slot.id,
      kind: 'button' as const,
      name: `Program ${slot.index} (${slot.label})`,
      momentary: true,
    })),
  ]),
  ...build('program', 'Edit', [
    { id: 'program.solo', kind: 'button', name: 'Solo / Undo', toggle: true },
    { id: 'program.section-edit', kind: 'button', name: 'Section Edit / Layer Init', toggle: true },
    { id: 'program.mon-copy', kind: 'button', name: 'Mon/Copy / Paste', momentary: true },
    { id: 'program.shift', kind: 'button', name: 'Shift / Exit', toggle: true },
  ]),
]

/* ------------------------------------------------------------------ synth */

const synth: ControlSpec[] = [
  ...build('synth', 'Section', [
    { id: 'synth.section-on', kind: 'button', name: 'Synth Section On', toggle: true, initial: 0 },
  ]),
  ...build('synth', 'Layers', [
    { id: 'synth.a.level', kind: 'fader', name: 'Synth layer A level', initial: 9, valueText: tenths },
    { id: 'synth.b.level', kind: 'fader', name: 'Synth layer B level', initial: 3, valueText: tenths },
    { id: 'synth.c.level', kind: 'fader', name: 'Synth layer C level', initial: 6, valueText: tenths },
    { id: 'synth.a.on', kind: 'button', name: 'Synth layer A On/Off', toggle: true, initial: 1 },
    { id: 'synth.b.on', kind: 'button', name: 'Synth layer B On/Off', toggle: true, initial: 0 },
    { id: 'synth.c.on', kind: 'button', name: 'Synth layer C On/Off', toggle: true, initial: 0 },
    { id: 'synth.kb-hold', kind: 'button', name: 'Synth KB Hold', toggle: true },
    { id: 'synth.arp-run', kind: 'button', name: 'Arpeggiator Run', toggle: true },
    { id: 'synth.octave-down', kind: 'button', name: 'Synth Octave Shift down', momentary: true },
    { id: 'synth.octave-up', kind: 'button', name: 'Synth Octave Shift up', momentary: true },
  ]),
  ...build('synth', 'Oscillators', [
    { id: 'synth.mode', kind: 'button', name: 'Synth Mode', options: ['Samples', 'Analog', 'Extern'], initial: 1 },
    { id: 'synth.osc.type', kind: 'encoder', name: 'Synth display dial 1 (Filter Drive / Envelope Attack)', min: 0, max: 10, step: 1 },
    { id: 'synth.osc.category', kind: 'encoder', name: 'Synth display dial 2 (Oscillator Category / Envelope Decay)', min: 0, max: 10, step: 1 },
    { id: 'synth.osc.waveform', kind: 'encoder', name: 'Synth display dial 3 (Oscillator Waveform / Envelope Release)', min: 0, max: 10, step: 1, initial: 2 },
    { id: 'synth.sound-init', kind: 'button', name: 'Waveform / Sound Init', momentary: true },
    { id: 'synth.osc.pitch-smp', kind: 'button', name: 'Oscillator Env To Pitch', toggle: true },
    { id: 'synth.osc.envelope', kind: 'button', name: 'Oscillator Envelope', toggle: true },
    { id: 'synth.osc.ctrl', kind: 'knob', name: 'Oscillator Control', initial: 3.4, valueText: tenths },
    { id: 'synth.osc.env-amt', kind: 'knob', name: 'Oscillator Envelope Amount', min: -10, max: 10, initial: 0, valueText: tenths },
  ]),
  ...build('synth', 'Filter', [
    { id: 'synth.filter.type', kind: 'button', name: 'Filter Type', options: ['LP12', 'LP24', 'LP+HP', 'BP', 'HP', 'LP M'] },
    { id: 'synth.filter.envelope', kind: 'button', name: 'Filter Envelope', toggle: true },
    { id: 'synth.filter.freq', kind: 'knob', name: 'Filter Frequency', initial: 6.4, valueText: tenths },
    { id: 'synth.filter.res', kind: 'knob', name: 'Filter Resonance / HP Frequency', initial: 2.5, valueText: tenths },
    { id: 'synth.filter.env-amt', kind: 'knob', name: 'Filter Envelope Amount', initial: 5.6, valueText: tenths },
    { id: 'synth.filter.on', kind: 'button', name: 'Filter On', toggle: true, initial: 1 },
  ]),
  ...build('synth', 'Amp', [
    { id: 'synth.amp.envelope', kind: 'button', name: 'Amp Envelope', toggle: true },
    { id: 'synth.unison', kind: 'button', name: 'Synth Unison', options: ['Off', '1', '2', '3'] },
  ]),
  ...build('synth', 'LFO', [
    { id: 'synth.lfo.waveform', kind: 'button', name: 'LFO Waveform', options: ['Triangle', 'Saw', 'Ramp', 'Square', 'S/H'] },
    { id: 'synth.lfo.rate', kind: 'knob', name: 'LFO Rate / Time', initial: 4.2, valueText: tenths },
    { id: 'synth.lfo.mod-amt', kind: 'knob', name: 'LFO Modulation Amount', initial: 6.2, valueText: tenths },
    { id: 'synth.lfo.destination', kind: 'button', name: 'LFO Destination', options: ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter'] },
  ]),
  ...build('synth', 'Arpeggiator/Gate', [
    { id: 'synth.arp.rate', kind: 'knob', name: 'Arpeggiator Rate / Time', initial: 5.4, valueText: tenths },
    { id: 'synth.arp.mode', kind: 'button', name: 'Arpeggiator Mode', options: ['Poly', 'Arp', 'Gate'] },
    { id: 'synth.arp.range', kind: 'knob', name: 'Arpeggiator Range', min: 0, max: 4, step: 1, initial: 2 },
    { id: 'synth.arp.menu', kind: 'button', name: 'Arpeggiator Menu (direction / clock sync)', momentary: true },
  ]),
  ...build('synth', 'Voice', [
    { id: 'synth.voice.mode', kind: 'button', name: 'Voice Mode', options: ['Poly', 'Mono', 'Legato'] },
    { id: 'synth.voice.glide', kind: 'knob', name: 'Glide', initial: 0, valueText: tenths },
    { id: 'synth.vibrato.source', kind: 'button', name: 'Vibrato source', options: ['Off', 'Wheel', 'Delay', 'Aftertouch', 'Pedal'] },
    { id: 'synth.vibrato.menu', kind: 'button', name: 'Vibrato Menu (rate and amount preset)', momentary: true },
  ]),
]

/* ------------------------------------------------------------------ layer effects */

const effects: ControlSpec[] = [
  ...build('effects', 'FX Focus', [
    { id: 'fx.focus.organ', kind: 'button', name: 'FX Focus Organ / All FX Off', options: ['Organ A', 'Organ B'] },
    { id: 'fx.focus.piano', kind: 'button', name: 'FX Focus Piano', options: ['Piano A', 'Piano B'] },
    { id: 'fx.focus.synth', kind: 'button', name: 'FX Focus Synth', options: ['Synth A', 'Synth B', 'Synth C'] },
    { id: 'fx.shift', kind: 'button', name: 'Layer Effects Shift / Exit', toggle: true },
    { id: 'fx.section-on', kind: 'button', name: 'Layer Effects On', toggle: true, initial: 1 },
  ]),
  ...build('effects', 'Mod 1', [
    { id: 'fx.mod1.rate', kind: 'knob', name: 'Mod 1 Rate', initial: 3.6, valueText: tenths },
    { id: 'fx.mod1.amount', kind: 'knob', name: 'Mod 1 Amount', initial: 6.5, valueText: tenths },
    { id: 'fx.mod1.type', kind: 'button', name: 'Mod 1 type', options: ['A-Pan', 'Trem', 'RM', 'A-Wah', 'Wah', 'Pump'] },
    { id: 'fx.mod1.on', kind: 'button', name: 'Mod 1 On', toggle: true },
  ]),
  ...build('effects', 'Mod 2', [
    { id: 'fx.mod2.rate', kind: 'knob', name: 'Mod 2 Rate', initial: 5.6, valueText: tenths },
    { id: 'fx.mod2.amount', kind: 'knob', name: 'Mod 2 Amount', initial: 5.2, valueText: tenths },
    { id: 'fx.mod2.type', kind: 'button', name: 'Mod 2 type', options: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] },
    { id: 'fx.mod2.on', kind: 'button', name: 'Mod 2 On', toggle: true },
  ]),
  ...build('effects', 'Amp Sim/EQ', [
    { id: 'fx.amp.drive', kind: 'knob', name: 'Amp Sim Drive', initial: 2.4, valueText: tenths },
    { id: 'fx.amp.freq', kind: 'knob', name: 'EQ Mid Frequency', min: 0, max: 8, step: 1, initial: 4 },
    { id: 'fx.amp.bass', kind: 'knob', name: 'EQ Bass', min: -15, max: 15, step: 0.5, initial: 2, valueText: tenths },
    { id: 'fx.amp.mid', kind: 'knob', name: 'EQ Mid / Resonance', min: -15, max: 15, step: 0.5, initial: 3, valueText: tenths },
    { id: 'fx.amp.treble', kind: 'knob', name: 'EQ Treble', min: -15, max: 15, step: 0.5, initial: 2, valueText: tenths },
    { id: 'fx.amp.type', kind: 'button', name: 'Amp Sim type', options: ['Twin', 'JC', 'Small', 'To Rotary', 'LP Filter', 'HP Filter'] },
    { id: 'fx.amp.on', kind: 'button', name: 'Amp Sim/EQ On', toggle: true },
  ]),
  ...build('effects', 'Delay', [
    { id: 'fx.delay.tempo', kind: 'knob', name: 'Delay Tempo', initial: 3.5, valueText: tenths },
    { id: 'fx.delay.feedback', kind: 'knob', name: 'Delay Feedback', initial: 7, valueText: tenths },
    { id: 'fx.delay.dry-wet', kind: 'knob', name: 'Delay Dry/Wet', initial: 2.2, valueText: tenths },
    { id: 'fx.delay.effects', kind: 'button', name: 'Delay Effects', options: ['Off', 'Chorus', 'Vibe', 'Ensemble', 'Flam', 'Space'], initial: 3 },
    { id: 'fx.delay.filter', kind: 'button', name: 'Delay Filter', options: ['LP', 'BP', 'HP'] },
    { id: 'fx.delay.tap', kind: 'button', name: 'Delay Tap/Set', momentary: true },
    { id: 'fx.delay.on', kind: 'button', name: 'Delay On', toggle: true },
  ]),
  ...build('effects', 'Comp', [
    { id: 'fx.comp.amount', kind: 'knob', name: 'Compressor Amount', initial: 2.2, valueText: tenths },
    { id: 'fx.comp.on', kind: 'button', name: 'Compressor On', toggle: true },
  ]),
  ...build('effects', 'Reverb', [
    { id: 'fx.reverb.tone', kind: 'button', name: 'Reverb Tone', options: ['Normal', 'Bright', 'Dark'] },
    { id: 'fx.reverb.type', kind: 'button', name: 'Reverb type', options: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'], initial: 2 },
    { id: 'fx.reverb.dry-wet', kind: 'knob', name: 'Reverb Dry/Wet', initial: 6.4, valueText: tenths },
    { id: 'fx.reverb.on', kind: 'button', name: 'Reverb On', toggle: true },
  ]),
]

export const CONTROLS: readonly ControlSpec[] = [
  ...performance,
  ...organ,
  ...piano,
  ...program,
  ...synth,
  ...effects,
]

const BY_ID = new Map(CONTROLS.map((control) => [control.id, control]))

export function control(id: string): ControlSpec {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown control id: ${id}`)
  return found
}

export function controlsInSection(section: SectionId): readonly ControlSpec[] {
  return CONTROLS.filter((entry) => entry.section === section)
}

export function controlValueText(spec: ControlSpec, value: number): string {
  if (spec.options) return spec.options[Math.round(value)] ?? String(value)
  if (spec.toggle) return value >= 0.5 ? 'On' : 'Off'
  if (spec.momentary) return value >= 0.5 ? 'Pressed' : 'Released'
  if (spec.valueText) return spec.valueText(value)
  return String(value)
}
