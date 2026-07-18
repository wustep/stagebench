# Phase 1 Implementation Plan — Nord Stage 4 73

Assigned specs:

- `specs/nord-stage-4.visual.json` — shared control-deck geometry, section
  landmarks, colors, presentation rules.
- `specs/nord-stage-4.piano.json` — piano behavior (Phase 1 subset only: one
  dependable basic piano voice played from the keybed).
- Variant: `stage-4-73` from `specs/nord-stage-4.variants.json`
  (73 keys, E–E, hammer action, aspect ratio ≈ 3.095).

## Hard gates checklist (copied from `specs/benchmark-phases.json`, Phase 1)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Architecture

1. **Hardware model** (`src/hardware/`): typed, normalized control/key tables
   with stable IDs (`perf.masterLevel`, `organ.drawbar.1`, `key.e1`, …).
   Presentation state lives in one store keyed by control ID and changes
   nothing but visuals — the honesty contract.
2. **Surface** (`src/components/`): one continuous red chassis; six sections at
   the spec fractions (Performance 14 / Organ 20 / Piano 8.5 / Program 12.5 /
   Synth 25 / Effects 20); 54/46 deck/keybed split; 73-key keybed
   (E1–E7, 43 white / 30 black).
3. **Audio** (`src/audio/`): injectable `AudioBackend` (real WebAudio backend +
   deterministic fake for tests), a voice manager with fixed polyphony,
   deterministic oldest-first stealing, velocity, release, sustain (UI + CC64),
   and all-notes-off. The Phase 1 voice is honestly synthesized
   (multi-partial additive piano with per-note detune and decay) — declared as
   generated, never described as a recording.
4. **Inputs** (`src/input/`): pointer with independent multi-touch tracking,
   computer-keyboard map with repeat suppression and blur cleanup, injectable
   Web MIDI with denied/disconnected states.
5. **Tests** (`src/**/*.test.ts(x)`, `tests/feature-matrix.json`): every
   Phase 1 feature ID maps to real, non-empty test files; audio tests use the
   deterministic fake backend and tolerant signal relationships.
