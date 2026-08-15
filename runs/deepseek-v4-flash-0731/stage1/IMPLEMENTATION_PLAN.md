# Stage 1 — Implementation plan (Nord Stage 4 73)

Phase 1: complete visible surface + basic playable piano.

## Specs cited

- `nord-stage-4.visual.json` — surface geometry, sections, colors, topography, viewport constraints.
- `nord-stage-4.piano.json` — basic one-voice piano behaviour, note lifecycle, inputs, sustain, status/fallback honesty.
- `inputs/TASK.md` and `inputs/specs/benchmark-phases.json` — Phase 1 scope and shared completion gates.

## Order of work

1. **Hardware data model** (`src/hardware/`): typed keys, sections, control inventory with stable IDs; the 73-key E1–E7 keybed (43 white / 30 black), six deck sections at their documented widths, and a single continuous red chassis.
2. **Hardware presentation store** (`src/hardware/store.ts`): normalized, React-observable presentation state keyed by control id; moving a control updates nothing but this map.
3. **Section controls** (`src/components/`): every visible control (knob, fader, drawbar, encoder, wheel, stick, button, OLED, LED graph) as an accessible, pointer- and keyboard-operable element that stores its presentation state only.
4. **Audio / timing boundary** (`src/audio/`): a pure-DSP, sample-accurate, honestly synthesized piano voice on an injectable clock; tests render real PCM.
5. **Note lifecycle + inputs** (`src/piano/`): one shared lifecycle for pointer, multi-touch, computer keyboard (repeat-suppressed, blur cleanup), and Web MIDI (note/velocity/sustain CC64, denied/disconnected) — plus truthful loading/ready/error/fallback status.
6. **Tests, browser pass, captures, provenance.**

## Phase 1 hard gates (checklist)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.