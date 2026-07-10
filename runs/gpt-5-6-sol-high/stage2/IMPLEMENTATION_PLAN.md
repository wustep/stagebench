# Phase 2 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, and `inputs/specs/nord-stage-4.effects.json`, with Phase 2 selected from `inputs/specs/benchmark-phases.json` and the Stage 4 73 variant from `inputs/specs/nord-stage-4.variants.json`.

## Build plan

1. Preserve the Phase 1 E1–E7 keybed, six-section geometry, input lifecycle, accessibility, and decorative Organ/Program/Synth boundary.
2. Replace the single voice output with two owned Piano layer buses and one lazy `AudioContext`; keep pointer, keyboard, and MIDI tokens authoritative for note release.
3. Add six playable piano families, per-layer enable/focus/level/octave/SUSTPED/PSTICK, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, and Master Level.
4. Add ordered Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb processing per Piano layer, shared Rotary after Reverb, layer level, then master gain/limiter and the sole destination.
5. Add focus-follow, manual focus, Piano group mode, Delay/Compressor/Reverb global mode, unit bypass, all-effects bypass, deterministic offline rendering tests, cleanup tests, provenance, and Phase 2 evidence.

## Signal graph

```text
Piano A source ─► Mod1 ─► Mod2 ─► Delay ─► Amp/EQ ─► Comp ─► Reverb ─┬─► A level ─┐
                                                                     └─► Rotary ──┤
Piano B source ─► Mod1 ─► Mod2 ─► Delay ─► Amp/EQ ─► Comp ─► Reverb ─┬─► B level ─┤
                                                                     └─► Rotary ──┤
                                                                                   ▼
                                                                       Master gain ─► limiter ─► one destination
```

Delay feedback is a separate loop whose repeats cross the selected LP/HP/BP filter on every pass. Audible parameter and bypass changes use short ramps.

## Sample provenance plan

The isolated workspace contains no redistributable acoustic-piano recordings. Grand, Upright, and Electric therefore use bundled, deterministic multi-root/multi-velocity PCM banks rendered from original physical-model code; they work offline and avoid one-note pitch shifting, but are truthfully declared as generated samples rather than recordings. Clav, Digital, Misc, and the asset-failure fallback use live synthesis. This is a known hard-gate deviation and will not be disguised in metadata or UI copy.

## Phase 2 hard gates

- [ ] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
  - **Known input limitation:** no recordings were supplied; generated PCM banks are used and labeled honestly.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Shared completion gates

- [x] All benchmark-owned and candidate-authored tests pass.
- [ ] Required browser interaction pass has no console errors.
- [x] Every claimed audible feature is connected to the signal graph.
- [x] Inherited tests, evidence, and behavior are preserved.
- [x] `IMPLEMENTATION_DETAILS.json` distinguishes generated PCM, live synthesis, and recorded samples.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
