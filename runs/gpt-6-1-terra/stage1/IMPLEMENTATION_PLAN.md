# Phase 1 implementation plan

Based on `nord-stage-4.visual.json` and `nord-stage-4.piano.json`, model the 73-key E–E keybed and six-section control deck, then connect all note inputs to a synthesized piano voice. Panel controls maintain presentation state only.

## Hard gates

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.
