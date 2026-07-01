# Stagebench v3 testing contract

Tests are part of implementation. Each phase uses red-green-refactor, preserves inherited tests, and must pass candidate-authored checks plus benchmark-owned verification before its artifact is sealed.

## Required package contract

Use pnpm exclusively. Every phase contains `pnpm-lock.yaml`, declares `packageManager: "pnpm@..."`, and exposes non-interactive scripts:

- `test` — deterministic unit/component/integration tests that run once;
- `typecheck` — TypeScript validation without output;
- `lint` — static checks;
- `build` — production build producing `dist/index.html`.

Tests run without a network, physical MIDI device, microphone, or real audio output. Browser, MIDI, audio, timing, storage, and asset boundaries must be injectable. Fake-backed state tests do not replace real or offline audio-boundary tests when behavior is claimed audible.

## Feature matrix

Each phase maintains `tests/feature-matrix.json` against `schemas/feature-matrix.schema.json`. Every required ID appears once and maps to one or more real, non-empty test files. Later phases keep inherited IDs and tests. Do not delete a regression test to pass a later phase.

```json
{
  "$schema": "https://stagebench.local/schemas/feature-matrix.schema.json",
  "version": 1,
  "stage": 1,
  "features": [
    {
      "id": "piano.basic-note-lifecycle",
      "tests": ["src/audio/note-lifecycle.test.ts"],
      "notes": "Covers repeated, overlapping, release, cleanup, and all-notes-off behavior."
    }
  ]
}
```

## Phase 1 required feature IDs

### Complete surface

- `visual.key-count` — exact assigned variant key count, range, white/black pattern, and geometry.
- `visual.section-layout` — six ordered sections, normalized widths, 54/46 deck/keybed split, and continuous chassis.
- `visual.control-inventory` — stable IDs, representative counts/landmarks/density, correct section ownership, and only Program/Synth primary OLEDs.
- `interaction.keys` — pointer/touch/keyboard visual key press and release/cancel/blur behavior.
- `interaction.decorative-controls` — every visible knob/encoder/fader/drawbar/wheel/button moves or presses accessibly without falsely changing unimplemented audio/system state.
- `accessibility.controls` — accessible names, roles, values/states, keyboard operation, focus visibility, and usable targets.
- `regression.chassis` — no marketing hero, detached rails, white gaps, wrong keybed, overflow, or clipped chassis at required viewports.

### Basic Piano

- `piano.basic-note-lifecycle` — note-on/off, repeated/overlapping notes, release, all-notes-off, and node cleanup.
- `piano.basic-inputs` — pointer, independent multi-touch, mapped computer keyboard/repeat suppression/blur, MIDI note/velocity/sustain, disconnect, and denied permission.
- `piano.basic-sustain-polyphony` — sustain transitions, concurrent voices, deterministic stealing, cleanup, and useful velocity response.
- `piano.basic-status-cleanup` — blur/disconnect/unmount cleanup stops every owned voice and ready/loading/error/fallback status is truthful without activating a visible panel button.

## Phase 2 additional feature IDs

- `piano.instrument-library` — at least three bundled recorded sample sets (grand, upright, electric/electromechanical) are selectable, audibly distinct, offline-capable, redistributable, and truthfully sourced by file/root/velocity layer.
- `piano.layers` — two layer enable/focus/selection/level/octave paths with correct voice ownership and cleanup.
- `piano.velocity-controls` — velocity/touch, timbre, dynamic compression, unison, release, resonance, master volume, and Panic claims measurably alter rendered audio/state.
- `piano.pedals` — sustain plus supported soft/sostenuto behavior or explicitly tested truthful approximation.
- `piano.fallback` — asset failure enters a labeled playable fallback without reporting the primary library ready.
- `effects.graph` — one AudioContext, per-layer buses, ordered effects, master gain/limiter, one destination, automation, and cleanup.
- `effects.routing` — focus/targeting, Piano group/layer behavior, global units, on/bypass, all-bypass, dry/wet, documented order, Delay feedback path, and To Rotary.
- `effects.processing` — Mod 1, Mod 2, Delay, Amp/EQ or filter, Compressor, Reverb, and Rotary measurably change real/offline rendered audio.
- `regression.phase1` — all Phase 1 visual, interaction, input, basic Piano, and cleanup tests remain present and green.

## Phase 3 additional feature IDs

### Programs and performance

- `programs.roundtrip` — save/load restores all supported Piano, Organ, Synth, effects, routing, splits, scenes, morphs, presets, focus, and display state.
- `programs.store-live` — Store/Store As, naming, categories, Program buttons/banks/pages, presets, and eight Live slots.
- `programs.undo-cancel` — dirty state, cancel, undo, and previous-state restoration.
- `programs.navigation` — numeric/alphabetic/category browsing, contextual displays/editing, and preset navigation.
- `layers.routing` — enable/focus/level/octave/source bus/effect target/master routing for every supported layer.
- `splits.zones` — editable Low/Mid/High documented positions, up to four zones, membership, note routing, and Off/±6/±12 crossfade gains.
- `morph.assignments` — Wheel/Aftertouch/Control Pedal assignment, input path, start/end, interpolation, limits, indicators, copy, and clear.
- `scenes.switching` — Scene I/II changes layer enable state without duplicating sound parameters.

### Organ

- `organ.engine` — two-layer note lifecycle, levels, focus, zones, inherited effects, Programs, and cleanup.
- `organ.models-drawbars` — B3/B3 Bass/Vox/Farf/Pipe 1/Pipe 2 distinctions, drawbars/registers/LEDs, percussion, key click, vibrato/chorus, presets/live, and sync.
- `organ.rotary` — routing, slow/fast/stop, acceleration, drive, close mic, bypass, and morph speed.

### Synth

- `synth.sources` — three layers, Samples/Analog/Extern state, and distinct Pure/Sync/Multi/Super/Misc/Wave/FM behavior.
- `synth.filter-envelopes` — required filters/tracking/resonance/drive plus oscillator/filter/amplifier envelope time behavior.
- `synth.voice-modes` — poly/mono/legato/priority/glide/unison/vibrato/LFO and note lifecycle.
- `synth.arp-gate` — deterministic rate/clock sync/range/inversion/pattern/hold/keyboard sync/run/gate behavior.

### Complete integration

- `system.integration` — all engines use inherited Programs, presets, scenes, splits/crossfades, morphs, focus, clocks, effects, one AudioContext, one master path, and Panic.
- `hardware.bindings` — every required Phase 3 control has meaningful canonical behavior and audible effect where appropriate; no generic required-control fallback.
- `regression.phase2` — all Phase 1/2 visual, input, Piano-library, effect, routing, failure, and cleanup tests remain green.

## Audio test requirements

Use deterministic signals/events and tolerant relationships instead of exact cross-browser waveforms. Tests must prove claimed distinctions with appropriate level, duration, time-domain, or spectral measures. At minimum:

- a non-silent output is distinguishable from silence;
- velocity/volume changes move output in the expected direction;
- sustain/release changes duration/order;
- Piano choices and Organ/Synth models required to be distinct do not render identically;
- effect on/bypass/wet-dry and primary parameters change the rendered signal;
- no engine bypasses the shared master path;
- voice/node/timer/listener counts return to a stable state after cleanup.

## Canonical browser evidence

Candidate screenshots are not sufficient. The parent runs:

```sh
pnpm stagebench capture --id <run-id> --phase <1|2|3> --url <sealed-build-url>
```

This produces:

- `evidence/stageN-desktop.png` at exactly 1440x900, device scale 1;
- `evidence/stageN-narrow.png` at exactly 390x844, device scale 1;
- `evidence/stageN-capture.json` with URL, time, browser profile, console messages/errors, and file metadata;
- candidate-authored `evidence/stageN-visual-audit.md` describing measurements, exercised flows, corrections, console status, and known deviations.

Capture uses light color mode, UTC, `en-US`, reduced motion, loaded fonts, disabled animations/transitions, and a fixed viewport screenshot. The verifier decodes the PNG header and rejects missing/wrong dimensions.

Phase 1 requires two implementation comparison-and-repair passes before the canonical capture. Later phases compare canonical evidence with the preceding phase for visual regressions. Phase 2’s audit records Piano/effect flows. Phase 3’s audit records Programs/performance/Organ/Synth integration and the required-control binding audit.

## Implementation and audio provenance

Every phase validates `IMPLEMENTATION_DETAILS.json` against `schemas/implementation-details.schema.json`. Declare the actual audio strategy, generated sources, and every recorded/remote sample’s name, source, license, and relevant files. Never describe generated buffers as recorded samples. Phase 1 now has real basic Piano audio and may not use the old `None (visual-only)` strategy.

## Sealing

Verification runs all four package checks, validates the phase contract/feature matrix/manifest/evidence, and hashes the retained phase tree. The artifact digest is stored in `runs/<id>/verifications/stageN.json`. Phase completion and blinded evaluation require that passing sealed record; modifying the artifact requires a new verification attempt.
