# Phase 2 — Piano library and working effects

Work only inside the assigned Phase 2 candidate directory. It is the sealed Phase 1 artifact copied forward. Read Phase 2 of the manifest, the visual/Piano/effects specs, manual pages for Piano and effects, inherited source/tests/evidence, and the exact hard gates.

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, and `specs/nord-stage-4.effects.json`.

## Exact outcome

Preserve the complete Phase 1 surface and input lifecycle. Turn it into a credible multi-Piano instrument with at least three audibly distinct Piano choices and a real connected effects architecture. Piano and effect controls now update canonical state, hardware feedback, and audible output. Program, Organ, and Synth system behavior remains deferred to Phase 3.

## Required Piano library

Provide bundled recorded sample sets for at least these three selectable musical characters:

1. acoustic grand;
2. acoustic upright;
3. electric or electromechanical Piano.

They must be audibly distinct rather than labels over one source. Phase 2’s primary instruments must use recorded samples—not generated buffers presented as samples—and must be bundled for offline use under licenses that permit redistribution. Declare source, license, files, root notes, and velocity layers. Use enough root notes and velocity variation to avoid obvious uniform pitch shifting. A synthesized/modelled fallback is allowed only after primary sample failure, must remain playable, and must be labeled as fallback.

Implement two Piano layers with:

- enable, focus, level, selection, and octave;
- shared input lifecycle with correct per-layer voice ownership;
- useful velocity/touch curves;
- sustain plus supported soft/sostenuto or truthful approximation;
- release and string/pedal resonance where claimed;
- timbre, dynamic compression, and unison where exposed;
- stable repeated/overlapping notes, deterministic stealing, functional master-volume and Panic panel controls, and cleanup;
- selection/loading/fallback/error feedback through the real panel/display.

## Required signal architecture

Use one `AudioContext`. Notes enter reusable per-layer source buses, then ordered effect processing, master gain/limiter, and one destination. Engines/effects may not create direct parallel destination contexts. Apply short parameter ramps where needed to avoid clicks and clean up all nodes/timers/listeners.

## Required working effect families

Each family must process real audio, expose its primary parameters through the reference hardware, support on/bypass, and measurably change standardized rendered audio:

- Mod 1 representative modulation;
- Mod 2 representative modulation;
- Delay with time/rate, feedback, dry/wet, and feedback-path filtering/effect behavior;
- Amp Simulator/EQ or resonant filter behavior;
- Compressor;
- Reverb with audible tail and dry/wet behavior;
- Rotary Speaker with slow/fast/stop behavior for routed content.

Implement focus/targeting, Piano layer/group behavior, global-unit behavior, all-effects bypass, wet/dry, and the documented order. Reverb precedes Rotary. Delay feedback processing affects repeats rather than the dry path. A label, enum, metadata object, or disconnected node is not an effect.

## Hardware boundary

Piano and effect controls that exist in the assigned specs must become meaningful. Their accessible values, LEDs, displays, focus, bypass, and audible state must agree. Program, Organ, and Synth controls may continue their Phase 1 presentation-only movement, but must not pretend to work.

## Required implementation order

1. Update `IMPLEMENTATION_PLAN.md` with all three assigned specs, an exact `Hard gates` checklist, source/provenance plan, graph diagram, control-to-state/audio mapping, and tests.
2. Refactor the Phase 1 voice into the shared layer/bus/master architecture without changing input behavior.
3. Add the three-or-more Piano choices and two-layer canonical state.
4. Implement detailed Piano controls and pedals.
5. Add each effect family and routing in documented signal order.
6. Bind real Piano/effect hardware controls and displays.
7. Complete deterministic rendered-audio tests, browser stress, visual regression, and evidence.

## Required tests and evidence

Preserve every Phase 1 test and feature mapping. Add all Phase 2 IDs from `TESTING.md`. Tests must directly cross the audio boundary and prove instrument distinctions, velocity/timbre/control changes, sustain/pedal/release behavior, two-layer ownership, effect processing/bypass/wet-dry/order/targeting, one context, clipping protection, and cleanup.

Exercise all Piano choices, layering, every input, rapid repeated notes, pedals, effect focus/targeting/bypass, parameter changes, asset failure, and Panic in the browser. Compare with Phase 1 to detect visual drift. Use the parent capture harness for canonical Phase 2 desktop/narrow images and metadata; record flows, console state, and remaining deviations in the audit.

Update `IMPLEMENTATION_DETAILS.json` with the complete Piano library, source/license/file provenance, fallback, and real signal graph. Run all four pnpm gates.

## Explicitly deferred to Phase 3

Do not claim full Program storage/navigation, Live Mode, preset libraries, editable zones/splits/crossfades, scenes, morph assignments, Organ sound engines, Synth sound engines, or complete hardware binding coverage.
