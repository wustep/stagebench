# Phase 3 Implementation Plan

Assigned specs cited by this implementation:

- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.piano.json`
- `specs/nord-stage-4.effects.json`
- `specs/nord-stage-4.programs.json`
- `specs/nord-stage-4.organ.json`
- `specs/nord-stage-4.synth.json`

Canonical state schema:

- `ProgramSnapshot` is the serializable program payload. It includes Piano A/B layer state, piano performance state, Phase 2 effects, Organ A/B, Synth A/B/C, split points/crossfades, layer Scenes I/II, Wheel and Control Pedal morph assignments, master clock, and transpose.
- `Stage3State` wraps 32 program slots, 8 Live slots, current page/button, numeric list view state, dirty indicator, current working snapshot, held-note cleanup state, and unsupported/excluded declarations.
- Master Level remains outside `ProgramSnapshot`, matching `specs/nord-stage-4.programs.json`.

Control-binding audit plan:

- All visible Piano, Organ, Synth, Program, Performance, and supported Effects controls are in `functionalControlIds`.
- Spec-excluded controls stay visibly movable but are labeled decorative. In this artifact those include `program.morph-aftertouch` and `effects.delay-tempo`; the broader unsupported list is rendered in the hidden audit text and `IMPLEMENTATION_DETAILS.json`.
- Tests check every visible control has a stable ID, accessible name, and functional/decorative label matching the support contract.

Implemented scope:

1. Preserve Phase 1 keybed/input behavior and Phase 2 piano/effects tests.
2. Add `src/stage3System.ts` for program storage, Live slots, dirty/discard lifecycle, splits, scenes, morphs, clock, transpose, Panic, Organ, Synth, integration snapshots, and deterministic audio probes.
3. Wire Program/Organ/Synth/Performance controls into the serializable system while keeping the inherited Piano engine and Phase 2 effect graph.
4. Extend tests and feature matrix for all Phase 3 IDs.
5. Add `evidence/stage3-visual-audit.md` with exercised flows and known deviations.

Hard gates checklist:

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

Known implementation deviations:

- Grand/Upright/Electric remain candidate-authored generated offline approximations inherited from Phase 2, not recorded samples. The UI and provenance declare this truthfully.
- Organ and Synth live playback share the browser piano key lifecycle at the system/state level and use deterministic render probes for test evidence. The browser app exposes their state and probe RMS; live Web Audio oscillator playback remains implemented by the inherited piano engine.
- Store As naming is implemented as a deterministic API path (`storeAsProgram`) and tested; the compact hardware surface uses Store on-panel and does not add a text-entry modal.
- External hardware features excluded by spec remain unsupported and declared rather than simulated.
