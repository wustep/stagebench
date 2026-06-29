# Phase 2 Implementation Plan — Piano instrument

## Scope and source of truth

- Phase prompt: `prompts/stage2.md`
- Assigned specs: `specs/nord-stage-4.visual.json` and `specs/nord-stage-4.piano.json`
- Selected variant: `stage-4-88` from `specs/nord-stage-4.variants.json`
- Reference image: `reference/nord-stage-4.jpg`
- Manual behavior: `reference/manual.pdf`, printed pages 23–26
- Inherited visual contract: preserve the Stage 4 88 silhouette, 54/46 deck-to-keybed allocation, six section ratios, two-OLED rule, and existing interaction tests.

## Phase 2 hard gates

- [ ] The primary piano path is not a placeholder oscillator or generated additive buffer bank presented as recorded samples.
- [ ] Pointer, touch, computer keyboard, and MIDI share one deterministic note lifecycle.
- [ ] Volume, reverb, velocity, release, sustain, and selected Piano controls alter audible output.
- [ ] Fallback mode remains playable and is labeled accurately.

## Required red-green-refactor order

1. Define injectable audio, MIDI, timing, and asset boundaries.
2. Implement note ownership, repeated notes, release, all-notes-off, voice limits, and deterministic stealing.
3. Implement velocity response, sustain transitions, half-pedal approximation, and cleanup.
4. Connect pointer, multitouch, computer keyboard, blur cleanup, and MIDI to the same lifecycle.
5. Connect master volume and reverb to the audible graph.
6. Connect the Piano spec controls, canonical state, displays, and truthful fallback state.
7. Run browser/audio evidence loops and repair visual drift against Phase 1 evidence.

## Architecture and ownership map

| Requirement | Owning module | Rendered control/state | Audible path | Tests |
| --- | --- | --- | --- | --- |
| Injectable audio boundary | `src/audio.ts` | `Piano status` / fallback badge | `PianoAudioEngine` context/loader | `src/audio.test.ts` |
| Note lifecycle, repeat, release, panic | `src/pianoEngine.ts` | pressed key classes and voice count | per-voice buffer source → envelope → piano bus | `src/pianoEngine.test.ts` |
| Velocity and touch curves | `src/pianoEngine.ts`, `src/pianoState.ts` | KB TOUCH buttons | velocity gain and attack/timbre mapping | `src/pianoEngine.test.ts` |
| Sustain, half pedal, sostenuto, soft pedal | `src/pianoEngine.ts`, `src/midi.ts` | SUSTPED / pedal controls | deferred release and pedal gain/tone | `src/pianoEngine.test.ts`, `src/midi.test.ts` |
| Pointer/touch/computer keyboard | `src/App.tsx`, `src/components/Keyboard.tsx` | 88 physical keys | shared `noteOn`/`noteOff` dispatcher | `src/App.test.tsx` |
| MIDI note/CC/error states | `src/midi.ts`, `src/App.tsx` | MIDI status | shared lifecycle + sustain CC | `src/midi.test.ts` |
| Master volume | `src/App.tsx`, `src/audio.ts` | Master level knob | master gain before destination | `src/audio.test.ts` |
| Reverb | `src/App.tsx`, `src/audio.ts` | Reverb mix control | dry/wet convolution-style impulse branch | `src/audio.test.ts` |
| Piano layers A/B and focus | `src/pianoState.ts`, `src/components/HardwarePanel.tsx` | A/B faders, layer buttons, FX focus | independent layer buses into shared piano bus | `src/pianoState.test.ts` |
| Type/model/list/failure | `src/pianoState.ts`, `HardwarePanel` | type/model buttons and display | selected recorded bank or labeled missing-model fallback | `src/pianoState.test.ts`, `src/App.test.tsx` |
| Dynamic compression, timbre, unison | `src/pianoState.ts`, `src/audio.ts` | Piano detail controls | compressor, EQ/filter, detune voices | `src/audio.test.ts`, `src/pianoState.test.ts` |
| Soft release/string resonance | `src/pianoState.ts`, `src/pianoEngine.ts` | Acoustics toggles | release envelope and sympathetic resonance taps | `src/audio.test.ts` |
| Visual/regression contract | inherited `src/hardware.ts`, CSS | existing surface | none | `src/hardware.test.ts`, `src/App.test.tsx` |

## Sample/source plan

- Primary playback uses bundled recorded VSO2 piano excerpts distributed by Tone.js Instruments, with seven A-root notes. Normal playback makes no network request.
- The loader selects the nearest root and rate-shifts within a bounded range. The source is a single recorded velocity layer; velocity shaping is implemented through gain, compression, touch curves, and timbre rather than being described as recorded velocity layers.
- If a sample asset cannot decode/load, the engine switches to a small live-synthesis fallback and exposes `FALLBACK · SYNTH PIANO` in the UI. It will never claim that generated buffers are recorded samples.

## Verification and evidence

- Preserve the inherited Phase 1 suite and add all Phase 2 feature IDs to `tests/feature-matrix.json`.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- Exercise pointer, touch, computer keyboard, repeat suppression, sustain, panic, blur cleanup, parameter changes, and MIDI permission/error paths in browser.
- Save `evidence/stage2-desktop.png`, `evidence/stage2-narrow.png`, and `evidence/stage2-visual-audit.md`; compare to `stage1-desktop.png` and `stage1-narrow.png` without changing section geometry.
- Append architecture, tests, audio provenance, browser/audio findings, and limitations to `STAGE_NOTES.md`.
