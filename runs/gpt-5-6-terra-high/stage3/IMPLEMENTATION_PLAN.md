# Phase 3 plan

Inputs used: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, and `nord-stage-4.synth.json`.

## Hard gates

- Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- All inherited visual, piano, effects, and input behavior remains regression-free.
