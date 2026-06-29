# Phase 4 - Organ and Synth

Work only inside the assigned `stage4` directory. It is a clean copy of the verified Phase 3 artifact. Read:

1. `BENCHMARK.md` and `TESTING.md`
2. `specs/benchmark-phases.json` Phase 4
3. `specs/nord-stage-4-73.visual.json`
4. `specs/nord-stage-4.piano.json`
5. `specs/nord-stage-4.programs.json`
6. `specs/nord-stage-4.effects.json`
7. `specs/nord-stage-4.organ.json`
8. `specs/nord-stage-4.synth.json`
9. Manual pages 18-22 and 27-36
10. inherited plans, notes, tests, evidence, and implementation

Continue using pnpm exclusively. Preserve all inherited visual, Piano, Program, routing, split, morph, preset, scene, and effect behavior.

Before implementation, update `IMPLEMENTATION_PLAN.md` to cite every assigned spec filename and copy the Phase 4 `Hard gates` into a checked task list. Map each Organ/Synth requirement to its engine, rendered hardware, Program state, inherited routing, and a real-boundary test.

## Non-negotiable outcome

Complete the instrument with distinct Organ and Synth engines that join the Phase 3 layer buses and effect chains. Do not create new destination AudioContexts. Do not satisfy model selections by renaming one generic oscillator. Every required Organ/Synth control must change canonical state and, when sonically meaningful, audible output.

## Mandatory milestones

### A. Organ engine

Implement two Organ layers and all six manual models: B3, B3 Bass, Vox, Farf, Pipe 1, and Pipe 2. Model behavior must be observably distinct.

Implement the Organ spec including drawbars/registers and LEDs, B3 percussion, key click, vibrato/chorus, presets/live drawbars, sync, rotary speed/stop/drive/close-mic behavior, levels, focus, zones, octave shift, and morph destinations. Both layers share the inherited Organ effect chain as specified.

### B. Synth engine

Implement three Synth layers with Samples, Analog, and Extern state. Implement enough source categories to demonstrate the documented Pure, Sync, Multi, Super, Misc, Wave, and FM behavior without collapsing them into labels.

Implement filter types and tracking, drive, oscillator/filter/amplifier envelopes, LFO destinations, mono/legato/priority/glide/unison/vibrato behavior, and deterministic arpeggiator/gate timing, range, inversion, patterns, hold, keyboard sync, and master-clock sync.

### C. Full-system integration

Organ and Synth layers must use inherited Program save/load, presets, scenes, zones, splits/crossfades, morphs, focus, effect targeting, master clock, Panic, and one master output path. Program round-trips must restore all newly supported engine state.

Remove any generic unbound-control fallback for required Phase 4 controls. Unsupported optional controls must be explicitly identified in notes and UI rather than silently acting decorative.

## Required tests

Maintain all inherited mappings and add every Phase 4 feature ID from `TESTING.md`. Tests must directly exercise real engine boundaries and prove:

- Organ model and drawbar/register spectral differences;
- percussion, key click, vibrato/chorus, rotary, and two-layer behavior;
- Synth source/Osc Ctrl spectral differences;
- filter type/frequency/resonance/tracking/drive behavior;
- envelope and LFO time-domain behavior;
- mono/legato/priority/glide/unison/vibrato voice behavior;
- arpeggiator/gate patterns and clock synchronization;
- routing through inherited Programs, layers, splits, morphs, scenes, presets, and effects;
- one shared AudioContext, master gain staging, cleanup, and rapid layered play.

## Browser and evidence

Audibly exercise each engine, representative model/source changes, layered/split play, morphs, presets, and effects. Verify every required hardware binding, display update, and console state.

Save `evidence/stage4-desktop.png`, `evidence/stage4-narrow.png`, and `evidence/stage4-visual-audit.md`, comparing with the reference and Phase 3 evidence. Update `IMPLEMENTATION_DETAILS.json` with Organ/Synth generation methods and any sample provenance. Append final architecture, coverage, browser, performance, and known-limitation notes to `STAGE_NOTES.md`. Run all pnpm gates and produce `dist/` before reporting completion.
