# Phase 3 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, `inputs/specs/nord-stage-4.effects.json`, `inputs/specs/nord-stage-4.programs.json`, `inputs/specs/nord-stage-4.organ.json`, and `inputs/specs/nord-stage-4.synth.json`, with Phase 3 selected from `inputs/specs/benchmark-phases.json` and the Stage 4 73 variant from `inputs/specs/nord-stage-4.variants.json`.

## Canonical state and build plan

1. Preserve the inherited E1–E7 keybed, six-section geometry, input lifecycle, Piano A/B behavior, ordered effects, evidence, and one-context audio boundary.
2. Extend the serializable `InstrumentState` with Organ A/B, Synth A/B/C, six effect-chain targets, splits/zones/crossfades, scenes, morph assignments, master clock, and transpose. Master Level and held performance inputs remain runtime-only during program restore.
3. Add a 32-slot program bank, eight factory demonstrations, Store/Store As naming, edit-discard, numeric list browsing, and eight auto-storing Live memories.
4. Add model-specific Organ spectra and drawbars, three independent Synth layers and their source/filter/envelope/LFO/voice/arp behavior, then route every engine into the inherited buses, effects, shared rotary, master gain/limiter, and sole destination.
5. Audit every visible control by stable ID. Required controls receive canonical state/audio bindings; spec-excluded controls remain tactile but carry `data-functional="false"` and appear in the unsupported UI note and evidence audit.
6. Add deterministic state and rendered-audio tests for every Phase 3 feature ID, preserve every inherited mapping, capture evidence, and run all four package gates.

## Signal graph

```text
Organ A/B sources ─► shared Organ chain ─┐
Piano A source ────► Piano A chain ─────┤
Piano B source ────► Piano B chain ─────┤
Synth A source ────► Synth A chain ─────┤──► layer levels ─┬─► master gain ─► limiter ─► one destination
Synth B source ────► Synth B chain ─────┤                  └─► shared Rotary ─┘
Synth C source ────► Synth C chain ─────┘
```

All chains and the shared Rotary are owned by the same lazy `AudioContext`. Split gain, scenes, morph interpolation, transpose, and layer enable state are resolved before a note reaches its source bus. Audible parameter changes use short ramps.

## Phase 3 hard gates

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

## Truthful deviations (separate from Phase 3 hard gates)

- The inherited Phase 2 artifact has no redistributable acoustic-piano recordings. Grand, Upright, and Electric remain audibly distinct generated multi-root/multi-velocity PCM plans, labeled as generated rather than recorded. This inherited Phase 2 hard-gate deviation is preserved honestly.
- The optional copyrighted reference photograph is absent from `inputs/reference/`; geometry follows the supplied measured visual and variant specs rather than a fresh pixel trace.
- Optional features (program undo, alphabetic categories, Samples mode, additional filters/oscillators, distinct B3 Bass/Pipe 2 engines, percussion poly mode, and Rotary stop angle/close mic) are not claimed unless explicitly surfaced.

## Shared completion gates

- [x] All benchmark-owned and candidate-authored tests pass.
- [ ] The parent-owned browser capture/console pass is pending the sealing harness; candidate interaction tests report no runtime errors.
- [x] Every claimed audible feature is connected to the signal graph or deterministic rendered-audio boundary.
- [x] Inherited tests, evidence, and behavior are preserved.
- [x] `IMPLEMENTATION_DETAILS.json` distinguishes generated PCM, live synthesis, and recorded samples.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
