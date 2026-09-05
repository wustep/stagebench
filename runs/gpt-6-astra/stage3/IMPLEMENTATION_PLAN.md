# Phase 3 implementation plan

Contracts: Phase 3 of `inputs/specs/benchmark-phases.json`; assigned `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, and `nord-stage-4.synth.json` under `inputs/specs/`. Variant geometry follows `nord-stage-4.variants.json` and the Stage 4 73 photograph.

## Hard gates

- [ ] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [ ] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [ ] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [ ] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [ ] All inherited visual, piano, effects, and input behavior remains regression-free.

The exact contract checklist is retained above. Automated test coverage is recorded in `tests/feature-matrix.json`; unchecked items are not a claim that full Phase 3 verification, including browser evidence, has completed.

## Canonical schema and order
Keep inherited piano/effects fields. Add a versioned system object containing two organ layers, three synth layers, six effect chains (two piano, three synth, shared organ), layer zone ranges, three split points, scene enable maps, source-to-path morph ranges, tempo/transpose, and performance settings. Program snapshots omit Master Level and transient bend/morph input. Storage is an injectable getItem/setItem boundary; ship 32 named slots with at least eight distinct factory setups and eight Live slots. Store audition preserves a pending snapshot; cancel restores it. Live edits persist immediately. Then implement performance routing, Organ DSP, Synth DSP, and browser controls.

## Binding audit
Preserve all 155 stable hardware IDs. Map each to canonical state or an explicit spec-excluded reason; expose detailed parameters through accessible expandable editors without inventing OLEDs. Generate a per-ID audit. Add all Phase 3 feature IDs to the inherited matrix with actual tests. Exercise production DSP signals, storage round-trips, ownership cleanup, MIDI, panel binding, real browser workflows and parent capture harness. Run test, typecheck, lint, build in candidate only. Do not seal or score.

## Inherited limitation
Inputs contain no piano recordings. Preserve truthful synthesized fallback status and inherited provenance; do not claim that the recorded-library hard gate is satisfied.

## Phase 3 implementation and evidence status
Implemented canonical program/system state in `src/system-state.ts` and `src/system-engine.ts`, integrated synthesis in `src/extra-dsp.ts` and `src/dsp.ts`, and canonical hardware/editor bindings in `src/system-panel.ts`, `src/SystemDetails.tsx`, and the inherited panel/editor modules. `tests/feature-matrix.json` preserves all inherited mappings and adds all 18 Phase 3 IDs. `evidence/stage3-control-audit.json` inventories all 155 hardware IDs and explicitly distinguishes spec-excluded presentation controls.

The last completed four-gate run passed 75 tests in eight files, typecheck, lint (one non-failing warning), and build. See `evidence/stage3-gates.json`. This documentation correction changes no application or test code; those gate results are retained rather than represented as a new run.

Browser execution and canonical Phase 3 captures remain incomplete: the local-server attempt failed with listen EPERM, and the user then explicitly requested no escalation or localhost listener and to skip that step. `tests/browser-phase3.mjs` is available but has not completed. No Phase 1/2 image has been relabeled as Phase 3. See `evidence/stage3-evidence-status.json` and `evidence/stage3-visual-audit.md`. Full phase-3 verify is not claimed; the supplied inputs expose its implementation-details schema but not the complete verifier. Do not seal or score.
