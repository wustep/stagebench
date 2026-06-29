# Phase 3 Implementation Plan — Programs and effects

## Scope and source of truth

- Phase prompt: `prompts/stage3.md`
- Required contract: `BENCHMARK.md`, `TESTING.md`, and Phase 3 in `specs/benchmark-phases.json`
- Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.programs.json`, `specs/nord-stage-4.effects.json`
- Selected variant: `stage-4-88` from `specs/nord-stage-4.variants.json`
- Reference image: `reference/nord-stage-4.jpg`
- Behavioral source: `reference/manual.pdf`, especially printed pages 37–44 and 47–52
- Inherited artifact: verified Phase 2 Piano implementation, tests, evidence, notes, and sample provenance

## Phase 3 hard gates

- [ ] A single AudioContext feeds per-layer buses, effect chains, a master bus, and destination.
- [ ] Program save/load restores the canonical supported state rather than a display-only copy.
- [ ] Split positions, zones, crossfades, layer scenes, and morph assignments are editable and observable.
- [ ] Every required representative effect changes rendered audio and supports bypass.
- [ ] All inherited tests/features and evidence remain present and green.
- [ ] `IMPLEMENTATION_DETAILS.json` truthfully distinguishes recorded samples, generated buffers, and live synthesis.
- [ ] An effect represented only by metadata or disconnected nodes does not count as implemented.

## Mandatory milestone order

1. Canonical Program state and rendered Program workflows.
2. Editable layers, split points/zones/crossfades, scenes, and morph assignments.
3. One shared audio graph with reusable layer buses, ordered chains, master limiter, and cleanup.
4. Connected representative effects with click-safe automation and bypass.
5. Red-green-refactor tests, browser interaction/audio boundary checks, visual repair, evidence, and all pnpm gates.

## Architecture and ownership map

| Requirement | Canonical owner | Rendered hardware / observation | Audible path | Tests |
| --- | --- | --- | --- | --- |
| Program serialization | `src/programState.ts` | Program OLED, Store/Store As, category/list controls, dirty marker | Loaded state drives Piano, routing, splits, scenes, effects | `src/programState.test.ts`, `src/App.test.tsx` |
| Program navigation/storage | `src/App.tsx` + `programState.ts` | Program dial, page/bank, eight Live slots, list modes, naming/category, cancel/undo | Recalling a program updates active graph parameters | `src/programState.test.ts`, `src/App.test.tsx` |
| Layers and focus | canonical layer state + reducer | Piano A/B buttons/faders, FX focus, layer LEDs | Source enters the selected layer bus; focus/group changes targeting | `src/programState.test.ts`, `src/audio.test.ts` |
| Splits/zones/crossfades | `programState.ts` | Split SET screen, Low/Mid/High selectors, zone chips, xFade controls | Note router selects layer zones and applies semitone crossfade gains | `src/programState.test.ts`, `src/audio.test.ts` |
| Layer Scenes I/II | `programState.ts` | Scene I/II buttons and OLED status | Scene changes enabled layers without duplicating sound settings | `src/programState.test.ts`, `src/App.test.tsx` |
| Morphs | `programState.ts` | Wheel/A.T./CtrlPed assign/clear, range indicators, destination controls | Source input interpolates assigned destination parameters | `src/programState.test.ts`, `src/audio.test.ts` |
| Shared graph | `src/audio.ts` | Graph/status readout in Effects UI | one context → A/B buses → ordered chains → master limiter → destination | `src/audio.test.ts` |
| Mod 1 / Mod 2 | `src/effects.ts` | Unit type, On, Amount/Rate, focus | gain/pan/tremolo/ring-mod and chorus/phaser-style processing | `src/effects.test.ts` |
| Delay | `src/effects.ts` | Tempo, feedback, dry/wet, ping-pong, filter, bypass | feedback delay processes wet repeats only | `src/effects.test.ts` |
| Amp/EQ/filter | `src/effects.ts` | Model, drive, bass/mid/treble, filter frequency/resonance | waveshaper/EQ/filter nodes in required order | `src/effects.test.ts` |
| Compressor | `src/effects.ts` | Amount/Fast/Global/On | DynamicsCompressorNode on chain or global path | `src/effects.test.ts` |
| Reverb | `src/effects.ts` | Type, dry/wet, bright/dark, global, bypass | generated IR ConvolverNode before Rotary | `src/effects.test.ts` |
| Rotary / To Rotary | `src/effects.ts` | Slow/Fast/Stop, drive, mic, speed, target | final routed effect; To Rotary controls routing | `src/effects.test.ts`, `src/audio.test.ts` |
| Piano regression | inherited Piano modules | Existing Piano controls and 88-key surface | recorded roots + truthful fallback through shared graph | inherited `src/App.test.tsx`, `src/hardware.test.ts` |

## Test and verification matrix

- Maintain every inherited feature ID and add all Phase 3 IDs from `TESTING.md` exactly once in `tests/feature-matrix.json`.
- Add deterministic fake-context tests for canonical round-trips, bus topology, ordering, bypass, parameter automation, cleanup, clipping protection, and representative effect processing.
- Add rendered component tests for Store/Store As, dirty/cancel/undo, display/list modes, Live slots, split/zone/crossfade editing, scene switching, morph assignment/clear/copy, and effect controls.
- Exercise real browser boundaries after unit tests: pointer/touch/computer-key Piano play, Program storage/edit flows, morph input, effect bypass/focus/global changes, rapid toggling, and browser console.

## Visual and evidence loop

- Preserve the inherited `stage-4-88` continuous chassis, 88-key A–C hammer-action model, six section ratios, and two-OLED rule from `specs/nord-stage-4.visual.json`.
- Compare new desktop and narrow renders with `evidence/stage2-desktop.png` and `evidence/stage2-narrow.png`; repair the three most visible layout/control-density regressions.
- Save `evidence/stage3-desktop.png` at 1440×900, `evidence/stage3-narrow.png` at 390×844, and `evidence/stage3-visual-audit.md` with bounds, ratios, key counts, exercised Program/effect flows, audible graph confirmation, console state, and remaining deviations.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; verify `dist/index.html` and the phase verifier before reporting.

## Provenance and limitations policy

- Keep the inherited bundled VSO2/Tone.js Instruments recordings identified as one recorded velocity layer with seven roots; do not describe generated fallback oscillators or generated reverb IR as recorded samples.
- Record the one-context graph, generated impulse response, live-synthesis fallback, browser permission limitations, and any unimplemented Phase 4 Organ/Synth audio honestly in `IMPLEMENTATION_DETAILS.json` and `STAGE_NOTES.md`.
