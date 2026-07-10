# GPT 5.6 Terra High — full run — Stagebench evaluation

- Run: `gpt-5-6-terra-high`
- Status: complete
- Aggregate: **40/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 60 |
| 2 | Piano library and working effects | 45 |
| 3 | Complete Stage 4 system | 27 |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Live Web Audio synthesis: triangle fundamental plus a quiet sine overtone through a per-note ADSR-like gain envelope. This is an honestly labeled piano-like fallback, not a recorded sample set.
- Generated sound sources: [object Object]
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 exposes one playable synthesized piano-like voice only.
- Audio note: Panel controls other than the keyboard and sustain input are decorative presentation controls and are intentionally not connected to audio.
- Audio note: AudioContext creation is lazy and Web MIDI denial/unavailability is reported in the visible status text.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One lazy Web Audio AudioContext with two owned piano-layer inputs, ordered effect nodes, layer output gains, one master gain, one DynamicsCompressor limiter, and one destination. The current instrument is a labeled live-synthesis fallback; it does not contain recorded sample assets.
- Generated sound sources: [object Object]; [object Object]
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: The status display explicitly says 'Sample assets unavailable · playable synthesis fallback'; it does not report a primary sample library ready.
- Audio note: Each generated layer routes source → Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb → optional Rotary → layer level → master gain → limiter → destination.
- Audio note: Organ, Synth, and Program controls remain presentation-only in Phase 2. Excluded pedal-noise, half-pedaling, Triple Pedal modeling, size classes, INFO, Sound Manager, and piano preset library are unsupported.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One lazy Web Audio AudioContext owns all keyboard-triggered Piano, Organ, and Synth fallback sources. They enter the inherited effect buses, master gain, limiter, and single destination; Panic and unmount release every owned voice.
- Generated sound sources: [object Object]; [object Object]
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: The status display truthfully identifies the unavailable sample assets and the playable synthesis fallback.
- Audio note: The UI stores all supported Program state, but deliberately labels only the benchmark's spec-excluded program/menu/preset features as unsupported in the implementation plan.
- Audio note: Organ and Synth source selections are implemented as distinct generated profiles in the existing context; no second AudioContext is created.

## Phase 1: Complete surface and basic piano

**60/100**

A solid, honest Stage 4 73 surface with exact key count, broad geometry, and a working synthesized basic voice. It falls well short of reference-level hardware density and responsive presentation, while the audio/input implementation has important untested lifecycle gaps. All four required technical checks pass.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 57 |
| Basic Piano functionality | 25% | 56 |
| Surface interaction and honesty | 15% | 75 |
| Engineering quality | 15% | 61 |

### Priority issues

- Reference hardware inventory and micro-layout are substantially reduced; several sections rely on generic control grids rather than the product's differentiated hardware.
- Narrow presentation depends on horizontal scrolling, leaving the majority of the chassis outside the initial 390px capture.
- Overlapping inputs for the same MIDI note are not independently owned: noteOff releases all voices for that note.
- New MIDI inputs connected after access is granted do not receive a message handler.
- Feature-matrix coverage is nominal rather than behavioral: four UI tests are mapped to all eleven Phase 1 feature IDs.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**45/100**

This is a functional, visually retained Phase 2 fallback rather than a complete Phase 2 instrument. The sealed verification passed all four package gates and recorded no page errors in the canonical captures. The artifact truthfully reports that Grand, Upright, and Electric recorded libraries are unavailable and uses live oscillator synthesis instead, so it misses a central hard gate. Direct source inspection finds one AudioContext, two layer inputs, a master gain and limiter, but the effect implementation is materially incomplete: the created Rotary node is not connected, most listed modulation types share the same processing, and the rendered controls omit key routing and parameter behavior. The sole six-test DOM suite checks state changes only and provides no rendered-audio or backend-bound evidence.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 65 |
| Piano library and performance | 35% | 47 |
| Effects and signal graph | 30% | 38 |
| System behavior and UX | 10% | 50 |
| Engineering quality | 15% | 35 |

### Priority issues

- Grand, Upright, and Electric have no bundled recorded sample sets or provenance. The fallback labeling is honest, but this misses a central Phase 2 hard gate and sharply limits Piano-library credit.
- The Rotary node is never connected; most Mod 1/Mod 2 types are not distinct processing; several required effect parameters/routing semantics are absent. The UI therefore overrepresents the actual effects implementation.
- All 20 feature IDs point to one six-test DOM suite. There is no real audio-bound evidence for source distinction, controls, effect processing, routing/order, or cleanup.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**27/100**

The sealed Phase 3 artifact is a visually retained, accessible control-state prototype rather than a complete Stage 4 system. Its verification passed test, typecheck, lint, build, sealed-digest, and capture checks; the canonical captures have no page errors. It adds UI and serializable state for Programs, Organ, Synth, splits, scenes, and morphs, but source inspection shows many required behaviors are state-only: split crossfade and morph positions do not affect rendering, Organ drawbars and most Organ parameters do not affect its source, and Synth filter parameters, envelopes, LFO, voice modes, and arp do not affect sound. The sole 127-line test file has nine DOM/state tests, while all 38 required IDs map to it; it contains no rendered-audio or real-boundary evidence.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 62 |
| Complete feature system | 35% | 31 |
| Audio quality and integration | 30% | 25 |
| Full-system behavior | 20% | 17 |
| Engineering quality | 10% | 22 |

### Priority issues

- Phase 3 controls substantially overrepresent behavior: crossfade, morph interpolation, clock sync, most Organ controls, and most Synth controls are state-only; Organ/Synth are mappings into the inherited Piano fallback rather than complete engines.
- Program serialization and dirty state omit supported Organ drawbar/percussion/rotary and other control state, so the required complete round-trip cannot hold. The eight Live slots are in-memory and lack behavioral coverage.
- Every required feature ID maps to a single nine-test DOM suite. No deterministic rendered-audio, routing, source distinction, timing, real MIDI, or cleanup evidence exists.
- Non-excluded generic presentation controls remain no-ops and spec exclusions are not surfaced in a UI unsupported-control audit, failing the hardware-binding honesty contract.

### Technical gate

Passed.
