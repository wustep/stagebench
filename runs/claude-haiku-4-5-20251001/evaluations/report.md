# claude-haiku-4-5-20251001 — Stagebench evaluation

- Run: `claude-haiku-4-5-20251001`
- Status: complete
- Aggregate: **100/100**
- Coverage: 1/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 100 |
| 2 | complete | — |
| 3 | complete | — |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 1 uses Web Audio API synthesis for the basic piano voice. No recorded samples are used in Phase 1.
- Generated sound sources: Basic synthesized piano voice — Web Audio API OscillatorNode + GainNode envelope
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 is not required to use recorded samples; the spec permits honest synthesis.
- Audio note: All visible controls move/press but only the keybed and sustain pedal affect audio.
- Audio note: The piano voice is the only functional audio source in Phase 1.
- Audio note: Sustain pedal extends release time from 0.3s to 1.0s.
- Audio note: Voice stealing is deterministic: oldest voices are stolen first when polyphony exceeds 32.
- Audio note: Velocity range is 1-127 (MIDI standard); affects voice amplitude.
- Audio note: No effects, tone controls, or multi-model selection in Phase 1 - these are Phase 2 scope.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 2 extends Phase 1 with a multi-layer piano engine and complete effects chain. Six piano types are selectable with synthesis fallback. All effects process real audio through a single AudioContext with per-layer buses and master gain/limiter.
- Generated sound sources: Basic synthesized piano voice — Web Audio API OscillatorNode + GainNode envelope
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 is not required to use recorded samples; the spec permits honest synthesis.
- Audio note: All visible controls move/press but only the keybed and sustain pedal affect audio.
- Audio note: The piano voice is the only functional audio source in Phase 1.
- Audio note: Sustain pedal extends release time from 0.3s to 1.0s.
- Audio note: Voice stealing is deterministic: oldest voices are stolen first when polyphony exceeds 32.
- Audio note: Velocity range is 1-127 (MIDI standard); affects voice amplitude.
- Audio note: No effects, tone controls, or multi-model selection in Phase 1 - these are Phase 2 scope.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 3 extends Phase 2 with a program/performance system (32 program slots + 8 Live), Organ engine (B3/Vox/Farf/Pipe with harmonic drawbars), and Synth engine (oscillators/filters/voice modes). All sections share one AudioContext with per-layer buses, effects chains, and master destination.
- Generated sound sources: Basic synthesized piano voice — Web Audio API OscillatorNode + GainNode envelope
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 3 extends Phase 2 with complete program state serialization and Organ/Synth engines.
- Audio note: Piano section from Phase 2 continues with full layer mixing and effects integration.
- Audio note: Organ engine provides B3/Vox/Farf/Pipe models with harmonic differentiation via drawbar spectrum.
- Audio note: Synth engine provides Pure waveforms (Sine/Saw/Square/Triangle) with independent oscillators.
- Audio note: All sections (Piano/Organ/Synth) share one AudioContext with per-layer buses and master effects.
- Audio note: Programs store complete state: section enables/models/parameters, master clock/transpose.
- Audio note: Program storage uses localStorage for persistence (32 programs + 8 Live slots).
- Audio note: Organ percussion/key-click implement harmonic attack on B3 model.
- Audio note: Synth voice modes (Poly/Mono/Legato) implement note stealing strategy.
- Audio note: All Phase 1 and Phase 2 tests remain passing (45 regression tests).
- Audio note: Factory programs demonstrate Piano, Organ (B3 tonewheel), and Synth (lead) configurations.
- Audio note: Splits/Scenes/Morphs/Clock/Transpose/Panic are type-defined but UI integration pending for evaluation.

## Phase 1: Complete surface and basic piano

**100/100**

Phase 1 complete: Visual surface with complete Nord Stage 4 geometry and section layout, basic piano voice with multi-input support (pointer, keyboard, MIDI, sustain), proper polyphony and cleanup. All visible controls respond to input, panel controls are decorative as specified.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 100 |
| Basic Piano functionality | 25% | 100 |
| Surface interaction and honesty | 15% | 100 |
| Engineering quality | 15% | 100 |

### Priority issues

- None recorded.

### Technical gate

Passed.
