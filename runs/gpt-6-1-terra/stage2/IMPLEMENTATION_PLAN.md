# Phase 2 implementation plan

The contracts are `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, and `nord-stage-4.effects.json`; preserve the Phase 1 surface and input tests while extending the audio path.

## Hard gates

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Sample provenance plan

Bundle recordings only when their original source, redistribution license, root note and velocity layer can all be verified. Record each file in IMPLEMENTATION_DETAILS.json. Generated sound must be labeled as synthesis and cannot satisfy the recording gate. Failed loads must enter an explicitly labeled playable fallback.

## Target graph

```text
Piano A source -> Mod 1 -> Mod 2 -> Delay -> Amp/EQ -> Compressor -> Reverb -> Rotary (if routed) -> A level --+
Piano B source -> Mod 1 -> Mod 2 -> Delay -> Amp/EQ -> Compressor -> Reverb -> Rotary (if routed) -> B level --+-> Master gain -> limiter -> destination
                                      ^ feedback through filter
```

Implement two-layer ownership and pedal handling before effect routing; exercise audible behavior through rendered audio as well as state and input tests. Preserve the existing visual audit and use the operator's seal harness for canonical captures.
