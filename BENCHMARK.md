# Stagebench — Nord Stage 4 recreation benchmark (protocol 3.1)

Stagebench measures how well a coding-agent configuration can recreate the Nord Stage 4 as an interactive browser instrument, working incrementally from a product photo, the user manual, and machine-readable specs. It exercises dense reference-driven UI, accessibility, browser input, real-time audio, state architecture, and regression-safe extension of an existing artifact.

## Three phases, three feature sets

Each phase turns one set of features on and leaves everything else honestly decorative. A run picks a target phase at creation; targets are cumulative (target 2 = phases 1–2, target 3 = phases 1–3), and each phase starts from the previous phase's sealed artifact and must not regress it.

| Phase | Becomes functional | Stays decorative |
| ---: | --- | --- |
| 1 | The complete visible surface (every control moves/presses accessibly) and one basic piano voice played from the keybed | Every panel control |
| 2 | The Piano section (6 types, 3 recorded sample sets, 2 layers, performance controls) and the Layer Effects section (6 units + Rotary), plus Master Level | Organ, Synth, Program sections |
| 3 | Everything else: Organ engine, Synth engine, Programs (32 slots + 8 Live), splits, scenes, morphs, master clock, transpose, Panic | Only spec-excluded controls (listed as unsupported) |

## Source-of-truth files

- `specs/benchmark-phases.json` — phase scopes, hard gates, and shared completion gates.
- `specs/nord-stage-4.visual.json` + `specs/nord-stage-4.variants.json` — surface geometry and the three hardware variants.
- `specs/nord-stage-4.piano.json`, `…effects.json`, `…organ.json`, `…synth.json`, `…programs.json` — per-section behavior, summarized from the manual with page citations. Each has a `scope` block: `required` must work canonically, `optional` is extra credit that must actually work if claimed, and `excluded` is deliberately cut — those controls exist visually, move or press, and are listed as unsupported.
- `prompts/stage1.md` … `stage3.md` — the per-phase instructions given to the implementation agent.
- `bench/rubric.json` — scoring weights.

Precedence: the run's variant photo is authoritative for visible layout and materials; the fetched manual is authoritative for behavior where a spec is ambiguous; the specs bind both to phases.

Notable deliberate cuts from the real instrument: 32 programs instead of 512, no per-section preset library, no Extern/Aux KB/MIDI menus, no aftertouch, no arpeggiator pattern editor, and reduced organ engine requirements (B3 Bass and Pipe 2 may reuse engines).

## Honesty contract

The core rule in every phase: a control either works canonically — updating real state with audible output where sonically meaningful — or it visibly exists, moves, and does nothing. It never fakes success, and evidence never claims unimplemented behavior. Verification and evaluation both check this boundary.

## Implementation requirements

Every phase uses TypeScript + React + Vite (`base: './'`) with pnpm (committed lockfile, declared `packageManager`), and exposes non-interactive `test`, `typecheck`, `lint`, and `build` scripts (`build` produces `dist/index.html`). Controls have stable IDs and accessible names/roles/values. Browser, audio, MIDI, timing, and storage boundaries are injectable so tests run deterministically without network, devices, or audio output. `IMPLEMENTATION_DETAILS.json` truthfully declares every audio source and license — generated buffers are never described as recordings.

## Required feature IDs

Each phase maintains `tests/feature-matrix.json`: every required ID below maps to one or more real, non-empty test files. Later phases keep inherited IDs and tests; never delete a regression test to pass a later phase.

**Phase 1 — surface and basic piano**

- `visual.key-count` — exact variant key count, range, white/black pattern, and geometry.
- `visual.section-layout` — six ordered sections at documented widths, 54/46 deck/keybed split, continuous chassis.
- `visual.control-inventory` — stable control IDs, per-section landmarks and density, Program/Synth as the only primary OLEDs.
- `interaction.keys` — pointer/touch/keyboard key press, release, and cancel/blur behavior.
- `interaction.decorative-controls` — every visible control moves or presses accessibly and changes presentation state only.
- `accessibility.controls` — accessible names, roles, values, keyboard operation, and visible focus.
- `piano.basic-note-lifecycle` — note on/off, repeated and overlapping notes, release, all-notes-off, node cleanup.
- `piano.basic-inputs` — pointer, independent multi-touch, mapped keyboard with repeat suppression, MIDI note/velocity/sustain, and denied/disconnected MIDI.
- `piano.basic-sustain-polyphony` — sustain transitions, concurrent voices, deterministic stealing, velocity response.
- `piano.basic-status-cleanup` — truthful loading/ready/error/fallback status; blur/disconnect/unmount stops every owned voice.
- `regression.chassis` — no marketing hero, detached rails, missing keys, overflow, or clipped chassis at 1440x900 and 390x844.

**Phase 2 — piano library and effects**

- `piano.instrument-library` — six selectable types; Grand/Upright/Electric are bundled recorded sample sets, audibly distinct, offline, with truthful provenance.
- `piano.layers` — two-layer enable/focus/level/octave with correct voice ownership and cleanup.
- `piano.velocity-controls` — KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, and Master Level measurably alter rendered audio.
- `piano.pedals` — sustain from UI/keyboard/MIDI honoring SUSTPED; any claimed soft/sostenuto behavior is tested or truthfully labeled an approximation.
- `piano.fallback` — asset failure enters a labeled playable fallback without reporting the primary library ready.
- `effects.graph` — one AudioContext, per-layer buses, ordered effects, master gain/limiter, one destination, cleanup.
- `effects.routing` — focus follows layers, manual focus, group and global modes, per-unit bypass, all-effects bypass, dry/wet, documented order, delay feedback path, To Rotary.
- `effects.processing` — every unit and listed type measurably changes rendered audio.
- `regression.phase1` — all Phase 1 tests remain present and green.

**Phase 3 — the rest of the instrument**

- `programs.roundtrip` — save/load restores all supported state across the 32 slots; dirty indicator is truthful.
- `programs.store-live` — Store, Store As with naming, and the 8 auto-storing Live slots.
- `programs.undo-cancel` — edit-discard on program change and any claimed undo restores the documented prior state.
- `programs.navigation` — program buttons, pages, dial, and the numeric list view.
- `layers.routing` — enable/focus/level/octave/effect-target routing for every layer of every engine.
- `splits.zones` — editable split points at the 11 documented positions, up to 4 zones, note routing, Off/±6/±12 crossfade gains.
- `morph.assignments` — Wheel and Control Pedal assignment, interpolation, indicators, and clearing.
- `scenes.switching` — Scene I/II toggles layer enable state without duplicating sound parameters.
- `organ.engine` — two-layer note lifecycle, levels, focus, zones, shared effect chain, cleanup.
- `organ.models-drawbars` — B3/Vox/Farf/Pipe spectral distinctions; drawbars/registers with LED state; percussion, key click, vibrato/chorus.
- `organ.rotary` — routing, slow/fast/stop with acceleration, drive, morphable speed.
- `synth.sources` — three layers; required waveforms distinct per category; Osc Ctrl behaves per category.
- `synth.filter-envelopes` — filter types/tracking/resonance/drive and all three envelopes have observable effects.
- `synth.voice-modes` — poly/mono/legato, priority, glide, unison, vibrato, and LFO behavior.
- `synth.arp-gate` — deterministic rate, clock sync, range, direction, hold, and run.
- `system.integration` — all engines share programs, scenes, zones, morphs, clock, effects, one AudioContext, one master path, and Panic.
- `hardware.bindings` — every non-excluded control has meaningful canonical behavior; spec-excluded controls are listed as unsupported.
- `regression.phase2` — all Phase 1–2 tests remain green.

**Audio test rules.** Use deterministic signals and tolerant relationships, not exact cross-browser waveforms. At minimum prove: output differs from silence; velocity/volume move output in the expected direction; sustain/release change duration; required instrument/model/source distinctions do not render identically; effect on/bypass/wet-dry and primary parameters change the signal; nothing bypasses the master path; and voice/node/timer/listener counts return to baseline after cleanup. When behavior is claimed audible, a state-only test with fakes is not enough.

## Running the benchmark

Fetch the copyrighted reference assets first (never redistributed with this repo):

```sh
pnpm bench fetch
```

Then a run is four commands:

```sh
pnpm bench new --model <id> --target <1|2|3> [--variant stage-4-73]
pnpm bench start <run-id>     # per phase: creates the isolated workspace
pnpm bench seal <run-id>      # per phase: import + checks + capture + verify + seal
pnpm bench score <run-id>     # per phase: run twice — writes the template, then registers the filled assessment
```

`start` copies the starter (or the preceding sealed artifact) plus only this phase's prompt/specs into `.stagebench/work/<id>/stage<N>/` — the implementation agent works there and never sees `runs/`, other solutions, or future prompts. For hard isolation, run the candidate's commands inside Docker: `pnpm bench exec <run-id> --command "pnpm test"` mounts the candidate writable and the inputs read-only with no network (pass `--network registry` to allow package installs). `seal` imports the candidate, reruns the four package gates, captures parent-controlled 1440x900 and 390x844 screenshots of the built artifact, verifies the phase contract/feature matrix/evidence/provenance, hashes the tree into `runs/<id>/verifications/stage<N>.json`, and publishes the preview. The candidate also writes `evidence/stage<N>-visual-audit.md` describing measurements, exercised flows, and known deviations.

**Telemetry.** Wall time per phase is recorded automatically (start → seal). Cost and token usage come from the agent runtime, so the operator or orchestrating agent passes them at seal time — `pnpm bench seal <id> --cost-usd 12.50 --input-tokens 1200000 --output-tokens 300000 --reasoning-tokens 80000 --tool-calls 420` — or afterwards with `pnpm bench telemetry <id> --phase <N> <same flags>`. Per-phase values roll up into run totals shown in the gallery; unrecorded values stay `null`, never zero.

`bench status <run-id>` always prints the next command plus recorded telemetry. `pnpm bench help` lists everything.

## Evaluation

`bench score` writes an assessment template; a **fresh evaluator agent** (independent of the implementation agent, read-only) inspects the sealed artifact against the rubric and fills in 0–4 ratings, each with concrete evidence. Running `bench score` again validates the assessment, reruns the technical checks against the sealed digest, computes the score, and writes the gallery report. Phases 1–3 aggregate at 25/30/45; a failed technical check caps the phase at 59, a missing build at 49.

## Interpreting results

- The unit under test is the full agent configuration recorded in `run.json` — not a base model in the abstract.
- A single run is one stochastic observation; small score differences are within evaluator noise, and evaluations are not blinded to model identity.
- The Nord Stage 4 is a public product; training-data familiarity cannot be ruled out. Results mean "performance on this disclosed task".
- Prompts, specs, rubric, and verifier behavior are comparison-critical: changing them means bumping the protocol version, and runs from different protocol versions are not comparable. Runs recorded before the current run schema are shown as **Legacy** in the gallery with their frozen scores and reports.

## Run records

`runs/<id>/run.json` is the only authoritative run record; `src/data/runs.json` is a generated projection (`pnpm bench reindex`, run automatically before dev/build). Sealed phases record artifact digests; scored phases record evaluations and static HTML reports under `public/reports/<id>/`.
