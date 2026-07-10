# GPT 5.6 Luna High — Stagebench evaluation

- Run: `gpt-5-6-luna-3`
- Status: complete
- Aggregate: **65/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 76 |
| 2 | Piano library and working effects | 64 |
| 3 | Complete Stage 4 system | 60 |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Generated Web Audio piano fallback: three deterministic oscillator partials per note (triangle fundamental, sine upper partials), per-note exponential attack/release, a 24-voice oldest-first limit, sustain-held release, and one AudioContext destination. No recording is claimed.
- Generated sound sources: basic-generated-piano
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No network, sample download, physical MIDI device, or real audio output is required by the tests.
- Audio note: Panel controls update normalized presentation state only; they do not alter the audio graph in Phase 1.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One lazy Web Audio AudioContext owns two Piano layer buses. Each enabled layer uses an offline-safe deterministic model profile with velocity, touch curve, dyn comp, timbre, unison, soft release, string resonance, octave, level, sustain ownership, and a six-unit wet/dry chain. The chains feed layer level, master gain, a DynamicsCompressor limiter, and exactly one destination. When Web Audio is unavailable, the UI remains playable as a labeled fallback and never reports the library as ready.
- Generated sound sources: Grand model profile; Upright model profile; Electric model profile; Clav model profile; Digital model profile; Misc model profile
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: The phase inputs provide no bundled, redistributable recorded Grand, Upright, or Electric files, so this candidate does not falsely claim recordings or invent licenses.
- Audio note: No network, sample download, physical MIDI device, or audio output is required by the tests.
- Audio note: The fallback status is surfaced in the top rail and Piano status line; controls remain available without Web Audio.
- Audio note: The effect path uses generated impulse responses for Room/Booth/Spring/Stage/Hall/Cathedral and real Delay, WaveShaper, DynamicsCompressor, and layer/master nodes.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One lazy PianoAudioEngine AudioContext owns Piano, Organ, and Synth source buses, inherited ordered effect units, one master gain, one limiter, and one destination. Piano uses deterministic generated model profiles; Organ uses model-specific harmonic banks and drawbar weights; Synth uses live oscillators, filters, envelopes, LFO modulation, and deterministic control state.
- Generated sound sources: Piano model profiles; Organ model profiles; Synth sources; Reverb impulses
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: The supplied Phase 2 artifact contained no redistributable recorded Grand/Upright/Electric files; the candidate truthfully retains generated profiles and labeled fallback behavior.
- Audio note: Organ and Synth share the single engine context and final master path; no second AudioContext is created.
- Audio note: Browser MIDI, timing, storage, and Web Audio boundaries remain injectable/optional; denied MIDI and missing Web Audio are surfaced honestly.

## Phase 1: Complete surface and basic piano

**76/100**

A clean, honest Phase 1 recreation of the Nord Stage 4 73 surface. The desktop capture (stage1-desktop.png) shows a continuous red chassis with the six sections in the correct left-to-right order (Performance, Organ, Piano, Program, Synth, Effects), dark inset panels, nine drawbars with LED ladders, and Program + Synth as the only OLED-style displays (matches the audit and hard gate). The keybed models 73 keys E-to-E (43 white / 30 black; whiteKeys length 43 in App.tsx). All panel controls are honestly presentation-only: they write only the normalized `hardware` map, displays are explicitly labeled DECORATIVE, and the footer reads '0 PRESENTATION CONTROLS'. I verified at runtime (served dist on 8751) that pressing a key created exactly one AudioContext and 3 oscillators (triangle + two sines) with status 'ready · generated piano', while dispatching input on a drawbar created zero audio nodes -- confirming the decorative boundary. Input handling is comprehensive: pointer with pointer-capture and per-pointerId source keys (multitouch), computer keyboard with repeat suppression, Web MIDI (note/velocity/note-off/CC64, statechange disconnect clears notes), space/CC64 sustain, and blur/unmount cleanup, all through one activeSources lifecycle. Voice management includes velocity, exponential release, 24-voice oldest-first stealing, and disconnect cleanup. IMPLEMENTATION_DETAILS.json truthfully declares a generated synthesis source with no recorded-sample claim. Main limitations: the geometry is a stylized simplification of the far denser reference, knobs move only by click-increment and keyboard (no pointer drag), and candidate tests assert DOM state rather than the audio boundary (jsdom has no AudioContext).

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 75 |
| Basic Piano functionality | 25% | 75 |
| Surface interaction and honesty | 15% | 86 |
| Engineering quality | 15% | 75 |

### Priority issues

- Piano source is generated synthesis only (honestly declared) -- acceptable for Phase 1's basic-voice scope but no recorded sample.
- Knobs move only via click-increment and keyboard; no pointer drag gesture for continuous controls.
- Candidate tests assert DOM/aria state, not the Web Audio backend (jsdom limitation).
- Surface geometry is a stylized simplification of the substantially denser reference panel.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**64/100**

Phase 2 makes the Piano and Layer Effects sections genuinely functional through a real single-AudioContext graph, while Organ/Synth/Program stay decorative (correct scope). Verified at runtime (dist on 8752): pressing a key created exactly one AudioContext with 4 oscillators (Grand's 4 harmonics, piano-only -- organ/synth silent), plus 2 ConvolverNodes, 2 DelayNodes, 6 WaveShaperNodes and 3 DynamicsCompressors, i.e. a full per-layer ordered effect chain (mod1->mod2->delay->ampEq->compressor->reverb) feeding layer level -> master gain -> limiter -> one destination. Six piano types are selectable with distinct synthesized profiles (PROFILE harmonics/wave/brightness), and the performance controls (KB Touch curve, Dyn Comp, Timbre partial shaping, Unison detune, Soft Release, String Res) measurably alter rendered audio. THE MAJOR SHORTFALL against the Phase 2 hard gate: Grand/Upright/Electric are NOT bundled recorded sample sets -- there are no recordings at all; everything is runtime-generated. This is declared honestly (sampleSources: [], 'does not falsely claim recordings'), so it is not a dishonesty-zero, but the defining recorded-sample-library requirement is unmet. Additional gaps: Mod 1/Mod 2 are implemented as WaveShaper distortion curves rather than true time/pan modulation (chorus/flanger/phaser/tremolo character is not modeled); the Rotary is only a gain redirect to master (no Leslie modulation); and a gain-staging bug leaves the piano input connected directly to the layer level node AND through the effect chain (input.connect(level) in ensureGraph plus current.connect(level) in buildUnits), so an always-on dry path runs in parallel with the chain, roughly doubling piano level and preventing a clean fully-wet or bypassed sound. Candidate tests assert DOM/aria state only, not the audio boundary.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 75 |
| Piano library and performance | 35% | 60 |
| Effects and signal graph | 30% | 63 |
| System behavior and UX | 10% | 75 |
| Engineering quality | 15% | 60 |

### Priority issues

- Hard-gate failure: Grand/Upright/Electric are generated synthesis, not bundled recorded sample sets (no recordings exist); honestly declared but the core Phase 2 requirement is unmet.
- Mod 1/Mod 2 are WaveShaper distortion, not true modulation effects; Rotary is a gain redirect with no Leslie modulation.
- Gain-staging bug: piano input is connected directly to the layer level node in addition to routing through the effect chain, creating an always-on parallel dry path (roughly doubles piano level; prevents clean fully-wet/bypass).
- Candidate tests assert DOM state only; no real Web Audio boundary tests (routing/bypass/cleanup unverified by tests).
- AudioContext/platform APIs are not injectable, limiting deterministic backend testing.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**60/100**

Phase 3 turns the whole instrument into one serializable state object (EngineState) driven by a single extended PianoAudioEngine. Verified at runtime (dist on 8753): pressing one key created exactly ONE AudioContext and 15 oscillators = piano A (4 harmonics) + organ A B3 (9 partials) + synth A (1 osc) + 1 LFO, alongside 2 convolvers / 2 delays / 6 waveshapers / 3 compressors, all feeding master -> limiter -> one destination. So all three engines share the single context and master path with no second AudioContext. Organ models use genuinely distinct partial banks (B3/Vox/Farf/Pipe, Farf on square) and drawbars multiply partial weights; key click is a real transient. Synth has real biquad filters, amp envelope, LFO routing (filter/pitch), and unison detune. The Program system implements 32 slots + 8 Live slots with Store/Store As naming, dirty 'E' indicator, load/discard, split zones (zoneAllows routes audio by note), two scenes, Wheel/Control-Pedal morph, transpose +/-6, master-clock tap, and Panic. HOWEVER significant completeness gaps remain: (1) Synth source CATEGORIES are not audibly distinct -- waveType() collapses Sync Saw / Multi Saw / Super Saw all to a plain sawtooth and FM 2-op to a sine, so Sync/Multi/Super/FM-H are renamed copies of one oscillator (fails the distinct-source hard gate for the synth). (2) The arpeggiator/gate is not implemented (no scheduler); voice modes (Mono/Legato), glide, and synth vibrato update state but produce no audio behavior. (3) Organ percussion (soft/fast/3rd), vibrato/chorus, and rotary are non-audible -- the rotary effect is never built in the engine at all. (4) Organ and Synth buses route input->level->master and BYPASS the effect chain entirely (effect units are built only for piano A/B), so inherited effects and rotary do not process organ/synth. (5) The Phase 2 parallel-dry-path gain-staging bug persists. (6) Morph destinations are hardcoded (wheel->piano A level, pedal->synth A filter) rather than assignable; scenes only toggle layer enables; split crossfade value is stored but not applied as an audible gain crossfade. Visually the desktop capture is dense but shows some label/control overlap in the Synth and Program areas, and the 390px narrow capture is noticeably crowded with overlapping controls. Console was clean (favicon 404 only). Honesty is well maintained: spec-excluded controls are disclosed in a UI details panel and no recorded-sample provenance is falsely claimed. Candidate tests remain DOM/aria assertions, not real audio-boundary tests, and App.tsx is written as extremely dense single-line components (maintainability concern).

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 62 |
| Complete feature system | 35% | 56 |
| Audio quality and integration | 30% | 57 |
| Full-system behavior | 20% | 67 |
| Engineering quality | 10% | 66 |

### Priority issues

- Distinct-source hard gate partially failed: synth Sync/Multi/Super categories all render as a plain sawtooth and FM 2-op as a sine (waveType collapses them) -- renamed copies of one oscillator; organ models are genuinely distinct.
- Arpeggiator/Gate is unimplemented (no scheduler); synth voice modes (Mono/Legato), glide, and vibrato, and organ percussion/vibrato-chorus/rotary update state but produce no audible behavior.
- Organ and Synth buses bypass the inherited effect chain and rotary entirely (effects built only for piano A/B), so shared effects/Rotary do not process organ/synth.
- Performance systems are shallow: morph destinations hardcoded (not assignable), scenes only toggle layer enables, split crossfade stored but not audibly applied; morph/clock/transpose not saved per program.
- Phase 2 parallel-dry-path gain-staging bug persists; narrow (390px) layout is crowded with overlapping controls; candidate tests assert DOM state only, not the audio backend.

### Technical gate

Passed.
