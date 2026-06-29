# Phase 3 - Programs and Effects

Work only inside the assigned `stage3` directory. It is a clean copy of the verified Phase 2 artifact. Read:

1. `BENCHMARK.md` and `TESTING.md`
2. `specs/benchmark-phases.json` Phase 3
3. `specs/nord-stage-4-73.visual.json`
4. `specs/nord-stage-4.piano.json`
5. `specs/nord-stage-4.programs.json`
6. `specs/nord-stage-4.effects.json`
7. Manual pages 37-44 and 47-52
8. inherited plans, notes, tests, evidence, and implementation

Continue using pnpm exclusively. Preserve the Phase 1 visual contract and Phase 2 Piano behavior. Organ and Synth sound engines remain Phase 4 work; their visible controls stay present but must not be falsely reported as audible engines.

Before implementation, update `IMPLEMENTATION_PLAN.md` to cite every assigned spec filename and copy the Phase 3 `Hard gates` into a checked task list. Map each Program/effect requirement to canonical state, rendered hardware, audible routing where applicable, and a test.

## Non-negotiable outcome

Implement Programs and a connected effect/routing system around the Piano engine. Phase 3 must establish the canonical state and single signal architecture that Organ and Synth will join in Phase 4.

An effect enum, display label, disconnected node, or state-only `EffectsRack` does not count as an effect implementation.

## Mandatory milestones

Complete and test these in order.

### A. Canonical program state

Create one serializable instrument state for supported layers, Piano parameters, effects, routing, splits/zones, morph assignments, scenes, and display/program metadata. Program save/load must round-trip this state. Dirty state, cancel, undo, naming, categories, list modes, Live Mode, and Program buttons must operate through rendered controls.

### B. Layers, splits, scenes, and morphs

Implement the Program spec rather than fixed demonstrations:

- up to four zones and Low/Mid/High split points;
- the documented C2-C7 split choices;
- Off, +/-6, and +/-12 semitone crossfades;
- editable layer-zone assignment;
- Layer Scene I/II enable-state switching;
- Wheel, Aftertouch, and Control Pedal morph assignments with visible indicators;
- editable start/end ranges, interpolation, clearing, and copy behavior.

A fixed C4 split or stored morph with no controllable input path is incomplete.

### C. One audible signal graph

Refactor to one `AudioContext` with reusable per-layer source buses, ordered effect chains, a master bus/limiter, and one destination. Preserve note lifecycle while moving the Piano engine into this graph. Do not create separate direct-to-destination contexts for engines or effects.

### D. Effects

Implement the routing and units in `specs/nord-stage-4.effects.json`. At minimum, every listed unit family and its representative modes must process real audio, support On/Bypass, and expose its documented primary parameters. Focus, Piano group/layer behavior, Delay/Compressor/Reverb global behavior, all-effects bypass, To Rotary, and signal order must alter the actual graph.

Use parameter automation or short ramps to avoid clicks. Delay feedback effects process repeats, not dry signal. Rotary is the final effect for routed layers. Reverb precedes Rotary.

## Required tests

Maintain inherited tests and add every Phase 3 feature ID from `TESTING.md`. Directly exercise:

- Program and preset round-trips, dirty state, cancel, undo, Live Mode, and display modes;
- split editing, zone membership, crossfade gains, scenes, and morph interpolation;
- one shared context and ordered bus topology;
- audible bypass, wet/dry, focus, group/global, targeting, and parameter automation;
- representative time-domain or spectral changes for Mod 1, Mod 2, Delay, Amp/EQ or filter, Compressor, Reverb, and Rotary;
- rapid toggling, cleanup, clipping protection, and inherited Piano behavior.

## Browser and evidence

Exercise Program editing/storage, split and scene changes, morph assignment, effect focus/group/global modes, effect bypass, and rapid Piano play through effects. Confirm displayed state and audible behavior agree. Check the console.

Save `evidence/stage3-desktop.png`, `evidence/stage3-narrow.png`, and `evidence/stage3-visual-audit.md`, comparing with the product reference and Phase 2 evidence. Update `IMPLEMENTATION_DETAILS.json` with the real signal graph and sound-generation details. Run all pnpm gates before reporting completion.
