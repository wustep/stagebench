# Haiku 4.5 — Stagebench evaluation

- Run: `claude-haiku-4-5-20251001-2`
- Status: running
- Aggregate: **23/100 · incomplete**
- Coverage: 1/4 phases

## Phase scores

| Phase | Scope | Score | Grade |
| --- | --- | ---: | --- |
| 1 | running | — | Not evaluated |
| 2 | Piano instrument | 23 | incomplete |
| 3 | queued | — | Not evaluated |
| 4 | queued | — | Not evaluated |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Visual recreation

- Application libraries: `react` ^19.2.7, `react-dom` ^19.2.7
- Development and test tooling: `@types/node` ^18.0.0, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `@vitejs/plugin-react` ^4.0.0, `typescript` ~5.3.0, `vite` ^5.0.0
- Audio strategy: None (visual-only phase)
- Generated sound sources: None declared
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 is a visual recreation only. No audio implementation is required.

### Phase 2: Piano instrument

- Application libraries: `react` ^19.2.7, `react-dom` ^19.2.7, `tone` ^14.8.56
- Development and test tooling: `@types/node` ^18.0.0, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `@vitejs/plugin-react` ^4.0.0, `typescript` ~5.3.0, `vite` ^5.0.0
- Audio strategy: FM Synthesis via Tone.js PolySynth
- Generated sound sources: FM Synthesis Piano Model
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Web Audio API with Tone.js library provides credible piano-like synthesis without recorded samples
- Audio note: No network dependencies; all synthesis occurs in browser using Web Audio API
- Audio note: Fallback mode displays 'fallback' label when Web Audio unavailable, visual feedback only (no audio)
- Audio note: MIDI input supported via Web MIDI API with graceful degradation if unavailable
- Audio note: All input sources (pointer, touch, keyboard, MIDI) funnel through unified NoteLifecycleService
- Audio note: Touch curves (heavy/medium/light) adjust velocity response; dynamic compression (0-3) smooths dynamics

## Phase 2: Piano instrument

**23/100 · incomplete**

Phase 2 implementation has critical compilation errors preventing build. While architecture is sound and FM synthesis source is credible, the codebase fails TypeScript compilation, all audio tests are mock-based (not real Web Audio), visual regression evidence is missing, and browser testing is impossible. Hard gates architecturally present but not demonstrated to work. Phase 2 status: INCOMPLETE with major blockers.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 25% | 50 |
| Piano feature completion | 25% | 25 |
| Audio implementation | 30% | 12 |
| Playability and UX | 15% | 0 |
| Engineering quality | 5% | 12 |

### Priority issues

- TypeScript compilation fails
- No real Web Audio tests
- Phase 2 visual regression unchecked
- InputHandler not connected to Keyboard
- MIDI types incorrect
- Inaccurate completion claims
- Mock-based tests create false positive

### Technical gate

Failed; score capped at 59.
