# Phase 1 implementation plan — Nord Stage 4 73

Assigned variant: `stage-4-73` (73-key hammer action, E1–E7).

Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`.

Phase 1 of `specs/nord-stage-4.piano.json` is one dependable piano voice. Everything else in that file stays decorative. The visual spec fixes the silhouette, the 54/46 deck/keybed split, and the photo-corrected section fractions (performance 0.14, organ 0.20, piano 0.085, program 0.125, synth 0.25, effects 0.20).

## Hard gates

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Order of work

1. Normalized hardware and key model with stable ids (`src/model`).
2. Continuous red chassis, six sections, and the 73-key keybed (`src/components`, `src/styles.css`).
3. Presentation store for decorative knobs, faders, drawbars, wheels, sticks, and buttons.
4. Injectable audio/MIDI/timer boundaries, one note lifecycle, and the additive piano voice.
5. Feature tests, package gates, and `evidence/` captures plus `evidence/stage1-visual-audit.md`.

## Honesty

Panel controls update `PresentationStore` only. The program OLED reports the real piano-engine status (`idle`, `loading`, `ready`, `error`, `fallback`). It does not name a loaded program. The synth OLED stays on “decorative”. The piano is live synthesis, declared in `IMPLEMENTATION_DETAILS.json`, not a sample recording.
