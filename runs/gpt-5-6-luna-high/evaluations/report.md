# GPT 5.6 Luna High — Stagebench evaluation

- Run: `gpt-5-6-luna-high`
- Status: complete
- Aggregate: **54/100 · incomplete**
- Coverage: 4/4 phases

## Phase scores

| Phase | Scope | Score | Grade |
| --- | --- | ---: | --- |
| 1 | Visual recreation | 60 | developing |
| 2 | Piano instrument | 59 | incomplete |
| 3 | Programs and effects | 52 | incomplete |
| 4 | Organ and synth | 47 | incomplete |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Visual recreation

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `typescript` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `@types/react` latest, `@types/react-dom` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: None (visual-only phase)
- Generated sound sources: None declared
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No audio engine or sound assets are included in Phase 1.

### Phase 2: Piano instrument

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `typescript` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `@types/react` latest, `@types/react-dom` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: Redistributable deterministic modal/physical piano model in Web Audio with the same in-memory renderer as an honest fallback.
- Generated sound sources: Modal piano body
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded piano files are bundled; this implementation intentionally claims comparably convincing modelled synthesis rather than sampled audio.
- Audio note: Web Audio uses oscillator partials and a shared master/wet-delay graph. When AudioContext is unavailable (tests or unsupported browser), the deterministic physical model remains playable and status reports fallback mode.
- Audio note: No network dependency is required for normal playback.
- Audio note: The first user gesture resumes a suspended AudioContext; suspended, error, fallback, and MIDI connection states are surfaced in the Piano status.

### Phase 3: Programs and effects

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `typescript` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `@types/react` latest, `@types/react-dom` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: Redistributable deterministic modal/physical piano model in Web Audio with the same in-memory renderer as an honest fallback.
- Generated sound sources: Modal piano body
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded piano files are bundled; this implementation intentionally claims comparably convincing modelled synthesis rather than sampled audio.
- Audio note: Web Audio uses oscillator partials and a shared master/wet-delay graph. When AudioContext is unavailable (tests or unsupported browser), the deterministic physical model remains playable and status reports fallback mode.
- Audio note: No network dependency is required for normal playback.
- Audio note: The first user gesture resumes a suspended AudioContext; suspended, error, fallback, and MIDI connection states are surfaced in the Piano status.
- Audio note: Phase 3 routes Piano voices through one EffectsGraph with piano-A/piano-B/organ-A/organ-B/synth-A/synth-B buses, ordered Mod1 → Mod2 → Delay → Amp/EQ → Compressor → Reverb → Rotary, then a master bus, limiter and destination. Native units use parallel dry/wet gains and click-safe automation; EffectsGraph also provides deterministic offline DSP for tests and fallback verification; no effect is metadata-only. ProgramStore state drives effect bypass, focus, routing and contextual displays.

### Phase 4: Organ and synth

- Application libraries: `@vitejs/plugin-react` latest, `react` latest, `react-dom` latest, `typescript` latest, `vite` latest
- Development and test tooling: `@eslint/js` latest, `@testing-library/jest-dom` latest, `@testing-library/react` latest, `@testing-library/user-event` latest, `@types/react` latest, `@types/react-dom` latest, `eslint` latest, `eslint-plugin-react-hooks` latest, `eslint-plugin-react-refresh` latest, `globals` latest, `jsdom` latest, `typescript-eslint` latest, `vitest` latest
- Audio strategy: Redistributable deterministic modal/physical piano model in Web Audio with the same in-memory renderer as an honest fallback.
- Generated sound sources: Modal piano body; Organ tonewheel/transistor/pipe model; Synth hybrid source model
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded piano files are bundled; this implementation intentionally claims comparably convincing modelled synthesis rather than sampled audio.
- Audio note: Web Audio uses oscillator partials and a shared master/wet-delay graph. When AudioContext is unavailable (tests or unsupported browser), the deterministic physical model remains playable and status reports fallback mode.
- Audio note: No network dependency is required for normal playback.
- Audio note: The first user gesture resumes a suspended AudioContext; suspended, error, fallback, and MIDI connection states are surfaced in the Piano status.
- Audio note: Phase 4 routes Organ A/B and Synth A/B/C voices through the inherited EffectsGraph buses, ordered Mod1 → Mod2 → Delay → Amp/EQ → Compressor → Reverb → Rotary, then one master bus, limiter and destination. No separate destination AudioContexts are created.

## Phase 1: Visual recreation

**60/100 · developing**

The repaired Phase 1 artifact now has a strong measured chassis and keybed silhouette: the 3.0951 aspect ratio, 94% desktop width, 54/46 deck-to-keybed allocation, continuous red rails, six ordered sections, exactly 43 white plus 30 black keys, and only Program/Synth OLEDs are all visible in the refreshed evidence. The data model and interaction pass are materially better, with section-specific drawbars, faders, knobs, toggles, keyboard focus/press states, OLED coupling, and explicit focus outlines. It remains a stylized product-study rather than a close recreation of the reference: most photographed micro-hardware and printed legends are absent or clipped by panel overflow, performance controls are generic sliders rather than a pitch stick/mod wheel, and the narrow capture is a horizontally scrolling 820px canvas. Independent test, typecheck, lint, and build checks all pass.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity | 55% | 56 |
| Feature completion | 20% | 60 |
| Interaction and UX | 15% | 66 |
| Engineering quality | 10% | 75 |

### Priority issues

- Expose the full section-specific hardware inventory: Remove panel overflow clipping and fit the required Organ LED/model/percussion, Piano detail, Program live/morph, Synth filter/envelope, and two grouped Effects controls into the visible deck with photo-matched placement and density.
- Replace generic performance sliders with Nord landmarks: Model a true pitch stick and modulation wheel on exposed red metal, plus the reference branding and nearby master controls.
- Add reference micro-detail and typography: Add LED ladders, silver switches, varied drawbar caps, printed legends, display framing, and the reference's compact label hierarchy/materials.
- Improve narrow viewport behavior: Provide a practical 390px presentation or clearly managed section navigation instead of requiring an 820px horizontally scrolling canvas.
- Deepen behavioral assertions: Assert actual knob/range value changes, state/display coupling across representative controls, and browser-level console/no-clipping behavior in addition to the current unit checks.

### Technical gate

Passed.

## Phase 2: Piano instrument

**59/100 · incomplete**

Post-repair source and artifact review confirms the project passes all required pnpm checks (19 tests, typecheck, lint, build), now resumes a suspended AudioContext from noteOn, exposes audio/MIDI status, wires substantially more Piano controls into the deterministic renderer, fixes released-voice preference and sostenuto capture, and disconnects stolen/released Web Audio nodes. The result is a credible small modal/physical model with an honest no-asset fallback, but it is still materially below the full Piano contract: the visual surface is a sparse approximation, the narrow capture is an 820px horizontally clipped canvas, layer focus/zones/transposition/routing and list/missing-model behavior are absent, the visible status omits the computed Piano summary/voice count, and most Web Audio controls beyond gain/reverb/model/unison/layers/soft-pedal are not applied to live voices. Real browser audio/MIDI interaction was not independently reproducible here, so resume and graph claims are verified by code and unit boundaries rather than a live-output pass.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 25% | 50 |
| Piano feature completion | 25% | 58 |
| Audio implementation | 30% | 62 |
| Playability and UX | 15% | 67 |
| Engineering quality | 5% | 75 |

### Priority issues

- Complete the Piano contract beyond scalar controls: implement layer focus, zones/transposition/routing, real model/list modes and missing-model display, and make the computed Piano summary/voice/pedal state visibly readable.: src/main.tsx:30-32,49-68; specs/nord-stage-4.piano.json acceptance/selection; reference manual pages 23-26
- Apply all claimed Piano sonic controls to live Web Audio voices (or narrow the claim) and add a fake AudioContext/OfflineAudioContext render test; currently only deterministic in-memory rendering proves many control differences.: src/pianoEngine.ts:38-79,153-158,198-203; tests/piano-engine.test.ts
- Raise the visual recreation density to the assigned Stage 4 73 photograph and make the 390px view genuinely usable or explicitly provide a clear horizontal navigation affordance.: evidence/stage2-desktop.png, evidence/stage2-narrow.png, src/styles.css media query
- Add end-to-end browser interaction coverage for AudioContext resume, audible note output, MIDI permission/disconnect, rapid repeated notes, and touch/multitouch; current evidence is static plus jsdom/fallback tests.: STAGE_NOTES.md Browser findings; tests/piano-engine.test.ts resume fake; no live-output harness
- Track/cancel normal-release timers and define ownership/closure semantics for the AudioContext to make cleanup deterministic under rapid play and unmount.: src/pianoEngine.ts:205-209

### Technical gate

Passed.

## Phase 3: Programs and effects

**52/100 · incomplete**

The repaired Phase 3 artifact passes its full mechanical gate (28 tests, typecheck, lint, and build) and now has a typed canonical ProgramStore, dynamic Program/effect status displays, editable split/crossfade state, list/preset handlers, and a single EffectsGraph boundary with six buses, ordered units, limiter, click-safe native wet/dry gains, and deterministic offline DSP. It is still a partial Programs/effects recreation: rendered workflows remain shallow (no real Store destination/name flow or Live recall), morph sources and zone assignment are not fully input-wired, native units are generic filters/delays rather than documented effect models, per-layer/global/group/To Rotary routing is shared or incomplete, and Piano adds a parallel wet path that duplicates the graph master path. Desktop geometry is retained, but the narrow capture remains a horizontally clipped 820px canvas and the evidence image is stale (caption says Piano Phase 02).

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 15% | 62 |
| Program feature completion | 30% | 50 |
| Effects and signal architecture | 30% | 50 |
| System behavior | 15% | 56 |
| Engineering quality | 10% | 50 |

### Priority issues

- Complete rendered Program workflows: real program load/recall, Live Mode recall, Store/Store As destination and naming/category confirmation, and four contextual Program View/list displays.
- Make morph sources (Wheel, Aftertouch, Control Pedal) and all documented destinations observable input paths with indicators; add a zone-membership editor and apply layer zones/crossfade to every audible layer.
- Replace generic native Biquad/Delay placeholders with connected representative Mod, Delay feedback/filter, Amp/EQ, Compressor, Reverb, and Rotary processing, including per-layer focus/group/global/To Rotary targeting and click-safe bypass.
- Remove PianoEngine's parallel wetDelay/reverb path so every voice traverses exactly one ordered EffectsGraph/master path; synchronize Program load/scene/layer state into PianoEngine and graph state.
- Refresh Phase 3 desktop/narrow evidence after exercising Program/effect flows, correct the stale Piano Phase 02 caption, and address the 390px horizontal clipping or document it as an explicit limitation.

### Technical gate

Passed.

## Phase 4: Organ and synth

**47/100 · incomplete**

Phase 4 adds real deterministic Organ and Synth renderers with six organ models, source-family/filter/envelope/LFO processing, and one shared EffectsGraph; all 33 tests and pnpm typecheck/lint/build pass. The implementation is materially stronger offline than in its browser path, but the hardware/UI surface is still a generic Phase 3-style control map, many required Phase 4 controls are absent or no-op, Program/scene/split/morph state is not applied back to engine controls, and Web Audio noteOn uses a single generic oscillator (and only the focused/first synth layer). This is a plausible modelled-audio prototype, not a substantially complete Stage 4 Organ/Synth integration.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual fidelity retention | 10% | 62 |
| Engine feature completion | 35% | 46 |
| Audio implementation | 30% | 50 |
| System behavior | 15% | 32 |
| Engineering quality | 10% | 50 |

### Priority issues

- Live WebAudio path does not implement the tested Organ/Synth engines: OrganEngine.noteOn creates generic sine/saw partial oscillators without percussion/click/vibrato/rotary; SynthEngine.noteOn creates one oscillator and ignores source/filter/envelope/LFO/arp controls. Browser users therefore do not hear most claimed controls.
- Program, scenes, splits and morphs do not hydrate or route Organ/Synth state: ProgramState stores metadata, but App only applies scene/morph changes to Piano; Organ/Synth noteOn never checks zones/splits and ProgramStore load has no engine synchronization.
- Required hardware inventory is largely decorative/generic: The UI exposes only Organ A and Synth A subsets. B3/Farf/pipe register/preset/sync, Synth B/C, filter type/tracking, three envelope pages, LFO destination/group, voice priority/glide, arp menu/range/hold/sync controls are absent or local toggles.
- Layer routing is incorrect for active/focused layers: Organ routes all active layers to the focused organ bus; Synth noteOn always uses layerA and maps focused C to synth-B, preventing independent per-layer effect chains.
- Deterministic tests under-cover the required contract: 33 tests pass, but phase4.test.ts has four cases and does not exercise live AudioContext processing, browser controls, layer B/C, registration/preset workflows, split/morph/scene routing, priority/glide/hold/clock semantics or performance stress.
- Visual evidence is inherited rather than a Phase 4 interaction audit: stage4-visual-audit.md states no in-app browser was available; screenshot caption remains 'interactive surface / piano phase 02' and Synth display is static.

### Technical gate

Passed.
