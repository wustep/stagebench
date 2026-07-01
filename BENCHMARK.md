# Nord Stage 4 web recreation benchmark — protocol 3

## Overview

Stagebench evaluates a coding-agent configuration’s ability to incrementally recreate the Nord Stage 4 as an interactive browser instrument. It combines reference-driven UI reconstruction, accessibility, browser input, real-time audio, state architecture, technical-document interpretation, testing, and regression-sensitive product development.

The unit under test is the recorded agent configuration—not a base-model name by itself. See [`METHODOLOGY.md`](./METHODOLOGY.md) for claims, non-claims, comparison rules, validity classes, and threats to validity.

## Three cumulative completion targets

A run chooses target Phase 1, 2, or 3 at creation. Selection is cumulative:

| Target | Created/evaluated phases | Final outcome |
| ---: | --- | --- |
| 1 | Phase 1 | Complete surface plus one basic playable Piano voice |
| 2 | Phases 1–2 | Complete surface plus multi-Piano library and working effects |
| 3 | Phases 1–3 | Complete Stage 4 Programs/performance/Organ/Synth system |

Target 2 does not skip Phase 1. Target 3 does not skip Phases 1–2. Each later phase begins from the preceding sealed artifact and must preserve its behavior.

Create a run with the public CLI:

```sh
pnpm stagebench create \
  --model <canonical-model-id> \
  --provider <provider> \
  --model-snapshot <exact-snapshot> \
  --reasoning <setting> \
  --target-phase <1|2|3> \
  --variant <stage-4-88|stage-4-73|stage-4-compact-73>
```

New runs default to `exploratory`. `--official true` is reserved for runs using an approved comparison group, environment, resource track, and complete provenance.

## Source-of-truth files

- `specs/benchmark-phases.json` — active phase selection, scope, exact included/excluded behavior, and hard gates.
- `prompts/stage1.md`, `stage2.md`, `stage3.md` — implementation instructions.
- `TESTING.md` — exact feature IDs, candidate tests, canonical evidence, and sealing contract.
- `specs/nord-stage-4.*.json` — visual, Piano, effects, Programs, Organ, Synth, and variant requirements.
- `evaluation/rubrics/v3.json` — active three-phase evaluation weights and guidance.
- `schemas/` — persisted protocol, run, telemetry, assessment, evaluation, verification, feature, provenance, and registry contracts.
- each `runs/<id>/run.json` — authoritative run state. `src/data/runs.json` is generated and never an independent source of truth.

The fetched manual is authoritative where a summarized domain spec is ambiguous.

## Reference material

Nord/Clavia’s manual and product photography are third-party copyrighted works and are not redistributed by Stagebench. Fetch the current official assets locally:

```sh
pnpm fetch:reference
```

Each run targets exactly one variant:

| Variant | ID | Keybed |
| --- | --- | --- |
| Stage 4 88 | `stage-4-88` | 88 keys, A–C, hammer action |
| Stage 4 73 | `stage-4-73` | 73 keys, E–E, hammer action |
| Stage 4 Compact 73 | `stage-4-compact-73` | 73 keys, E–E, semi-weighted waterfall |

The selected variant’s registry entry and reference image win over generic assumptions. Do not mix variants within one run.

## Isolation and one-way inheritance

Candidate generation must not run from the repository containing prior solutions. Create an allowlisted bundle:

```sh
pnpm stagebench bundle --id <run-id> --phase <N>
```

The bundle contains:

- a writable `candidate/` directory containing the starter or inherited candidate artifact;
- read-only-intended `inputs/` containing only benchmark/testing docs, the current phase prompt, current and inherited assigned specs, selected variant registry, and fetched selected references;
- no other `runs/`, gallery registry, reports, evaluator output, future prompts, or unrelated solutions;
- `bundle-manifest.json` with input hashes and isolation assertions.

Official execution uses the container command so the inputs are read-only and the host repository is not mounted:

```sh
pnpm stagebench exec --id <run-id> --phase <N> --command "pnpm test"
```

Network is disabled unless the run’s declared policy explicitly selects the registry-only track. The same isolation boundary applies to implementation-agent processes; merely giving an agent a bundle path while leaving host filesystem access available is not sufficient for an official run.

Phase N receives only its own prompt/spec bundle and the sealed candidate output from Phase N−1. It does not receive future prompts or prior models’ conclusions.

## Shared implementation requirements

Every phase uses:

- TypeScript and React;
- pnpm with a committed `pnpm-lock.yaml` and declared `packageManager`;
- Vite `base: './'` for portable previews;
- a normalized, typed hardware/state model with stable control IDs;
- responsive, keyboard-accessible controls and clear focus states;
- injectable browser/audio/MIDI/timing/storage boundaries;
- deterministic tests that do not require network, devices, or audio output;
- `test`, `typecheck`, `lint`, and `build` scripts;
- truthful `IMPLEMENTATION_DETAILS.json` source/sample provenance;
- canonical parent-captured evidence and a candidate visual/flow audit;
- no TypeScript, console, or runtime errors in required flows.

## Phase 1 — Complete surface and basic Piano

### Product outcome

Build the entire visible Stage 4 for the assigned variant and make the exact keybed playable with one dependable basic Piano voice. All other visible controls move/press accessibly but are explicitly decorative.

### Visual requirements

- Exact variant silhouette, key count/range/action, and continuous red chassis.
- Roughly 54% control deck and 46% keybed height.
- Performance 13%, Organ 21%, Piano 15%, Program/Morph 9%, Synth 21%, Effects 21% section widths.
- Reference-specific control density and landmarks across all six sections.
- Program and Synth are the only primary OLED locations.
- Mixed reference materials: red metal, dark inset panels, black indexed knobs, switches, fader caps, LEDs, drawbars, blue-green OLEDs, and white legends.
- No generic dark slab, invented primary hardware, large marketing hero, reference-image overlay, detached frame, missing keys, or clipped chassis.

### Functional requirements

- Pointer, independent touch, computer keyboard, and MIDI feed one note lifecycle.
- One Piano-like source with velocity, release, sustain input, polyphony/stealing, cleanup, and truthful loading/error/fallback state.
- Every visible physical control has a stable accessible name and moves or presses.
- Every visible panel knob/button/wheel/fader/drawbar/encoder is decorative and must not change audio or fake canonical system behavior. Only keybed note/sustain input affects sound.

### Deferred

Multiple Piano instruments, detailed Piano modeling controls, audible effects, Programs/presets, splits/scenes/morphs, Organ audio, and Synth audio.

## Phase 2 — Piano library and working effects

### Product outcome

Preserve Phase 1 and add a credible multi-Piano instrument plus a connected, controllable effects architecture.

### Piano requirements

- At least three audibly distinct bundled recorded sample sets covering acoustic grand, acoustic upright, and electric/electromechanical character.
- Redistributable licenses, offline playback, complete file/root/velocity provenance, and a separately labeled synthesized/modelled fallback.
- Two Piano layers with enable/focus/level/selection/octave and correct voice ownership.
- Velocity/touch response, detailed release, supported resonance, timbre, dynamic compression, unison, sustain, and supported soft/sostenuto behavior.
- Every claimed Piano control updates canonical state, hardware feedback, and audible output.
- Master Volume and Panic become functional panel controls in this phase; other Phase 3-only controls remain decorative.

### Audio/effect requirements

- One AudioContext, per-layer buses, ordered effects, master gain/limiter, and one destination.
- Real Mod 1, Mod 2, Delay, Amp/EQ or filter, Compressor, Reverb, and Rotary processing.
- On/bypass, all-bypass, wet/dry, focus/targeting, Piano group/layer and global-unit behavior.
- Delay feedback processing affects repeats; Reverb precedes Rotary; parameter changes avoid clicks.
- Real/offline tests show measurable effect and Piano-control changes.

### Deferred

Full Programs/Live/presets, editable splits/scenes/morph assignment, Organ engines, Synth engines, and complete binding of Phase 3-only controls.

## Phase 3 — Complete Stage 4 system

### Product outcome

Complete the instrument as one canonical serializable system. Add Programs/performance workflows, two Organ layers, three Synth layers, and meaningful bindings across the required hardware, all routed through Phase 2’s graph.

### Programs and performance

- Program browse/list modes, Store/Store As, naming/categories, dirty/cancel/undo, Program buttons, presets, and eight Live slots.
- Round-trip all supported Piano/Organ/Synth/effect/routing/split/scene/morph/focus/display state.
- Engine/layer enable/focus/levels/octaves and source/effect/master routing.
- Up to four zones with editable documented Low/Mid/High split points and Off/±6/±12 crossfades.
- Layer Scenes I/II and Wheel/Aftertouch/Control Pedal morph assignment, interpolation, indicators, copy, and clear.
- Master Clock, Transpose, and Panic.

### Organ

- Two layers and audibly distinct B3, B3 Bass, Vox, Farf, Pipe 1, and Pipe 2 models.
- Drawbars/registers/LED state, percussion, key click, vibrato/chorus, presets/live drawbars, sync, focus/zones, and morph destinations.
- Rotary routing, slow/fast/stop, acceleration, drive, close mic, and morph behavior.

### Synth

- Three layers with Samples, Analog, and Extern state.
- Distinct Pure, Sync, Multi, Super, Misc, Wave, and FM behavior.
- Osc Ctrl, required filters/tracking/resonance/drive, oscillator/filter/amplifier envelopes, LFO, poly/mono/legato/priority, glide, unison, and vibrato.
- Deterministic Arpeggiator/Gate rate, master-clock sync, range, inversion, patterns, hold, keyboard sync, run, and gate behavior.

### Integration and bindings

All engines use inherited Programs, presets, scenes, zones/splits/crossfades, morphs, focus, clocks, effects, one AudioContext, and one master destination. Every required control has a meaningful canonical binding and an audible result where sonically appropriate. Generic no-op fallbacks do not count.

## Durable phase workflow

For each selected phase:

1. `prepare` requires the preceding selected phase to be complete.
2. `bundle` creates the solution-free phase workspace.
3. `mark --status running` starts an implementation attempt and telemetry clock.
4. The candidate implements/tests only inside the bundle candidate directory; `pnpm stagebench import --id <id> --phase <N>` imports only that output to the authoritative stage directory.
5. Parent canonical capture records desktop/narrow evidence and console output.
6. `verify` runs technical/contract/evidence checks and seals an artifact digest.
7. `mark --status complete` requires that passing sealed verification.
8. A blind evaluator bundle uses an opaque trial ID and excludes model/provider identity.
9. The assessment is scored and recorded against the private trial-to-run mapping.
10. Preview publication may expose completed phases; official final publication requires all selected phases complete and evaluated.

The executable state machine, not prose alone, rejects skipped prerequisites and completion without verification.

## Provenance, telemetry, and run identity

Protocol-v3 `run.json` records:

- provider, canonical model, exact snapshot, reasoning setting, agent/tool/orchestration/context policy, and response model IDs when available;
- protocol/rubric version and manifest digest;
- selected target/phases and hardware variant;
- official/exploratory classification, comparison group, and validity;
- git commit/branch/dirty state;
- OS/architecture, Node/pnpm/browser/timezone, and network policy;
- resource track and limits;
- measured/estimated/unavailable per-phase and total wall time, tokens, reasoning tokens, cost, tool calls, subagents, attempts, and verifier repairs.

Record telemetry with:

```sh
pnpm stagebench telemetry --id <run-id> --phase <N> --wall-time-seconds <n> --input-tokens <n> --kind measured
```

Unavailable values are recorded as unavailable, never silently as zero.

## Evaluation and result interpretation

Protocol-v3 uses `evaluation/rubrics/v3.json`. Phase aggregate weights are 25%, 30%, and 45%. Category weights change by phase because the delivered product changes.

An evaluator receives `.stagebench/blind/trial-…`, not a model-named run path. The public bundle contains the sealed artifact, relevant protocol/spec/rubric inputs, and opaque ID; the private map resolves the result only during scoring. Identity-leak scanning fails bundle creation unless explicitly overridden for a non-official diagnostic run.

Technical failures still retain diagnostic raw rubric values, but run validity/classification is shown separately. Only complete, valid, compatible official trials may be ranked together. Partial, invalid, exploratory, and legacy runs remain inspectable in separate classes.

## Registry and publication

`runs/<id>/run.json` is the only mutable run record. Normal run/evaluation updates never write `src/data/runs.json`. Regenerate the deterministic gallery index with:

```sh
pnpm stagebench reindex
```

`predev` and `prebuild` regenerate it automatically. Legacy records receive a generated legacy/non-comparable classification in the index without rewriting their authoritative historical manifests.
