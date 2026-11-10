/**
 * Which panel controls are functional, as plain data. In Phase 3 that is every control the
 * specs do not exclude: 135 of the 146. The other 11 are listed in UNSUPPORTED_CONTROLS with
 * the reason; they still move or press, and change nothing but their own look.
 *
 * Functional controls are still only *positions* in the hardware store. What they mean lives
 * in src/state; the binder in src/state/binding.ts connects the two.
 */

export const FUNCTIONAL_BUTTON_IDS = [
  // Performance band: Rotary Speaker.
  'rotary-source',
  'rotary-stop-mode',
  'rotary-speed',
  // Organ.
  'organ-on',
  'organ-layer-a',
  'organ-layer-b',
  'organ-octave-down',
  'organ-octave-up',
  'organ-model',
  'organ-vibrato-type',
  'organ-vibrato-on',
  'organ-perc-volume-soft',
  'organ-perc-decay-fast',
  'organ-perc-harmonic-third',
  'organ-perc-on',
  // Piano.
  'piano-on',
  'piano-layer-a',
  'piano-layer-b',
  'piano-timbre',
  'piano-octave-down',
  'piano-octave-up',
  'piano-acoustics',
  'piano-unison',
  'piano-kb-touch',
  'piano-dyn-comp',
  'piano-type',
  // Program.
  'morph-wheel',
  'morph-control-pedal',
  'split',
  'mst-clk',
  'transpose',
  'store',
  'page-prev',
  'page-next',
  'live-mode',
  'layer-scene',
  'program-1',
  'program-2',
  'program-3',
  'program-4',
  'program-5',
  'program-6',
  'program-7',
  'program-8',
  // Synth.
  'synth-on',
  'synth-layer-a',
  'synth-layer-b',
  'synth-layer-c',
  'synth-kb-hold',
  'synth-arp-run',
  'synth-octave-down',
  'synth-octave-up',
  'synth-waveform',
  'synth-lfo-waveform',
  'synth-lfo-dest',
  'synth-osc-pitch',
  'synth-osc-envelope',
  'synth-arp-mode',
  'synth-arp-menu',
  'synth-voice-mode',
  'synth-vibrato-mode',
  'synth-vibrato-menu',
  'synth-filter-type',
  'synth-filter-envelope',
  'synth-filter-on',
  'synth-amp-envelope',
  'synth-unison',
  // Layer Effects.
  'fx-on',
  'fx-focus-organ',
  'fx-focus-piano',
  'fx-focus-synth',
  'fx-mod1-type',
  'fx-mod1-on',
  'fx-mod2-type',
  'fx-mod2-on',
  'fx-amp-type',
  'fx-amp-on',
  'fx-delay-tap',
  'fx-delay-filter',
  'fx-delay-on',
  'fx-comp-on',
  'fx-reverb-tone',
  'fx-reverb-type',
  'fx-reverb-on',
  'shift',
  'fx-shift',
] as const

export const FUNCTIONAL_RANGE_IDS = [
  'perf-master-level',
  'perf-pitch-stick',
  'perf-mod-wheel',
  'rotary-drive',
  'organ-layer-a-level',
  'organ-layer-b-level',
  'organ-drawbar-1',
  'organ-drawbar-2',
  'organ-drawbar-3',
  'organ-drawbar-4',
  'organ-drawbar-5',
  'organ-drawbar-6',
  'organ-drawbar-7',
  'organ-drawbar-8',
  'organ-drawbar-9',
  'piano-layer-a-level',
  'piano-layer-b-level',
  'piano-model',
  'program-dial',
  'synth-layer-a-level',
  'synth-layer-b-level',
  'synth-layer-c-level',
  'synth-osc-dial-1',
  'synth-osc-dial-2',
  'synth-osc-dial-3',
  'synth-lfo-amount',
  'synth-lfo-rate',
  'synth-osc-ctrl',
  'synth-osc-env-amt',
  'synth-arp-rate',
  'synth-arp-range',
  'synth-glide',
  'synth-filter-env-amt',
  'synth-filter-freq',
  'synth-filter-res',
  'fx-mod1-rate',
  'fx-mod1-amount',
  'fx-mod2-rate',
  'fx-mod2-amount',
  'fx-drive',
  'fx-eq-bass',
  'fx-eq-mid-freq',
  'fx-eq-mid',
  'fx-eq-treble',
  'fx-delay-tempo',
  'fx-delay-mix',
  'fx-delay-feedback',
  'fx-comp-amount',
  'fx-reverb-mix',
] as const

export const FUNCTIONAL_CONTROL_IDS: readonly string[] = [...FUNCTIONAL_BUTTON_IDS, ...FUNCTIONAL_RANGE_IDS]

/** The two Shift buttons act as one modifier. */
export const SHIFT_BUTTON_IDS = ['shift', 'fx-shift'] as const

/**
 * Every control that stays decorative, with the reason. Each one is cut by a spec's `excluded`
 * list, or belongs to a spec's `optional` list and is not implemented. They are listed as
 * unsupported in the page's notes and in IMPLEMENTATION_DETAILS.json.
 */
export const UNSUPPORTED_CONTROLS: Readonly<Record<string, string>> = {
  'morph-aftertouch': 'Aftertouch is excluded as a morph source (programs spec): browser keyboards have none.',
  'prog-view': 'Multi-view Prog View modes are optional in the programs spec and not implemented.',
  'preset-organ': 'The Organ preset library is excluded by the programs spec.',
  'preset-piano': 'The Piano preset library is excluded by the programs spec.',
  'preset-synth': 'The Synth preset library is excluded by the programs spec.',
  solo: 'Solo is optional in the programs spec and not implemented.',
  'section-edit': 'Section Edit and Layer Init are excluded by the programs spec.',
  'mon-copy': 'Monitor / Copy / Paste are excluded by the programs spec.',
  'organ-preset': 'Organ Preset / Drawbar Live modes and drawbar sync are excluded by the organ spec.',
  'synth-mode': 'Samples mode is optional and Extern is excluded in the synth spec; the Synth is always in Analog mode.',
  'fx-delay-effects': 'Delay feedback-loop effects are excluded by the effects spec.',
}

/** Kept under its Phase 2 name for the suites that were written against it. */
export const UNSUPPORTED_IN_FUNCTIONAL_SECTIONS = UNSUPPORTED_CONTROLS

/**
 * Functions reached with Shift (or by holding) that a spec excludes or leaves optional. The
 * control itself is functional; this one function reports that it is not available and
 * changes nothing.
 */
export const UNSUPPORTED_FUNCTIONS: Readonly<Record<string, string>> = {
  'Shift + Piano Type (Info)': 'Piano INFO view is excluded by the piano spec.',
  'Shift + Piano Acoustics (Ped Noise)': 'Pedal noise is excluded by the piano spec.',
  'Shift + Piano Model dial (List)': 'The piano model list view is optional and not implemented.',
  'Shift + effect type selector (Variation / Chorale)': 'Per-type Variations and Reverb Chorale are excluded by the effects spec.',
  'Shift + Delay Tap (Analog)': 'Delay Analog mode is excluded by the effects spec.',
  'Shift + Rotary Stop Mode (Angle)': 'Rotary stop angle is excluded by the effects spec.',
  'Shift + Rotary Organ (Close Mic)': 'Rotary close mic is excluded by the effects spec.',
  'Shift + Percussion Volume Soft (Poly)': 'Percussion poly mode is optional in the organ spec and not implemented.',
  'Shift + Page (Bank)': 'Banks beyond one are excluded by the programs spec.',
  'Shift + Mst Clk (Pedal Tap)': 'Pedal tap and external MIDI clock are excluded by the programs spec.',
  'Shift + Synth Layer C (Pan)': 'Layer pan is not part of the synth spec.',
  'Shift + KB Hold (Exclude)': 'Per-layer KB Hold exclude is excluded by the synth spec.',
  'Shift + Arp Mode (Pattern)': 'Arpeggiator pattern editing is excluded by the synth spec.',
  'Shift + LFO Waveform / Filter Type / Arp Menu (Group)': 'Filter, LFO, and Arp Group modes are excluded by the synth spec.',
  'Vibrato mode A.T.': 'Aftertouch vibrato is optional in the synth spec and skipped: browser keyboards have no aftertouch.',
}
