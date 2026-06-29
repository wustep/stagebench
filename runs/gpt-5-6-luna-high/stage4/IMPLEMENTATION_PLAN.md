# Phase 4 implementation plan — Organ and Synth

Assigned specifications (active variant-aware manifest):

- `specs/benchmark-phases.json`
- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.variants.json` (selected `stage-4-73`)
- `specs/nord-stage-4.piano.json` (inherited)
- `specs/nord-stage-4.programs.json` (inherited canonical state)
- `specs/nord-stage-4.effects.json` (inherited shared graph)
- `specs/nord-stage-4.organ.json`
- `specs/nord-stage-4.synth.json`

Manual references: `reference/manual.pdf`, pages 18–22 (Organ) and 27–36 (Synth).

## Phase 4 hard gates (verbatim)

- [x] Organ and Synth have distinct, audible engines rather than shared placeholder oscillators.
- [x] Organ models, drawbars/registers, percussion, vibrato, and rotary controls alter audible output.
- [x] Synth source, oscillator control, filter, envelopes, LFO, voice mode, and arpeggiator/gate alter audible output.
- [x] Organ and Synth layers route through the Phase 3 buses and effects without creating separate destination AudioContexts.
- [x] All required Phase 4 hardware bindings are meaningful and no generic unbound-control fallback remains.

## Implementation map and boundary tests

| Requirement | Engine/state | Rendered hardware and canonical state | Inherited route | Real-boundary test |
| --- | --- | --- | --- | --- |
| Two Organ layers, six models, levels/focus/zones/octave | `src/organEngine.ts` `OrganControls.layerA/B` | ORGAN drawbars/model/rotary; `ProgramState.organ`, `layers.organA/B` | `organ-A/B` buses → shared effects/master | `tests/phase4.test.ts` Organ engine/model test |
| B3 drawbars/registers, preset/live sync, percussion, click | `renderOrganNote`, `setDrawbar`, `syncPreset` | nine sliders + LEDs and canonical `organ.layerA/B` | shared Organ chain | `tests/phase4.test.ts` drawbar/percussion test |
| Vibrato/chorus and rotary speed/drive/close-mic | Organ layer modulation and rotary render | vibrato/rotary/drive controls | rotary unit can be To Rotary | `tests/phase4.test.ts` Organ modulation test |
| Three Synth layers and Samples/Analog/Extern sources | `src/synthEngine.ts` `SynthControls.layerA/B/C` | SYNTH source/shape/level controls; `ProgramState.synth`, `layers.synthA/B/C` | `synth-A/B/C` buses → independent shared chains | `tests/phase4.test.ts` source spectra |
| Pure/Sync/Multi/Super/Misc/Wave/FM + Osc Ctrl | `renderSynthNote` category wave/fm operators | Osc controls and Synth display | per-layer graph processing | source/Osc Ctrl test |
| Filters, tracking, drive and three envelopes | `filterSample`, `envelope` | filter, env, drive controls | per-layer buses/effects | filter/envelope test |
| LFO, mono/legato/priority, glide, unison, vibrato | Synth voice state and render modulation | Synth voice controls | synth bus and focus | voice-mode test |
| Arpeggiator/gate rate/range/inversion/pattern/hold/clock | `arpPattern`, deterministic clock fields | Arp/Gate buttons and canonical `synth.layerA` | master clock from Program routing | arp/gate test |
| Programs, scenes, morphs, presets, panic and one context | `ProgramStore`, `EffectsGraph`, App shared context | Program controls and keyboard | one Piano-created context + graph | Program roundtrip/shared graph test |

## Verification checklist

- [x] Every assigned Phase 4 spec is cited above.
- [x] Organ and Synth renderers and Web Audio voices share the Piano-created `AudioContext` and `EffectsGraph`.
- [x] Phase 1–3 tests remain green; Phase 4 feature IDs are listed in `tests/feature-matrix.json`.
- [ ] Browser desktop/narrow/audit evidence recaptured after final build.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` before handoff.
