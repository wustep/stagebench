# Implementation plan — Phase 1 (Stage 4 73)

Assigned specs: `specs/nord-stage-4.visual.json` and `specs/nord-stage-4.piano.json`
(variant entry `stage-4-73` in `specs/nord-stage-4.variants.json`, reference `reference/nord-stage-4-73.jpg`).

## Phase 1 hard gates (checklist)

- [ ] The exact keybed count and range for the assigned variant are modeled and playable. (73 keys, E1–E7, 43 white / 30 black)
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Architecture

1. **Geometry** (`src/hardware/geometry.ts`): all panel coordinates are authored from crops of the reference
   photo and converted to *instrument units* (`u` = 1/1000 of instrument width). Six sections have the
   fractions from `visual.json` (0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20). Deck = 54 % of height, keybed = 46 %.
2. **Hardware model** (`src/hardware/*`): typed, data-driven control specs with stable ids, one per section file
   in `src/hardware/panel/`. A normalized store (`store.ts`) holds *presentation state only* (values + held flags).
   Nothing outside the UI subscribes to it — in particular the audio graph never reads it.
3. **Keybed** (`src/hardware/keybed.ts`): 73 keys E1 (MIDI 28) … E7 (MIDI 100), white/black geometry from the
   variant measurements (black key height 0.61).
4. **Audio** (`src/audio/*`): injectable `AudioFactory`, `Scheduler`, MIDI provider and event targets.
   `NoteLifecycle` (pure logic: holders, sustain, polyphony, deterministic stealing) → `VoiceSink`
   (`WebAudioPianoSink`: generated additive-piano buffers, oscillator fallback, master gain + limiter).
5. **Inputs** (`src/input/*`): pointer/multi-touch (in the Keybed component), computer keyboard with repeat
   suppression, Web MIDI (note/velocity/CC64, denied/unsupported/disconnected), page blur/hidden cleanup.
6. **UI** (`src/ui/*`): controls (knob, encoder, fader, drawbar, wheel, button/selector/tag), OLEDs that only show
   real state, status bar.

## Evidence

- `tests/feature-matrix.json` maps every Phase 1 feature id to real test files.
- `stage1-visual-audit.md`, `stage1-desktop.png`, `stage1-narrow.png`, `stage1-capture.json`.
- `IMPLEMENTATION_DETAILS.json` truthfully describes the audio source (generated additive-synthesis buffers — not recordings).
