# Phase 1 Implementation Plan — Nord Stage 4 (variant stage-4-73)

Assigned specs: `specs/nord-stage-4.visual.json` and `specs/nord-stage-4.piano.json`.

## Outcome

Build the entire visible Nord Stage 4 surface for the 73-key variant. Exactly two
things are functional:

1. The keybed plays one dependable piano voice (Web Audio).
2. Every visible control moves / presses / is accessibly operable.

Everything else is honestly decorative: it moves and shows presentation state but
changes no audio and reports no unimplemented behavior as working.

## Hard gates (from `specs/benchmark-phases.json` Phase 1) — checklist

- [ ] The exact keybed count and range for the assigned variant are modeled and playable. (73 keys, E–E.)
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Package gates

- [ ] `pnpm test` (vitest) — meaningful audio/interaction assertions, deterministic.
- [ ] `pnpm typecheck` — zero errors.
- [ ] `pnpm lint` — zero errors.
- [ ] `pnpm build` — produces `dist/index.html`.

## Architecture

- `src/model/` — typed normalized hardware model: keybed geometry (73 keys, E1..E7),
  section definitions, and the full control inventory with stable IDs, accessible
  names, roles, and value ranges. Source of truth for the surface.
- `src/audio/` — injectable audio boundary (`AudioBackend`), the piano voice
  (`PianoEngine`), and the deterministic note lifecycle. One AudioContext, polyphony
  with deterministic voice stealing, sustain, per-note release, all-notes-off.
- `src/input/` — injectable MIDI + timing boundaries; computer-keyboard mapping with
  repeat suppression and blur cleanup; Web MIDI note/velocity + CC64 sustain with
  denied/disconnected handling.
- `src/state/` — React store for decorative control presentation state (knob angles,
  fader positions, drawbar levels, button toggles, selector indices) — presentation
  only, wired to nothing sonic.
- `src/components/` — chassis, deck, the six sections, keybed, OLED displays, and the
  reusable control primitives (Knob, Fader, Drawbar, Button, Selector, Wheel, LED).
- `src/hooks/` — glue: `usePiano`, `useKeyboardInput`, `useMidiInput`.

## Order of work

1. Typed hardware/key model with stable IDs; chassis, sections, exact keybed.
2. Section controls with accessible decorative interaction (presentation state only).
3. Injectable audio/MIDI/timing boundaries, the note lifecycle, then the piano voice.
4. Tests, browser pass, canonical captures, and provenance.

## Honesty contract

The piano voice is honest synthesis (an FM-ish layered oscillator with a
velocity-shaped amplitude envelope), NOT a recorded sample set. This is declared in
`IMPLEMENTATION_DETAILS.json` under `generatedSources` with an empty `sampleSources`.
Recorded sample sets are Phase 2 scope. No decorative control fakes audio or state.
