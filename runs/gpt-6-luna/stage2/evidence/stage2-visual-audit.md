# StageBench Phase 2 visual audit — Stage 4 73

## Source-level audit

- Preserved the Phase 1 chassis silhouette and surface split: the control deck remains 54% of the instrument height and the keybed remains 46%.
- Preserved the six control bands in reference order and width: Performance 14%, Organ 20%, Piano 8.5%, Program 12.5%, Synth 25%, Layer Effects 20%.
- Preserved the E2–E8 73-key model (43 white, 30 black) and the two primary OLEDs in Program and Synth.
- Reflowed the denser Phase 2 Piano controls into a three-column grid and Layer Effects into a compact two-column grid. The Piano readout follows both octave controls; the effect readout names the current manual section and focused layer.
- Piano type buttons name their selected instrument family. Program shows the active piano model, while Program controls, Synth controls, and Organ controls remain visibly identified as decorative for this phase.
- Added the missing EQ mid gain/resonance and frequency controls and the Delay Tap button without moving the existing six section boundaries.
- Kept the existing narrow viewport CSS rules and accessible input labels/focus treatment.

## Evidence and seal handoff

`pnpm test` includes DOM checks for the section order and proportions, complete key count, control inventory, readouts, and Phase 1 chassis behavior. Phase 2 browser screenshots were not generated; leave the canonical desktop and narrow captures to the operator seal step. Existing Phase 1 captures remain in this directory.

## Visual limitations

The piano type set and Effects panel are dense within their measured reference bands. Verify text legibility and any clipping in the operator's canonical 1440×900 and 390×844 captures. The sample model dial still has one model per type. The Electric recording set is redistributable under CC BY-NC 4.0 only for noncommercial use; see `../public/samples/ATTRIBUTION.md`.
