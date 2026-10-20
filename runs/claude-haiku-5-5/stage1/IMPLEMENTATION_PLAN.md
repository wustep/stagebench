# Phase 1 implementation plan — Nord Stage 4 73 (stage-4-73)

Governing specs:

- `specs/nord-stage-4.visual.json` (surface geometry, section fractions, landmarks, forbidden-hardware rules)
- `specs/nord-stage-4.piano.json` (basic piano voice; Phase 1 subset only)

Also read: `TASK.md`, `specs/benchmark-phases.json` (Phase 1 contract), `specs/nord-stage-4.variants.json` (variant `stage-4-73`: 73 keys, 43 white, 30 black, E to E, hammer action), `reference/nord-stage-4-73.jpg`.

## Phase 1 hard gates (copied from `specs/benchmark-phases.json`)

- [ ] The exact keybed count and range for the assigned variant are modeled and playable.
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Feature IDs to maintain (`tests/feature-matrix.json`)

`visual.key-count`, `visual.section-layout`, `visual.control-inventory`, `interaction.keys`, `interaction.decorative-controls`, `accessibility.controls`, `piano.basic-note-lifecycle`, `piano.basic-inputs`, `piano.basic-sustain-polyphony`, `piano.basic-status-cleanup`, `regression.chassis`.

## Architecture

Layers, bottom to top. Nothing above a layer reaches below it except through the injected boundary.

1. `src/model/` — pure typed data. `keybed.ts` builds the 73-key map (MIDI 28 E1 to MIDI 100 E7). `sections.ts` holds the six section fractions and the 54/46 split. `hardware.ts` is the normalized control inventory (stable IDs, section, kind, accessible name, group/row) plus a presentation-only reducer.
2. `src/audio/` — injectable boundary. `audioBoundary.ts` defines the minimal Web Audio surface the piano needs and a browser implementation. `pianoVoice.ts` is the one basic piano voice (live additive synthesis, no samples). A fake boundary is used by tests.
3. `src/input/` — input adapters that only translate events into note intents: `computerKeys.ts` (key map, repeat suppression), `midi.ts` (Web MIDI access, denied/disconnected states, note/velocity/CC64 parsing, injectable access factory).
4. `src/engine/noteController.ts` — the single note lifecycle shared by pointer, touch, keyboard, and MIDI: held-source tracking, repeat-safe on/off, sustain, polyphony with deterministic stealing, all-notes-off cleanup. Pure logic with injected voice factory and timers.
5. `src/components/` — presentational React. Keybed, generic control components (Knob, Fader, Drawbar, Wheel, PitchStick, Button, Oled) that read and write only the presentation reducer.
6. `src/App.tsx` — composes the chassis from the inventory, the keybed, the engine hook, and the status line.

## Decisions and declared choices

- Audio source: **live synthesis** (additive partials with inharmonicity, generated in the browser). No recordings are bundled in Phase 1; `IMPLEMENTATION_DETAILS.json` says so explicitly. The piano spec allows honest synthesis for Phase 1.
- Pointer and computer-keyboard velocity: fixed at 100 in Phase 1 (KB Touch is Phase 2). MIDI uses the incoming velocity.
- Sustain: computer key `Shift`, MIDI CC64, and a virtual sustain pedal placed outside the chassis and labelled as virtual.
- Computer keys: `A W S E D F T G Y H U J K O L P ;` = C4 through E5 (MIDI 60–76). Octave shift is a panel control and stays decorative in Phase 1.
- Narrow viewport (390x844): the instrument keeps its designed width (a minimum width inside a horizontal scroll region) so it is inspectable rather than squeezed to ~116px tall. Declared as a deviation in the visual audit.
- Program and Synth OLEDs show honest "not active in Phase 1" text. Every other section has no OLED-classed element.
- Presentation state (knob values, LED/button pressed, fader/drawbar positions) lives in one reducer and never reaches audio.

## Order of work

1. This plan.
2. Typed keybed and hardware inventory; chassis, sections, exact keybed rendering.
3. Section controls with accessible decorative interaction.
4. Audio boundary, note controller, computer keys, MIDI adapter, then the piano voice.
5. Tests, browser pass, canonical captures, provenance manifest, visual audit.
