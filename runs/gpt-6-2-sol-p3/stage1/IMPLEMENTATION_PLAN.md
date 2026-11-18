# Stage 4 73 implementation plan

1. Reconstruct the chassis, the six bands, and the E1–E7 hammer-action keybed from the variant entry and the product reference. The visual spec's updated photo measurements establish section boundaries.
2. Model each panel control with a stable ID, geometry, initial position, and accessible name. Keep panel presentation state separate from note input.
3. Route pointer, touch, mapped keyboard, and Web MIDI through an injectable note lifecycle. Ship one recorded piano voice with a labeled synthesis fallback.
4. Verify interaction and rendered audio with deterministic tests. Measure the rebuilt surface at both viewports and preserve the canonical captures, audit, and sample provenance.

## Phase 1 hard gates

- [ ] The exact keybed count and range for the assigned variant are modeled and playable.
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`
