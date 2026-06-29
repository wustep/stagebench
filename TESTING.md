# Benchmark testing contract

Tests are part of the implementation, not a final cleanup task. Every benchmark phase must use a red-green-refactor loop: add or update a failing test for the behavior being implemented, implement the smallest coherent behavior, and keep the entire inherited suite green before moving to the next feature.

## Required project scripts

All installation and script execution must use pnpm. Every phase must contain `pnpm-lock.yaml` and a `packageManager: "pnpm@..."` declaration. `package-lock.json` and `yarn.lock` are prohibited. The verifier enforces this before running checks.

Every phase artifact must expose these package scripts:

- `test` — deterministic unit and component tests that run once and exit;
- `typecheck` — TypeScript validation without emitting;
- `lint` — static analysis;
- `build` — production build.

Run them as `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

The test suite must run without network access, microphone access, MIDI hardware, or a real audio output device. Wrap browser and audio APIs behind injectable boundaries so they can be tested with fakes.

## Implementation and audio provenance manifest

Every phase must keep an `IMPLEMENTATION_DETAILS.json` file at its artifact root. Package dependencies are inventoried automatically, but the implementation agent must explicitly describe how sound is produced and where every recorded or remote sample came from:

```json
{
  "version": 1,
  "phase": 2,
  "audio": {
    "strategy": "Generated AudioBuffer samples",
    "generatedSources": [
      {
        "name": "Piano root buffers",
        "method": "Generated at startup with additive synthesis"
      }
    ],
    "sampleSources": [],
    "notes": ["No recorded or external audio samples are used."]
  }
}
```

For recorded, downloaded, or remote samples, each `sampleSources` entry must include non-empty `name`, `source`, and `license` fields, plus `files` and `notes` when useful. A visual-only phase must use an explicit strategy such as `None (visual-only phase)`. Update the manifest when a later phase changes the audio graph or adds sound assets. The phase verifier rejects missing or malformed manifests, and the evaluator publishes the combined inventory in both JSON and the readable report.

## Feature matrix

Each phase owns `tests/feature-matrix.json` (the `stage` field is retained as a compatibility identifier):

```json
{
  "version": 1,
  "stage": 1,
  "features": [
    {
      "id": "visual.key-count",
      "tests": ["src/components/Keyboard.test.tsx"],
      "notes": "Verifies the 43 white and 30 black key model."
    }
  ]
}
```

Every required feature ID must appear exactly once and point to at least one existing non-empty test file. When a later phase changes inherited behavior, update its inherited test before or alongside the implementation; never delete a regression test merely to make the suite pass.

## Phase 1 required coverage

- `visual.key-count` — 73-key data model, 43 white and 30 black keys, correct black-key pattern;
- `visual.section-layout` — six ordered hardware sections and normalized section values;
- `visual.control-inventory` — representative control counts, stable identifiers, and section-specific landmark assertions; explicitly assert that only Program and Synth own primary OLED displays and that Organ, Piano, and Effects do not;
- `interaction.keys` — pointer and keyboard key pressed/released state;
- `interaction.buttons-leds` — buttons toggle the intended LED and display state;
- `interaction.knobs` — pointer and keyboard changes are clamped and reflected visually;
- `accessibility.controls` — controls have names, roles, focus behavior, and usable keyboard input;
- `regression.chassis` — continuous chassis structure and no accidental extra marketing region above the instrument.

## Phase 2 additional coverage

- `piano.note-lifecycle` — note-on, note-off, repeated notes, and all-notes-off;
- `piano.sustain` — held, sustained, released, and pedal-up transitions;
- `piano.polyphony` — concurrent voices, deterministic voice stealing, and cleanup;
- `piano.velocity` — meaningful velocity-to-gain response with boundary cases;
- `piano.keyboard-map` — mapped computer keys, repeat suppression, blur cleanup;
- `piano.midi` — note, velocity, sustain CC, disconnected, and permission-denied paths;
- `piano.volume-reverb` — parameter changes reach the audio graph and remain clamped;
- `piano.fallback` — offline/network failure still yields a playable engine;
- `regression.stage1` — the inherited Phase 1 suite remains present and green.

## Phase 3 additional coverage

- `programs.roundtrip` — Program save/load restores canonical supported state, including layers, Piano, effects, routing, splits, scenes, and morphs;
- `programs.store-live` — Store, Store As, naming, categories, Program buttons, banks/pages, and eight Live slots;
- `programs.undo-cancel` — dirty state, cancel, undo, and previous-state restoration;
- `programs.navigation` — Program display modes, numeric/alphabetic/category lists, preset browsing, and contextual editing;
- `layers.routing` — enable, focus, levels, source bus, effect assignment, and master-bus routing;
- `splits.zones` — editable Low/Mid/High points, documented positions, zone membership, note routing, and crossfade gains;
- `morph.assignments` — Wheel/Aftertouch/Control Pedal assignment, interpolation, indicators, limits, copying, and removal;
- `scenes.switching` — Layer Scene I/II changes enable states without duplicating sound parameters;
- `effects.graph` — one AudioContext, per-layer chains, ordered shared master path, limiter, and cleanup;
- `effects.routing` — focus, group/global, bypass, dry/wet, ordering, targeting, and To Rotary;
- `effects.processing` — representative Mod 1, Mod 2, Delay, Amp/EQ or filter, Compressor, Reverb, and Rotary controls measurably alter rendered audio;
- `regression.stage2` — all inherited visual and Piano tests remain present and green.

## Phase 4 additional coverage

- `organ.engine` — two-layer note lifecycle, levels, focus, zones, effects, and cleanup;
- `organ.models` — B3, B3 Bass, Vox, Farf, Pipe 1, and Pipe 2 produce distinct behavior;
- `organ.drawbars` — drawbars/registers, LEDs, presets/live state, sync, percussion, key click, and vibrato/chorus;
- `organ.rotary` — routing, slow/fast/stop, acceleration, drive, close mic, and morph speed;
- `synth.sources` — Samples/Analog/Extern state and distinct Pure, Sync, Multi, Super, Misc, Wave, and FM behavior;
- `synth.filter-envelopes` — filter types/tracking/drive plus oscillator, filter, and amplifier envelope behavior;
- `synth.voice-modes` — poly/mono/legato/priority, glide, unison, vibrato, LFO destinations, and note lifecycle;
- `synth.arp-gate` — deterministic rate, clock sync, range, inversion, pattern, hold, run, and gate behavior;
- `system.integration` — Organ and Synth use inherited Programs, scenes, splits, morphs, presets, effects, and one master graph;
- `hardware.bindings` — every required Phase 4 control has a meaningful canonical binding with no generic no-op fallback;
- `regression.stage3` — all inherited Program, routing, effect, Piano, interaction, and visual tests remain green.

## Browser evidence

Automated tests do not replace rendered verification. Every phase must also save:

- `evidence/stageN-desktop.png` at 1440×900;
- `evidence/stageN-narrow.png` at 390×844;
- `evidence/stageN-visual-audit.md` with measured bounds, section ratios, key counts, console state, and the three most visible remaining deviations.

Phase 1 requires at least two screenshot-and-correction passes. Later phases must compare their screenshot with the previous phase to catch visual regressions.

Phase 3 evidence must also record the exercised Program/effect flows and confirm one audible graph. Phase 4 evidence must record representative Organ/Synth engine exercises and the required-control binding audit.
