# Phase 3 Implementation Plan — Nord Stage 4 73

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`, `specs/nord-stage-4.programs.json`, `specs/nord-stage-4.organ.json`, `specs/nord-stage-4.synth.json`

Variant: **Stage 4 73** (`stage-4-73`)

## Hard gates (from `specs/benchmark-phases.json`)

- [ ] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [ ] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [ ] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [ ] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [ ] All inherited visual, piano, effects, and input behavior remains regression-free.

## Canonical state schema

`SerializableProgramState` captures piano A/B, organ A/B, synth A/B/C, effects (excluding master level), splits (3 points × 11 positions, Off/±6/±12 crossfades), zones, scenes I/II enable maps, morph assignments, master clock BPM, and transpose. `ProgramSystemState` adds navigation, dirty flag, Live mode, Store/Store As workflow, and list view.

## Control-binding audit plan

Every control in `hardware.ts` is either mapped in `control-bindings.ts` (functional) or listed in `unsupported-controls.ts` (spec-excluded). Morph knob (aftertouch), organ preset/live, synth extern, and undocumented master wet remain decorative.

## Signal graph (Phase 3)

```
Keybed/MIDI (+ transpose, zones, scenes)
    ├─► Piano A/B ─► Layer FX A/B ──┐
    ├─► Organ A/B ─► mix ─► Organ FX (shared) ──┤
    └─► Synth A/B/C ─► Synth FX A/B/C ──────────┤
                                                 ├─► Shared Rotary ─► Mix ─► Master ─► Limiter ─► Out
Programs round-trip all supported state; Live slots auto-store; Panic clears voices + performance inputs.
```

## Build order

1. Extend `InstrumentAudioState` + program store with 8 factory programs.
2. Zones, splits, scenes, morph, clock, transpose, Panic.
3. Organ additive engines (B3/Vox/Farf/Pipe) + drawbars + percussion/rotary.
4. Synth oscillators/filters/envelopes/LFO/arp across three layers.
5. Integration tests, feature-matrix Phase 3 IDs, evidence audit.

## Phase 3 honesty contract

Spec-excluded controls (banks, preset library, Extern, shift menus, aftertouch morph) stay decorative and are documented as unsupported. All other controls update canonical state and audible output where sonically meaningful.
