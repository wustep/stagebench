# GPT5.5-high isolated target 3 stage-4-73 — Stagebench evaluation

- Run: `gpt5-5-high-2`
- Status: in-progress
- Aggregate: **73/100**
- Coverage: 1/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 73 |
| 2 | queued | — |
| 3 | queued | — |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 1 uses live Web Audio synthesis only: one generated triangle-wave piano-like voice with velocity-scaled gain, per-note release envelopes, sustain hold/release, bounded polyphony, and deterministic oldest/released voice stealing. No recorded samples are bundled or claimed.
- Generated sound sources: Generated basic piano voice — Web Audio OscillatorNode triangle waveform through per-voice GainNode ADS-style envelope
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Panel controls outside the keybed and sustain input are decorative in Phase 1 and intentionally do not change audio, program, synth, organ, or effects state.
- Audio note: If AudioContext is unavailable or cannot be started, the app reports a labeled playable fallback state instead of claiming recorded piano readiness.
- Audio note: Web MIDI input is requested when available; denied, unavailable, disconnected, and no-input states are reported in visible status text.

## Phase 1: Complete surface and basic piano

**73/100**

Strong Phase 1 artifact with a credible full Nord Stage 4 73 surface, exact 73-key keybed, clean runtime, and honest generated-synthesis piano source. Main gaps are simplified micro-detail, very small narrow rendering, shallow real-boundary tests, unexercised MIDI/multitouch evidence, and a basic triangle oscillator voice rather than a more piano-like source.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 71 |
| Basic Piano functionality | 25% | 75 |
| Surface interaction and honesty | 15% | 86 |
| Engineering quality | 15% | 61 |

### Priority issues

- Narrow layout preserves the full instrument but renders controls and legends extremely small (3.4px labels at 390x844), limiting usable inspection and legible state.
- Candidate tests do not directly exercise Web MIDI note/CC64, denied/disconnected MIDI behavior, independent multitouch, or actual audio rendering.
- The generated voice is a simple triangle oscillator with envelopes; it is honest and playable but only a basic approximation of a piano-like source.
- Overlapping same-key ownership is not fully represented in visual state because active keys are tracked by keyId Set rather than per input owner.

### Technical gate

Passed.
