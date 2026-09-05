# Phase 1 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, the Stage 4 73 entry in `inputs/specs/nord-stage-4.variants.json`, `inputs/reference/nord-stage-4-73.jpg`, and manual pp. 23–26.

The visual spec v1.4 corrects the prompt's obsolete section percentages; use photo-measured 14/20/8.5/12.5/25/20, 54/46 vertical allocation, aspect ratio 3.0951, and 73 hammer-action keys E1–E7 (43 white, 30 black).

## Hard gates
- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Sequence
1. Typed normalized hardware inventory and exact key geometry; continuous chassis with reference section placements.
2. Accessible presentation-only controls, differentiated panel groups, static honest OLED text.
3. Injectable audio, MIDI and event boundaries; unified owner-based lifecycle and generated piano-like buffers, sustain and deterministic voice stealing.
4. Deterministic signal and lifecycle tests, interaction/accessibility tests, feature matrix.
5. Run required checks, inspect in browser, use parent capture harness and record measurements and provenance.

All changes and evidence stay within candidate/. No panel function beyond presentation is claimed. No sampled recordings, network assets or storage are needed.
