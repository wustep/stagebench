# GPT 5.6 Sol High — Stagebench evaluation

- Run: `gpt-5-6-sol-high`
- Status: complete
- Aggregate: **58/100 · incomplete**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score | Grade |
| --- | --- | ---: | --- |
| 1 | Visual recreation | 70 | competent |
| 2 | Piano instrument | 65 | developing |
| 3 | Complete instrument | 45 | incomplete |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Visual recreation

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `typescript` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `@types/react` latest, `@types/react-dom` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: None (visual-only phase)
- Generated sound sources: None declared
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 implements visual and control interaction only.

### Phase 2: Piano instrument

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `typescript` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `@types/react` latest, `@types/react-dom` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: Generated AudioBuffer piano samples with Web Audio playback
- Generated sound sources: Six piano root-note buffers — Generated at startup from a four-partial additive waveform, then pitch-mapped across the keyboard; Reverb impulse — Generated in memory with decaying noise
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded, downloaded, remote, or bundled audio samples are used.
- Audio note: The word sample refers to generated AudioBuffer playback, not recorded piano material.

### Phase 3: Complete instrument

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `typescript` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `@types/react` latest, `@types/react-dom` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: Hybrid generated AudioBuffer and oscillator synthesis
- Generated sound sources: Piano root-note buffers — Six additive-synthesis buffers generated at startup and pitch-mapped across the keyboard; Organ voices — Web Audio oscillators combined from drawbar harmonics and percussion; Synth voices — Web Audio oscillator, filter, envelope, and LFO graph; Reverb impulse — Generated in memory with decaying noise
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded, downloaded, remote, or bundled audio samples are used.
- Audio note: Piano sample playback uses generated buffers rather than recorded piano samples.

## Phase 1: Visual recreation

**70/100 · competent**

A geometrically disciplined and technically clean Stage 1 recreation with an exact 73-key model, connected chassis, measured desktop proportions, and broad interactive control coverage. Direct comparison with the primary photograph and the manual's panel overview shows that the control deck remains a schematic approximation: several displays are oversized or invented, physical control placement and density differ materially, tiny legends are difficult to read, and the narrow layout preserves the whole instrument by shrinking controls below practical touch sizes. Core key, button/LED, and knob behavior is exercised by passing tests, but display and meter content is static and the controls do not form the coupled hardware state described by the manual.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity | 55% | 68 |
| Feature completion | 20% | 75 |
| Interaction and UX | 15% | 66 |
| Engineering quality | 10% | 75 |

### Priority issues

- The panel layout is visibly more schematic and less reference-faithful than the chassis and keybed, with oversized/invented OLED bars, consolidated controls, and reduced density in several sections.
- Displays and meters are static; control changes do not update related display content or form the coupled state relationships documented in the Nord manual.
- At 390 px width the full instrument avoids clipping, but labels and interaction targets shrink below practical reading and touch sizes.
- Live browser verification could not be repeated because the in-app browser was unavailable; visual ratings use the required saved desktop/narrow evidence and interactions use the exercised test suite plus source inspection.

### Technical gate

Passed.

## Phase 2: Piano instrument

**65/100 · developing**

Stage 2 preserves the strong measured chassis and complete 73-key presentation, adds all four required input paths, deterministic lifecycle/sustain/polyphony/velocity coverage, useful status feedback, and a cleanly separated piano engine, input layer, and Web Audio backend. The implementation is nevertheless only a partial piano recreation: its six root AudioBuffers are generated at startup from a four-partial additive waveform rather than recorded or comparably convincing piano samples; piano type/model, Timbre, and Dynamic Compression largely change names or display state without changing the audio; the Web Audio graph itself has no focused tests; and the no-Web-Audio fallback is silent while the UI calls it ready. All 25 tests and the test/typecheck/lint/build gates pass. Saved 1440x900 and 390x844 renders support the visual ratings, but this evaluator could not repeat live browser or audible verification because no in-app browser target was available.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 25% | 75 |
| Piano feature completion | 25% | 66 |
| Audio implementation | 30% | 65 |
| Playability and UX | 15% | 50 |
| Engineering quality | 5% | 62 |

### Priority issues

- The piano sound source is a six-root additive waveform bank rendered into AudioBuffers at startup, not credible recorded multi-velocity piano samples or comparably convincing modeling.
- Piano type/model, Timbre, and Dynamic Compression update selection/display state but do not change the generated sound; several manual Piano controls are decorative or absent.
- The Web Audio backend has no direct tests for attack/release automation, dry/wet routing, source cleanup, sample selection, or load behavior; most audio tests stop at a fake boundary.
- The no-Web-Audio fallback is silent while the UI reports 'offline piano ready', and AudioContext construction/resume errors are not surfaced.
- Narrow rendering avoids clipping but makes the full panel and keys too small for practical touch use.
- Live browser and audible verification could not be repeated because the in-app browser exposed no target; ratings use fresh saved evidence, the verification record, direct source/manual comparison, and independently rerun deterministic checks.

### Technical gate

Passed.

## Phase 3: Complete instrument

**45/100 · incomplete**

Stage 3 preserves the measured connected chassis and complete 73-key presentation, adds real but simplified Web Audio Organ and Synth voices, and supplies coherent typed models for seven layers, splits/zones, morph interpolation, presets, and menu state. All 41 tests and the verifier's test/typecheck/lint/build gates pass, and the saved desktop/narrow renders show no structural visual regression. The completion claim is nevertheless substantially overstated: the 17-type EffectsRack is only an in-memory list and is never connected to any audio graph, many visible hardware controls still fall through to decorative local state, aftertouch/control-pedal morphs have no input path, the UI exposes only a fixed C4 split, menu parameter editing is not wired, and several engine parameters do not affect synthesis. The preview answered HTTP 200, but this evaluator could not repeat live browser or audible checks because no in-app browser target was available; behavior ratings therefore rely on independently rerun tests, source/manual inspection, and saved evidence, with low ratings where real audio behavior is unsupported.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 15% | 62 |
| Instrument feature completion | 35% | 42 |
| Audio and effects | 25% | 33 |
| System behavior | 15% | 53 |
| Engineering quality | 10% | 50 |

### Priority issues

- EffectsRack enumerates all 17 required effects but is state-only and never processes or routes audio; effect type, order, mix, bypass, and targeting changes are inaudible.
- Many visible hardware controls remain decorative because App.getBinding returns an empty binding for unhandled IDs, contrary to the Stage 3 requirement that every control have meaningful functionality.
- Engine fidelity is partial: Piano selections do not change sound, most Organ model/rotary/drive behavior is simplified, and several Synth parameters and performance features are ignored by the audio backend.
- The UI exposes only a fixed C4 split with fixed zones; split-point editing, xFade, broad zone assignment, and Layer Scene II are absent or decorative relative to manual pages 37-38 and 42.
- Aftertouch and control-pedal morph assignments are stored but cannot be driven; there are no corresponding input paths or destination indicators.
- Menu parameter editing is not connected in the rendered App: beginEdit/confirm are never invoked, so menu pages are primarily labels/navigation.
- Piano, Organ, and Synth use separate direct-to-destination AudioContexts with no shared master/effect bus, limiting coherent layer gain staging and creating untested clipping/CPU risks.
- Narrow evidence preserves the full chassis without clipping but shrinks legends, keys, and controls below practical reading and touch sizes.
- Live browser, console, and audible verification could not be independently repeated because the in-app browser exposed no target; the local preview did answer HTTP 200, and ratings use saved evidence, source/manual comparison, verifier output, and independently rerun deterministic tests.

### Technical gate

Passed.
