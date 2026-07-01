# Phase 3 — Complete Stage 4 system

Work only inside the assigned Phase 3 candidate directory. It is the sealed Phase 2 artifact copied forward. Read every assigned domain spec, all relevant manual chapters, the Phase 3 manifest contract/hard gates, and inherited source/tests/evidence.

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`, `specs/nord-stage-4.programs.json`, `specs/nord-stage-4.organ.json`, and `specs/nord-stage-4.synth.json`.

## Exact outcome

Complete the browser instrument. Add canonical Programs and performance workflows, two Organ layers, three Synth layers, full integration with the inherited Piano library/effects, and meaningful bindings for every required hardware control. The result must behave as one serializable, routed instrument rather than independent demos.

## A. Canonical Programs, presets, and editing

One serializable canonical state must own all supported Piano, Organ, Synth, effect, routing, split, scene, morph, focus, clock, preset, and display values.

Implement through the rendered hardware:

- browse by number/name/category and contextual list/edit modes;
- Store and Store As, naming, categories, dirty state, cancel, undo, and previous-state restoration;
- Program buttons/banks/pages and eight Live slots;
- per-section/layer preset browsing and storage;
- complete save/load round-trip of supported state.

## B. Layers and performance systems

Implement:

- engine/layer enable, focus, level, octave, source bus, effect target, and master routing;
- up to four zones with editable Low/Mid/High split points at documented C2–C7 positions;
- editable layer-zone assignments and Off, ±6, ±12 semitone crossfades;
- Layer Scene I/II enable-state switching without duplicating sound parameters;
- Wheel, Aftertouch, and Control Pedal morph assignments with editable start/end, interpolation, indicators, copy, and clear;
- Master Clock, Transpose, and Panic behavior.

Fixed splits or stored morph metadata without a controllable input path are incomplete.

## C. Complete Organ engine

Implement two Organ layers integrated with Programs, zones, scenes, morphs, presets, focus, levels, inherited effects, and cleanup.

Required behavior:

- audibly distinct B3, B3 Bass, Vox, Farf, Pipe 1, and Pipe 2 models;
- drawbars/registers with live/stored LED state and sync;
- B3 percussion and key click;
- vibrato/chorus and relevant model parameters;
- presets/live drawbars, octave, focus, zones, and morph destinations;
- Rotary routing, slow/fast/stop, acceleration, drive, close mic, and morph speed.

## D. Complete Synth engine

Implement three Synth layers integrated with the same Programs/performance/routing system.

Required behavior:

- Samples, Analog, and Extern state;
- meaningfully distinct Pure, Sync, Multi, Super, Misc, Wave, and FM behavior;
- Osc Ctrl behavior for supported source types;
- LP24, LP12, LP M, LP+HP, HP, and BP filters, tracking, resonance, and drive;
- oscillator, filter, and amplifier envelopes;
- LFO destinations/grouping/clock sync;
- poly, mono, legato, priority, glide, unison, and vibrato;
- deterministic Arpeggiator/Gate rate, clock sync, range, inversion, pattern, hold, keyboard sync, run, and gate behavior.

Renaming one oscillator for multiple models/sources is incomplete.

## E. Full-system integration and hardware audit

All engines must enter the Phase 2 buses/effects/master path and one destination. Program round-trips restore them. Splits, scenes, morphs, presets, focus, clocks, effects, and displays operate consistently across engines.

Audit every required Phase 3 control. Remove generic unbound-control fallbacks. A required control must change canonical state and, when sonically meaningful, audible output. Explicitly list any unsupported optional control in UI/notes; silent decoration may not masquerade as completion.

## Required implementation order

1. Update `IMPLEMENTATION_PLAN.md` with every assigned spec, an exact `Hard gates` checklist, canonical state schema, integration map, control-binding audit, and test matrix.
2. Complete canonical Program/preset serialization and workflows.
3. Add layers, zones/splits/crossfades, scenes, morphs, clock, transpose, and Panic.
4. Add and integrate the complete Organ engine.
5. Add and integrate the complete Synth engine.
6. Bind/audit all required hardware, displays, routing, and Program round-trips.
7. Run full regression, real-boundary audio tests, integrated browser flows, stress/performance checks, and canonical capture.

## Required tests and evidence

Preserve all Phase 1/2 tests and feature mappings. Add every Phase 3 ID from `TESTING.md`. Directly test Program round-trip/workflows, splits/zones/crossfades, scenes, morph inputs/interpolation, six Organ models/drawbars/Rotary, Synth sources/filters/envelopes/LFO/voice/arp/gate, hardware bindings, one-context routing, inherited effects, rapid layered play, and cleanup.

Browser evidence must exercise Programs, presets, Live Mode, splits, scenes, morphs, representative Organ models, representative Synth sources, layered/split play through effects, Panic, and required displays/bindings. Use canonical parent captures and compare against Phase 2 for visual drift. Record console state, exercised flows, performance observations, binding audit, and limitations.

Update implementation details with all generation/sample methods and provenance. Run all four pnpm gates and produce the sealed final build.
