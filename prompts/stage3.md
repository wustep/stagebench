# Phase 3 — Complete Stage 4 system

Work only inside the assigned Phase 3 candidate directory: the sealed Phase 2 artifact copied forward. Read Phase 3 of `specs/benchmark-phases.json`, every assigned spec, and the inherited source, tests, and evidence.

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`, `specs/nord-stage-4.programs.json`, `specs/nord-stage-4.organ.json`, and `specs/nord-stage-4.synth.json`.

## Outcome

The remaining sections come alive: **Organ**, **Synth**, and the **Program/performance system**, exactly as their specs' `scope.required` lists define. The result is one serializable instrument — every control either works canonically or is explicitly listed as unsupported because its spec excludes it.

## Feature set

**Program section (programs spec):**

- 32 program slots (4 pages × 8 buttons) with dial browsing, a numeric list view, Store and Store As with naming, a truthful dirty indicator, and edit-discard on program change. Ship at least 8 factory programs.
- 8 Live slots that auto-store edits.
- Splits: up to 4 zones, three split points at the 11 documented positions, Off/±6/±12 crossfades, per-layer zone assignment, split LEDs.
- Layer Scenes I/II; Wheel and Control Pedal morphs with assignment, interpolation, indicators, and clearing.
- Master Clock (tap and dial, syncing arp/LFO/delay/Mod 1), Transpose ±6, and Panic.

**Organ section (organ spec):**

- Two layers sharing one effect chain; audibly distinct B3, Vox, Farf, and Pipe engines (B3 Bass and Pipe 2 may reuse engines as documented).
- Nine drawbars with LED graphs driving each model's spectrum; B3 percussion and key click; vibrato/chorus C1–C3/V1–V3; rotary routing with morphable slow/fast speed.

**Synth section (synth spec):**

- Three layers with the exact required waveform list (Pure, Sync, Multi, Super, FM-H) and category-correct Osc Ctrl.
- LP12/LP24/HP/BP filters with tracking, resonance, drive; oscillator/filter/amp envelopes; LFO with five waveforms and three destinations; poly/mono/legato, priority, glide, unison, vibrato; deterministic arpeggiator/gate with rate, clock sync, range, direction, hold, and run.

**Integration:**

- Organ and Synth enter the Phase 2 buses, effect chains, and single destination — no second `AudioContext`.
- Programs round-trip all supported state; splits, scenes, morphs, focus, and clock work identically across all engines.
- Audit every control: bind it, or list it under unsupported (spec-excluded) in the UI notes and audit. No silent no-op fallbacks.

## Order of work

1. Update `IMPLEMENTATION_PLAN.md` citing every assigned spec filename with the Phase 3 `Hard gates` checklist, the canonical state schema, and a control-binding audit plan.
2. Canonical serializable program state, then Store/Store As/Live and the dirty lifecycle.
3. Splits, zones, crossfades, scenes, morphs, clock, transpose, Panic.
4. Organ engine, then Synth engine, each integrated as it lands.
5. Full binding audit, regression pass, rendered-audio tests, captures, and provenance.

## Evidence

Preserve all Phase 1–2 tests and mappings; add every Phase 3 ID from `TASK.md`. Tests must prove program round-trips, split/scene/morph behavior, organ model and drawbar distinctions, synth source/filter/envelope/LFO/voice/arp behavior, one-context routing, and cleanup. Exercise programs, Live Mode, splits, scenes, morphs, representative organ and synth sounds, and Panic in the browser. Update `IMPLEMENTATION_DETAILS.json`, use the parent capture harness, and run all four pnpm gates.
