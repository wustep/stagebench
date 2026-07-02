# Fable 5 High — Stagebench evaluation

- Run: `claude-fable-5`
- Status: complete
- Classification: exploratory
- Validity: valid
- Aggregate: **92/100 · exceptional**
- Coverage: 2/2 phases

## Phase scores

| Phase | Scope | Score | Grade |
| --- | --- | ---: | --- |
| 1 | Complete surface and basic piano | 96 | exceptional |
| 2 | Piano library and working effects | 89 | strong |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Generated live synthesis (no recorded samples). Each note builds a small stack of detuned oscillator partials (triangle fundamental plus sine partials at 1x, 2x and ~3x) through a velocity- and pitch-keyed lowpass filter and a percussive exponential-decay gain envelope, into a shared master gain and DynamicsCompressor soft limiter, then one destination. Piano-like by design and honestly not a sampled piano.
- Generated sound sources: Basic piano-like oscillator voice
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded, downloaded, or bundled audio samples are used or claimed in Phase 1.
- Audio note: Audio starts lazily on the first key gesture; status is reported truthfully as idle/loading/ready/fallback/error in the status strip below the instrument.
- Audio note: Only keybed note input and the sustain input path (space bar, MIDI CC64) reach the audio graph. Every visible panel control is decorative presentation state only.
- Audio note: All browser boundaries (AudioContext factory, timers, Web MIDI access) are injectable; unit tests run against deterministic fakes and the real graph was exercised in headless Chrome.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@audio-samples/piano-mp3-velocity13` ^1.0.5, `@audio-samples/piano-mp3-velocity4` ^1.0.5, `@audio-samples/piano-mp3-velocity8` ^1.0.5, `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `node-web-audio-api` ^2.0.0, `oxlint` ^1.69.0, `playwright-core` ^1.61.1, `vitest` ^4.1.0, `web-music-score-samples` ^3.0.0
- Audio strategy: Sampled multi-piano instrument with a live-DSP effect chain. Primary sound: three bundled RECORDED sample sets (Grand/Upright/Electric) played through AudioBufferSourceNodes with nearest-root selection, recorded-velocity-layer crossfading (grand) or declared gain+filter velocity shaping (single-layer sets), unison detune copies, and per-voice envelopes. One AudioContext: voices enter per-layer buses (timbre EQ, dynamic compression, level), then the ordered per-layer effect chain Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb, then either the single Rotary Speaker instance (Amp unit 'To Rotary') or directly the master gain → limiter → one destination. All effects are live Web Audio processing (LFOs, modulated delays, biquads, waveshapers, convolution). The Phase 1 oscillator voice survives only as a clearly labeled synthesized fallback after primary sample failure.
- Generated sound sources: Synthesized fallback voice; Reverb impulse responses; String-resonance impulse and pedal-noise thump; Effect processing (Mod 1/Mod 2/Delay/Amp-EQ/Compressor/Rotary)
- Recorded sample provenance: Salamander Grand ('Grand' type) — Salamander Grand Piano V3 — Yamaha C5 recorded by Alexander Holm (archive.org/details/SalamanderGrandPianoV3), obtained exclusively through the npm registry packages @audio-samples/piano-mp3-velocity4, -velocity8 and -velocity13 (v1.0.5) and copied into public/samples/grand by scripts/sync-samples.mjs. (CC BY 3.0 — attribution: 'Salamander Grand Piano V3' by Alexander Holm.); Tack Upright ('Upright' type) — GM Honky-tonk piano program (detuned tack-upright character), note-per-note mp3 renders from the MIDI-JS Soundfonts collection (github.com/gleitz/midi-js-soundfonts, Benjamin Gleitzman), obtained via the npm registry package web-music-score-samples v3.0.0 (samples/003-honkytonk-piano) and copied into public/samples/upright. (MIT (MIDI-JS Soundfonts collection; repackaged MIT by web-music-score-samples).); Tine EP ('Electric' type) — GM Electric Piano 1 (tine/electromechanical character) from the same MIDI-JS Soundfonts collection via npm web-music-score-samples v3.0.0 (samples/004-electric-piano-1), copied into public/samples/electric. (MIT (MIDI-JS Soundfonts collection; repackaged MIT by web-music-score-samples).)
- Bundled audio files: `public/samples/electric/c1.mp3` (16.7 KB), `public/samples/electric/c2.mp3` (16.7 KB), `public/samples/electric/c3.mp3` (14.5 KB), `public/samples/electric/c4.mp3` (13.8 KB), `public/samples/electric/c5.mp3` (14.3 KB), `public/samples/electric/c6.mp3` (14.2 KB), `public/samples/electric/c7.mp3` (13.4 KB), `public/samples/electric/e1.mp3` (18.0 KB), `public/samples/electric/e2.mp3` (16.3 KB), `public/samples/electric/e3.mp3` (14.5 KB), `public/samples/electric/e4.mp3` (14.8 KB), `public/samples/electric/e5.mp3` (13.9 KB), `public/samples/electric/e6.mp3` (14.0 KB), `public/samples/electric/gs1.mp3` (18.5 KB), `public/samples/electric/gs2.mp3` (15.1 KB), `public/samples/electric/gs3.mp3` (14.2 KB), `public/samples/electric/gs4.mp3` (15.1 KB), `public/samples/electric/gs5.mp3` (14.1 KB), `public/samples/electric/gs6.mp3` (13.5 KB), `public/samples/grand/a0-l1.mp3` (301.7 KB), `public/samples/grand/a0-l2.mp3` (310.3 KB), `public/samples/grand/a0-l3.mp3` (325.1 KB), `public/samples/grand/a1-l1.mp3` (257.8 KB), `public/samples/grand/a1-l2.mp3` (300.5 KB), `public/samples/grand/a1-l3.mp3` (312.3 KB), `public/samples/grand/a2-l1.mp3` (237.6 KB), `public/samples/grand/a2-l2.mp3` (233.8 KB), `public/samples/grand/a2-l3.mp3` (238.3 KB), `public/samples/grand/a3-l1.mp3` (220.8 KB), `public/samples/grand/a3-l2.mp3` (226.0 KB), `public/samples/grand/a3-l3.mp3` (218.6 KB), `public/samples/grand/a4-l1.mp3` (169.1 KB), `public/samples/grand/a4-l2.mp3` (169.4 KB), `public/samples/grand/a4-l3.mp3` (175.0 KB), `public/samples/grand/a5-l1.mp3` (80.3 KB), `public/samples/grand/a5-l2.mp3` (132.5 KB), `public/samples/grand/a5-l3.mp3` (130.2 KB), `public/samples/grand/a6-l1.mp3` (68.1 KB), `public/samples/grand/a6-l2.mp3` (72.2 KB), `public/samples/grand/a6-l3.mp3` (74.8 KB), `public/samples/grand/a7-l1.mp3` (41.9 KB), `public/samples/grand/a7-l2.mp3` (43.3 KB), `public/samples/grand/a7-l3.mp3` (43.3 KB), `public/samples/grand/c1-l1.mp3` (281.2 KB), `public/samples/grand/c1-l2.mp3` (281.3 KB), `public/samples/grand/c1-l3.mp3` (287.5 KB), `public/samples/grand/c2-l1.mp3` (261.1 KB), `public/samples/grand/c2-l2.mp3` (306.7 KB), `public/samples/grand/c2-l3.mp3` (309.3 KB), `public/samples/grand/c3-l1.mp3` (204.4 KB), `public/samples/grand/c3-l2.mp3` (207.6 KB), `public/samples/grand/c3-l3.mp3` (211.3 KB), `public/samples/grand/c4-l1.mp3` (185.3 KB), `public/samples/grand/c4-l2.mp3` (214.0 KB), `public/samples/grand/c4-l3.mp3` (204.8 KB), `public/samples/grand/c5-l1.mp3` (167.0 KB), `public/samples/grand/c5-l2.mp3` (168.4 KB), `public/samples/grand/c5-l3.mp3` (170.1 KB), `public/samples/grand/c6-l1.mp3` (80.9 KB), `public/samples/grand/c6-l2.mp3` (93.7 KB), `public/samples/grand/c6-l3.mp3` (91.6 KB), `public/samples/grand/c7-l1.mp3` (46.7 KB), `public/samples/grand/c7-l2.mp3` (47.4 KB), `public/samples/grand/c7-l3.mp3` (54.9 KB), `public/samples/grand/c8-l1.mp3` (39.2 KB), `public/samples/grand/c8-l2.mp3` (55.5 KB), `public/samples/grand/c8-l3.mp3` (55.9 KB), `public/samples/grand/ds1-l1.mp3` (298.3 KB), `public/samples/grand/ds1-l2.mp3` (337.8 KB), `public/samples/grand/ds1-l3.mp3` (342.8 KB), `public/samples/grand/ds2-l1.mp3` (309.0 KB), `public/samples/grand/ds2-l2.mp3` (309.6 KB), `public/samples/grand/ds2-l3.mp3` (312.5 KB), `public/samples/grand/ds3-l1.mp3` (209.1 KB), `public/samples/grand/ds3-l2.mp3` (220.0 KB), `public/samples/grand/ds3-l3.mp3` (214.7 KB), `public/samples/grand/ds4-l1.mp3` (181.3 KB), `public/samples/grand/ds4-l2.mp3` (192.7 KB), `public/samples/grand/ds4-l3.mp3` (186.2 KB), `public/samples/grand/ds5-l1.mp3` (137.3 KB), `public/samples/grand/ds5-l2.mp3` (139.2 KB), `public/samples/grand/ds5-l3.mp3` (141.0 KB), `public/samples/grand/ds6-l1.mp3` (100.2 KB), `public/samples/grand/ds6-l2.mp3` (102.0 KB), `public/samples/grand/ds6-l3.mp3` (104.7 KB), `public/samples/grand/ds7-l1.mp3` (55.2 KB), `public/samples/grand/ds7-l2.mp3` (56.6 KB), `public/samples/grand/ds7-l3.mp3` (56.5 KB), `public/samples/grand/fs1-l1.mp3` (291.9 KB), `public/samples/grand/fs1-l2.mp3` (297.5 KB), `public/samples/grand/fs1-l3.mp3` (299.8 KB), `public/samples/grand/fs2-l1.mp3` (269.5 KB), `public/samples/grand/fs2-l2.mp3` (285.2 KB), `public/samples/grand/fs2-l3.mp3` (289.6 KB), `public/samples/grand/fs3-l1.mp3` (216.8 KB), `public/samples/grand/fs3-l2.mp3` (222.2 KB), `public/samples/grand/fs3-l3.mp3` (224.5 KB), `public/samples/grand/fs4-l1.mp3` (151.6 KB), `public/samples/grand/fs4-l2.mp3` (172.9 KB), `public/samples/grand/fs4-l3.mp3` (171.4 KB), `public/samples/grand/fs5-l1.mp3` (122.7 KB), `public/samples/grand/fs5-l2.mp3` (127.4 KB), `public/samples/grand/fs5-l3.mp3` (125.2 KB), `public/samples/grand/fs6-l1.mp3` (76.0 KB), `public/samples/grand/fs6-l2.mp3` (81.2 KB), `public/samples/grand/fs6-l3.mp3` (79.6 KB), `public/samples/grand/fs7-l1.mp3` (80.6 KB), `public/samples/grand/fs7-l2.mp3` (83.0 KB), `public/samples/grand/fs7-l3.mp3` (76.9 KB), `public/samples/upright/c1.mp3` (23.4 KB), `public/samples/upright/c2.mp3` (24.7 KB), `public/samples/upright/c3.mp3` (24.1 KB), `public/samples/upright/c4.mp3` (23.0 KB), `public/samples/upright/c5.mp3` (20.2 KB), `public/samples/upright/c6.mp3` (17.6 KB), `public/samples/upright/c7.mp3` (16.3 KB), `public/samples/upright/e1.mp3` (24.1 KB), `public/samples/upright/e2.mp3` (24.4 KB), `public/samples/upright/e3.mp3` (23.1 KB), `public/samples/upright/e4.mp3` (23.7 KB), `public/samples/upright/e5.mp3` (19.5 KB), `public/samples/upright/e6.mp3` (16.8 KB), `public/samples/upright/gs1.mp3` (24.3 KB), `public/samples/upright/gs2.mp3` (25.0 KB), `public/samples/upright/gs3.mp3` (24.3 KB), `public/samples/upright/gs4.mp3` (20.5 KB), `public/samples/upright/gs5.mp3` (18.2 KB), `public/samples/upright/gs6.mp3` (15.5 KB)
- Audio note: All recorded material was obtained exclusively through the npm registry (the run's only permitted network source) and is bundled under public/samples/ for fully offline playback; see public/samples/SOURCES.md and scripts/sync-samples.mjs for the exact provenance chain.
- Audio note: One AudioContext feeds per-layer buses, ordered effects, the single rotary instance, master gain and limiter into one destination; no engine or effect creates a parallel context or destination.
- Audio note: Clav/Digital/Misc piano types have no bundled model: selecting them flashes the type LED and reports 'Piano not found' on the Program display, and the layer plays nothing rather than pretending (spec: nord-stage-4.piano.json selection.missingModelState).
- Audio note: Functional Phase 2 controls: keybed + pedals, full Piano section, full Layer Effects section (except the Synth FX-focus button, decorative until a Synth engine exists), Rotary strip (drive/speed/stop), Master Level, pitch stick (±2 semitones on Piano voices), Panic, and Shift as the Global-mode modifier. Organ, Synth and remaining Program/Morph controls stay truthfully decorative until Phase 3.
- Audio note: Deterministic tests cross the real audio boundary via node-web-audio-api OfflineAudioContext rendering (no network, devices or audio output); browser boundaries (context, assets, MIDI, timers) remain injectable and fake-backed state tests complement, not replace, the rendered-audio proofs.

## Phase 1: Complete surface and basic piano

**96/100 · exceptional**

Exceptionally strong Phase 1 candidate. The rendered Nord Stage 4 73 surface reproduces the measured reference geometry almost exactly (chassis aspect 3.0951 vs registry 3.0951; 0.94 viewport width fraction; 54/46 deck/keybed split; 13/21/15/9/21/21 section widths verified in live DOM), with a complete, reference-specific six-section hardware inventory (150 panel controls + 73-key E1-E7 keybed, nine LED-laddered drawbars, exactly two OLEDs in Program and Synth, eight Program buttons matching the reference photo). Behavior was verified directly in Chromium: pointer, independent three-point multi-touch, mapped computer keyboard with repeat suppression, and truthful MIDI-denied handling all feed one note lifecycle; analyser taps on the single lazily-created AudioContext confirmed audible output, monotonic velocity response (soft peak RMS 0.107 vs hard 0.294), sustain hold/release, 24-voice deterministic stealing, and silence after blur/release. The decorative boundary is honest and proven: operating knobs/buttons/drawbars before any key press created zero AudioContexts, and the status strip explicitly declares panel controls visual-only and the voice as generated synthesis with no samples. All four technical checks pass (113/113 tests) and a rebuild reproduces the sealed dist byte-for-byte. Remaining gaps are cosmetic: ~10 legend strings ellipsis-truncated at 1440x900 (e.g. Synth OLED 'Super S…', Delay 'EFFECTS: CHOR · VIBE · ENS · FLAM · SPAC…'), sub-pixel illegible legends at 390x844 (structure fully retained, nothing clipped), simplified micro-detail, and a ~200-500ms first-note warm-up latency while the AudioContext starts.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 91 |
| Basic Piano functionality | 25% | 100 |
| Surface interaction and honesty | 15% | 100 |
| Engineering quality | 15% | 100 |

### Priority issues

- Programmatic truncation survey (textOverflow ellipsis + scrollWidth > clientWidth) at 1440x900 and 2x close-up screenshots of the Synth section.
- Narrow-viewport DOM measurements (73/73 keys visible, sections 47.8-77.2px wide) and eval-narrow screenshot.
- Fresh-context RMS sampling at 50ms intervals after the first keyboard and pointer gestures.
- Reference photo crop of the Program section (eight numbered buttons visible) and candidate stage1-visual-audit.md.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**89/100 · strong**

Strong Phase 2 artifact with an exemplary audio graph, genuinely audible effects, and exceptional real-boundary evidence, held back mainly by an incomplete piano library. Direct browser inspection (headless Chromium against the sealed production build at localhost:4823, AnalyserNode tapped on the real master gain, plus AudioContext-construction counting injected before load) confirmed: one AudioContext; layer buses through the documented Mod1->Mod2->Delay->Amp/EQ->Comp->Reverb order into master gain -> limiter -> one destination; Grand/Upright/Electric are bundled recorded sample sets that load offline, sound (RMS 0.0015-0.0039 under --mute-audio tab) and are spectrally distinct; two layers with correct per-layer voice ownership, level fader binding (0..127, audible mute), and octave shift doubling the fundamental (258->527 Hz); KB Touch, Dyn Comp, Timbre (node gains follow state: treble -4.5 dB Soft, threshold -21 dB at Dyn Comp 1, readable only while the graph processes - a Chromium getter quirk I ruled out), Unison, Soft Release, String Res and Master Level all change canonical state and rendered/live audio; every effect family processes real audio (tremolo modulation 2.4x dry, delay repeats with LP-filtered repeat tail, LP24 centroid collapse, compressor dynamic range 16.2->1.8, Booth vs Cathedral tails, rotary fast 5.0x stop modulation via To Rotary); focus/group/global targeting, per-unit and all-FX bypass, wet/dry, tap tempo (~520 ms for 500 ms taps) all verified against store state and sound; MIDI-denied, asset-failure fallback (labeled synthesized, playable, never 'ready'), blur/pointercancel cleanup, 24-voice stealing and panic all behave; zero console errors across every session. The candidate's 203 tests pass (23 files) and include real OfflineAudioContext renders (node-web-audio-api) with measured assertions and graph-connectivity traversal. Key gaps: Clav/Digital/Misc types have no model at all (spec requires all six types playable, honest synthesis permitted - selecting them reports 'Piano not found' and plays nothing); SUSTPED/PSTICK exist only as indicator LEDs, not toggles; no on-screen UI sustain control (Space/CC64 only); several spec-excluded features (half-pedaling, pedal noise, delay feedback-loop effects, Analog mode) were implemented functionally instead of staying decorative (honestly declared); typecheck depends on @types/node being resolvable from a parent directory. Visual surface and narrow retention against Phase 1 captures show no drift.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 100 |
| Piano library and performance | 35% | 73 |
| Effects and signal graph | 30% | 100 |
| System behavior and UX | 10% | 100 |
| Engineering quality | 15% | 93 |

### Priority issues

- Live: RMS 0.0000 while holding keys with Clav/Digital/Misc selected; oled-piano-line '▤ Piano not found (Clav)'; src/audio/library.ts ships only grand-salamander, upright-tack, electric-tine; IMPLEMENTATION_DETAILS.json notes[2] declares the choice.
- sections.tsx:356-359 renders LEDs with no button; grep for sustped/pstick routing in src/ returns nothing beyond the LEDs; no test exercises a SUSTPED-off state.
- DOM scan of all buttons found no sustain-named control; status strip documents only 'Space / CC64 half-pedal'.
- engine.ts HALF_PEDAL_RELEASE_SECONDS/playPedalNoise; state/instrument.ts DelayEffect/analog; effects.ts in-loop fbEffectDelay/analogShaper; IMPLEMENTATION_DETAILS.json declares them.
- Reproduced on a scratch copy: tsc --noEmit fails with 6 TS2591 errors after pnpm install --frozen-lockfile; passes after making @types/node resolvable. test/lint/build pass standalone (203/203 tests, 0 lint errors on src, dist/index.html built).
- render-effects.test.ts test list; evaluator live measurements (mod2 six-type RMS 0.0015-0.0038; ring-mod centroid shift; reverb tail spread).
- IMPLEMENTATION_DETAILS.json sampleSources[1]; live centroid distinct from Grand (84.3 vs 77.2); 19 roots x 1 layer on disk.

### Technical gate

Passed.
