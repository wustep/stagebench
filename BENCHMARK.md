# Nord Stage 4 Web Recreation Benchmark

## Overview

This benchmark evaluates the ability of an LLM coding agent to incrementally recreate the Nord Stage 4 as a fully interactive web application.

Unlike traditional coding benchmarks, this benchmark measures long-horizon product development, UI fidelity, incremental architecture, browser APIs, audio programming, and the ability to extend an existing codebase without regressions.

The benchmark is intentionally split into four phases. Each phase builds on the previous one while remaining independently runnable.

## Repository structure

```text
/
├── prompts/
│   ├── stage1.md
│   ├── stage2.md
│   ├── stage3.md
│   └── stage4.md
├── runs/
│   └── <model-id>/
│       ├── run.json
│       ├── stage1/
│       ├── stage2/
│       ├── stage3/
│       └── stage4/
├── reference/        # fetched, gitignored — manual + product photos (pnpm fetch:reference)
└── tests/
```

The benchmark infrastructure copies compatibility-named folders between phases:

```text
stage1 → copy → stage2 → copy → stage3 → copy → stage4
```

Each folder must be independently runnable.

## Machine-readable specifications

The `specs/` directory is part of the benchmark contract, not optional background reading. `specs/benchmark-phases.json` assigns the relevant domain specifications and hard gates to each phase. The phase prompts and run skill must pass those exact files to implementation and evaluation agents.

- Phase 1: `nord-stage-4-73.visual.json`
- Phase 2: visual plus `nord-stage-4.piano.json`
- Phase 3: inherited specs plus `nord-stage-4.programs.json` and `nord-stage-4.effects.json`
- Phase 4: all inherited specs plus `nord-stage-4.organ.json` and `nord-stage-4.synth.json`

The checked-in manual remains authoritative when a summarized spec is ambiguous. Each domain spec cites its printed manual pages.

## Canonical references

Treat these as the source of truth.

### Reference material

The Nord Stage 4 user manual and official product photos are third-party works owned by Clavia DMI AB. They are **not** redistributed in this repository. Fetch them from Nord's official servers into `reference/` (gitignored) before running the benchmark:

```sh
pnpm fetch:reference
```

This downloads the manual and the 88 / 73 / Compact 73 top-down photos for local evaluation only. Do not commit, re-host, or otherwise redistribute the contents of `reference/`.

### Product image

The full-resolution primary visual reference is `reference/nord-stage-4-73.jpg`, fetched from Nord's official asset server (see [Reference material](#reference-material)). Measured reference values are stored in [`specs/nord-stage-4-73.visual.json`](./specs/nord-stage-4-73.visual.json).

It targets the Nord Stage 4 73 hardware shown in the official top-down photograph. The 88 (`reference/nord-stage-4.jpg`) and Compact 73 (`reference/nord-stage-4-compact.jpg`) are fetched for context only. Do not silently substitute the Compact 73 or label the recreation “Compact” when following this reference.

Do not use a Compact-model image as a geometry or labeling reference. When another product image conflicts with the primary 73 image, the primary 73 image wins.

### Visual fidelity contract

The recreation must be compared directly against the primary image rather than merely borrowing a generic red-keyboard aesthetic.

- Preserve the measured 3.095:1 instrument width-to-height silhouette within a 2.5% tolerance.
- Render one continuous red chassis around the control surface and keybed. Top rail, bottom lip, and both end cheeks must connect without white gaps, detached rails, or unrelated outer frames.
- The control deck including its top rail should occupy about 54% of the instrument height and the keybed including the bottom rail about 46%. The earlier 45/55 estimate was incorrect; use the measured specification.
- Approximate horizontal section allocation from left to right: Performance 13%, Organ 21%, Piano 15%, Program/Morph 9%, Synth 21%, Layer Effects 21%.
- Keep the red surface visible between dark inset control plates. Do not turn the entire upper chassis into one uninterrupted charcoal slab.
- Match the reference hierarchy of control sizes: primary encoders and layer faders, then secondary knobs, then compact rectangular switches and LEDs.
- Reproduce the reference’s mixed hardware materials: black knobs with white index marks, dark and light fader caps, silver/gray switches, red illuminated states, green level LEDs, blue-green OLEDs, and white legends.
- Match the visible control density and grouping. Large empty panels or evenly spaced placeholder controls are fidelity failures.
- Match the section landmarks in `specs/nord-stage-4-73.visual.json` before adding micro-detail. Invented primary hardware is a structural failure: the Organ, Piano, and Effects sections must not gain OLED displays that are absent from the photograph. Only Program and Synth use primary OLEDs in this reference.
- Prefer fewer correctly placed controls over a dense generic matrix. A repeated knob/button grid that ignores the photograph scores worse than a partially complete but correctly structured panel.
- Model exactly 73 keys: 43 white and 30 black in the Stage 4 73 E-to-E pattern. Keep them inside the connected red end cheeks at every supported width. No key or chassis segment may overflow or be clipped.
- Use a neutral light product-study background like the source photograph. The instrument—not a marketing headline—must be the first and dominant visual element, occupy 88–97% of a 1440px viewport's width, and remain fully visible without vertical scrolling at 1440×900.
- Do not add a large hero, product slogan, decorative stage scene, or unrelated copy above the instrument. Small status/help text may sit below it.
- Do not render the supplied reference photograph as a background, texture, overlay, or substitute for DOM/CSS controls. It is comparison evidence only.

### Required visual comparison loop

Visual fidelity is an implementation loop, not a final glance.

1. Read the full-resolution image and `specs/nord-stage-4-73.visual.json` before creating components.
2. Build the instrument from a normalized, data-driven hardware map with stable IDs for sections and controls.
3. Capture a 1440×900 screenshot, crop both render and reference to the instrument bounds, then compare section landmarks, forbidden hardware, control placement, vertical allocation, section widths, key counts, and dominant colors in that order. Whole-page whitespace must not dominate the comparison.
4. Record the measured differences and correct the three largest structural mismatches.
5. Capture a second desktop pass plus a 390×844 narrow screenshot. Save the required evidence described in `TESTING.md`.

Phase 1 cannot be complete after only one screenshot pass. Later phases must compare their evidence with the preceding phase to prevent visual drift.

### User manual

The behavioral reference is the [Nord Stage 4 User Manual v1.6X](https://www.nordkeyboards.com/wt/documents/951/Nord%20Stage%204%20User%20Manual%20v1.6X-Edition-N.pdf), fetched to `reference/manual.pdf` (see [Reference material](#reference-material)).

Treat the manual as the behavioral specification. Use it to reproduce control behavior, button interactions, menus, parameter ranges, layer behavior, keyboard splits, morph assignments, effects, routing, synthesizer behavior, piano behavior, organ behavior, and display states.

The goal is not simply to build “a keyboard.” The goal is to recreate the Nord Stage 4 as faithfully as practical within the browser.

## General requirements

Throughout all phases:

- pnpm exclusively for dependency installation and every package script; commit `pnpm-lock.yaml`, declare `packageManager` in `package.json`, and do not create npm or Yarn lockfiles
- TypeScript
- React
- Modern browser APIs
- Responsive layout
- Runs locally with one command
- No TypeScript errors
- No runtime console errors
- Clean architecture
- Preserve all previous functionality
- Do not regress previous phases
- Follow [`TESTING.md`](./TESTING.md), maintain `tests/feature-matrix.json`, and write tests alongside each implemented behavior
- Maintain `IMPLEMENTATION_DETAILS.json` with the phase's audio strategy, generated sound sources, and complete sample provenance; never describe generated buffers as recorded samples
- Provide `test`, `typecheck`, `lint`, and `build` package scripts that run non-interactively

The application should feel like a polished product, not a prototype.

The phase verifier must pass before completion:

```sh
node .agents/skills/run-nord-benchmark/scripts/verify-stage.mjs verify --id <run-id> --phase <1|2|3|4>
```

## Phase 1 — Visual recreation

### Goal

Recreate the Nord Stage 4 interface with high visual fidelity. No sound is required. Focus entirely on appearance and interaction.

### Requirements

Implement:

- Keyboard with all white and black keys
- OLED displays
- Buttons
- Knobs
- Rotary encoders
- LEDs
- Drawbars, if applicable to the chosen model
- Pitch stick
- Modulation wheel
- Branding
- Labels
- Section dividers
- Realistic spacing
- Shadows
- Gradients
- Responsive scaling

Interactions:

- Keys depress visually
- Buttons animate
- Knobs rotate
- LEDs toggle
- Displays illuminate
- Hover states
- Focus states

Everything visible on the hardware should exist. It does not need to perform its real function yet.

Write the Phase 1 model and interaction tests listed in `TESTING.md` before or alongside the corresponding controls. Preserve them in every later phase.

## Phase 2 — Piano instrument

Continue from Phase 1. Do not remove or regress any existing functionality.

### Goal

Implement a realistic playable piano. Only the Piano engine is required.

### Required features

Keyboard:

- Mouse input
- Touch input
- Computer keyboard input
- MIDI input

Audio:

- Sampled piano
- Velocity sensitivity
- Sustain pedal
- Polyphony
- Note release
- Low latency

Effects:

- Master volume
- Reverb

UI:

- Piano controls become functional
- Piano section updates display
- Parameter editing

Ignore Organ and Synth sections.

Add deterministic tests for note lifecycle, sustain, polyphony, velocity, keyboard mapping, MIDI parsing and failure states, volume/reverb routing, and the offline fallback. Fake the audio and MIDI boundaries; do not require physical devices or a real output channel.

## Phase 3 — Programs and effects

Continue from Phase 2. Preserve all previous functionality. Read and implement the Programs and Effects specs before beginning Organ or Synth audio work.

### Programs and performance system

- Canonical serializable Program state
- Program browsing, Store, Store As, categories, dirty state, cancel, undo, Live Mode, and Program buttons
- Preset browsing and storage for supported sections/layers
- Layer focus, levels, zones, splits, crossfades, and Layer Scenes
- Wheel, Aftertouch, and Control Pedal morph assignments
- Master Clock, Transpose, and Panic behavior
- Contextual displays and parameter editing

### Signal architecture and effects

Refactor the Piano engine into one shared `AudioContext` with per-layer buses, ordered effects, a master bus/limiter, and one destination. Implement the effect routing and unit families defined by `specs/nord-stage-4.effects.json`:

- Mod 1 and Mod 2
- Delay and its feedback effects/filters
- Amp Simulator/EQ and resonant filters
- Compressor
- Reverb
- Rotary Speaker
- Focus, group, global, targeting, bypass, wet/dry, and documented ordering

An effect represented only by state, metadata, a display label, or disconnected nodes is incomplete. A fixed split or a stored morph with no controllable input path is incomplete.

Add the Phase 3 tests specified in `TESTING.md`. Organ and Synth controls remain visually present but their sound engines are not implemented until Phase 4.

## Phase 4 — Organ and synth

Continue from the verified Phase 3 artifact and preserve its Piano, Program, routing, split, morph, scene, preset, and effect behavior.

### Organ

- Two layers sharing the documented Organ effects chain
- B3, B3 Bass, Vox, Farf, Pipe 1, and Pipe 2 models
- Drawbars/registers and stored/morphed LED state
- B3 percussion and key click
- Vibrato/chorus, presets/live drawbars, sync, zones, and focus
- Rotary speed, stop, acceleration, drive, close-mic, and morph behavior

### Synth

- Three independent layers
- Samples, Analog, and Extern state
- Pure, Sync, Multi, Super, Misc, Wave, and FM source behavior
- LP24, LP12, LP M, LP+HP, HP, and BP filters
- Oscillator, Filter, and Amplifier envelopes
- LFO destinations, grouping, and clock sync
- Poly, Mono, Legato, priority, glide, unison, and vibrato behavior
- Arpeggiator/Gate timing, patterns, range, inversion, hold, and sync

Organ and Synth must join the inherited Phase 3 buses and effects without creating separate destination AudioContexts. Model or source selections that only rename one generic oscillator are incomplete.

### Hardware controls

Every required Organ and Synth hardware control must have meaningful functionality. Remove generic unbound-control fallbacks for the Phase 4 inventory and integrate engine state with inherited Programs, splits, morphs, scenes, presets, displays, and effects.

Add the focused Phase 4 tests and all inherited regressions specified in `TESTING.md`.

## Evaluation

The benchmark evaluates both objective functionality and implementation quality. Every new four-phase run is scored independently with the versioned rubric in [`evaluation/rubrics/v2.json`](./evaluation/rubrics/v2.json). Legacy three-phase evaluations retain their original rubric version. See [`evaluation/README.md`](./evaluation/README.md) for the evaluator workflow and score format.

An independent evaluator assigns evidence-backed 0–4 criterion ratings. The scoring pipeline normalizes those ratings to 0–100, runs the phase artifact's typecheck, lint, and build commands, applies technical gates, and stores an auditable result with the run. Do not infer visual scores from source code alone; inspect the rendered artifact against the primary image.

Each scored run must publish a consistent readable report at `/reports/<run-id>/index.html` and store its Markdown counterpart at `runs/<run-id>/evaluations/report.md`. Reports present the run summary, generated implementation details, category scores, strengths, priority issues, technical results, and expandable criterion evidence in that order. The evaluator inventories declared application/development libraries from each `package.json`, detects bundled audio assets, and combines them with the authored audio provenance in `IMPLEMENTATION_DETAILS.json`. The resulting machine-readable inventory is stored at `runs/<run-id>/evaluations/implementation-details.json` and published beside the HTML report.

The inventory can also be regenerated independently of scoring with `node .agents/skills/run-nord-benchmark/scripts/evaluate-run.mjs details --id <run-id>`, including for partial or not-yet-evaluated runs.

Category values intentionally change as the benchmark advances:

| Category | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
| --- | ---: | ---: | ---: | ---: |
| Visual fidelity | 55% | 25% | 15% | 10% |
| Feature completion | 20% | 25% | 30% | 35% |
| Audio implementation | — | 30% | 30% | 30% |
| Interaction or system behavior | 15% | 15% | 15% | 15% |
| Engineering quality | 10% | 5% | 10% | 10% |

The run aggregate values Phase 1 at 20%, Phase 2 at 25%, Phase 3 at 25%, and Phase 4 at 30%. Partial aggregates are normalized over evaluated phases and must report their available phase coverage.

### Visual

- Layout accuracy
- Proportions
- Spacing
- Responsiveness
- Typography
- Control placement
- Continuous chassis silhouette
- Section-width accuracy
- Control density and material accuracy
- Direct screenshot comparison with the primary reference
- Correct section-specific hardware landmarks, including the reference's exact display count and locations
- Absence of invented OLEDs, generic control matrices, and controls borrowed from the wrong section

### Interaction

- Keyboard animation
- Knob behavior
- Button behavior
- LED behavior
- Display updates

### Audio

- Latency
- Polyphony
- Sustain
- Velocity
- Effect routing
- Audio quality

### Architecture

- Maintainability
- Modularity
- Incremental development
- Code organization

### Quality

- No console errors
- No runtime crashes
- TypeScript passes
- Lint passes
- Acceptable performance

Technical checks do not replace product evaluation. A failed test suite, typecheck, lint, or build caps the recorded phase score at 59. A missing built artifact caps it at 49. The uncapped rubric score remains available as `rawScore` for diagnosis.

## Benchmark philosophy

Rather than isolated algorithmic problems, this benchmark evaluates whether an agent can:

- Build a polished software product
- Work from visual references
- Interpret documentation
- Preserve previous work
- Extend an existing architecture
- Integrate UI, state management, rendering, and Web Audio
- Execute long-horizon implementation plans

Success is measured by how closely the resulting application resembles using an actual Nord Stage 4 in both appearance and behavior.
