# Phase 2 implementation plan

Assigned specs (filenames only, as provided in this workspace):

- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.piano.json`
- `specs/nord-stage-4.effects.json`

Assigned variant: Stage 4 73 (`specs/nord-stage-4.variants.json`).

## Hard gates (Phase 2)

Copied from `specs/benchmark-phases.json`:

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

Inherited Phase 1 gates remain green (surface, keybed, inputs, decorative Organ/Synth/Program).

## Sample provenance plan

| Type | Source | License | Method |
| --- | --- | --- | --- |
| Grand | FluidR3 GM acoustic grand (recorded piano, MIDI.js soundfont pack) | MIT (FluidR3_GM / Frank Wen) | Bundled WAV, multiple roots, offline |
| Upright | Distinct recorded acoustic piano set (upright or documented recorded acoustic distinct from the grand) | CC-BY or MIT as fetched | Bundled WAV, multiple roots, offline |
| Electric | FluidR3 GM electric piano 1 (recorded tine EP) | MIT | Bundled WAV, multiple roots, offline |
| Clav / Digital / Misc | Live synthesis in the voice engine | n/a | Honest generated sources, never labeled recordings |

If a recorded file fails to decode, that type LED flashes, the Program display reports the failure, status is `fallback` (not `ready`), and a labeled synthesized voice stays playable.

## Graph

```
                    Piano A voices ──► bus A ──► Mod1 → Mod2 → Delay → Amp/EQ → Comp → Reverb ─┬─► (To Rotary?) ─► Rotary
                    Piano B voices ──► bus B ──► Mod1 → Mod2 → Delay → Amp/EQ → Comp → Reverb ─┘         │
                                                                                                        ▼
                                                                              layer level A/B ──► master gain → limiter → destination
```

One `AudioContext`. Reverb always precedes Rotary. Delay feedback filter sits in the repeat path, not the dry path. Short ramps on bypass and parameter changes. Organ/Synth/Program controls stay decorative.

## Approach

1. Keep Phase 1 input lifecycle (pointer, keyboard, MIDI, sustain, blur cleanup).
2. Split the Phase 1 voice into per-layer buses feeding the ordered effect graph and a real Master Level.
3. Six piano types; sampled Grand/Upright/Electric; synthesized Clav/Digital/Misc.
4. Layer A/B enable, focus (drives FX focus), level, octave, SUSTPED, PSTICK.
5. Bind Layer FX panel to Piano A/B chains with group/global/bypass.
