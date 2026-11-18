# Stage 4 73 implementation plan

1. Model the E1–E7 hammer-action keybed, individual hardware controls, and six panel bands. Follow the selected photograph and the corrected fractions in nord-stage-4.visual.json.
2. Recreate the metalwork, printed legends, controls and two OLED windows. Bind the panel to presentation state only.
3. Implement a shared note lifecycle and a velocity-sensitive piano according to the Phase 1 subset of nord-stage-4.piano.json.
4. Exercise inputs, audio and layout, capture both viewports, measure the finished instrument, and record audio provenance.

## Phase 1 hard gates

- [ ] The exact keybed count and range for the assigned variant are modeled and playable.
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`
