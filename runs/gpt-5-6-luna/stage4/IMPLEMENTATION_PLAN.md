# Phase 4 Implementation Plan — Organ and Synth

## Scope and source of truth

- Phase prompt: `/Users/wustep/Documents/Projects/stagebench/prompts/stage4.md`
- Required contract: `/Users/wustep/Documents/Projects/stagebench/BENCHMARK.md`, `/Users/wustep/Documents/Projects/stagebench/TESTING.md`
- Phase manifest: `/Users/wustep/Documents/Projects/stagebench/specs/benchmark-phases.json`
- Assigned specs: `/Users/wustep/Documents/Projects/stagebench/specs/nord-stage-4.visual.json`, `/Users/wustep/Documents/Projects/stagebench/specs/nord-stage-4.piano.json`, `/Users/wustep/Documents/Projects/stagebench/specs/nord-stage-4.programs.json`, `/Users/wustep/Documents/Projects/stagebench/specs/nord-stage-4.effects.json`, `/Users/wustep/Documents/Projects/stagebench/specs/nord-stage-4.organ.json`, `/Users/wustep/Documents/Projects/stagebench/specs/nord-stage-4.synth.json`, `/Users/wustep/Documents/Projects/stagebench/specs/nord-stage-4.variants.json`
- Selected variant: `stage-4-88` — 88 keys, A–C, hammer action; reference `/Users/wustep/Documents/Projects/stagebench/reference/nord-stage-4.jpg`
- Behavioral source: `/Users/wustep/Documents/Projects/stagebench/reference/manual.pdf`, printed Organ pages 18–22 and Synth pages 27–36, plus inherited Phase 3 pages 37–52

## Honest inherited Phase 3 review

- Green baseline before Phase 4 work: `pnpm test` 5 files / 14 tests, `pnpm typecheck`, `pnpm lint`, and `pnpm build` all passed; `dist/index.html` existed.
- Preserved strengths: exact 88-key model and shared visual surface, recorded VSO2 piano roots with truthful fallback, canonical Program serialization, split/zones/crossfade state, morph assignments, scenes, and one shared Piano/effects graph with limiter.
- Phase 3 gaps carried into this phase: `src/App.tsx` did not render or own canonical Organ/Synth state; `src/audio.ts` only exposed A/B Piano buses; Organ/Synth controls changed generic local values/display text; no Organ/Synth engine modules or Phase 4 feature IDs/tests existed; Phase 4 evidence and notes were absent.
- Phase 4 repair target: add explicit Organ A/B and Synth A/B/C state and engines, route all layers into inherited buses/master path, and bind every required control to state plus audio where sonically meaningful.

## Phase 4 hard gates — checked task list

- [ ] Organ and Synth have distinct, audible engines rather than shared placeholder oscillators.
- [ ] Organ models, drawbars/registers, percussion, vibrato, and rotary controls alter audible output.
- [ ] Synth source, oscillator control, filter, envelopes, LFO, voice mode, and arpeggiator/gate alter audible output.
- [ ] Organ and Synth layers route through the Phase 3 buses and effects without creating separate destination AudioContexts.
- [ ] All required Phase 4 hardware bindings are meaningful and no generic unbound-control fallback remains.
- [ ] All inherited tests/features and evidence remain present and green.
- [ ] `IMPLEMENTATION_DETAILS.json` distinguishes recorded piano files, generated organ/synth synthesis, and generated effect buffers truthfully.
- [ ] `evidence/stage4-desktop.png`, `evidence/stage4-narrow.png`, and `evidence/stage4-visual-audit.md` are current and include browser/audio/control evidence.

## Architecture and requirement map

| Requirement | Engine/state | Rendered hardware | Program/routing integration | Real-boundary test |
| --- | --- | --- | --- | --- |
| Organ A/B, six models | `src/organEngine.ts`, `OrganState` | model buttons, layer buttons, level faders, display, model LEDs | two Organ layers share Organ-focused inherited effect chain and zones | `organ.engine`, `organ.models` |
| Drawbars/registers, LEDs, presets/live/sync | `OrganState` drawbars + register semantics | nine faders and LED ladder, preset/live/sync buttons | serializes in Program extension; Wheel morph updates values/LEDs | `organ.drawbars`, `hardware.bindings` |
| Percussion, click, vibrato/chorus | Organ voice synthesis partials/transients/modulation | percussion, click, vibrato controls | shared organ layer bus | `organ.drawbars` |
| Rotary speed/stop/acceleration/drive/close-mic | shared rotary node parameters plus Organ voice metadata | rotary buttons/knobs and morph indicator | uses inherited final rotary path; no new destination context | `organ.rotary`, `system.integration` |
| Synth A/B/C and sources | `src/synthEngine.ts`, `SynthState` | layer buttons, source/category/wave/Osc Ctrl controls | independent synth layer buses/effect targeting and zones | `synth.sources` |
| Synth filter/envelopes/LFO/voice | oscillator graph + deterministic offline renderer | filter, envelope, LFO, voice controls | morph destinations update canonical state and graph params | `synth.filter-envelopes`, `synth.voice-modes` |
| Arp/Gate | deterministic scheduler/renderer and state | mode, rate, pattern, range, inversion, hold, run, sync controls | master clock and KB sync use Program routing clock | `synth.arp-gate` |
| Programs/scenes/splits/morphs/presets | `programState.ts` Phase 4 extension | program display, scene/preset controls, zone chips | round-trip Organ/Synth state and shared effect rack | `system.integration`, inherited Program tests |
| One shared graph and cleanup | `SharedAudioGraph` plus layer inputs | graph status in displays/footer | all six source layers feed inherited master/limiter/destination | `effects.graph`, `system.integration` |

## Mandatory milestone order

1. Extend canonical Program state and add deterministic Organ/Synth engine boundaries with failing tests.
2. Extend the shared graph to six layer inputs while retaining one context, master limiter, effect ordering, and cleanup.
3. Implement Organ models/drawbars/voice features, then Synth sources/filter/modulation/voice/arp features.
4. Replace required generic hardware controls with explicit bindings and display/state feedback; integrate scenes, zones, splits, morphs, presets, and effects.
5. Run inherited and Phase 4 red-green-refactor tests, browser/audio boundary smoke, visual repair loop, evidence, implementation details, notes, and all pnpm gates.

## Test and evidence plan

- Preserve every inherited `tests/feature-matrix.json` ID and add exactly the Phase 4 IDs from `TESTING.md`.
- Use deterministic real engine boundaries: `OfflineAudioContext`/injectable graph fakes for rendered frames, one shared context assertion, voice cleanup, spectral/time-domain comparisons, and rapid layered play.
- Browser pass at 1440×900 and 390×844: exercise Organ models/drawbars/percussion/rotary, Synth source/filter/arp, layered/split play, morphs, scenes, presets, effects, panic, and inspect console.
- Compare the current screenshots with inherited Phase 3 evidence and the selected Stage 4 88 reference; record bounds, section ratios, 88-key count, two-OLED rule, bindings, audio graph, console state, and three remaining visual deviations.

## Provenance and limitations policy

- Keep inherited `public/audio/piano/A1.mp3`–`A7.mp3` identified as CC BY 3.0 VSO2 recorded piano files from Tone.js Instruments.
- Describe Organ and Synth as live/generated synthesis; no new recorded samples are introduced. Generated reverb/noise buffers remain effect buffers, never sample recordings.
- Document browser MIDI/audio permission limits, any optional controls intentionally unsupported, offline-test boundaries, and performance observations separately from benchmark infrastructure limitations.
