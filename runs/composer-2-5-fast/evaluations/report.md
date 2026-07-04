# Composer 2.5 Fast — Stagebench evaluation

- Run: `composer-2-5-fast`
- Status: complete
- Aggregate: **69/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 71 |
| 2 | Piano library and working effects | 63 |
| 3 | Complete Stage 4 system | 72 |

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

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `node-web-audio-api` ^2.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One AudioContext with Piano A/B layer buses, shared Organ bus + effect chain, Synth A/B/C independent effect chains, inherited Mod1→Mod2→Delay→Amp/EQ→Compressor→Reverb order, shared Rotary, master gain and limiter. Piano Grand/Upright/Electric use programmatically synthesized offline sample sets. Organ uses live additive synthesis (tonewheel/transistor/pipe models). Synth uses live Web Audio oscillators with filters, envelopes, LFO, and deterministic arpeggiator.
- Generated sound sources: piano-sample-sets; organ-additive-engines; synth-oscillator-engines; effects-impulse-responses
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Grand, Upright, and Electric are audibly distinct synthesized sample sets — honestly declared as generated, not recordings.
- Audio note: Organ and Synth are live synthesis engines, not sample playback.
- Audio note: Programs serialize all supported state except Master Level; 32 slots + 8 Live auto-store slots.
- Audio note: Spec-excluded controls listed in unsupported-controls.ts remain presentation-only.
- Audio note: Panic (Shift+Transpose) sends all-notes-off and resets transpose/mod wheel/control pedal.

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

## Phase 3: Complete Stage 4 system

**72/100**

Phase 3 delivers a credible full-system Stage 4: 32 program slots with Live mode, splits/scenes/morph/clock/transpose/panic, live organ and synth engines integrated through the inherited single-AudioContext graph, and an unsupported-controls audit. All gates pass (74/74 tests, 38/38 feature IDs). Inherited weaknesses remain: piano Grand/Upright/Electric are still synthesized buffers (sampleSources: 0), visual surface is schematic CSS from Phase 1, and LFO/rotary polish is simplified. Program round-trips and cross-engine integration are tested with rendered-audio assertions on organ/synth distinctions.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 75 |
| Complete feature system | 35% | 75 |
| Audio quality and integration | 30% | 67 |
| Full-system behavior | 20% | 75 |
| Engineering quality | 10% | 68 |

### Priority issues

- [object Object]
- [object Object]

### Technical gate

Passed.
