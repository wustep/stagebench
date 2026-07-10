# Phase 1 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json` and `inputs/specs/nord-stage-4.piano.json`.

1. Model the Stage 4 73 chassis, its E-to-E 73-note hammer-action keybed, and the six reference-driven control areas.
2. Put every rendered panel input in a normalized presentation model with a stable identifier, accessible label, keyboard operation, and no functional panel binding.
3. Route pointer, touch, computer keys, Web MIDI, and sustain through one note lifecycle into a small, deterministic Web Audio piano-like synthesizer.
4. Cover the feature matrix with interaction and lifecycle tests; record source provenance and visual measurements.

## Phase 1 hard gates — explicitly acknowledged

The following is copied verbatim from `inputs/specs/benchmark-phases.json` and acknowledged by this implementation:

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.
