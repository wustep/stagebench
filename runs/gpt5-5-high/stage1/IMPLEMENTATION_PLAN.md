# Phase 1 Implementation Plan

Assigned specs cited by this implementation:

- `nord-stage-4.visual.json`
- `nord-stage-4.piano.json`

Approach:

1. Model the Stage 4 73 hardware as typed data: six documented horizontal sections, 54/46 deck/keybed split in CSS, complete 73-key E-to-E keybed, stable decorative control IDs, and only two primary OLEDs in Program and Synth.
2. Render a single continuous red chassis with dark inset panels, white legends, black knobs, faders, nine organ drawbars with LED ladders, Program controls, dense Synth controls, and Layer Effects groups.
3. Keep panel controls honest in Phase 1: every visible control is accessible and moves/presses, but writes only presentation state and does not claim audio or program behavior.
4. Route pointer, multi-touch, computer keyboard, Web MIDI note/velocity, and MIDI CC64 sustain through one basic generated piano lifecycle with release, sustain, bounded polyphony, deterministic stealing, and cleanup.
5. Maintain tests, feature matrix, truthful audio provenance, and the visual audit needed by the parent-controlled capture and seal flow.

Hard gates checklist:

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.
