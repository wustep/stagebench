# Phase 1 implementation plan — Nord Stage 4 73

Run: `claude-opus-5-5` · Variant: **Stage 4 73** (`stage-4-73`, 73 keys E–E, hammer action)

Assigned specs:

- `specs/nord-stage-4.visual.json` — surface geometry, section widths, landmarks, forbidden hardware, colors, presentation.
- `specs/nord-stage-4.piano.json` — Phase 1 subset only: one dependable basic piano voice, sustain input, truthful status.

Also read: `specs/nord-stage-4.variants.json` (stage-4-73 entry), `specs/benchmark-phases.json` (Phase 1),
`reference/nord-stage-4-73.jpg` (authoritative for layout/materials), `reference/manual.pdf` (pp. 23–26).

## Phase 1 hard gates (from `specs/benchmark-phases.json`)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Decisions

1. **Geometry source of truth.** The instrument is drawn in a fixed 1600 × 517 design space (aspect 3.0948 ≈ the measured
   3.0951) and scaled as one unit, so every ratio is exact at any viewport. Section widths use the photo-measured
   fractions of `nord-stage-4.visual.json` v1.4.0 (0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20). The stage prompt still
   lists the older coarse values (13/21/15/9/21/21); the spec's own note says those contradicted the photo and were
   corrected, and the photo is authoritative for layout, so the spec values win. This is recorded in the visual audit.
2. **Control placement** is measured from `nord-stage-4-73.jpg` (crops of the deck, converted to design px) and then
   linearly mapped into each spec section box, so the landmark order and density follow the photograph.
3. **Normalized hardware model.** `src/model/panel.ts` declares every control/LED/legend with a stable ID;
   `src/model/hardwareStore.ts` holds presentation state (button LED state index, knob/fader/drawbar values, press state).
   Nothing reads that store except the controls and their own LEDs/graphs: no audio, no program state.
4. **One note lifecycle.** `src/audio/noteEngine.ts` owns holders per note (pointer / touch / computer key / focused
   key / MIDI input+channel), sustain sources, voice allocation with deterministic stealing and all-notes-off.
   Every input adapter feeds it.
5. **Piano voice.** Honest synthesis: an additive, inharmonic, two-stage-decay piano tone is *generated* at load time
   for 25 root notes (every 3 semitones, E1–E7) into PCM buffers and played through
   `BufferSource → velocity low-pass → envelope gain → master gain → destination`. These are generated buffers, not
   recordings, and `IMPLEMENTATION_DETAILS.json` says so. If generation fails, a labeled live-oscillator fallback plays;
   if Web Audio is missing, status says so.
6. **Injectable boundaries.** `Runtime` provides the AudioContext factory, `requestMIDIAccess`, keyboard/blur event
   target, document (visibility) and the async yield used while generating tones. Tests use an in-repo sample-accurate
   Web Audio graph simulator (`src/testing/simAudio.ts`) that renders the real buffers and automation, plus fake MIDI.

## Order of work

1. Plan (this file) → typed key/section/control data with stable IDs → chassis, sections, exact keybed.
2. Section controls with accessible decorative interaction.
3. Runtime boundaries → note lifecycle → piano voice → input adapters (pointer, keyboard, MIDI).
4. Tests, browser pass with the parent capture harness, `evidence/` captures and `stage1-visual-audit.md`,
   `IMPLEMENTATION_DETAILS.json`, `tests/feature-matrix.json`.

## Verification status

- Feature coverage (`tests/feature-matrix.json`): `src/__tests__/model.test.ts` (key count, section layout,
  control inventory), `surface.test.tsx` (rendered surface, keys, decorative controls, accessibility,
  chassis), `inputs.test.ts` (computer keyboard + Web MIDI), `app.test.tsx` (status and cleanup),
  `noteEngine.test.ts` and `pianoAudio.test.ts` (lifecycle, sustain/polyphony, rendered audio).
- Visual audit: `evidence/stage1-visual-audit.md`. The parent harness captures the canonical PNGs at seal.
- Audio provenance: `IMPLEMENTATION_DETAILS.json` (generated buffers + labelled oscillator fallback, no recordings).
