# Phase 2 - Piano Instrument

Work only inside the assigned `stage2` directory. It is a clean copy of the verified Phase 1 artifact. Read:

1. `BENCHMARK.md` and `TESTING.md`
2. `specs/benchmark-phases.json` Phase 2
3. `specs/nord-stage-4.visual.json`
4. `specs/nord-stage-4.piano.json`
5. Manual pages 23-26
6. inherited `IMPLEMENTATION_PLAN.md`, `STAGE_NOTES.md`, tests, and source

Continue using pnpm exclusively and preserve `packageManager`, `pnpm-lock.yaml`, and Vite `base: './'`.

Before implementation, update `IMPLEMENTATION_PLAN.md` to cite both assigned spec filenames and copy the Phase 2 `Hard gates` into a checked task list. Map every Piano requirement to its owning module, rendered control, audio-path effect, and test.

## Non-negotiable outcome

Turn the inherited surface into a credible, low-latency browser Piano without visually redesigning it. Pointer, touch, mapped computer keyboard, and Web MIDI must feed one deterministic note lifecycle. Piano controls must change canonical state, display feedback, and audible behavior where the manual describes sonic behavior.

## Sound-source rule

The primary piano path must use bundled, redistributable recorded samples or comparably convincing physical/modelled synthesis. A handful of short additive waveforms rendered into AudioBuffers is a placeholder and must not be described as a sampled piano.

If using recorded samples:

- bundle them so normal playback has no network dependency;
- record source, license, files, root notes, and velocity layers in `IMPLEMENTATION_DETAILS.json`;
- use enough roots and velocity variation to avoid obvious uniform pitch-shifting.

A synthesized fallback is permitted only after the primary path fails. It must remain playable and the UI must label fallback mode accurately; a silent engine may not report ready.

## Required implementation order

1. Define injectable audio, MIDI, timing, and asset boundaries.
2. Implement note ownership, repeated notes, release, all-notes-off, voice limits, and deterministic stealing.
3. Implement velocity response, sustain transitions, half-pedal approximation where supported, and cleanup.
4. Connect pointer, multitouch, computer keyboard, blur cleanup, and MIDI to that lifecycle.
5. Connect master volume and reverb to the audible graph.
6. Implement the Phase 2 Piano spec: two layers, type/model, touch curves, dynamic compression, timbre, unison, release/resonance state, pedal behavior, display/status, and relevant panel controls.

Do not implement Organ or Synth sound engines yet.

## Tests must cross the real audio boundary

Keep fake-backed lifecycle tests, but also directly test the Web Audio backend or an `OfflineAudioContext`-compatible renderer. Tests must prove that:

- velocity changes rendered level or timbre;
- sustain changes note duration and release ordering;
- volume and reverb alter rendered output;
- supported Piano controls claiming sonic behavior measurably change output;
- voices and nodes are cleaned up;
- fallback is playable and truthfully reported.

Maintain all inherited Phase 1 mappings plus every Phase 2 feature ID in `tests/feature-matrix.json`.

## Browser and visual repair

Exercise pointer and computer-keyboard playing, rapid repeated notes, sustain, Panic, focus loss, parameter changes, and MIDI states when available. Check the console after interaction.

Compare Phase 2 with the product reference and Phase 1 evidence. Functional wiring must not alter section widths, chassis continuity, key geometry, display inventory, or control density. Save:

- `evidence/stage2-desktop.png`
- `evidence/stage2-narrow.png`
- `evidence/stage2-visual-audit.md`

Update `IMPLEMENTATION_DETAILS.json` precisely. Append architecture, tests, source provenance, audio limitations, and browser findings to `STAGE_NOTES.md`. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` before reporting completion.
