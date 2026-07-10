# Phase 3 implementation plan

Sources: `inputs/specs/nord-stage-4.visual.json`, `inputs/specs/nord-stage-4.piano.json`, `inputs/specs/nord-stage-4.effects.json`, `inputs/specs/nord-stage-4.programs.json`, `inputs/specs/nord-stage-4.organ.json`, and `inputs/specs/nord-stage-4.synth.json`.

The program record is canonical and serializable: Piano A/B, Organ A/B, Synth A/B/C, split configuration and zones, both Scene enable maps, morph assignments, master clock, transpose, and name. Master Level stays outside a record as required. Selecting a non-Live program restores its stored record, intentionally discarding edits; Live records update after an edit.

```text
Keyboard/MIDI → zones/splits → piano + organ + synth layer sources
                              → existing owned layer buses/effects → master limiter → one destination
Program → layers/sounds/FX routing/splits/scenes/morphs/clock/transpose
```

The binding audit is represented directly by stable panel IDs and the Phase 3 feature matrix. Each required visible control writes canonical state, updates its feedback, and either affects the shared synthesis fallback on the next note or changes note routing/performance state. Unsupported controls remain intentionally limited to the spec exclusions: Program banks beyond 32, program organize/preset library/Num Pad/menus, aftertouch morph, Organ drawbar presets/swell/tonewheel wear, and Synth Extern/preset library/arp pattern editing/group modes.

## Phase 3 hard gates

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

Implementation detail: the UI provides 4 pages of 8 regular records, Store/Store As name flow, dirty `E`, discard-on-change, 8 auto-saving Live positions, 4-zone split controls, Scene I/II, wheel/pedal morph controls, master clock, transpose, and Panic. The full control-binding audit and test mapping remain in `tests/feature-matrix.json`.
