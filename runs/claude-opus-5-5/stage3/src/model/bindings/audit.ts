// The Phase 3 control-binding audit: every visible control that is not functional is listed here
// with the spec clause that excludes it (or the optional feature this build does not claim).
// These controls still move/press/light as presentation only and are named in the UI notes.
// A test checks that FUNCTIONAL ∪ UNSUPPORTED covers every panel control exactly once.

export const UNSUPPORTED: Readonly<Record<string, string>> = {
  'organ-preset': 'Organ Preset/Drawbar Live modes and drawbar sync are excluded (organ spec scope.excluded)',
  'program-morph-at': 'Aftertouch as a morph source is excluded (programs spec scope.excluded)',
  'program-preset-organ': 'The Organ preset library is excluded (programs spec scope.excluded, manual p. 41–42)',
  'program-preset-piano': 'The Piano preset library is excluded (programs spec scope.excluded, manual p. 41–42)',
  'program-preset-synth': 'The Synth preset library is excluded (programs spec scope.excluded, manual p. 41–42)',
  'program-prog-view': 'Multi-view Prog View modes are optional and not implemented; Shift+Prog View (preset name) is excluded',
  'program-section-edit': 'Section Edit and Layer Init are excluded (programs spec scope.excluded, manual p. 43–44)',
  'program-mon-copy': 'Monitor/Copy/Paste/Swap are excluded (programs spec scope.excluded, manual p. 43–44)',
  'synth-mode': 'Samples mode is optional and not implemented; Extern mode is excluded (synth spec) — the engine is Analog only',
  'effects-delay-effects': 'Delay feedback-loop effects (Chor/Vibe/Ens/Flam/Space) are excluded (effects spec scope.excluded)',
}

/** Shift functions of functional controls that the specs exclude (ignored, never faked). */
export const UNSUPPORTED_SHIFT: Readonly<Record<string, string>> = {
  'performance-rotary-organ': 'Close Mic (excluded, effects spec)',
  'performance-rotary-stop-mode': 'Stop angle (excluded, effects spec)',
  'program-page-left': 'Bank (only one bank, programs spec)',
  'program-page-right': 'Bank (only one bank, programs spec)',
  'program-slot-1': 'System menu (excluded)',
  'program-slot-2': 'Sound menu (excluded)',
  'program-slot-3': 'Organize menu (excluded)',
  'program-slot-4': 'Aux KB menu (excluded)',
  'program-slot-5': 'Output menu (excluded)',
  'program-slot-6': 'Pedal menu (excluded)',
  'program-slot-7': 'MIDI menu (excluded)',
  'program-slot-8': 'Extern menu (excluded)',
  'synth-layer-c': 'Pan (not in the synth spec)',
  'synth-kb-hold': 'Exclude (per-layer KB Hold exclude is excluded, synth spec)',
  'synth-arp-menu': 'Arp Group mode (excluded, synth spec)',
  'synth-lfo-waveform': 'LFO Group mode (excluded, synth spec)',
  'synth-filter-type': 'Filter Group mode (excluded, synth spec)',
  'effects-delay-filter': 'Ping Pong (optional, not implemented)',
  'effects-mod1-type': 'Mod 1 pedal modes / Variations (excluded, effects spec)',
}

/** LEDs of excluded features that never light. */
export const UNSUPPORTED_LEDS: readonly string[] = [
  'organ-led-a-aux-kb',
  'organ-led-b-aux-kb',
  'piano-led-a-aux-kb',
  'piano-led-b-aux-kb',
  'synth-led-a-aux-kb',
  'synth-led-b-aux-kb',
  'synth-led-c-aux-kb',
  'organ-led-perc-poly',
  'program-led-pedal-tap',
  'program-led-num-pad',
  'program-led-midi',
  'program-led-extern',
  'synth-led-keep-edits',
  'synth-led-exclude',
  'synth-led-arp-pattern',
  'synth-led-lfo-group',
  'synth-led-filter-group',
  'piano-led-ped-noise',
  'performance-led-rotary-close-mic',
]
