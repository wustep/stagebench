# Phase 1 implementation plan

Assigned specs:

- `inputs/specs/nord-stage-4.visual.json`
- `inputs/specs/nord-stage-4.piano.json`
- Variant: `stage-4-73` from `inputs/specs/nord-stage-4.variants.json`

## Phase 1 hard gates — explicit acknowledgement

The following five hard gates are explicitly acknowledged from Phase 1 of `inputs/specs/benchmark-phases.json` and are the acceptance criteria for this candidate:

1. The exact keybed count and range for the assigned variant are modeled and playable.
2. The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
3. The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
4. Every visible panel control moves or presses accessibly but truthfully does nothing else.
5. Canonical desktop and narrow captures are complete with a written visual audit.

## Hard-gate checklist

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Delivery sequence

1. Model the 73-key E-to-E keyboard, typed hardware controls, chassis, and six documented sections.
2. Add accessible decorative controls with normalized presentation state.
3. Add an injectable generated Web Audio piano voice and shared note lifecycle for pointer, keyboard, MIDI, sustain, and cleanup.
4. Add deterministic tests, feature evidence, provenance, and the visual audit for the parent capture harness.
