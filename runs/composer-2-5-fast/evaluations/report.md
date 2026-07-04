# Composer 2.5 Fast — Stagebench evaluation

- Run: `composer-2-5-fast`
- Status: in-progress
- Aggregate: **66/100**
- Coverage: 2/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 71 |
| 2 | Piano library and working effects | 63 |
| 3 | queued | — |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 1 basic piano via honest additive synthesis (triangle + sine overtone oscillators with AD envelope). No recorded samples in Phase 1.
- Generated sound sources: basic-piano-voice
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 uses live Web Audio synthesis only; recorded sample sets are Phase 2 scope.
- Audio note: Polyphony limit 32 with deterministic oldest-voice stealing.
- Audio note: Sustain pedal supported via note lifecycle and MIDI CC64.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `node-web-audio-api` ^2.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One AudioContext with Piano A/B layer buses, per-layer effect chains (Mod1→Mod2→Delay→Amp/EQ→Compressor→Reverb), shared Rotary via To Rotary, master gain and limiter. Grand/Upright/Electric/Clav/Digital/Misc use programmatically synthesized offline sample sets (not field recordings).
- Generated sound sources: piano-sample-sets; synth-fallback-voice; effects-impulse-responses
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Grand, Upright, and Electric are audibly distinct synthesized sample sets — honestly declared as generated, not recordings.
- Audio note: Organ, Synth, and Program controls remain presentation-only (Phase 1 honesty preserved).
- Audio note: Master Level knob scales master gain; Panic via blur/all-notes-off clears voices.
- Audio note: Sustain honors per-layer SUSTPED toggle.
- Audio note: Polyphony limit 32 with deterministic oldest-voice stealing per layer pool.

## Phase 1: Complete surface and basic piano

**71/100**

Solid Phase 1 pass with correct geometry, a complete decorative control inventory, and a dependable synthesized piano voice backed by real audio tests. The six-section layout, 54/46 deck/keybed split, 73-key E1–E7 keybed, and Program/Synth-only OLED placement match the spec. Visual fidelity is functional but schematic: controls render as generic CSS sliders/buttons rather than reference-faithful Nord hardware, and narrow viewports hide section headers below 480px. All four technical gates pass (26/26 tests); capture harness reports zero console errors at 1440×900 and 390×844.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 66 |
| Basic Piano functionality | 25% | 75 |
| Surface interaction and honesty | 15% | 75 |
| Engineering quality | 15% | 75 |

### Priority issues

- [object Object]
- [object Object]

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**63/100**

Phase 2 extends Phase 1 with a working dual-layer piano engine, per-layer effect chains, and Master Level on one AudioContext — all four gates pass (38/38 tests) with rendered-audio assertions. The decorative boundary for Organ/Synth/Program is preserved. The main gap is sample provenance: Grand/Upright/Electric are programmatically synthesized OfflineAudioContext buffers (sampleSources: 0), honestly declared but not bundled recorded sample sets as the piano spec requires. Effects processing, bypass, and layer routing are tested; global-mode and exhaustive per-type variant coverage are partial.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 75 |
| Piano library and performance | 35% | 60 |
| Effects and signal graph | 30% | 56 |
| System behavior and UX | 10% | 75 |
| Engineering quality | 15% | 68 |

### Priority issues

- [object Object]
- [object Object]

### Technical gate

Passed.
