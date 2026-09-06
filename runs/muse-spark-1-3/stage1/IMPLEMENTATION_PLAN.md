# IMPLEMENTATION_PLAN.md — Phase 1: Complete surface and basic piano

Specs read (workspace `inputs/`):
- `specs/nord-stage-4.visual.json` (v1.4.0) — control-deck geometry, section landmarks, forbidden-hardware rules, presentation gates.
- `specs/nord-stage-4.piano.json` (v2.0.0) — piano behavior; only the Phase 1 subset applies (one dependable basic voice).
- `specs/nord-stage-4.variants.json` — assigned variant **stage-4-73** (73 keys, 43 white / 30 black, E–E, MIDI 28–100).
- `specs/benchmark-phases.json` (protocol v2.0.0) — Phase 1 outcome, exclusions, hard gates.
- Reference photo `reference/nord-stage-4-73.jpg` (authoritative for visible layout/materials).

## Phase 1 hard gates (checklist)

- [ ] The exact keybed count and range for the assigned variant are modeled and playable. (73 keys, E1–E7, MIDI 28–100.)
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Geometry decisions (photo wins on conflict)

- Section fractions from `nord-stage-4.visual.json` (photo-measured 2026-07-04 correction):
  performance 0.14 / organ 0.20 / piano 0.085 / program 0.125 / synth 0.25 / effects 0.20.
  The `prompts/stage1.md` percentages (13/21/15/9/21/21) are the superseded coarse values
  the visual spec explicitly corrects — deviation recorded in `stage1-visual-audit.md`.
- Vertical deck/keybed split 54/46 (±0.025 tolerance).
- Desktop 1440×900: instrument 88–97% viewport width, no vertical scroll, no page overflow.
  Narrow 390×844: instrument keeps a minimum usable width inside a page-safe horizontal
  scroller (body never overflows) so it stays inspectable without clipping.
- Forbidden-hardware rules implemented structurally: no display element in performance or
  effects; no wide (≥0.5 section) display in organ/piano/synth; program has exactly one
  primary OLED (any secondary readout < 0.5 of its area); organ keeps 9 tall drawbars
  (never a uniform grid); synth uses varied control sizes + grouped sub-panels; effects is
  two visibly separated groups. Piano band has only 2 tall faders (no drawbar bank).

## Work order

1. Normalized typed hardware/key data with stable IDs (`src/hardware/keys.ts`,
   `src/hardware/sections.ts`): keybed E1–E7, six sections, full control inventory.
2. Chassis, sections, exact keybed (`src/components/*`, `src/App.tsx`, `src/styles.css`):
   one continuous red chassis, dark inset plates (performance stays exposed red),
   decorative accessible controls backed by a normalized presentation-only hardware store
   (`src/state/stage.tsx`) that changes no audio/system state.
3. Injectable audio/MIDI/timing boundaries, then note lifecycle, then piano voice:
   - `src/audio/dsp.ts` — pure deterministic DSP (midi→freq, velocity→gain, additive
     piano-note renderer, RMS/tail helpers, deterministic steal-victim selection).
   - `src/audio/engine.ts` — `PianoEngine` over an injected `AudioContextLike`
     (master gain → destination; per-note buffer source + gain; sustain hold; stealing;
     status idle/loading/ready/error/silent-fallback). `src/audio/fakes.ts` test doubles.
   - `src/audio/lifecycle.ts` — `NoteManager` (per-source refcount, retrigger,
     sustain-aware release, all-notes-off).
   - `src/midi/midi.ts` — `MidiManager` (pending/connected/denied/disconnected/
     unavailable/error; note on/off, velocity, CC64 sustain; injectable access).
   - Computer-key map (C4-based, repeat suppression, blur cleanup) + Space-as-sustain
     only when the event target is the page body.
4. Honesty: one synthesized basic piano voice, declared as live synthesis + generated
   buffers in `IMPLEMENTATION_DETAILS.json` (`sampleSources: []` — no recordings claimed).
   Panel OLEDs show static text that never reports unimplemented features as working.
5. Tests (`src/*.test.*`, mapped in `tests/feature-matrix.json`, one or more real files
   per required feature ID) with deterministic fakes — no network, devices, or audio out.
6. Evidence: `stage1-desktop.png`, `stage1-narrow.png`, `stage1-capture.json`,
   `stage1-visual-audit.md`; truthful `IMPLEMENTATION_DETAILS.json`; final
   `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Phase 1 scope discipline

Functional: keybed notes + sustain input (UI, computer key, MIDI CC64) through one
lifecycle into one piano voice with loading/ready/error/fallback status. Everything else
(keys depress, buttons light, knobs turn, faders/drawbars slide) is presentation state
only: no audio, no fake program/effect state. Phase 2+ behavior (piano types/models,
effects, organ, synth, programs) stays decorative.
