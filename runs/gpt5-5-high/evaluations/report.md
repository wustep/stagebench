# GPT 5.5 High — Stagebench evaluation

- Run: `gpt5-5-high`
- Status: complete
- Aggregate: **75/100**
- Coverage: 1/1 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 75 |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Generated browser synthesis for Phase 1: each played note starts two Web Audio oscillators (triangle fundamental plus quiet sine partial) through a gain envelope and low-pass filter. Tests use an injectable null adapter, so they do not require audio hardware.
- Generated sound sources: Phase 1 generated piano voice
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No bundled recorded piano samples are included or claimed in Phase 1.
- Audio note: Panel controls are decorative presentation state only; only keybed/computer-key/MIDI note input and MIDI/keyboard sustain affect the generated voice.

## Phase 1: Complete surface and basic piano

**75/100**

Strong Phase 1 artifact with a coherent Stage 4 73 surface, exact 73-key E1-E7 keybed, clean technical gates, accessible decorative controls, and a truthful generated basic piano voice. The main limitations are visual exactness at hardware/micro-label level, very compressed narrow presentation, shallow real-audio verification, and incomplete exercised status/fallback cleanup paths.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 71 |
| Basic Piano functionality | 25% | 75 |
| Surface interaction and honesty | 15% | 86 |
| Engineering quality | 15% | 75 |

### Priority issues

- Narrow 390px rendering preserves the whole instrument but compresses it to about 121px tall, making detailed controls and labels mostly illegible.
- Visual inventory is dense and sectionally correct, but many hardware details are simplified into schematic generic controls rather than reference-accurate labels, LEDs, and exact placements.
- Audio verification relies on stateful/null-adapter tests; it does not measure actual rendered Web Audio output or node cleanup at the browser boundary.
- GeneratedPianoEngine keeps released voices in its internal snapshot until cleanupReleased or later polyphony stealing; the app does not schedule cleanupReleased.
- The UI exposes a ready generated-synthesis status but does not exercise loading, error, or playable fallback states.

### Technical gate

Passed.
