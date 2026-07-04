# Phase 1 Implementation Plan — Nord Stage 4 73

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`

Variant: **Stage 4 73** (`stage-4-73`) — 73 keys, E–E range, hammer action.

## Hard gates (from `specs/benchmark-phases.json`)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Build order

1. Typed hardware model with stable control IDs and 73-key keybed geometry.
2. Chassis layout: 54/46 deck/keybed split, six sections at 13/21/15/9/21/21%.
3. Section panels with ~150 decorative controls (presentation state only).
4. Injectable audio/MIDI/timing boundaries and note lifecycle.
5. Basic piano voice (honest additive synthesis for Phase 1).
6. Tests for every Phase 1 feature ID in `tests/feature-matrix.json`.
7. `IMPLEMENTATION_DETAILS.json`, `evidence/stage1-visual-audit.md`, gate verification.

## Phase 1 honesty contract

Panel controls update presentation state only — no audio, no fake program/effect behavior. Only keybed notes and sustain input are functional.
