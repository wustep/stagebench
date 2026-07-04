# Claude Opus 4.8 — Stagebench evaluation

- Run: `claude-opus-4-8`
- Status: complete
- Aggregate: **88/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 87 |
| 2 | Piano library and working effects | 87 |
| 3 | Complete Stage 4 system | 88 |

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

**87/100**

A strong, honest Phase 1. The desktop capture renders one continuous deep-red chassis with the correct left-to-right section order (Performance/wheels -> Organ -> Piano -> Program+OLED -> Synth+OLED -> Layer Effects), a 54/46 deck/keybed split, and an exact 73-key E1-E7 keybed (43 white + 30 black, verified in code and math). Program and Synth carry the only two primary OLEDs, satisfying that hard gate. Section landmarks are dense and faithful: nine footage-labelled drawbars with LED ladders, piano selectors, the central program navigation cluster, the dense synth deck, and the effects column. The main visual gap is section widths: the code uses the coarse fractions from prompts/stage1.md (piano 0.15, program 0.09, synth 0.21) which the current specs/nord-stage-4.visual.json (corrected 2026-07-04) now overrides with piano 0.085, program 0.125, synth 0.25 at tolerance 0.025 — so Piano renders visibly too wide and Program too narrow vs the reference photo, though the candidate faithfully followed the prompt values it was given. Audio is honest real-time additive synthesis, declared truthfully as generated (not recorded) in IMPLEMENTATION_DETAILS.json, matching webAudioBackend.ts. The note lifecycle is excellent: one shared NoteRouter funnels pointer/multitouch/computer-keyboard/MIDI through a PianoEngine with velocity-squared gain, per-note release, CC64 sustain hold, deterministic oldest-first voice stealing at 16 voices, and blur/disconnect/unmount cleanup. All panel controls are presentation-only in a normalized ControlStore that touches no audio, and tests explicitly prove a toggled button/turned knob creates zero tones. The status bar states the honesty contract in plain text. Tests are deterministic and assert against the real engine/router boundary through an injectable fake backend (velocity direction, sustain hold, stealing, cleanup, MIDI denied/disconnected, repeat suppression). Narrow (390x844) preserves true proportions via horizontal scroll rather than reflow, disclosed honestly, so the whole surface is not visible in one frame. Captures record zero console errors and zero page errors.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 71 |
| Basic Piano functionality | 25% | 100 |
| Surface interaction and honesty | 15% | 100 |
| Engineering quality | 15% | 100 |

### Priority issues

- Section widths follow the coarse prompt values (piano 0.15, program 0.09, synth 0.21) while the current specs/nord-stage-4.visual.json (corrected 2026-07-04, tolerance 0.025) specifies piano 0.085, program 0.125, synth 0.25; Piano renders visibly too wide and Program too narrow vs reference/nord-stage-4-73.jpg. The candidate faithfully followed the prompt it was given.
- Narrow (390x844) uses horizontal scroll rather than reflow, so only the far-left chassis + Organ + keybed start are visible in a single frame; inspection of the full surface requires scrolling. Disclosed honestly in stage1-visual-audit.md.
- Effects modulation blocks are labelled Mod 1 / Mod 2 where the reference silk-screen reads Effect 1 / Effect 2 (inventory equivalent); chassis hue is a slightly muted maroon vs the brighter Nord red.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**87/100**

A strong, honest Phase 2. Grand/Upright/Electric are genuinely recorded, distinct, offline-bundled CC-BY sample sets (30 real MP3 root notes each, distinct hashes) with complete provenance; Clav/Digital/Misc are honestly declared synthesis. The audio graph is textbook: one AudioContext, per-layer buses, the exact documented ordered chain (Mod1->Mod2->Delay->Amp/EQ->Comp->Reverb), shared Rotary after reverb, master gain -> limiter -> one destination, StrictMode-safe context ownership and clean teardown. All seven effect units are real Web Audio subgraphs with distinct per-type processing, working bypass/dry-wet, an in-loop delay feedback filter, and To Rotary rerouting. 126 real-boundary OfflineAudioContext tests pass (no mocks) and typecheck/lint are clean. The visual surface is faithfully retained from Phase 1. The main gap: String Res is a spec-required performance control that is stored but never bound to audio (effectively decorative), and IMPLEMENTATION_DETAILS mildly overstates that all functional piano controls change audio.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 75 |
| Piano library and performance | 35% | 82 |
| Effects and signal graph | 30% | 100 |
| System behavior and UX | 10% | 75 |
| Engineering quality | 15% | 93 |

### Priority issues

- String Res is listed in piano.json scope.required and is carried into PerformanceParams.stringRes and bound in controlBindings, but it never affects any audio node — the control is effectively decorative, and no test asserts it changes audio.
- IMPLEMENTATION_DETAILS.json states 'all functional Piano controls ... change rendered audio' and lists String Res under functional.piano, a mild overstatement given String Res produces no audible change.
- Narrow (390x844) retention relies on horizontal scroll inside the chassis container rather than reflow, so the right-hand sections (incl. much of Layer Effects) are off-screen until scrolled.
- Recorded sets bundle a single velocity layer per root note (honestly declared); acceptable per spec but below true multi-velocity fidelity.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**88/100**

A strong, substantially complete Phase 3 system. All four package gates pass (168 tests across 19 files, typecheck clean, capture shows only the standard autoplay warning and zero page errors). Organ and Synth engines are genuinely distinct honest synthesis (declared truthfully in IMPLEMENTATION_DETAILS.json), not renamed generic oscillators, and all three sections render through one AudioContext into a single destination. Programs (32 + 8 Live), Store/Store As/dirty/edit-discard, splits/zones/crossfades, two scenes, and Wheel/Control-Pedal morphs are fully wired with real-time interpolation and lossless JSON round-trip. The most material gap: the deterministic Arpeggiator/Gate is implemented and unit-tested as a standalone class but is NOT instantiated or driven inside the live AudioEngine note flow, so run/rate/direction/range/hold do not audibly sequence held notes in the running instrument (state + algorithm only). Minor honesty-neutral gaps: synth filter drive is computed then discarded (void drive), and LFO 'ctrl' destination maps to cutoff. Panel styling uses dark section plates where the reference uses blue-grey, but silhouette, chassis, keybed, inventory, and ordering are faithful.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 75 |
| Complete feature system | 35% | 87 |
| Audio quality and integration | 30% | 92 |
| Full-system behavior | 20% | 86 |
| Engineering quality | 10% | 93 |

### Priority issues

- Arpeggiator/Gate not wired into the live AudioEngine: the deterministic Arpeggiator class (clock.ts) is fully implemented and unit-tested but never instantiated in synthNoteOn or the App/input layer, so ARP RUN/RATE/RANGE/DIR/SYNC/HOLD set state without audibly sequencing held notes in the running instrument. This is the main functional gap against synth.arp-gate.
- Synth filter drive knob is computed then discarded (void drive in synthEngine.configureFilter), so the drive control does not shape the filter/amp signal despite being declared functional.
- LFO 'ctrl' destination maps to cutoff rather than Osc Ctrl (applyLfo), a minor fidelity approximation.
- Deck section plates render dark where reference/nord-stage-4-73.jpg uses blue-grey panels; silhouette/inventory/ordering are otherwise faithful. Synth OLED 'Super Saw' label overflows slightly at 1440px (self-noted, cosmetic).

### Technical gate

Passed.
