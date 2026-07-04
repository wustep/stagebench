# GPT5.5-high isolated target 3 stage-4-73 — Stagebench evaluation

- Run: `gpt5-5-high-2`
- Status: complete
- Aggregate: **50/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 73 |
| 2 | Piano library and working effects | 44 |
| 3 | Complete Stage 4 system | 43 |

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

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 2 uses one Web Audio context with Piano A/B layer buses, generated piano-like source voices, ordered deterministic effect processors, master gain, limiter, and one destination. Test rendering uses the same parameter state in deterministic Float32Array probes.
- Generated sound sources: Generated Studio Grand — Candidate-authored additive/generated buffer approximation with nine declared root notes and soft/medium/hard velocity variants in code; not sampled from a recording.; Generated Felt Upright — Candidate-authored additive/generated buffer approximation with a more mid-forward, shorter-decay harmonic recipe; not sampled from a recording.; Generated Tine Electric — Candidate-authored additive/generated tine/reed approximation with ten declared root notes and soft/medium/hard velocity variants in code; not sampled from a recording.; Generated Clav — Live Web Audio/generated probe synthesis with bright saw-style harmonic weighting.; Generated Digital Piano — Live Web Audio/generated probe synthesis with digital layered harmonic weighting.; Generated Misc Mallet — Live Web Audio/generated probe synthesis with square/mallet-like harmonic weighting.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: The app visibly declares that the Grand/Upright/Electric libraries are generated offline approximations and are not recordings.
- Audio note: If AudioContext is unavailable or cannot be started, the app reports a labeled playable fallback state instead of claiming primary library readiness.
- Audio note: Organ, Synth, Program, Organ/Synth FX focus, Delay Tap/Tempo, and spec-excluded behavior are decorative in Phase 2.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Phase 3 keeps the inherited single Web Audio context, Piano A/B layer buses, ordered Phase 2 effects, master gain, limiter, and one destination. Organ and Synth are integrated into the same serializable program/effects/master-path model and verified with deterministic Float32Array render probes. No second AudioContext is created.
- Generated sound sources: Generated Studio Grand — Candidate-authored additive/generated buffer approximation with nine declared root notes and soft/medium/hard velocity variants in code; not sampled from a recording.; Generated Felt Upright — Candidate-authored additive/generated buffer approximation with a mid-forward, shorter-decay harmonic recipe; not sampled from a recording.; Generated Tine Electric — Candidate-authored additive/generated tine/reed approximation with ten declared root notes and soft/medium/hard velocity variants in code; not sampled from a recording.; Generated B3/Vox/Farf/Pipe Organ — Candidate-authored deterministic additive organ probes. B3, Vox, Farf, and Pipe use different harmonic tables, drawbar/register rules, percussion/key-click/vibrato/chorus, and rotary modulation.; Generated Stage 4 Synth — Candidate-authored deterministic oscillator/filter/envelope/LFO/voice/arp probes for Pure, Sync, Multi, Super, and FM-H source categories. No sample-library downloads are used.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: The app visibly declares that the Grand/Upright/Electric libraries are generated offline approximations and are not recordings.
- Audio note: If AudioContext is unavailable or cannot be started, the app reports a labeled playable fallback state instead of claiming primary library readiness.
- Audio note: Organ and Synth state, routing, and deterministic audio probes share the one complete-system model; no unsupported control silently claims success.

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

## Phase 2: Piano library and working effects

**44/100**

Phase 2 preserves a recognizable Stage 4 73 surface and implements a useful generated two-layer piano shell with keyboard/pointer/MIDI input, stateful layer controls, and deterministic Float32Array probe processors for piano controls and effects. The artifact misses the main Phase 2 piano hard gate: IMPLEMENTATION_DETAILS.json declares sampleSources: [] and explicitly says Grand/Upright/Electric are generated approximations, not bundled recorded sample sets. A second major issue is that live played notes bypass the effect processors: noteOn builds oscillator/filter/gain voices directly into layer buses and master, while Mod/Delay/Amp/Compressor/Reverb/Rotary processing exists only in renderProbe(). Current pnpm test also fails with a timeout in the surface inventory test, while typecheck, lint, and build pass.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 65 |
| Piano library and performance | 35% | 48 |
| Effects and signal graph | 30% | 31 |
| System behavior and UX | 10% | 50 |
| Engineering quality | 15% | 42 |

### Priority issues

- Required recorded piano sample sets are absent: IMPLEMENTATION_DETAILS.json declares sampleSources: [] and lists Grand, Upright, and Electric as generated approximations, not recordings.
- Effects are not connected to live keybed audio: noteOn voices connect oscillator -> filter -> gain -> layer bus -> master; Mod/Delay/Amp/Compressor/Reverb/Rotary processing exists only in renderProbe().
- Required test gate fails: pnpm test fails because the surface inventory test times out after 5000ms; 12 of 13 tests pass.
- Functional control coverage is incomplete: piano.section-on and piano.model-select are marked functional but do not implement canonical behavior; UI sustain pedal input is missing beyond SUSTPED routing toggles.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**43/100**

The sealed artifact has a credible retained Nord Stage 4 surface, passing package gates, and a sizable serialized Stage 3 state/probe model for programs, organ, synth, splits, scenes, morphs, and effects. It falls well short of the complete system contract: Grand/Upright/Electric are explicitly generated approximations rather than the required recorded sample sets; live browser key/MIDI playback still uses only the piano engine; organ and synth are represented by deterministic probes instead of being mixed into the actual Web Audio note path; Store As naming lacks a panel UI; many hardware bindings are state-only or shallow; and the runtime displays non-finite synth RMS.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 62 |
| Complete feature system | 35% | 50 |
| Audio quality and integration | 30% | 33 |
| Full-system behavior | 20% | 36 |
| Engineering quality | 10% | 50 |

### Priority issues

- src/pianoEngine.ts sampleLibrary and IMPLEMENTATION_DETAILS.json explicitly declare generated approximations/not recordings; the visual audit lists this as a known deviation.
- App.startKey and MIDI note handlers call pianoEngine.noteOn only; visual audit states Organ/Synth live browser key playback is represented by state/probes while the live Web Audio path remains piano-focused.
- integrationSnapshot declares a shared path, but the actual Web Audio graph is built in createPianoEngine for piano layer buses; Organ/Synth focus buttons only update status text.
- Store As naming exists only as storeAsProgram helper, split editing toggles fixed C3/C4/C5 points, morph assignment is hardcoded/clear-only, and master clock tap/dial controls are not visibly implemented.
- Sealed desktop capture and interactive preview status both show synth RMS as Infinity.
- All required feature IDs map to one App.test.tsx; many assertions target state helpers and deterministic probes instead of the real browser UI/audio graph, and one test codifies the generated-sample deviation.

### Technical gate

Passed.
