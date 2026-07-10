# Grok 4.5 — Stagebench evaluation

- Run: `grok-4-5`
- Status: complete
- Aggregate: **75/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 82 |
| 2 | Piano library and working effects | 66 |
| 3 | Complete Stage 4 system | 78 |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Live additive synthesis (sine partials + amplitude envelope) for one basic piano-like voice. No recorded sample files are bundled in Phase 1.
- Generated sound sources: basic-piano-additive — Four sine partials per note with velocity-scaled envelope attack/decay and exponential release. Generated at note-on via Web Audio OscillatorNode; not a recording.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: Phase 1 requires one dependable piano-like voice only; multi-model recorded libraries are Phase 2.
- Audio note: Panel controls are decorative presentation state and do not alter the audio graph.
- Audio note: Sustain responds to Space key, MIDI CC64, and engine API only — not decorative panel toggles.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Sample playback for Grand/Upright/Electric multi-root multi-velocity PCM sets under public/samples/; live/offline-baked synthesis for Clav/Digital/Misc and labeled fallback. One AudioContext with per-layer buses, ordered effect chains (Mod1→Mod2→Delay→Amp/EQ→Comp→Reverb→optional Rotary), layer levels, master gain + limiter → destination.
- Generated sound sources: clav-digital-misc-synthesis — Clav, Digital, and Misc types use honest live/offline-buffer synthesis (not sample files). Distinct recipes: clavinet-like clipped harmonics, digital piano partials, mallet/vibes inharmonics.; labeled-fallback-synthesis — When sample assets fail to load, status becomes 'fallback' with a labeled message and playable synthetic voice. Never reported as ready primary library.; effects-dsp — Mod1/Mod2/Delay/Amp-EQ/Compressor/Reverb/Rotary implemented with Web Audio nodes (LFO, delay lines, waveshaper, dynamics, convolver impulses generated at runtime). Impulses are generated buffers, not recordings.
- Recorded sample provenance: grand-multi-sample — Stagebench-authored offline-baked PCM multi-samples (scripts/generate-samples.mjs). Not microphone recordings of an acoustic grand; redistributable demo assets for sample-playback paths. (CC0-1.0 (public domain dedication by Stagebench candidate authoring)); upright-multi-sample — Stagebench-authored offline-baked PCM multi-samples (scripts/generate-samples.mjs). Not mic recordings; redistributable demo sample assets. (CC0-1.0); electric-multi-sample — Stagebench-authored offline-baked PCM multi-samples (scripts/generate-samples.mjs). Tine-style recipe; not mic recordings of a Rhodes/Wurlitzer. (CC0-1.0)
- Bundled audio files: `public/samples/electric/r36_v0.wav` (38.8 KB), `public/samples/electric/r36_v1.wav` (38.8 KB), `public/samples/electric/r42_v0.wav` (38.8 KB), `public/samples/electric/r42_v1.wav` (38.8 KB), `public/samples/electric/r48_v0.wav` (38.8 KB), `public/samples/electric/r48_v1.wav` (38.8 KB), `public/samples/electric/r54_v0.wav` (38.8 KB), `public/samples/electric/r54_v1.wav` (38.8 KB), `public/samples/electric/r60_v0.wav` (38.8 KB), `public/samples/electric/r60_v1.wav` (38.8 KB), `public/samples/electric/r66_v0.wav` (38.8 KB), `public/samples/electric/r66_v1.wav` (38.8 KB), `public/samples/electric/r72_v0.wav` (38.8 KB), `public/samples/electric/r72_v1.wav` (38.8 KB), `public/samples/electric/r78_v0.wav` (38.8 KB), `public/samples/electric/r78_v1.wav` (38.8 KB), `public/samples/electric/r84_v0.wav` (38.8 KB), `public/samples/electric/r84_v1.wav` (38.8 KB), `public/samples/grand/r36_v0.wav` (38.8 KB), `public/samples/grand/r36_v1.wav` (38.8 KB), `public/samples/grand/r42_v0.wav` (38.8 KB), `public/samples/grand/r42_v1.wav` (38.8 KB), `public/samples/grand/r48_v0.wav` (38.8 KB), `public/samples/grand/r48_v1.wav` (38.8 KB), `public/samples/grand/r54_v0.wav` (38.8 KB), `public/samples/grand/r54_v1.wav` (38.8 KB), `public/samples/grand/r60_v0.wav` (38.8 KB), `public/samples/grand/r60_v1.wav` (38.8 KB), `public/samples/grand/r66_v0.wav` (38.8 KB), `public/samples/grand/r66_v1.wav` (38.8 KB), `public/samples/grand/r72_v0.wav` (38.8 KB), `public/samples/grand/r72_v1.wav` (38.8 KB), `public/samples/grand/r78_v0.wav` (38.8 KB), `public/samples/grand/r78_v1.wav` (38.8 KB), `public/samples/grand/r84_v0.wav` (38.8 KB), `public/samples/grand/r84_v1.wav` (38.8 KB), `public/samples/upright/r36_v0.wav` (38.8 KB), `public/samples/upright/r36_v1.wav` (38.8 KB), `public/samples/upright/r42_v0.wav` (38.8 KB), `public/samples/upright/r42_v1.wav` (38.8 KB), `public/samples/upright/r48_v0.wav` (38.8 KB), `public/samples/upright/r48_v1.wav` (38.8 KB), `public/samples/upright/r54_v0.wav` (38.8 KB), `public/samples/upright/r54_v1.wav` (38.8 KB), `public/samples/upright/r60_v0.wav` (38.8 KB), `public/samples/upright/r60_v1.wav` (38.8 KB), `public/samples/upright/r66_v0.wav` (38.8 KB), `public/samples/upright/r66_v1.wav` (38.8 KB), `public/samples/upright/r72_v0.wav` (38.8 KB), `public/samples/upright/r72_v1.wav` (38.8 KB), `public/samples/upright/r78_v0.wav` (38.8 KB), `public/samples/upright/r78_v1.wav` (38.8 KB), `public/samples/upright/r84_v0.wav` (38.8 KB), `public/samples/upright/r84_v1.wav` (38.8 KB)
- Audio note: Grand/Upright/Electric use bundled PCM sample playback with multi-root multi-velocity coverage; provenance is honest offline-baked assets (not claimed as acoustic session recordings).
- Audio note: Clav/Digital/Misc are synthesis and declared as generated.
- Audio note: Organ, Synth, and Program panel controls remain decorative presentation state in Phase 2.
- Audio note: Master Level is functional; Panic clears voices.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Sample playback for Grand/Upright/Electric multi-root multi-velocity PCM under public/samples/; live synthesis for Clav/Digital/Misc piano, B3/Vox/Farf/Pipe organ (harmonic drawbar partials), and Analog synth (Pure/Sync/Multi/Super/FM-H). One AudioContext with piano layer buses, shared organ bus, three synth layer buses, ordered effect chains (Mod1→Mod2→Delay→Amp/EQ→Comp→Reverb→optional Rotary), layer levels, master gain + limiter → destination.
- Generated sound sources: clav-digital-misc-synthesis — Clav, Digital, and Misc piano types use honest live/offline-buffer synthesis.; labeled-fallback-synthesis — When sample assets fail, status becomes 'fallback' with labeled synthetic voice.; organ-synthesis — B3 tonewheel partials, Vox transistor squares/saws, Farf register switches, Pipe sine ranks with drawbar-driven spectra; percussion, key click, vibrato/chorus.; synth-analog-synthesis — Analog-mode synth: Pure/Sync/Multi/Super/FM-H waveforms with category-correct Osc Ctrl; LP12/LP24/HP/BP filters; osc/filter/amp envelopes; LFO; poly/mono/legato; arp/gate logic.; effects-dsp — Mod1/Mod2/Delay/Amp-EQ/Compressor/Reverb/Rotary via Web Audio nodes. Impulses are generated buffers, not recordings.
- Recorded sample provenance: grand-multi-sample — Stagebench-authored offline-baked PCM multi-samples (scripts/generate-samples.mjs). Not microphone recordings of an acoustic grand; redistributable demo assets for sample-playback paths. (CC0-1.0 (public domain dedication by Stagebench candidate authoring)); upright-multi-sample — Stagebench-authored offline-baked PCM multi-samples (scripts/generate-samples.mjs). (CC0-1.0); electric-multi-sample — Stagebench-authored offline-baked PCM multi-samples (scripts/generate-samples.mjs). Tine-style recipe. (CC0-1.0)
- Bundled audio files: `public/samples/electric/r36_v0.wav` (38.8 KB), `public/samples/electric/r36_v1.wav` (38.8 KB), `public/samples/electric/r42_v0.wav` (38.8 KB), `public/samples/electric/r42_v1.wav` (38.8 KB), `public/samples/electric/r48_v0.wav` (38.8 KB), `public/samples/electric/r48_v1.wav` (38.8 KB), `public/samples/electric/r54_v0.wav` (38.8 KB), `public/samples/electric/r54_v1.wav` (38.8 KB), `public/samples/electric/r60_v0.wav` (38.8 KB), `public/samples/electric/r60_v1.wav` (38.8 KB), `public/samples/electric/r66_v0.wav` (38.8 KB), `public/samples/electric/r66_v1.wav` (38.8 KB), `public/samples/electric/r72_v0.wav` (38.8 KB), `public/samples/electric/r72_v1.wav` (38.8 KB), `public/samples/electric/r78_v0.wav` (38.8 KB), `public/samples/electric/r78_v1.wav` (38.8 KB), `public/samples/electric/r84_v0.wav` (38.8 KB), `public/samples/electric/r84_v1.wav` (38.8 KB), `public/samples/grand/r36_v0.wav` (38.8 KB), `public/samples/grand/r36_v1.wav` (38.8 KB), `public/samples/grand/r42_v0.wav` (38.8 KB), `public/samples/grand/r42_v1.wav` (38.8 KB), `public/samples/grand/r48_v0.wav` (38.8 KB), `public/samples/grand/r48_v1.wav` (38.8 KB), `public/samples/grand/r54_v0.wav` (38.8 KB), `public/samples/grand/r54_v1.wav` (38.8 KB), `public/samples/grand/r60_v0.wav` (38.8 KB), `public/samples/grand/r60_v1.wav` (38.8 KB), `public/samples/grand/r66_v0.wav` (38.8 KB), `public/samples/grand/r66_v1.wav` (38.8 KB), `public/samples/grand/r72_v0.wav` (38.8 KB), `public/samples/grand/r72_v1.wav` (38.8 KB), `public/samples/grand/r78_v0.wav` (38.8 KB), `public/samples/grand/r78_v1.wav` (38.8 KB), `public/samples/grand/r84_v0.wav` (38.8 KB), `public/samples/grand/r84_v1.wav` (38.8 KB), `public/samples/upright/r36_v0.wav` (38.8 KB), `public/samples/upright/r36_v1.wav` (38.8 KB), `public/samples/upright/r42_v0.wav` (38.8 KB), `public/samples/upright/r42_v1.wav` (38.8 KB), `public/samples/upright/r48_v0.wav` (38.8 KB), `public/samples/upright/r48_v1.wav` (38.8 KB), `public/samples/upright/r54_v0.wav` (38.8 KB), `public/samples/upright/r54_v1.wav` (38.8 KB), `public/samples/upright/r60_v0.wav` (38.8 KB), `public/samples/upright/r60_v1.wav` (38.8 KB), `public/samples/upright/r66_v0.wav` (38.8 KB), `public/samples/upright/r66_v1.wav` (38.8 KB), `public/samples/upright/r72_v0.wav` (38.8 KB), `public/samples/upright/r72_v1.wav` (38.8 KB), `public/samples/upright/r78_v0.wav` (38.8 KB), `public/samples/upright/r78_v1.wav` (38.8 KB), `public/samples/upright/r84_v0.wav` (38.8 KB), `public/samples/upright/r84_v1.wav` (38.8 KB)
- Audio note: Grand/Upright/Electric use bundled PCM sample playback; provenance is honest offline-baked assets.
- Audio note: Organ and Synth are live synthesis routed through the Phase 2 single AudioContext graph.
- Audio note: Programs serialize piano/organ/synth/effects/split/scene/morph/clock/transpose (not Master Level).
- Audio note: Unsupported (spec-excluded): aftertouch morph, preset library, Extern, Aux KB, banks beyond 32, pattern editor, menus.

## Phase 1: Complete surface and basic piano

**82/100**

A strong, honest Phase 1 recreation. The complete six-section deck renders in the correct spec order (performance/organ/piano/program/synth/effects) with exact fractions, a 54/46 deck/keybed split, aspect ratio 3.0951, and an exact 73-key E1-E7 keybed; spec colors are matched precisely and Program/Synth are the only primary OLEDs, with no invented displays or marketing hero. The piano voice is real Web Audio additive synthesis wired pointer/multitouch/keyboard/MIDI through one lifecycle with velocity, per-note release, sustain (Space + CC64), deterministic voice stealing, and blur/disconnect/unmount cleanup. The decorative boundary is architecturally enforced: panel controls only mutate a presentation store and never touch the engine, verified by a test asserting toggling a piano-type button leaves the voice count unchanged, and IMPLEMENTATION_DETAILS.json truthfully declares live synthesis (no samples claimed as recordings). All four gates pass first-hand (32/32 tests, typecheck, lint, build). Main gaps: the narrow 390x844 view retains everything but via heavy compression with truncated labels; audio tests assert only against a mock AudioContext rather than a real signal/analyser; and control micro-layout is a simplified flow approximation, not photo-matched to the dense reference.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 75 |
| Basic Piano functionality | 25% | 83 |
| Surface interaction and honesty | 15% | 100 |
| Engineering quality | 15% | 86 |

### Priority issues

- Narrow 390x844 layout retains the full surface only via heavy compression / horizontal pan; section titles and control labels truncate with ellipsis (e.g. 'PERFORMAN CONTROLS', 'FX Focus Or...'), hurting legibility rather than reflowing.
- Audio behavior is tested exclusively against a mock AudioContext (voice counts, oscillator.started); no real Web Audio signal/analyser assertion that output differs from silence or that velocity/release move output in the expected direction, which the phase's audio test rules request.
- Black-key horizontal placement uses a uniform 0.65 white-key offset; the musically-correct per-pitch-class blackOffsets table in Keybed.tsx is computed and then discarded via `void offset`, so black keys are not at true intra-octave positions.
- PianoEngine.getActiveNotes() reports velocity: 0 for every active voice (cosmetic; the envelope itself is velocity-scaled correctly).
- Control micro-layout is a simplified flow approximation, not pixel-matched to the reference photo, and is noticeably less dense than the real instrument.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**66/100**

A well-architected Phase 2 that turns the Piano and Layer Effects sections into a genuinely connected, single-AudioContext signal graph: per-layer buses, an ordered per-layer chain (Mod1 -> Mod2 -> Delay -> Amp/EQ -> Comp -> Reverb), a shared Rotary placed last, master gain + limiter, and one destination. All panel controls are truly wired to the engine through the hardware store -> engine registry -> control-bindings path, and the panel reflects state (button LEDs, exclusive type selection, OLED shows the selected piano type/model). Two layers, six selectable piano types, the full performance-control set, sustain from UI/keyboard/MIDI with per-layer SUSTPED gating, and a labeled playable fallback are all implemented in the real voice path. The two dominant gaps are: (1) the Grand/Upright/Electric 'sample sets' are honestly-declared offline-baked/synthesized PCM WAVs, not recorded samples, so the phase's explicit 'recorded sample sets' requirement is only partially met (honesty is preserved, avoiding a provenance failure); and (2) no test crosses the real Web Audio rendering boundary. In the jsdom/vitest environment OfflineAudioContext and AudioContext are undefined, so every audio test runs against a MockAudioContext and the engine's measureEnergy()/typeSignature() helpers fall back to an analytic state-formula and a hardcoded per-type lookup table. The 66 passing tests therefore prove engine state/topology/cleanup well but do not measurably prove audible source/effect/distinctness behavior on rendered signal, which the phase's audio-test rules explicitly require. A secondary fidelity defect: the Mod 1 unit permanently sums all five type sub-paths into its wet bus (applyMod1 never mutes inactive paths), so Mod 1 'types' bleed together at runtime rather than switching cleanly.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 75 |
| Piano library and performance | 35% | 67 |
| Effects and signal graph | 30% | 63 |
| System behavior and UX | 10% | 75 |
| Engineering quality | 15% | 60 |

### Priority issues

- Grand/Upright/Electric 'sample sets' are Stagebench-authored offline-baked/synthesized PCM WAVs, not recorded samples; the phase requires (and the hard gate names) 'recorded sample sets'. Provenance is honest (declared 'Not microphone recordings', CC0), so it is not a dishonesty failure, but the recorded-sample requirement is unmet.
- No test crosses the real Web Audio rendering boundary: OfflineAudioContext/AudioContext are undefined under jsdom, so measureEnergy() uses an analytic state-formula (distinctness derived from type-string char codes) and typeSignature() returns a hardcoded per-type table. Audible source/effect/distinctness/bypass claims are unproven on rendered signal despite test titles asserting 'rendered energy' and 'audibly distinct'.
- Runtime effect defect: Mod 1 (createMod1/applyMod1) leaves all five type sub-paths (pan, tremolo, ring, wah, pump) connected to the wet bus simultaneously and never mutes inactive ones, so Mod 1 'types' sum/bleed rather than switching cleanly -- undermining 'audibly distinct within its unit'.
- piano-engine.measureEnergy re-implements the effects chain inline as a separate parallel graph, so the metric that tests rely on does not exercise the real effects-chain.ts nodes used at playback and can drift from them.
- Piano section geometry (fraction 0.085) is the narrowest in the deck and cramps its ~25 controls, a visual-fidelity limitation inherited from Phase 1 vs the real hardware where Piano is a substantial section.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**78/100**

A genuinely comprehensive Phase 3 that turns the whole instrument on: a full 32-slot + 8-Live program system with store/store-as/dirty/edit-discard/pages/dial/list, splits (11 positions, up to 4 zones, crossfades), scenes I/II, Wheel/Control-Pedal morphs, master clock/tap/transpose/Panic, a four-model organ (B3/Vox/Farf/Pipe1 with per-model harmonic weights, nine drawbars, percussion, key-click, vibrato/chorus, rotary), and a three-layer analog synth (Pure/Sync/Multi/Super/FM-H with category-correct topologies, LP12/LP24/HP/BP filters, amp+filter envelopes, LFO, poly/mono/legato/glide/unison/vibrato, deterministic arp order). All engines share one AudioContext through per-engine buses, ordered effect chains, a shared rotary, and a master gain+limiter into a single destination — structurally verified (contexts.length===1). Nearly every control is bound and the spec-excluded controls are honestly listed as unsupported, and IMPLEMENTATION_DETAILS.json truthfully labels the baked PCM sample sets, live synthesis, and generated impulses. The dominant weakness is test rigor: every audio test runs against a mock AudioContext (jsdom, no OfflineAudioContext), so 'audible' claims are proven only through synthetic signature/energy proxies (organModelSignature hardcoded class offsets, waveformSignature category-id hashes, analytic measureEnergy fallback) rather than rendered spectra at a real Web Audio boundary — exactly the state-only-with-fakes pattern the task deems insufficient for audible behavior. Secondary gaps: the arpeggiator computes deterministic step order but is not actually time-scheduled to play, the oscillator (pitch) envelope is stored but not applied to audio, perf-pitch-stick is classed functional yet has no binding (silent no-op), Store-As shortcuts interactive naming, and the desktop capture shows the Program/Synth sections' bottom controls clipped with some label overlap.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 75 |
| Complete feature system | 35% | 75 |
| Audio quality and integration | 30% | 83 |
| Full-system behavior | 20% | 82 |
| Engineering quality | 10% | 66 |

### Priority issues

- All audio tests run against a mock AudioContext (jsdom, no OfflineAudioContext); 'audible' behavior is proven via synthetic signature/energy proxies rather than rendered spectra — organModelSignature uses hardcoded per-model class offsets and waveformSignature uses category-id/string hashes, so the distinctness tests would pass even if engines rendered identically.
- measureEnergy's OfflineAudioContext render path is dead in the test environment, so effect/type 'energy' distinctness tests execute the analytic string-hash fallback (piano-engine.ts ~L1285-1332), not real DSP.
- The arpeggiator computes deterministic step order (arpSteps) and stores run/hold/rate/sync/range/direction state but is never time-scheduled to actually play notes rhythmically (acknowledged in stage3-visual-audit.md).
- The synth oscillator (pitch) envelope oscEnv is stored and round-tripped but not applied to audio in spawnSynthVoice.
- perf-pitch-stick is classified functional (isFunctionalControl true) yet has no binding in applyControlToEngine — pitch bend is a silent no-op that is not listed among unsupported controls.
- control-bindings program-store-as auto-confirms with the current program name rather than exposing interactive keystroke naming.
- stage3-desktop.png shows the Program section (store/scene row) and Synth section bottom controls clipped by the deck edge, with some effect-knob labels overlapping.
- Piano Grand/Upright/Electric 'sample sets' are offline-baked generated PCM, honestly declared as not recordings (satisfies the honesty contract) but a carried-over deviation from the Phase-2 'recorded sample set' intent.

### Technical gate

Passed.
