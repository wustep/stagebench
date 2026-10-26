# Phase 3 implementation plan

Contracts: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, and `nord-stage-4.synth.json`, with Phase 3 of `benchmark-phases.json`.

## Hard gates

- [ ] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [ ] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [ ] All inherited visual, piano, effects, and input behavior remains regression-free.

## State and audit plan

Use a serializable program snapshot containing layer, sound, effects, split, scene, morph, tempo and transpose settings; master level remains outside the snapshot. Store 32 regular slots and eight automatically saved Live slots. Keep transient input and audio nodes outside serialized state. Audit each panel control against the assigned specs, exercising supported bindings and naming excluded controls as unsupported. Verify audio behavior with rendered signals and preserve inherited tests and evidence. The operator's seal harness supplies canonical captures.
