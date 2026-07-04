# Fable 5 High — Stagebench evaluation

- Run: `claude-fable-5`
- Status: complete
- Aggregate: **96/100**
- Coverage: 2/2 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 96 |
| 2 | Piano library and working effects | 97 |

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

**96/100**

A strong, unusually complete Phase 1 artifact with an exemplary honesty posture. The canonical desktop capture is a faithful likeness of the Nord Stage 4 73: one continuous red chassis at 0.9400 of viewport width, aspect 3.0951, a 0.54/0.46 deck/keybed split, the six sections at their documented widths (13/21/15/9/21/21%), a 73-key E1–E7 keybed (43 white / 30 black), nine organ drawbars with LED ladders, the wheel/master-level performance cluster, and exactly two primary OLEDs located only in Program and Synth. Materials read correctly (red metal, dark inset plates, black indexed knobs, fader/drawbar caps, red/green LED ladders, blue-green OLEDs, white legends) though micro-detail (Nord logotype glyphs, screw heads, brushed texture, printed scale numerals) is simplified — all disclosed in the audit. The piano is one dependable generated voice fed through a single unified note lifecycle: pointer/multi-touch, mapped computer keys with repeat suppression, and Web MIDI note/velocity/CC64 all route through one controller with per-source note ownership, correct velocity-to-level mapping, sustain latch, deterministic oldest-first 24-voice stealing, a soft-limiter master path with a reduced-path fallback, and full blur/MIDI-disconnect/unmount all-notes-off cleanup. The honesty boundary is airtight: IMPLEMENTATION_DETAILS.json truthfully declares live oscillator synthesis with no sample claims, the presentation store is completely isolated from audio, and a dedicated test asserts that operating panel controls creates no AudioContext and does not disturb playing voices. Engineering is high quality — 129 deterministic test cases with an injectable AudioContext fake that models real graph topology (reachesDestination, live-node kinds), zero console messages in both captures, and no reference photograph embedded. The main gaps are cosmetic/legibility only: at 390x844 the whole instrument is width-scaled so legends become sub-pixel and illegible (nothing clips), and typography/decorative detail is approximated rather than exact.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 91 |
| Basic Piano functionality | 25% | 100 |
| Surface interaction and honesty | 15% | 100 |
| Engineering quality | 15% | 100 |

### Priority issues

- At 390x844 the whole instrument is width-scaled so legends become sub-pixel and illegible (nothing clips) — usable for inspection but not for reading labels.
- Micro-detail fidelity is simplified: condensed sans instead of Nord's typeface, no screw heads/brushed texture/printed scale numerals, and drawbar cap colors follow classic Hammond convention rather than the exact photo tones.
- Program section renders eight numbered buttons (following the reference/manual and Phase 3 Live slots) rather than the visual spec's 'five live-program buttons'; disclosed in the audit as a deliberate reading.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**97/100**

A strong, honest Phase 2 artifact. The three required sample sets are genuinely recorded, redistributable, offline audio: public/samples/grand holds 90 real MP3s (30 roots x 3 distinct velocity layers, ~300KB each, ID3/MPEG verified), and public/samples/{upright,electric} hold 19 real MP3s each; md5 confirms grand/upright/electric and grand's three velocity layers are all distinct files, and render-library.test.ts proves the three are audibly distinct (similarity < 0.8, zero-crossing spread > 1.15) through the real graph. IMPLEMENTATION_DETAILS.json declares provenance/licenses truthfully (Salamander CC BY 3.0; MIDI-JS Soundfonts MIT) and honestly flags single-layer velocity shaping and generated reverb/resonance/pedal-noise buffers as DSP, never as recordings. The audio graph is exemplary: one AudioContext, per-layer voice buses -> timbre/dynComp/level -> ordered Mod1->Mod2->Delay->AmpEq->Comp->Reverb -> master gain -> limiter -> one destination, with a single shared rotary tapped post-reverb (Reverb-before-Rotary). All seven effect units are real Web Audio DSP with rendered-audio distinctness tests plus click-free crossfade bypass, and effects-routing/graph tests traverse actual node connectivity rather than metadata. Tests cross the boundary via node-web-audio-api OfflineAudioContext (~250 cases). The one real gap: only three of six piano types have a model; Clav/Digital/Misc report 'Piano not found' and play nothing where honest synthesis was allowed and would have completed the required 'six types with at least one model each' scope. Captures are clean (zero console/page errors) and surface fidelity vs the 73 reference is retained with no drift.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 100 |
| Piano library and performance | 35% | 92 |
| Effects and signal graph | 30% | 100 |
| System behavior and UX | 10% | 100 |
| Engineering quality | 15% | 100 |

### Priority issues

- [object Object]
- [object Object]

### Technical gate

Passed.
