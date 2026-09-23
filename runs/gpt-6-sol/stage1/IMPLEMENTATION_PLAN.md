# Phase 1 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, the Stage 4 73 variant entry, product photograph, and manual. The photograph and measured visual spec govern deck proportions where the phase prompt's coarse percentages disagree.

1. Model the continuous chassis, six ordered sections, 73 E–E keys, and each visible input with stable typed IDs.
2. Render the reference's dense controls as accessible buttons and sliders whose state affects presentation only.
3. Route pointer, keyboard, and MIDI input through one injectable note lifecycle and an honest synthesized piano voice.
4. Verify behavior, capture desktop and narrow views, and record measurements and audio provenance.

## Phase 1 Hard gates

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.
