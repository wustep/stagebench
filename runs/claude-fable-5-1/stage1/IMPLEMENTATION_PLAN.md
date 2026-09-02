# Phase 1 implementation plan — Nord Stage 4 73 (Stagebench)

Assigned specs: `specs/nord-stage-4.visual.json` (v1.4.0, surface geometry and section
landmarks) and `specs/nord-stage-4.piano.json` (v2.0.0, Phase 1 subset: one basic piano voice).
Variant: `stage-4-73` from `specs/nord-stage-4.variants.json` (73 keys, E1–E7 = MIDI 28–100, 43 white / 30 black,
hammer action, aspect ratio 3.0951). Reference photo: `reference/nord-stage-4-73.jpg`.
Manual: `reference/manual.pdf` (edition N, OS 1.6x) is the authority where a spec is ambiguous.

## Phase 1 hard gates (from `specs/benchmark-phases.json`)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Shared completion gates

- [x] All benchmark-owned and candidate-authored tests pass (`pnpm test`).
- [x] The browser console contains no errors during the required interaction pass (checked by `scripts/capture.mjs`, recorded in `evidence/stage1-capture.json`).
- [x] Every claimed audio feature is connected to the audible signal graph (voice → master gain → destination; tested).
- [x] `IMPLEMENTATION_DETAILS.json` accurately distinguishes recorded samples, generated buffers, and live synthesis (Phase 1 uses generated buffers only).

## Order of work

1. This plan.
2. Normalized typed hardware data (`src/hardware/`): keybed model with stable key IDs (`key-<midi>`), section table with
   the documented fractions (performance 0.14, organ 0.20, piano 0.085, program 0.125, synth 0.25, effects 0.20), and the full
   control inventory with stable IDs (`<section>.<group>.<control>`), kinds, legends, LEDs and photo-measured frames.
3. Chassis, deck, sections and exact keybed rendering (`src/ui/`), with decorative interaction stored in a normalized
   presentation store (`src/state/hardwareStore.ts`). Presentation state changes nothing else.
4. Injectable boundaries (`src/audio/boundaries.ts`): audio context factory, MIDI access, timers. Deterministic note
   lifecycle (`src/input/noteBus.ts`, `src/audio/engine.ts`), then the generated piano voice (`src/audio/pianoRenderer.ts`).
5. Tests per feature ID (`tests/`), browser interaction pass and canonical captures (`scripts/capture.mjs` →
   `evidence/stage1-desktop.png`, `evidence/stage1-narrow.png`, `evidence/stage1-capture.json`), `evidence/stage1-visual-audit.md`, provenance in
   `IMPLEMENTATION_DETAILS.json`, and `tests/feature-matrix.json`.

## Honesty rules applied

- Panel controls only update presentation state (knob angle, fader position, LED, pressed). No audio, no program state.
- The two OLEDs show truthful Phase 1 status text; they never show fake program names or unimplemented features as working.
- The piano voice is honest additive synthesis rendered into generated buffers, declared as generated, never as recordings.
- Audio status is reported as idle / loading / ready / error / fallback exactly as the engine observes it.

## Environment notes

- The box provides Node 20.19 while the declared `pnpm@11.7.0` needs Node ≥ 22.13, so all pnpm commands in this
  workspace were run through `corepack pnpm@10.17.1` (same lockfile format 9.0). `playwright-core` was added as a
  devDependency for `scripts/capture.mjs`; `lint` was narrowed to `oxlint src tests scripts` so it does not scan
  `node_modules`. Vitest test/hook timeouts were raised to 30 s because every UI test renders the full instrument in jsdom.
- Web MIDI reports `denied` in headless Chrome; the captures record that truthfully.
