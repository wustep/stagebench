# Phase 3 implementation plan — Stage 4 73

Assigned specs:

- `inputs/specs/nord-stage-4.visual.json`
- `inputs/specs/nord-stage-4.piano.json`
- `inputs/specs/nord-stage-4.effects.json`
- `inputs/specs/nord-stage-4.programs.json`
- `inputs/specs/nord-stage-4.organ.json`
- `inputs/specs/nord-stage-4.synth.json`

The sealed Phase 2 surface, 73-key E-to-E keybed, input lifecycle, Piano library/fallback, effect controls, master path, tests, and evidence remain inherited. Phase 3 adds one serializable state model shared by Piano, Organ, Synth, effects, programs, scenes, splits, morphs, clock, transpose, and Panic.

## Phase 3 hard-gate acknowledgement

The following are the five Phase 3 hard gates copied from `inputs/specs/benchmark-phases.json`; each is explicitly acknowledged with its implementation status:

1. **“Program save/load round-trips all supported state across the 32 slots and 8 Live slots.”** **Status: implemented.** `EngineState` separates `ProgramState` from navigation/dirty metadata; factory content creates 32 slots, Store/Store As commits a deep clone, and Live Mode auto-stores edits. `programs.roundtrip`, `programs.store-live`, `programs.undo-cancel`, and `programs.navigation` are mapped in `tests/feature-matrix.json`.
2. **“Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.”** **Status: partially implemented and documented.** Three split selects use the documented 11 positions, crossfade is editable as Off/6/12, each engine layer has zone/enable/focus/level state, Scene I/II changes only layer enables, and Wheel/Control Pedal interpolate assigned destinations with clear actions. The audio engine applies transpose and zone routing at note-on; crossfade gain taper is not fully proven in the current deterministic audio path.
3. **“B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.”** **Status: implemented.** Organ uses model-specific partial banks and drawbar weighting; Synth selects the exact Pure/Sync/Multi/Super/FM-H waveform lists and applies category-sensitive oscillator behavior, filters, envelopes, LFO, voice controls, and unison.
4. **“Organ and Synth route through the Phase 2 graph with no separate AudioContext.”** **Status: partially implemented and documented.** `PianoAudioEngine` owns one lazily-created `AudioContext`, one master gain/limiter/destination, and source buses for all seven layers; Piano A/B use the inherited ordered effect-chain nodes. Organ/Synth share the same context and master path, but source-specific reuse of every Phase 2 effect-chain unit is not fully proven in this artifact.
5. **“All inherited visual, piano, effects, and input behavior remains regression-free.”** **Status: verified by package gates.** Phase 1/2 tests remain present and green; the Phase 3 visual audit records the fixed 54/46 deck/keybed allocation, six section order, two primary OLEDs, and narrow-layout review.

## Canonical state and control-binding audit

`EngineState` is the canonical serializable state. `ProgramState` excludes only program navigation, dirty/store workflow, morph input values, clock tap history, and transpose metadata; all sound, routing, effects, split, scene, morph assignment, and engine parameters are included. Every non-excluded Phase 3 control is bound to this state and the audio engine. Spec-excluded controls are listed in the UI disclosure and `evidence/stage3-visual-audit.md`; they do not silently claim behavior.

## Delivery checklist

- [x] Canonical program state, 32 factory slots, Store/Store As, dirty indicator, Live slots, list/page/dial navigation.
- [ ] Splits, 11 split positions, three points, crossfade widths, zones, Scenes I/II, morph assignments/clear, Master Clock, Transpose, and Panic. The controls and state are present; crossfade audio taper remains a documented verification gap.
- [x] Organ A/B, B3/Vox/Farf/Pipe models, nine drawbars/LEDs, percussion, key click, vibrato/chorus, and rotary controls.
- [x] Synth A/B/C, exact required source categories, filters, envelopes, LFO, voice modes, unison/vibrato, and deterministic arp/gate controls.
- [ ] Shared one-context graph, inherited tests/mappings/evidence, feature matrix, implementation details, and visual audit. One context/master path is present; complete Organ/Synth effect-chain reuse remains a documented gap.
- [x] Final `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` gates.
