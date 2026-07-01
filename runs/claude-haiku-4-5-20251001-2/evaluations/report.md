# Haiku 4.5 — Stagebench evaluation

- Run: `claude-haiku-4-5-20251001-2`
- Status: running
- Aggregate: **24/100 · incomplete**
- Coverage: 1/4 phases

## Phase scores

| Phase | Scope | Score | Grade |
| --- | --- | ---: | --- |
| 1 | complete | — | Not evaluated |
| 2 | Piano instrument | 24 | incomplete |
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
- Development and test tooling: `@types/node` ^18.0.0, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `@vitejs/plugin-react` ^4.0.0, `oxlint` ~1.16.0, `tsx` ^4.19.4, `typescript` ~5.3.0, `vite` ^5.0.0
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

**24/100 · incomplete**

This is barely a Phase 1 surface with an unwired audio module bolted on. Mechanical gates are green (67 tests, typecheck, lint, build all pass), but the tests validate hardcoded data literals and Web Audio primitives, not the rendered artifact. In the live app the 73-key keyboard does NOT render: only ~8 white and ~6 black keys appear because Keyboard.tsx uses a fixed 14-character pattern string. Every section 'control' is a plain text <span> label, so there are zero knobs, drawbars, faders, buttons, LEDs, or OLED displays; none of the piano controls (type/model/touch/compression/timbre/unison/volume/reverb/sustain) are rendered or wired to audio. The sound source is a placeholder Tone.PolySynth triangle oscillator (self-described as 'FM Synthesis'), not credible piano material, failing hard gate 1. Pointer input is dead in the running app because the InputHandler prop is undefined on the only render pass. Only the computer-keyboard path can produce sound. The biggest gaps: the keyboard render is broken (~14 keys, empty keybed), controls are text-only with no hardware widgets and no audio wiring, and the primary path is a placeholder synth.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 25% | 25 |
| Piano feature completion | 25% | 8 |
| Audio implementation | 30% | 31 |
| Playability and UX | 15% | 30 |
| Engineering quality | 5% | 50 |

### Priority issues

- The 73-key keyboard does not render: Keyboard.tsx uses a fixed 14-character pattern string, so only ~8 white and ~6 black keys appear; the keybed is effectively empty.
- All section controls render as plain text labels with zero hardware widgets (no knobs/drawbars/faders/buttons/LEDs/OLEDs); no piano control (type/model/touch/compression/timbre/unison/volume/reverb/sustain) is rendered or wired to audio.
- Primary sound source is a placeholder Tone.PolySynth triangle oscillator (mislabeled 'FM Synthesis'), not credible/sampled piano — fails Phase 2 hard gate 1.
- Pointer/touch input is dead in the running app because inputHandler is undefined on the only render pass (App.tsx:138); only computer-keyboard input produces sound, and it uses fixed velocity 0.7 with no visual feedback and a wrong white-key pitch mapping.
- Sustain pedal has no audible effect (PianoEngine.config.sustain is never updated from the lifecycle) and the fallback mode, though implemented, is never labeled in the UI — fails hard gates 3 and 4.
- Narrow 390px layout overflows the viewport (Synth column clipped); EffectsGraph is dead duplicate code; passing tests assert hardcoded data literals rather than the rendered artifact.

### Technical gate

Passed.
