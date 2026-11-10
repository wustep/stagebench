/**
 * Which panel controls are functional in Phase 2, as plain data. Everything not listed here
 * is decorative: it moves or presses, and changes nothing but its own look.
 *
 * Functional controls are still only *positions* in the hardware store. What they mean lives
 * in src/state; the binder in src/state/binding.ts connects the two.
 */

export const FUNCTIONAL_BUTTON_IDS = [
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
  'fx-on',
  'fx-focus-piano',
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
  'rotary-stop-mode',
  'rotary-speed',
  'shift',
  'fx-shift',
] as const

export const FUNCTIONAL_RANGE_IDS = [
  'piano-layer-a-level',
  'piano-layer-b-level',
  'piano-model',
  'perf-master-level',
  'perf-pitch-stick',
  'rotary-drive',
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
 * Controls inside the Piano, Layer Effects, and Rotary areas that stay decorative in Phase 2,
 * with the reason. They are listed as unsupported in IMPLEMENTATION_DETAILS.json.
 */
export const UNSUPPORTED_IN_FUNCTIONAL_SECTIONS: Readonly<Record<string, string>> = {
  'fx-focus-organ': 'Organ effects arrive with the Organ engine in Phase 3.',
  'fx-focus-synth': 'Synth effects arrive with the Synth engine in Phase 3.',
  'fx-delay-effects': 'Delay feedback-loop effects are excluded by the effects spec.',
  'rotary-source': 'Routes the Organ into the Rotary; there is no Organ engine until Phase 3.',
  'perf-mod-wheel': 'Morph and modulation destinations are Phase 3.',
}
