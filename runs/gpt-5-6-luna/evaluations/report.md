# GPT-5.6 Luna — Nord Stage 4 88 — Stagebench evaluation

- Run: `gpt-5-6-luna`
- Status: running
- Aggregate: **54/100 · incomplete**
- Coverage: 3/4 phases

## Phase scores

| Phase | Scope | Score | Grade |
| --- | --- | ---: | --- |
| 1 | Visual recreation | 72 | competent |
| 2 | Piano instrument | 64 | developing |
| 3 | Programs and effects | 30 | incomplete |
| 4 | queued | — | Not evaluated |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Visual recreation

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: None (visual-only phase)
- Generated sound sources: None declared
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 intentionally has no audio engine or bundled sound files.

### Phase 2: Piano instrument

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: Bundled recorded piano samples with a labeled Web Audio live-synthesis fallback
- Generated sound sources: Fallback synth piano — Triangle oscillator voices with exponential attack and release envelopes; used only when recorded assets cannot be decoded or Web Audio is unavailable.; Reverb impulse response — Generated exponentially decaying noise impulse for the Web Audio ConvolverNode; this is an effect buffer, not a piano recording.
- Recorded sample provenance: VSO2 piano recordings distributed by Tone.js Instruments — https://github.com/nbrosowsky/tonejs-instruments/tree/master/samples/piano (CC BY 3.0)
- Bundled audio files: `public/audio/piano/A1.mp3` (373.6 KB), `public/audio/piano/A2.mp3` (225.0 KB), `public/audio/piano/A3.mp3` (195.7 KB), `public/audio/piano/A4.mp3` (155.3 KB), `public/audio/piano/A5.mp3` (119.9 KB), `public/audio/piano/A6.mp3` (68.5 KB), `public/audio/piano/A7.mp3` (53.2 KB)
- Audio note: Normal playback loads only bundled files and does not depend on a network request.
- Audio note: The engine selects the nearest recorded root and rate-shifts within the seven-root bank.
- Audio note: If loading or decoding fails, the UI reports FALLBACK · SYNTH PIANO and remains playable.

### Phase 3: Programs and effects

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: Bundled recorded piano samples routed through one shared Web Audio graph with per-layer buses, connected representative effects, a master bus, limiter, and labeled live-synthesis fallback.
- Generated sound sources: Fallback synth piano — Triangle oscillator voices with exponential attack and release envelopes; used only when recorded assets cannot be decoded or Web Audio is unavailable.; Reverb impulse response — Generated exponentially decaying noise AudioBuffer used by ConvolverNode; this is an effect buffer, not a piano recording.
- Recorded sample provenance: VSO2 piano recordings distributed by Tone.js Instruments — https://github.com/nbrosowsky/tonejs-instruments/tree/master/samples/piano (CC BY 3.0)
- Bundled audio files: `public/audio/piano/A1.mp3` (373.6 KB), `public/audio/piano/A2.mp3` (225.0 KB), `public/audio/piano/A3.mp3` (195.7 KB), `public/audio/piano/A4.mp3` (155.3 KB), `public/audio/piano/A5.mp3` (119.9 KB), `public/audio/piano/A6.mp3` (68.5 KB), `public/audio/piano/A7.mp3` (53.2 KB)
- Audio note: The Phase 3 graph creates one AudioContext, reusable Piano A/B source buses, ordered Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb → Rotary chains, a master bus, a limiter, and one destination.
- Audio note: Program state, effects state, split/zone state, scenes, and morph assignments are serializable. Organ and Synth remain visual-only until Phase 4.
- Audio note: Normal playback loads only bundled files and does not depend on a network request after build.

## Phase 1: Visual recreation

**72/100 · competent**

A technically clean and geometrically disciplined Stage 1 recreation for the assigned Stage 4 88 variant. The live render matches the measured 3.71:1 silhouette, 54/46 deck-keybed allocation, exact 88-key A-to-C keyboard, continuous red chassis, and two-OLED rule. The control deck remains a schematic approximation of the reference: panel groups are much sparser, many controls are compressed or visually hidden, fine legends are difficult to read, and several control surfaces are stand-ins rather than coupled hardware state. Required tests, build checks, narrow rendering, live interactions, and console checks passed.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity | 55% | 68 |
| Feature completion | 20% | 75 |
| Interaction and UX | 15% | 66 |
| Engineering quality | 10% | 100 |

### Priority issues

- The panel deck is substantially more schematic and less reference-faithful than the chassis and keybed, with sparse/consolidated control groups and visually clipped or hidden fine controls.
- Typography and micro-labels are too small to read comfortably at desktop size, and the central OLED/control hierarchy is only an approximation of the photographed hardware.
- At 390px the deck becomes horizontally scrollable and many labels/targets are very small, even though the body avoids overflow and the full keybed remains visible.
- Several visible shapes such as pitch/modulation controls and the Program keypad are decorative or only minimally interactive, and display state coupling is limited beyond the exercised Live-program path.

### Technical gate

Passed.

## Phase 2: Piano instrument

**64/100 · developing**

The Phase 2 artifact is a credible visual and interaction shell with bundled recorded piano assets, shared note routing, and a connected Web Audio graph. It passes the supplied verification checks, but its visual geometry is substantially too wide/short, the Piano behavior is only partially wired, audio-boundary tests are absent, and several claimed controls do not alter the audible graph. MIDI is truthfully shown as denied in the live browser.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 25% | 60 |
| Piano feature completion | 25% | 65 |
| Audio implementation | 30% | 62 |
| Playability and UX | 15% | 70 |
| Engineering quality | 5% | 75 |

### Priority issues

- Visual silhouette is materially too wide/short versus the reference; CSS uses aspect-ratio 3.71/1.
- Control deck is a sparse generic approximation and lacks much of the reference's exact material/control density.
- Required Phase 2 audio-boundary tests are absent; the feature matrix references implementation files instead of dedicated tests for several audio features.
- Several Piano controls are state/display-only or only partially connected to audio, including layer levels, string resonance, acoustics, and meaningful unison.
- Sostenuto is global rather than per-note, and MIDI sustain handling toggles instead of honoring CC up/down values.
- No-Web-Audio fallback reports a fallback label but noteOn is silent when context is unavailable.

### Technical gate

Passed.

## Phase 3: Programs and effects

**30/100 · incomplete**

The Phase 3 artifact passes the repository verifier and its built preview loads, with a visually coherent 88-key Nord-style surface and real bundled piano/audio graph modules. However, the canonical Program/effect modules are not integrated into App: rendered Program, split, scene, morph, focus, bypass, and effect controls remain generic local-value controls or display-only handlers. Native audio graph construction is substantially present, but the required per-layer/routing semantics are incomplete and the candidate tests exercise mostly pure reducers, fake topology, and synthetic frame processing rather than the live browser/audio path.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 15% | 37 |
| Program feature completion | 30% | 15 |
| Effects and signal architecture | 30% | 41 |
| System behavior | 15% | 22 |
| Engineering quality | 10% | 42 |

### Priority issues

- Wire one canonical ProgramState through the rendered UI and Piano/audio engine so Store, Store As, dirty/cancel/undo, lists, categories, Live recall, scenes, splits, zones, crossfades, and morph inputs are observable and persistent.
- Replace generic Program/effect buttons with real contextual editing controls and connect focus, group/global, bypass, wet/dry, targeting, and To Rotary to the actual signal path.
- Complete the required per-layer/shared effect topology and validate native browser audio behavior; synthetic frame tests and disconnected metadata are insufficient evidence.
- Improve visual fidelity against the 88-key reference: add the photographed control density/material hierarchy and make narrow evidence a deliberate usable layout rather than a clipped horizontal slice.

### Technical gate

Passed.
