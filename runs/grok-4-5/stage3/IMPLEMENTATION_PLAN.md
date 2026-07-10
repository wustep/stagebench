# Phase 3 Implementation Plan

Assigned specs:
- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.piano.json`
- `specs/nord-stage-4.effects.json`
- `specs/nord-stage-4.programs.json`
- `specs/nord-stage-4.organ.json`
- `specs/nord-stage-4.synth.json`
- Variant: `stage-4-73`

## Hard gates (checklist)

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

## Canonical state schema

```
ProgramSoundState {
  piano, organ, synth, effects,
  split { on, points: Low|Mid|High { enabled, note, crossfade } },
  scenes { active, I, II layer enables },
  morph { wheel[], controlPedal[] },
  masterClockBpm, masterClockKbSync, transpose
}
```

32 program slots + 8 Live slots; Master Level excluded from program state.

## Control-binding audit plan

1. Bind every non-excluded control in piano/organ/synth/program/effects/performance.
2. List spec-excluded as unsupported: aftertouch morph, preset library, Extern, Aux KB, Shift-menus, banks beyond 32, arpeggiator pattern editor, filter/LFO/Arp group modes.
3. Honesty: unsupported controls move/press but do not claim audio success.

## Order of work

1. Plan + hard gate checklist (this file)
2. Program system (slots, Store/Live, dirty)
3. Splits, scenes, morphs, clock, transpose, Panic
4. Organ engine → shared FX graph
5. Synth engine → per-layer FX
6. Bindings audit, tests, provenance, visual audit
