# Phase 2 Implementation Plan — Nord Stage 4 73

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`

Variant: **Stage 4 73** (`stage-4-73`)

## Hard gates (from `specs/benchmark-phases.json`)

- [ ] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance. *(Implemented as programmatically synthesized offline buffers — audibly distinct, redistributable, honestly declared in IMPLEMENTATION_DETAILS.json; not field recordings.)*
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Sample provenance plan

Programmatic OfflineAudioContext synthesis at load time — **not field recordings**. Six type profiles with distinct harmonics/decay/brightness. Five root MIDI notes (36, 48, 60, 72, 84) × two velocity layers (64, 100). Nearest-sample selection with playbackRate pitch shift. Fallback triangle voice on load failure.

## Signal graph

```
Keybed/MIDI
    │
    ├─► Piano Layer A ─► Layer Input A ─► [Mod1→Mod2→Delay→Amp/EQ→Comp→Reverb] ──┬─► Layer Level A ──┐
    │                                                                              └─► To Rotary Send ─┤
    └─► Piano Layer B ─► Layer Input B ─► [Mod1→Mod2→Delay→Amp/EQ→Comp→Reverb] ──┬─► Layer Level B ──┤
                                                                                   └─► To Rotary Send ─┤
                                                                                                      │
                              Shared Rotary ◄─────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                                 Mix Bus ─► Master Gain ─► Limiter ─► Destination
```

## Build order

1. Refactor Phase 1 PianoEngine into layer/bus/effects architecture (preserve input API).
2. Synthesized sample library for six piano types + fallback.
3. Piano layers, performance controls (KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res).
4. Effect units in documented order; focus/group/bypass routing; Master Level.
5. Rendered-audio tests, feature-matrix Phase 2 IDs, evidence audit.

## Phase 2 honesty contract

Organ, Synth, and Program controls update presentation state only. Piano and Layer Effects (plus Master Level) drive the audio graph truthfully.
