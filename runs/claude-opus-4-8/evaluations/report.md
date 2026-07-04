# Claude Opus 4.8 — Stagebench evaluation

- Run: `claude-opus-4-8`
- Status: complete
- Aggregate: **86/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 88 |
| 2 | Piano library and working effects | 87 |
| 3 | Complete Stage 4 system | 84 |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One basic piano voice produced by honest real-time synthesis in a single Web Audio AudioContext. Each note is a small additive oscillator stack (a triangle fundamental, a slightly detuned sine for body, and sine partials at the octave and twelfth) shaped by a per-note gain envelope. Velocity scales the peak gain on a squared curve; note-off applies a per-note linear release; sustain (UI/keyboard/MIDI CC64) holds released notes until the damper lifts. All voices route through one master gain into a DynamicsCompressor acting as a soft limiter, then to the single AudioContext.destination. Polyphony is bounded (16 voices) with deterministic oldest-first voice stealing. There are NO recorded samples in this phase.
- Generated sound sources: Phase 1 basic piano voice
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded sample sets are bundled in Phase 1. Grand/Upright/Electric recorded sample sets are Phase 2 scope.
- Audio note: The audio boundary is injectable (src/audio/types.ts). Tests use src/audio/fakeBackend.ts — no real AudioContext, no audio output, no network, no MIDI device.
- Audio note: If no AudioContext is available, the app enters a truthful, labeled silent 'fallback' status that still tracks the note lifecycle and never reports the primary voice as ready.
- Audio note: Every panel control other than the keybed and sustain input is honestly decorative: it moves/presses and stores presentation-only state (src/state/controlStore.ts). No decorative control produces audio or mutates program/effect/system state (honesty contract).

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `node-web-audio-api` ^2.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One AudioContext (src/audio/audioEngine.ts). Two Piano layers (A, B) each own their voices and route only to their own layer bus. Each layer bus passes through an ordered effect chain — Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ (or Filter) -> Compressor -> Reverb — then a per-layer level gain into the master gain -> DynamicsCompressor limiter -> the single AudioContext.destination. A single shared Rotary sits AFTER reverb (reverb always precedes rotary); a layer whose Amp Sim/EQ model is 'To Rotary' has its post-reverb signal rerouted into the shared rotary and out of the normal master path. Grand/Upright/Electric play RECORDED multi-sampled buffers (nearest recorded root, playback-rate pitch, <=1 semitone shift); Clav/Digital/Misc play HONEST SYNTHESIS. KB Touch, Dyn Comp, Timbre, Unison, and Soft Release shape each voice; sustain (UI/keyboard/MIDI CC64) holds released notes per layer only when that layer's SUSTPED is on. Every functional Piano, Layer-Effects, and Master control maps to real audio via src/audio/controlBindings.ts; Organ, Synth, and Program controls are not bound and stay decorative. Parameter changes use short ~20ms ramps to avoid clicks; voices, effect units, and the AudioContext are all cleaned up on release/teardown.
- Generated sound sources: Clav (Clavinet D6) voice; Digital (Digital Grand) voice; Misc (Vibraphone / mallet) voice; Layer effect units
- Recorded sample provenance: Grand — FluidR3_GM acoustic_grand_piano (public/samples/grand) — FluidR3_GM acoustic_grand_piano pre-rendered by gleitz/midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts); FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts. (CC-BY-3.0); Upright — FluidR3_GM honkytonk_piano (public/samples/upright) — FluidR3_GM honkytonk_piano pre-rendered by gleitz/midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts); FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts. (CC-BY-3.0); Electric — FluidR3_GM electric_piano_1 (public/samples/electric) — FluidR3_GM electric_piano_1 pre-rendered by gleitz/midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts); FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts. (CC-BY-3.0)
- Bundled audio files: `public/samples/electric/A0.mp3` (20.5 KB), `public/samples/electric/A1.mp3` (22.3 KB), `public/samples/electric/A2.mp3` (20.2 KB), `public/samples/electric/A3.mp3` (23.2 KB), `public/samples/electric/A4.mp3` (18.1 KB), `public/samples/electric/A5.mp3` (17.0 KB), `public/samples/electric/A6.mp3` (14.4 KB), `public/samples/electric/A7.mp3` (13.6 KB), `public/samples/electric/C1.mp3` (21.4 KB), `public/samples/electric/C2.mp3` (21.8 KB), `public/samples/electric/C3.mp3` (20.0 KB), `public/samples/electric/C4.mp3` (19.1 KB), `public/samples/electric/C5.mp3` (19.3 KB), `public/samples/electric/C6.mp3` (17.4 KB), `public/samples/electric/C7.mp3` (14.4 KB), `public/samples/electric/C8.mp3` (13.6 KB), `public/samples/electric/Eb1.mp3` (21.2 KB), `public/samples/electric/Eb2.mp3` (21.2 KB), `public/samples/electric/Eb3.mp3` (19.9 KB), `public/samples/electric/Eb4.mp3` (19.9 KB), `public/samples/electric/Eb5.mp3` (19.5 KB), `public/samples/electric/Eb6.mp3` (16.9 KB), `public/samples/electric/Eb7.mp3` (14.1 KB), `public/samples/electric/Gb1.mp3` (22.3 KB), `public/samples/electric/Gb2.mp3` (20.4 KB), `public/samples/electric/Gb3.mp3` (21.4 KB), `public/samples/electric/Gb4.mp3` (16.7 KB), `public/samples/electric/Gb5.mp3` (19.1 KB), `public/samples/electric/Gb6.mp3` (15.6 KB), `public/samples/electric/Gb7.mp3` (14.0 KB), `public/samples/grand/A0.mp3` (25.0 KB), `public/samples/grand/A1.mp3` (25.0 KB), `public/samples/grand/A2.mp3` (25.0 KB), `public/samples/grand/A3.mp3` (25.0 KB), `public/samples/grand/A4.mp3` (25.0 KB), `public/samples/grand/A5.mp3` (18.5 KB), `public/samples/grand/A6.mp3` (15.0 KB), `public/samples/grand/A7.mp3` (14.2 KB), `public/samples/grand/C1.mp3` (25.0 KB), `public/samples/grand/C2.mp3` (25.0 KB), `public/samples/grand/C3.mp3` (25.0 KB), `public/samples/grand/C4.mp3` (25.0 KB), `public/samples/grand/C5.mp3` (25.0 KB), `public/samples/grand/C6.mp3` (18.9 KB), `public/samples/grand/C7.mp3` (14.6 KB), `public/samples/grand/C8.mp3` (14.0 KB), `public/samples/grand/Eb1.mp3` (25.0 KB), `public/samples/grand/Eb2.mp3` (25.0 KB), `public/samples/grand/Eb3.mp3` (25.0 KB), `public/samples/grand/Eb4.mp3` (25.0 KB), `public/samples/grand/Eb5.mp3` (24.2 KB), `public/samples/grand/Eb6.mp3` (17.5 KB), `public/samples/grand/Eb7.mp3` (14.6 KB), `public/samples/grand/Gb1.mp3` (25.0 KB), `public/samples/grand/Gb2.mp3` (25.0 KB), `public/samples/grand/Gb3.mp3` (25.0 KB), `public/samples/grand/Gb4.mp3` (25.0 KB), `public/samples/grand/Gb5.mp3` (23.9 KB), `public/samples/grand/Gb6.mp3` (16.8 KB), `public/samples/grand/Gb7.mp3` (14.3 KB), `public/samples/upright/A0.mp3` (25.0 KB), `public/samples/upright/A1.mp3` (25.0 KB), `public/samples/upright/A2.mp3` (25.0 KB), `public/samples/upright/A3.mp3` (25.0 KB), `public/samples/upright/A4.mp3` (25.0 KB), `public/samples/upright/A5.mp3` (18.1 KB), `public/samples/upright/A6.mp3` (15.0 KB), `public/samples/upright/A7.mp3` (14.2 KB), `public/samples/upright/C1.mp3` (25.0 KB), `public/samples/upright/C2.mp3` (25.0 KB), `public/samples/upright/C3.mp3` (25.0 KB), `public/samples/upright/C4.mp3` (25.0 KB), `public/samples/upright/C5.mp3` (24.9 KB), `public/samples/upright/C6.mp3` (18.3 KB), `public/samples/upright/C7.mp3` (14.5 KB), `public/samples/upright/C8.mp3` (14.0 KB), `public/samples/upright/Eb1.mp3` (25.0 KB), `public/samples/upright/Eb2.mp3` (25.0 KB), `public/samples/upright/Eb3.mp3` (25.0 KB), `public/samples/upright/Eb4.mp3` (25.0 KB), `public/samples/upright/Eb5.mp3` (23.5 KB), `public/samples/upright/Eb6.mp3` (17.0 KB), `public/samples/upright/Eb7.mp3` (14.5 KB), `public/samples/upright/Gb1.mp3` (25.0 KB), `public/samples/upright/Gb2.mp3` (25.0 KB), `public/samples/upright/Gb3.mp3` (25.0 KB), `public/samples/upright/Gb4.mp3` (25.0 KB), `public/samples/upright/Gb5.mp3` (23.4 KB), `public/samples/upright/Gb6.mp3` (16.6 KB), `public/samples/upright/Gb7.mp3` (14.3 KB)
- Audio note: The recorded sample sets are bundled under public/samples/ and load offline (no network at runtime). scripts/fetch-samples.mjs reproducibly re-downloads them; provenance is echoed in each set's manifest.json and public/samples/LICENSE.txt.
- Audio note: Each recorded set uses 30 root notes spaced a minor third apart, so playback pitch-shifts a note by at most ~1 semitone (no obvious stretching). Only a single recorded velocity layer per root note is bundled; velocity/KB-Touch/Dyn-Comp shaping at play time is declared honestly and is NOT presented as multiple recorded velocity layers.
- Audio note: If a sample set fails to load, the engine reports a labeled playable fallback (StatusBar) and plays the synthesized 'digital' recipe instead of pretending recordings exist.
- Audio note: Master Level, all functional Piano controls, and all Layer-Effects controls change rendered audio and agree with their panel feedback (tests: tests/instruments.test.ts, tests/pianoControls.test.ts, tests/effects.test.ts, tests/controlBindings.test.ts).
- Audio note: The audio boundary is exercised in tests with node-web-audio-api's OfflineAudioContext (real rendered signals), not mocks. The Phase-1 fake backend (src/audio/fakeBackend.ts) still backs the preserved Phase-1 tests.
- Audio note: Organ, Synth, and Program controls remain honestly decorative in Phase 2: they move/press and store presentation-only state (src/state/controlStore.ts) and are not bound in src/audio/controlBindings.ts.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `node-web-audio-api` ^2.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One AudioContext (src/audio/audioEngine.ts). Piano (A,B), Organ (A,B), and Synth (A,B,C) layers each own their voices and route into per-layer effect chains (LayerChain) — Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ (or Filter) -> Compressor -> Reverb — then a per-layer level gain into the master gain -> DynamicsCompressor limiter -> the single AudioContext.destination. A single shared Rotary sits AFTER reverb; a layer whose Amp Sim/EQ model is 'To Rotary' (and the routed Organ) reroutes its post-reverb signal into the shared rotary. Grand/Upright/Electric play RECORDED multi-sampled buffers; Clav/Digital/Misc AND every Organ (B3/Vox/Farf/Pipe) and Synth (Pure/Sync/Multi/Super/FM-H) voice play HONEST SYNTHESIS (declared below), never recordings. Splits (up to 4 zones, 3 points, Off/±6/±12 crossfades), Layer Scenes I/II, and a per-note routing gate decide which section-layers sound. Wheel/Control-Pedal morphs interpolate assigned destinations through the ControlStore. A MasterClock (tap/dial) syncs the deterministic arpeggiator, synth LFO, delay, and Mod 1. Transpose (±6) shifts the whole instrument; Panic is an internal All Notes Off. Every functional Piano/Organ/Synth/Layer-Effects/Master/Program control maps to real audio or system state (src/audio/controlBindings.ts, src/audio/sectionBindings.ts, src/state/programManager.ts); only spec-excluded controls stay decorative and are listed in decorativeControls. Parameter changes use short ~20ms ramps; voices, effect units, LFOs, and the AudioContext are all cleaned up on release/teardown.
- Generated sound sources: Organ engines (B3, Vox, Farf, Pipe 1/2, B3 Bass); Synth engine (Pure, Sync, Multi, Super, FM-H); Clav (Clavinet D6) voice; Digital (Digital Grand) voice; Misc (Vibraphone / mallet) voice; Layer effect units
- Recorded sample provenance: Grand — FluidR3_GM acoustic_grand_piano (public/samples/grand) — FluidR3_GM acoustic_grand_piano pre-rendered by gleitz/midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts); FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts. (CC-BY-3.0); Upright — FluidR3_GM honkytonk_piano (public/samples/upright) — FluidR3_GM honkytonk_piano pre-rendered by gleitz/midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts); FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts. (CC-BY-3.0); Electric — FluidR3_GM electric_piano_1 (public/samples/electric) — FluidR3_GM electric_piano_1 pre-rendered by gleitz/midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts); FluidR3_GM SoundFont by Frank Wen, CC-BY 3.0; pre-rendered by gleitz/midi-js-soundfonts. (CC-BY-3.0)
- Bundled audio files: `public/samples/electric/A0.mp3` (20.5 KB), `public/samples/electric/A1.mp3` (22.3 KB), `public/samples/electric/A2.mp3` (20.2 KB), `public/samples/electric/A3.mp3` (23.2 KB), `public/samples/electric/A4.mp3` (18.1 KB), `public/samples/electric/A5.mp3` (17.0 KB), `public/samples/electric/A6.mp3` (14.4 KB), `public/samples/electric/A7.mp3` (13.6 KB), `public/samples/electric/C1.mp3` (21.4 KB), `public/samples/electric/C2.mp3` (21.8 KB), `public/samples/electric/C3.mp3` (20.0 KB), `public/samples/electric/C4.mp3` (19.1 KB), `public/samples/electric/C5.mp3` (19.3 KB), `public/samples/electric/C6.mp3` (17.4 KB), `public/samples/electric/C7.mp3` (14.4 KB), `public/samples/electric/C8.mp3` (13.6 KB), `public/samples/electric/Eb1.mp3` (21.2 KB), `public/samples/electric/Eb2.mp3` (21.2 KB), `public/samples/electric/Eb3.mp3` (19.9 KB), `public/samples/electric/Eb4.mp3` (19.9 KB), `public/samples/electric/Eb5.mp3` (19.5 KB), `public/samples/electric/Eb6.mp3` (16.9 KB), `public/samples/electric/Eb7.mp3` (14.1 KB), `public/samples/electric/Gb1.mp3` (22.3 KB), `public/samples/electric/Gb2.mp3` (20.4 KB), `public/samples/electric/Gb3.mp3` (21.4 KB), `public/samples/electric/Gb4.mp3` (16.7 KB), `public/samples/electric/Gb5.mp3` (19.1 KB), `public/samples/electric/Gb6.mp3` (15.6 KB), `public/samples/electric/Gb7.mp3` (14.0 KB), `public/samples/grand/A0.mp3` (25.0 KB), `public/samples/grand/A1.mp3` (25.0 KB), `public/samples/grand/A2.mp3` (25.0 KB), `public/samples/grand/A3.mp3` (25.0 KB), `public/samples/grand/A4.mp3` (25.0 KB), `public/samples/grand/A5.mp3` (18.5 KB), `public/samples/grand/A6.mp3` (15.0 KB), `public/samples/grand/A7.mp3` (14.2 KB), `public/samples/grand/C1.mp3` (25.0 KB), `public/samples/grand/C2.mp3` (25.0 KB), `public/samples/grand/C3.mp3` (25.0 KB), `public/samples/grand/C4.mp3` (25.0 KB), `public/samples/grand/C5.mp3` (25.0 KB), `public/samples/grand/C6.mp3` (18.9 KB), `public/samples/grand/C7.mp3` (14.6 KB), `public/samples/grand/C8.mp3` (14.0 KB), `public/samples/grand/Eb1.mp3` (25.0 KB), `public/samples/grand/Eb2.mp3` (25.0 KB), `public/samples/grand/Eb3.mp3` (25.0 KB), `public/samples/grand/Eb4.mp3` (25.0 KB), `public/samples/grand/Eb5.mp3` (24.2 KB), `public/samples/grand/Eb6.mp3` (17.5 KB), `public/samples/grand/Eb7.mp3` (14.6 KB), `public/samples/grand/Gb1.mp3` (25.0 KB), `public/samples/grand/Gb2.mp3` (25.0 KB), `public/samples/grand/Gb3.mp3` (25.0 KB), `public/samples/grand/Gb4.mp3` (25.0 KB), `public/samples/grand/Gb5.mp3` (23.9 KB), `public/samples/grand/Gb6.mp3` (16.8 KB), `public/samples/grand/Gb7.mp3` (14.3 KB), `public/samples/upright/A0.mp3` (25.0 KB), `public/samples/upright/A1.mp3` (25.0 KB), `public/samples/upright/A2.mp3` (25.0 KB), `public/samples/upright/A3.mp3` (25.0 KB), `public/samples/upright/A4.mp3` (25.0 KB), `public/samples/upright/A5.mp3` (18.1 KB), `public/samples/upright/A6.mp3` (15.0 KB), `public/samples/upright/A7.mp3` (14.2 KB), `public/samples/upright/C1.mp3` (25.0 KB), `public/samples/upright/C2.mp3` (25.0 KB), `public/samples/upright/C3.mp3` (25.0 KB), `public/samples/upright/C4.mp3` (25.0 KB), `public/samples/upright/C5.mp3` (24.9 KB), `public/samples/upright/C6.mp3` (18.3 KB), `public/samples/upright/C7.mp3` (14.5 KB), `public/samples/upright/C8.mp3` (14.0 KB), `public/samples/upright/Eb1.mp3` (25.0 KB), `public/samples/upright/Eb2.mp3` (25.0 KB), `public/samples/upright/Eb3.mp3` (25.0 KB), `public/samples/upright/Eb4.mp3` (25.0 KB), `public/samples/upright/Eb5.mp3` (23.5 KB), `public/samples/upright/Eb6.mp3` (17.0 KB), `public/samples/upright/Eb7.mp3` (14.5 KB), `public/samples/upright/Gb1.mp3` (25.0 KB), `public/samples/upright/Gb2.mp3` (25.0 KB), `public/samples/upright/Gb3.mp3` (25.0 KB), `public/samples/upright/Gb4.mp3` (25.0 KB), `public/samples/upright/Gb5.mp3` (23.4 KB), `public/samples/upright/Gb6.mp3` (16.6 KB), `public/samples/upright/Gb7.mp3` (14.3 KB)
- Audio note: The recorded sample sets are bundled under public/samples/ and load offline (no network at runtime). scripts/fetch-samples.mjs reproducibly re-downloads them; provenance is echoed in each set's manifest.json and public/samples/LICENSE.txt.
- Audio note: Each recorded set uses 30 root notes spaced a minor third apart, so playback pitch-shifts a note by at most ~1 semitone (no obvious stretching). Only a single recorded velocity layer per root note is bundled; velocity/KB-Touch/Dyn-Comp shaping at play time is declared honestly and is NOT presented as multiple recorded velocity layers.
- Audio note: If a sample set fails to load, the engine reports a labeled playable fallback (StatusBar) and plays the synthesized 'digital' recipe instead of pretending recordings exist.
- Audio note: Master Level, all functional Piano controls, and all Layer-Effects controls change rendered audio and agree with their panel feedback (tests: tests/instruments.test.ts, tests/pianoControls.test.ts, tests/effects.test.ts, tests/controlBindings.test.ts).
- Audio note: The audio boundary is exercised in tests with node-web-audio-api's OfflineAudioContext (real rendered signals), not mocks. The Phase-1 fake backend (src/audio/fakeBackend.ts) still backs the preserved Phase-1 tests.
- Audio note: Phase 3: Organ and Synth engines are honest synthesis (declared under generatedSources) and route through the same single-context Phase-2 effect graph; no second AudioContext exists. Program state (src/state/program.ts) is a serializable snapshot of every supported control plus performance state (splits, zones, crossfades, scenes, morphs, master clock, transpose); Master Level is excluded. The ProgramManager (src/state/programManager.ts) owns 32 slots + 8 auto-storing Live slots with the dirty (E) lifecycle and Store/Store As.
- Audio note: Phase-3 rendered-audio and system tests: tests/organEngine.test.ts, tests/synthEngine.test.ts, tests/program.test.ts, tests/integration.test.ts. Every inherited Phase-1 and Phase-2 test is preserved (regression-free).

## Phase 1: Complete surface and basic piano

**88/100**

A strong, honest Phase 1. The desktop capture is a faithful reproduction of the 73-key Nord Stage 4: continuous red chassis, correct left-to-right section order (Master/wheels/Rotary, Organ, Piano, central Program OLED, Synth OLED, Layer Effects), full E1-E7 keybed with correct 43-white/30-black pattern, red drawbar LED ladders with correct footage labels, and Program+Synth as the only two primary OLEDs. The control inventory is deep (140 stable-ID controls across all six sections). The one dependable piano voice is honest real-time additive synthesis through a single AudioContext -> master gain -> limiter -> destination, with truthful IMPLEMENTATION_DETAILS declaring no recorded samples. The note lifecycle (velocity, release, retrigger, sustain, deterministic oldest-first stealing, cleanup) is real and asserted via a fake-backend on measurable tone events. Every panel control is genuinely decorative (presentation-only store that mutates no audio/system state) and this is stated to the user in the status bar. All four gates pass; both captures render with zero console messages/page errors. Main gaps: narrow view uses horizontal scroll rather than reflow (whole surface not visible at once), a slightly muted chassis hue, and minor keybed bevel/rail simplifications, all disclosed honestly in the visual audit.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 83 |
| Basic Piano functionality | 25% | 91 |
| Surface interaction and honesty | 15% | 86 |
| Engineering quality | 15% | 100 |

### Priority issues

- Narrow (390x844) layout relies on horizontal scroll rather than reflow, so the full hardware surface is not visible in a single frame (disclosed in stage1-visual-audit.md).
- Chassis hue is a slightly muted maroon rather than the reference's more saturated Nord red.
- Minor material simplifications: keybed rendered without front-lip bevel; rear/top I/O rail not modeled (out of scope for the playable front surface).
- Layer Effects modulation blocks labeled Mod 1 / Mod 2 where the reference silk-screen reads Effect 1 / Effect 2 (control inventory is equivalent).

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**87/100**

A very strong, honest Phase 2. Six selectable Piano types: Grand/Upright/Electric are genuinely recorded multi-sampled sets (30 real MP3 root notes each, ~20-25KB per file, FluidR3_GM via gleitz/midi-js-soundfonts, CC-BY-3.0, full provenance in IMPLEMENTATION_DETAILS + per-set manifest.json + LICENSE), loaded offline via real createBufferSource + playbackRate pitch-shift (<=1 semitone). Clav/Digital/Misc are honest synthesis, correctly declared. The single-velocity-layer limitation is disclosed truthfully rather than faked as multi-layer. The audio graph is the real deal: one BaseAudioContext, per-layer buses A/B, ordered chain Mod1->Mod2->Delay->Amp/EQ->Comp->Reverb, shared post-reverb Rotary, master gain -> DynamicsCompressor limiter -> one destination, with To-Rotary reroute and per-layer voice ownership/stealing. Effects are real Web Audio subgraphs and are asserted on rendered signals via OfflineAudioContext (tremolo amplitude vs bypass, stereo width, delay repeats + in-loop feedback filtering, reverb tails growing Booth->Cathedral, rotary moving stereo, per-unit bypass, chain order, To-Rotary routing). Piano controls (KB Touch, Dyn Comp, Timbre, Unison, Soft Release, per-layer level/octave/SUSTPED) all change rendered audio and are tested. Organ/Synth/Program stay honestly decorative and this is asserted (controlBindings test confirms no binding). All four gates pass. Console shows only benign autoplay-policy warnings (AudioContext needs a user gesture); zero page errors. Main gaps: narrow layout still relies on horizontal scroll; recorded sets are a single velocity layer (honestly disclosed but a fidelity ceiling); effect visual-state feedback is functional but modest.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 75 |
| Piano library and performance | 35% | 82 |
| Effects and signal graph | 30% | 100 |
| System behavior and UX | 10% | 75 |
| Engineering quality | 15% | 93 |

### Priority issues

- Recorded Grand/Upright/Electric sets are a single velocity layer per root note; dynamic timbre is gain/filter-shaped at play time rather than multi-layer recorded (disclosed honestly, but a fidelity ceiling vs the real instrument).
- Narrow (390x844) layout still relies on horizontal scroll rather than reflow, inheriting the Phase-1 limitation.
- Effect/parameter visual-state feedback is functional but modest relative to the sonic depth; richer display readouts would strengthen audibleFeedback.
- Reverb impulse responses are generated (seeded PRNG) rather than recorded IRs (disclosed, acceptable, but not convolved real spaces).

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**84/100**

An ambitious and largely complete Phase 3 that ships the full Stage 4 system through the single inherited Phase-2 audio graph and backs almost everything with real-boundary tests. Organ: four spectrally distinct engines (B3 tonewheel with drawbar-footage sine partials + leakage + key click + single-trigger percussion; Vox odd-harmonic reed; Farf buzzy register switches; Pipe flute ranks), nine drawbars driving each model's spectrum, vibrato/chorus depth scaling, and rotary routing that accelerates slow->fast into the shared post-reverb rotary. Synth: five genuinely different oscillator constructions (Pure single wave, Sync hard-sync, Multi detuned-saw stack, Super 7-voice supersaw, FM-H 2-op FM) with category-correct Osc Ctrl, LP12/LP24/HP/BP filters with tracking/res/drive, osc/filter/amp envelopes, a 5-waveform/3-destination LFO with clock sync, poly/mono/legato + glide + unison + vibrato, and a deterministic arpeggiator/gate driven by an injectable MasterClock (tap + dial). The Program system is a serializable ControlStore+PerformanceStore snapshot: 32 slots (4 pages x 8) plus 8 auto-storing Live slots, dial/page/list browsing, Store/Store As with naming, truthful dirty (E) and edit-discard, plus splits (zones/points/crossfades), Layer Scenes I/II, Wheel + Control-Pedal morphs (assign/interpolate/clear), Master Clock, Transpose +/-6, and Panic — all round-tripping losslessly with Master Level correctly excluded. All engines run in one AudioContext to one destination, and the honesty contract holds: Organ/Synth engines are declared honest synthesis (no recordings), every functional control is bound, and the only decorative controls are explicitly enumerated spec-exclusions. The corrected status strip truthfully states everything is live. All four gates pass; 38/38 features covered; zero page errors (console shows only benign autoplay-policy warnings). Main gaps: cosmetic text overflow/crowding in the central Program OLED strip at 1440px, recorded pianos remain single-velocity-layer (inherited), and the narrow layout keeps the horizontal-scroll strategy.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 75 |
| Complete feature system | 35% | 75 |
| Audio quality and integration | 30% | 92 |
| Full-system behavior | 20% | 86 |
| Engineering quality | 10% | 93 |

### Priority issues

- Cosmetic layout crowding in the central Program OLED strip at 1440px: the Synth 'Super Saw' readout overflows slightly and the Store/Live/Split labels overlap their buttons in the capture (disclosed as a known gap; does not obscure function).
- Recorded Grand/Upright/Electric pianos remain a single recorded velocity layer (inherited from Phase 2); dynamic timbre is gain/filter-shaped, honestly disclosed.
- Narrow (390x844) layout continues to rely on horizontal scroll rather than reflow (inherited from Phase 1/2).
- A set of spec-excluded controls (A.T. morph, Num Pad, Shift menus, organ Preset, Extern/Samples synth modes) are honestly listed as unsupported rather than implemented — correct per the honesty contract, but a scope boundary versus the full hardware.
- Extreme sustained-polyphony CPU/voice-load and long-run stability are not independently profiled in the sealed evidence beyond the passing test suite and clean captures.

### Technical gate

Passed.
