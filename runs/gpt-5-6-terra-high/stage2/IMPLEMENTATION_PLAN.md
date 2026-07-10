# Phase 2 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, and `inputs/specs/nord-stage-4.effects.json`.

1. Preserve the Phase 1 73-key chassis, input lifecycle, decorative Organ/Synth/Program controls, and the two existing OLED locations.
2. Own Piano A and B voices separately and send them through one lazily created `AudioContext`, their layer chains, layer levels, shared master gain, limiter, and destination.
3. Bind Piano layer, type/model, performance, pedal, and Master Level controls to real audio parameters. A labeled synthesis fallback remains playable when recorded sample assets are unavailable.
4. Bind all seven effect units, type selection, bypass, focus, group/global targeting, and all-effects bypass to the ordered audio graph.
5. Keep provenance honest, add Phase 2 feature mappings and regression tests, and run the four package gates.

```text
Piano A source -> Mod 1 -> Mod 2 -> Delay -> Amp/EQ -> Comp -> Reverb -> Rotary? -> A level -+
                                                                                           |      |
Piano B source -> Mod 1 -> Mod 2 -> Delay -> Amp/EQ -> Comp -> Reverb -> Rotary? -> B level -+-> Master gain -> limiter -> destination
```

## Phase 2 hard gates — explicitly acknowledged

- [ ] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance. **Blocked: no sample assets or provenance were supplied in this isolated workspace; the candidate labels its playable synthesis fallback rather than claiming compliance.**
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.
