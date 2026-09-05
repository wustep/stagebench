# Phase 2 implementation plan

Assigned contracts: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, `inputs/specs/nord-stage-4.effects.json`; Phase 2 of `inputs/specs/benchmark-phases.json`. Preserve the inherited Phase 1 surface, tests, and evidence.

## Hard gates
- [ ] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Sample provenance plan
The supplied inputs contain no recordings or sample licenses. The input-only constraint precludes obtaining external recordings. Do not manufacture provenance: Grand/Upright/Electric must report unavailable recordings and use explicitly labeled, original synthesized fallbacks. Clav/Digital/Misc use original synthesis. Implement an injectable recorded-library loader with explicit root/velocity metadata for future authorized assets. This leaves the recorded-library hard gate unmet; passing software checks must not be described as passing that hard gate.

## Audio graph
```text
Owned notes A -> stereo layer bus A -> Mod1 -> Mod2 -> Delay -> Amp/EQ -> Compressor -> Reverb --+
                                                                                          | shared Rotary modulation (when routed)
Owned notes B -> stereo layer bus B -> Mod1 -> Mod2 -> Delay -> Amp/EQ -> Compressor -> Reverb --+
                         -> respective layer levels -> master gain -> limiter -> one destination
```

Use one AudioWorklet processor with deterministic, directly testable DSP for the two buses and shared rotary. Smooth continuous controls and crossfade unit bypass. Preserve the original Phase 1 audio boundary and regression fixtures. A Phase 2 engine composes two owned PianoEngine lifecycles and routes sustain per layer. Keep effects focus distinct from piano focus; group/global updates copy canonical settings to both current Piano layers. Organ/Synth/Program remain decorative.

Sequence: layer and graph architecture; library/fallback and performance state; all effect types and routing; canonical panel bindings plus accessible detail controls; deterministic rendered DSP and real browser audio tests; visual comparison and parent-harness Phase 2 captures; four pnpm gates. All writes stay in candidate/. Do not seal.

## Verification outcome
48 unit tests include all 20 inherited tests. The Phase 2 browser harness passed production AudioWorklet rendering, inherited basic-voice rendering, geometry, keyboard, touch, controls, routing and cleanup. Canonical Phase 2 captures use the unchanged parent harness. See evidence/stage2-gates.json for final four-gate results. The recorded-library hard gate above remains explicitly unchecked.
