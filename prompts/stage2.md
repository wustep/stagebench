# Phase 2 — Piano library and working effects

Work only inside the assigned Phase 2 candidate directory: the sealed Phase 1 artifact copied forward. Read Phase 2 of `specs/benchmark-phases.json`, all three assigned specs, and the inherited source, tests, and evidence.

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, and `specs/nord-stage-4.effects.json`.

## Outcome

Two sections come alive this phase: **Piano** and **Layer Effects**, exactly as their specs' `scope.required` lists define. The Master Level knob also becomes real. Organ, Synth, and Program controls keep their honest Phase 1 decorative behavior.

## Feature set

**Piano section (piano spec):**

- Six selectable types with at least one model each. Grand, Upright, and Electric are bundled, recorded, redistributable sample sets with enough root notes and velocity layers to avoid obvious pitch-shifting; Clav, Digital, and Misc may be honest synthesis.
- Two layers with enable, focus, level, octave shift, SUSTPED/PSTICK toggles, and correct per-layer voice ownership.
- KB Touch (3 curves), Dyn Comp (Off/1/2/3), Timbre (per type family), Unison (Off/1/2/3), Soft Release, String Res.
- Sustain from UI, keyboard, and MIDI CC64; asset failure enters a labeled playable fallback.

**Layer Effects section (effects spec):**

- Per-layer chains for Piano A and B: Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb — every listed type audibly distinct — plus the shared Rotary reached via To Rotary.
- Focus follows layer focus; manual focus buttons, Piano group mode, Delay/Compressor/Reverb global mode, per-unit bypass, all-effects bypass, and the documented signal order (Reverb before Rotary; Delay feedback filtering processes repeats).
- One `AudioContext`: layer buses → ordered effects → layer level → master gain/limiter → one destination. Short ramps avoid clicks; everything cleans up.

Skip everything the specs list under `excluded` — those controls stay decorative, permanently.

## Order of work

1. Update `IMPLEMENTATION_PLAN.md` citing all three assigned spec filenames with the Phase 2 `Hard gates` checklist, sample provenance plan, and a graph diagram.
2. Refactor the Phase 1 voice into the layer/bus/master architecture without changing input behavior.
3. Piano types, two-layer state, and performance controls.
4. Effect units in signal order, then focus/group/global routing and panel bindings.
5. Rendered-audio tests, browser pass, visual regression against Phase 1, captures, and provenance.

## Evidence

Preserve every Phase 1 test and feature mapping; add all Phase 2 IDs from `TASK.md`. Tests must cross the audio boundary: instrument distinctions, control changes, pedal behavior, layer ownership, effect processing/bypass/order, one context, and cleanup. Update `IMPLEMENTATION_DETAILS.json` with the full sample library and licenses. Use the parent capture harness for canonical Phase 2 evidence and run all four pnpm gates.
