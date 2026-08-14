# Phase 1 implementation plan

Assigned specs (filenames only, as provided in this workspace):

- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.piano.json`

Assigned variant: Stage 4 73 (`specs/nord-stage-4.variants.json`).

## Hard gates (Phase 1)

Copied from `specs/benchmark-phases.json`:

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Approach

1. Typed hardware model: 73-key E–E keybed, six deck sections at the visual-spec fractions, stable control IDs.
2. One continuous red chassis; decorative panel state only (no fake program/effect audio).
3. Injectable audio / MIDI / clock boundaries; one synthesized piano-like voice with a shared note lifecycle.
4. Feature-matrix tests for every Phase 1 ID; truthful `IMPLEMENTATION_DETAILS.json`; `stage1-visual-audit.md`.

Audio: live additive synthesis (generated), not recordings. Panel knobs including Master Level are decorative in this phase; only keybed notes and sustain input affect sound.
