# Phase 2 Implementation Plan

Assigned specs:
- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.piano.json`
- `specs/nord-stage-4.effects.json`
- Variant: `stage-4-73`

## Hard gates (checklist)

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Sample provenance plan

| Family | Path | Roots | Vel layers | Origin |
| --- | --- | --- | --- | --- |
| Grand | `public/samples/grand/` | 9 (every 6 st) | 2 | Offline-baked PCM via `scripts/generate-samples.mjs` (CC0) |
| Upright | `public/samples/upright/` | 9 | 2 | Same grid, distinct recipe |
| Electric | `public/samples/electric/` | 9 | 2 | Tine-style recipe |
| Clav/Digital/Misc | — | — | — | Honest live synthesis |

Asset failure → status `fallback` with labeled message; synthetic voice remains playable.

## Signal graph

```
[Piano voices layer A] → layerBusA → ChainA (Mod1→Mod2→Delay→Amp/EQ→Comp→Reverb)
                                      ├─ directOut → layerLevelA ─┐
                                      └─ toRotary ──┐              │
[Piano voices layer B] → layerBusB → ChainB …       │              ├→ master → limiter → destination
                                      └─ toRotary ──┼→ Rotary ─────┘
                                                    │
```

## Order of work

1. Plan + sample bake script
2. Layer/bus/master refactor of Phase 1 voice
3. Six types, two layers, performance controls
4. Effect units in signal order + focus/group/global
5. Tests, provenance, visual audit

## Honesty

- Piano + Layer Effects + Master Level are functional.
- Organ, Synth, Program stay decorative presentation state.
- Generated synthesis never labeled as recordings; sample files declared with honest offline-baked provenance.
