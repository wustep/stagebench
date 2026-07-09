# Phase 1 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json` and `inputs/specs/nord-stage-4.piano.json`, with the Stage 4 73 variant selected from `inputs/specs/nord-stage-4.variants.json`.

## Build plan

1. Model the E1–E7 73-key hammer-action keybed and every visible panel control as typed data with stable IDs.
2. Build one continuous 3.0951:1 red chassis, the 54/46 deck/keybed split, and the six corrected photo-measured section widths (14%, 20%, 8.5%, 12.5%, 25%, 20%).
3. Render accessible, keyboard-operable decorative buttons, knobs, faders, drawbars, wheels, and encoders whose normalized presentation state is isolated from sound state.
4. Route pointer, independent pointer/touch, mapped computer keys, and Web MIDI through one deterministic note lifecycle and an injectable synthesized piano voice.
5. Cover sustain, velocity, overlap, release, bounded polyphony, deterministic stealing, disconnected/denied MIDI, and cleanup without requiring audio hardware, MIDI hardware, or a network.
6. Complete provenance, feature matrix, visual audit, and the four package gates.

## Phase 1 hard gates

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

Capture note: the responsive canonical targets and audit are complete; per protocol, the parent harness writes the PNG/JSON artifacts during sealing.
