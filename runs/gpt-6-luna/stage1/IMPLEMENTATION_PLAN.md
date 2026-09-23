# Phase 1 implementation plan

Assigned specs: `nord-stage-4.visual.json` and `nord-stage-4.piano.json`.

## Hard gates checklist

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Build order and current implementation

1. Normalize the 73 key E2–E8 model, section fractions, stable control IDs, and presentation-only control values in `src/hardware.ts`.
2. Build one continuous red chassis with the six photo-measured deck sections, the two primary OLEDs, the organ drawbars, mixed section landmarks, and an exact 73-key keybed.
3. Render panel controls from the normalized inventory as keyboard and pointer accessible presentation-only controls.
4. Route pointer, keyboard, and Web MIDI through `NoteLifecycle`; generate one additive piano voice locally with Web Audio and deterministic voice stealing.
5. Exercise lifecycle, signal generation, MIDI states, control inventory, and key geometry with local deterministic tests.
6. Capture the 1440×900 and 390×844 surfaces with the parent harness and record measured results in `stage1-visual-audit.md`.

## Visual target

The chosen target is Stage 4 73 (`stage-4-73`): 73 hammer-action keys, 43 white and 30 black, from E2 to E8. The source image bounds have a 3.0951:1 aspect ratio. The control deck uses the corrected visual spec fractions: Performance 14%, Organ 20%, Piano 8.5%, Program/Morph 12.5%, Synth 25%, and Layer Effects 20%.

The phase capture files are left for the operator's seal step. The written CSS-geometry audit is in `stage1-visual-audit.md`; it distinguishes source measurements and defined layout values from browser-captured measurements.
