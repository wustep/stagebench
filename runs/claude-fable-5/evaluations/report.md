# Claude Fable 5 High — Stagebench evaluation

- Run: `claude-fable-5`
- Status: complete
- Aggregate: **88/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 96 |
| 2 | Piano library and working effects | 59 |
| 3 | Complete Stage 4 system | 100 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Generated live synthesis (no recorded samples). Each note builds a small stack of detuned oscillator partials (triangle fundamental plus sine partials at 1x, 2x and ~3x) through a velocity- and pitch-keyed lowpass filter and a percussive exponential-decay gain envelope, into a shared master gain and DynamicsCompressor soft limiter, then one destination. Piano-like by design and honestly not a sampled piano.
- Generated sound sources: Basic piano-like oscillator voice — live Web Audio oscillator synthesis
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: No recorded, downloaded, or bundled audio samples are used or claimed in Phase 1.
- Audio note: Audio starts lazily on the first key gesture; status is reported truthfully as idle/loading/ready/fallback/error in the status strip below the instrument.
- Audio note: Only keybed note input and the sustain input path (space bar, MIDI CC64) reach the audio graph. Every visible panel control is decorative presentation state only.
- Audio note: All browser boundaries (AudioContext factory, timers, Web MIDI access) are injectable; unit tests run against deterministic fakes and the real graph was exercised in headless Chrome.

### Phase 2: Piano library and working effects

- Audio strategy: Sampled multi-piano instrument with a live-DSP effect chain. Primary sound: three bundled RECORDED sample sets (Grand/Upright/Electric) played through AudioBufferSourceNodes with nearest-root selection, recorded-velocity-layer crossfading (grand) or declared gain+filter velocity shaping (single-layer sets), unison detune copies, and per-voice envelopes. One AudioContext: voices enter per-layer buses (timbre EQ, dynamic compression, level), then the ordered per-layer effect chain Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb, then either the single Rotary Speaker instance (Amp unit 'To Rotary') or directly the master gain → limiter → one destination. All effects are live Web Audio processing (LFOs, modulated delays, biquads, waveshapers, convolution). The Phase 1 oscillator voice survives only as a clearly labeled synthesized fallback after primary sample failure.
- Generated sound sources: Synthesized fallback voice — live Web Audio oscillator synthesis; Reverb impulse responses — algorithmically generated buffers (deterministic xorshift noise, per-type decay/predelay/spring character); String-resonance impulse and pedal-noise thump — generated buffers; Effect processing (Mod 1/Mod 2/Delay/Amp-EQ/Compressor/Rotary) — live Web Audio DSP (LFO-modulated gains/panners/filters/delays, feedback delay loop with in-loop filtering, waveshaper drive, DynamicsCompressor, dual-band rotary with inertial speed ramps)
- Recorded sample provenance: Salamander Grand ('Grand' type) — Salamander Grand Piano V3 — Yamaha C5 recorded by Alexander Holm (archive.org/details/SalamanderGrandPianoV3), obtained exclusively through the npm registry packages @audio-samples/piano-mp3-velocity4, -velocity8 and -velocity13 (v1.0.5) and copied into public/samples/grand by scripts/sync-samples.mjs. (CC BY 3.0 — attribution: 'Salamander Grand Piano V3' by Alexander Holm.); Tack Upright ('Upright' type) — GM Honky-tonk piano program (detuned tack-upright character), note-per-note mp3 renders from the MIDI-JS Soundfonts collection (github.com/gleitz/midi-js-soundfonts, Benjamin Gleitzman), obtained via the npm registry package web-music-score-samples v3.0.0 (samples/003-honkytonk-piano) and copied into public/samples/upright. (MIT (MIDI-JS Soundfonts collection; repackaged MIT by web-music-score-samples).); Tine EP ('Electric' type) — GM Electric Piano 1 (tine/electromechanical character) from the same MIDI-JS Soundfonts collection via npm web-music-score-samples v3.0.0 (samples/004-electric-piano-1), copied into public/samples/electric. (MIT (MIDI-JS Soundfonts collection; repackaged MIT by web-music-score-samples).)
- Bundled audio: 128 files (16.5 MB)
- Audio note: All recorded material was obtained exclusively through the npm registry (the run's only permitted network source) and is bundled under public/samples/ for fully offline playback; see public/samples/SOURCES.md and scripts/sync-samples.mjs for the exact provenance chain.
- Audio note: One AudioContext feeds per-layer buses, ordered effects, the single rotary instance, master gain and limiter into one destination; no engine or effect creates a parallel context or destination.
- Audio note: Clav/Digital/Misc piano types have no bundled model: selecting them flashes the type LED and reports 'Piano not found' on the Program display, and the layer plays nothing rather than pretending (spec: nord-stage-4.piano.json selection.missingModelState).
- Audio note: Functional Phase 2 controls: keybed + pedals, full Piano section, full Layer Effects section (except the Synth FX-focus button, decorative until a Synth engine exists), Rotary strip (drive/speed/stop), Master Level, pitch stick (±2 semitones on Piano voices), Panic, and Shift as the Global-mode modifier. Organ, Synth and remaining Program/Morph controls stay truthfully decorative until Phase 3.
- Audio note: Deterministic tests cross the real audio boundary via node-web-audio-api OfflineAudioContext rendering (no network, devices or audio output); browser boundaries (context, assets, MIDI, timers) remain injectable and fake-backed state tests complement, not replace, the rendered-audio proofs.

### Phase 3: Complete Stage 4 system

- Audio strategy: Full Stage 4 system on one AudioContext. PIANO: three bundled RECORDED sample sets (Grand/Upright/Electric) played through AudioBufferSourceNodes with nearest-root selection, recorded-velocity-layer crossfading (grand) or declared gain+filter velocity shaping (single-layer sets), unison detune copies, and per-voice envelopes. ORGAN (two layers, LIVE SYNTHESIS): additive oscillator banks per model — B3/B3 Bass drawbar-gained sine tonewheels with foldback, single-triggered percussion and generated key-click noise; Vox filtered triangle/saw registers plus a bright sawtooth bank; Farf buzzy saw/square registers; Pipe 1/2 sine-partial ranks with chiff noise — through per-layer scanner vibrato/chorus (modulated delay) into one shared organ effect chain. SYNTH (three layers, LIVE SYNTHESIS): Pure/Sync/Multi/Super/FM-H oscillator recipes (native waves, PeriodicWaves, looped generated noise, swept formant sync approximation, detuned stacks, 2-op FM), LP12/LP24/HP/BP biquad filters with tracking/resonance/drive waveshaper, dedicated oscillator/filter/amp envelopes, per-layer LFO and vibrato, poly/mono/legato with glide and priority, unison, and a deterministic audio-clock arpeggiator/gate — each layer into its own effect chain. Voices enter 6 per-layer/section chains (voice bus → timbre EQ → dyn comp → level → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb), then the single Rotary Speaker instance (organ rotary routing or Amp 'To Rotary') or directly master gain → limiter → one destination. Programs (32 + 8 Live), splits/zones with crossfades, Layer Scenes, Wheel/Control-Pedal morphs (engine renders the morph-interpolated effective state), Master Clock sync and global Transpose sit on top of the same graph. The Phase 1 oscillator voice survives only as a clearly labeled synthesized fallback after primary sample failure.
- Generated sound sources: Synthesized fallback voice — live Web Audio oscillator synthesis; Reverb impulse responses — algorithmically generated buffers (deterministic xorshift noise, per-type decay/predelay/spring character); String-resonance impulse and pedal-noise thump — generated buffers; Effect processing (Mod 1/Mod 2/Delay/Amp-EQ/Compressor/Rotary) — live Web Audio DSP (LFO-modulated gains/panners/filters/delays, feedback delay loop with in-loop filtering, waveshaper drive, DynamicsCompressor, dual-band rotary with inertial speed ramps); Organ engines (B3, B3 Bass, Vox, Farf, Pipe 1, Pipe 2) — live Web Audio additive/subtractive oscillator synthesis; Synth engine (Pure/Sync/Multi/Super/FM-H) — live Web Audio synthesis (oscillators, PeriodicWaves, generated noise/S&H buffers, biquads, waveshapers, FM)
- Recorded sample provenance: Salamander Grand ('Grand' type) — Salamander Grand Piano V3 — Yamaha C5 recorded by Alexander Holm (archive.org/details/SalamanderGrandPianoV3), obtained exclusively through the npm registry packages @audio-samples/piano-mp3-velocity4, -velocity8 and -velocity13 (v1.0.5) and copied into public/samples/grand by scripts/sync-samples.mjs. (CC BY 3.0 — attribution: 'Salamander Grand Piano V3' by Alexander Holm.); Tack Upright ('Upright' type) — GM Honky-tonk piano program (detuned tack-upright character), note-per-note mp3 renders from the MIDI-JS Soundfonts collection (github.com/gleitz/midi-js-soundfonts, Benjamin Gleitzman), obtained via the npm registry package web-music-score-samples v3.0.0 (samples/003-honkytonk-piano) and copied into public/samples/upright. (MIT (MIDI-JS Soundfonts collection; repackaged MIT by web-music-score-samples).); Tine EP ('Electric' type) — GM Electric Piano 1 (tine/electromechanical character) from the same MIDI-JS Soundfonts collection via npm web-music-score-samples v3.0.0 (samples/004-electric-piano-1), copied into public/samples/electric. (MIT (MIDI-JS Soundfonts collection; repackaged MIT by web-music-score-samples).)
- Bundled audio: 128 files (16.5 MB)
- Audio note: All recorded material was obtained exclusively through the npm registry (the run's only permitted network source) and is bundled under public/samples/ for fully offline playback; see public/samples/SOURCES.md and scripts/sync-samples.mjs for the exact provenance chain.
- Audio note: One AudioContext feeds 7 layers (Piano A/B, Organ A/B, Synth A/B/C) through 6 per-layer/section effect chains (the two organ layers share one chain per the organ spec), the single rotary instance, master gain and limiter into one destination; no engine or effect creates a parallel context or destination.
- Audio note: Clav/Digital/Misc piano types have no bundled model: selecting them flashes the type LED and reports 'Piano not found' on the Program display, and the layer plays nothing rather than pretending (spec: nord-stage-4.piano.json selection.missingModelState).
- Audio note: Functional Phase 3 controls: everything visible except the truthfully unsupported spec-excluded set — morph-at (aftertouch morph source), preset-organ/preset-piano/preset-synth and organ-preset (preset libraries), section-edit, layer-init, mon-copy (menu-only utilities), and synth-mode (Samples/Extern engines are not implemented; Analog is the only mode and its LED says so). These are marked decorative, move truthfully, and never fake behavior.
- Audio note: Programs: 32 slots + 8 Live slots serialize/round-trip all supported state (piano, organ, synth, all 6 chains, routing, splits, zones, scenes, morphs, clock, transpose); Live Mode auto-stores edits; persistence uses localStorage through an injectable storage boundary.
- Audio note: Morphs render through a derived EFFECTIVE state (base program values stay untouched); Wheel = panel wheel or MIDI CC1, Control Pedal = on-screen pedal or MIDI CC11.
- Audio note: Deterministic tests cross the real audio boundary via node-web-audio-api OfflineAudioContext rendering (no network, devices or audio output); browser boundaries (context, assets, MIDI, timers) remain injectable and fake-backed state tests complement, not replace, the rendered-audio proofs.

## Phase 1: Complete surface and basic piano

**96/100**

A disciplined, honest Phase 1. The published build renders the full six-section Stage 4 surface (150 panel controls, 73-key E1-E7 keybed, deck/keybed 0.5400/0.4600, aspect 3.0951, width fraction 0.940) and plays one generated piano voice from pointer, touch, computer keyboard and Web MIDI through a single note lifecycle. Measured on rendered signal: silence 0.000 RMS, note peak 0.310, velocity ladder 0.059/0.163/0.326 for MIDI 20/70/127, release to 0.000 within 500 ms, sustain (space and CC64) holds a released note at 0.108 while the unsustained control reads 0.000, a 24-voice cap with oldest-first stealing (96 live oscillators for 30 held keys), and blur / MIDI-disconnect silence everything. The decorative boundary is real: master level driven to 0 leaves the note at 0.249 vs 0.253, all 101 buttons clicked change nothing audible, and no panel gesture creates an AudioContext. Weaknesses are musical rather than structural: the 4-partial oscillator tone is obviously synthetic, and dense chords exceed full scale (max sample 1.02 at six notes, 1.27 at thirty) past the limiter. The candidate's own audio tests assert only on fake nodes.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 100 |
| Feature completeness | 20% | 100 |

### Priority issues

- **major** — Dense chords clip above full scale despite the limiter: Measured at the destination through an AnalyserNode: a six-note chord at MIDI velocity 100 reached max sample 1.019 and thirty held notes 1.271, both after the master gain (0.85) and the DynamicsCompressor (threshold -12, ratio 12, attack 3 ms). Per-voice peak is 0.04 + 0.32*v^1.5 (artifact/src/audio/engine.ts:160) with no polyphony-aware headroom, so ordinary two-hand playing drives the output into hard clipping at the device.
- **major** — Audio tests assert only on fake nodes, never on rendered signal: Every audio test (artifact/src/audio/note-lifecycle.test.ts, sustain-polyphony.test.ts, status-cleanup.test.ts) runs the engine against artifact/src/test/fakes.ts and asserts on scheduled AudioParam values and connection graphs; grepping for OfflineAudioContext, AnalyserNode or getFloatTimeDomainData across artifact/src and artifact/tests returns nothing. The task's audio test rules require proof on rendered signal (output differs from silence, velocity moves output in the expected direction, sustain changes duration). The behaviour is in fact correct — this evaluation measured it — but the suite would not catch a regression that leaves the state machine intact and the sound broken.
- **minor** — Piano timbre is a bare 4-partial oscillator stack: The voice is triangle plus sine partials at 1x/2x/3.01x with a velocity/pitch-keyed lowpass (artifact/src/audio/engine.ts:181-186). No hammer or damper noise, no inharmonicity, no register-dependent voicing, and a held note settles into a slow tail (RMS 0.278 at onset, 0.042 at 2 s, 0.0215 at 7 s) rather than a piano's decay. Honest and playable, but a knowledgeable player identifies it as a synth on the first note.
- **minor** — Stolen voices stay visibly pressed on the keybed: Holding 30 keys leaves 30 elements at data-pressed=true while the engine keeps only 24 voices (96 live oscillators measured), so the panel over-reports what is actually sounding. The controller's held map (artifact/src/input/controller.ts:38-48) is never reconciled with the engine's stealing decisions.
- **minor** — Space is swallowed with no effect when a panel control has focus: artifact/src/App.tsx:77 skips the sustain path when the event target matches 'button, [role=slider]', and the slider's own key handler ignores Space, so tabbing to a knob and pressing Space disables sustain with no feedback anywhere. Verified: with rotary-drive focused, a space-held note-on/note-off measured 0.000 peak RMS after release, versus 0.108 with focus cleared.
- **minor** — One control unreachable at 390x844: A 5x5 elementFromPoint hit test over each control's bounding box gives 150/150 reachable at 1440x900 but 149/150 at 390x844: 'delay-analog' has no grid point resolving to itself or a descendant at that scale.
- **minor** — Truncated legends and a clipped group title on the deck: At 1440x900 several Synth and Effects legends render with ellipsis ('OSC WAVE…', 'RAT…', 'PATT…', 'VELOCIT…', 'OSC PITCH …') and the Synth OLED shows 'Super S…' even though the visual audit reports that truncation as fixed; the 'MORPH ASSIGN' group title is clipped by the top edge of the Program band. Every affected control still carries a full accessible name.
- **minor** — Rotary Speaker block sits on a dark inset plate: specs/nord-stage-4.visual.json gives the performance band the surface 'exposed red chassis' and forbids a dark inset plate there; the build renders the Rotary Speaker group on its own dark plate with a border, beside the correctly bare Master Level / pitch stick / mod wheel area.
- **minor** — Computer keyboard reaches only 17 of 73 notes: artifact/src/input/keymap.ts maps KeyA through Semicolon to MIDI 60-76 with no octave-shift keys, so 56 of the variant's 73 keys are unreachable from the computer keyboard. Pointer and MIDI cover the full E1-E7 range.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**59/100**

A strong, largely honest Phase 2. The audio graph is what the contract asks for: one AudioContext, one destination connect, two distinct layer buses, ordered Mod1>Mod2>Delay>Amp>Comp>Reverb, a shared rotary and master gain+limiter, with no clipping under full load (peak 0.715, all units maxed, 12 notes, both layers, master 127). All six effect units and every listed type are panel-reachable and measurably change rendered audio: reverb decay runs 597 ms (Booth) to 1792 ms (Cathedral), delay repeats land at 240 ms against 237 ms specified, the compressor squeezes 25.9 dB of dynamic range to 7.6 dB, A-Pan drops L/R envelope correlation 0.993 to 0.246. Three bundled recorded sets decode 128/128 offline and are genuinely distinct (5.7-13.4 dB mean spectral distance). Two required gaps hold it back: Clav, Digital and Misc are silent (RMS exactly 0), and String Res is inert - its send gain stays at 1e-4 with the damper down while a neighbouring param in the same update ramps normally, and output is unchanged (0.01171 vs 0.01173). Input handling and failure behaviour are excellent.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 66 |
| Playability & control | 20% | 75 |
| Feature completeness | 25% | 70 |

### Priority issues

- **major** — Clav, Digital and Misc piano types are completely silent: Selecting any of the three unpopulated types renders exactly 0.00000 RMS / 0.00000 peak. The piano spec requires all six types selectable with at least one model each and explicitly permits honest synthesis for Clav/Digital/Misc, and selection.missingModelState requires a labelled fallback to stay playable. The failure is declared and the display reports 'Piano not found', so the honesty contract holds, but half the required instrument breadth is missing even though a synthesized voice already exists in the codebase.
- **major** — String Res never reaches the audio graph: With state.piano.stringRes true and the damper down (sustain level 1), the per-layer resonance send gain reads 1.0e-4 in every observed state, including immediately after a forced applyState pass in which the neighbouring layer-level param ramps correctly (0.6200 -> 0.0992 -> 0.6200). Rendered output is unchanged: RMS 0.01171 (off) vs 0.01173 (on), tail RMS 0.002669 vs 0.002501, 3-14 kHz band 0.000062 vs 0.000060. The LED and Program display report the control as engaged, so a required Phase 2 control changes state and panel feedback without changing sound.
- **minor** — SUSTPED per-section routing is missing and undeclared: The piano spec's architecture.sustainPedalPerSection requires a SUSTPED toggle that routes the sustain input to the section. sections.tsx:215 renders SUSTPED as an LED and legend only, and engine.setSustain applies the damper to every enabled layer unconditionally. Low practical impact this phase (Piano is the only sounding section) but it is neither implemented nor listed as unsupported.
- **minor** — Layer level sits before the effect chain instead of after it: engine.ts:304 connects levelGain into Mod 1, so the documented order (...Reverb, Rotary, Layer level, Master gain/limiter) is not followed. Audibly this makes the layer fader change how hard the compressor and the delay feedback loop are driven rather than acting as a clean post-effect trim.
- **minor** — Rotary Drive behaves as a large make-up gain: Engaging To Rotary at drive 127 raised destination peak from 0.065 to 0.855 and RMS from 0.00586 to 0.11533 (about +26 dB) on the same note; the tanh shaper is normalised at full scale, so low-level program material is amplified roughly 11x before it is soft-clipped. The master limiter keeps the output under full scale, but the level jump when a layer is routed to the rotary is far larger than the hardware's.
- **minor** — Timbre voicing is barely audible: Soft/Mid/Bright differ from Off by only 1.29 / 0.76 / 1.50 dB energy-weighted mean spectral distance on an identical note; the shelving filters are +-3 to +-5.5 dB at 250 Hz and 2.8 kHz. The direction is right (3-14 kHz band 0.000251 Soft, 0.000338 Off, 0.000543 Bright) but the effect is much weaker than the manual's Soft/Mid/Bright voicings.
- **minor** — Piano performance controls are shared across both layers: KB Touch, Dyn Comp, Timbre, Unison and the Acoustics group live in a single PianoSharedState (state/instrument.ts:73-82) rather than per layer, so editing Timbre while focused on layer B also re-voices layer A. The timbre list is chosen per layer from that layer's own family, so an Electric-only Dyno index is clamped rather than mapped when the other layer is acoustic.

### Technical gate

Failed; score capped at 59.

## Phase 3: Complete Stage 4 system

**100/100**

An unusually complete Stage 4 system. All three engines are genuinely separate: piano from bundled recorded sets, organ from additive tonewheel banks (spectral centroid 211 Hz on B3 vs 1918 Hz Farf, 2350 Hz Pipe 2), synth from five oscillator recipes with category-correct Osc Ctrl (Pure delta 0 Hz, FM-H delta +801 Hz). One AudioContext, six per-layer chains, every effect unit and type measurably alters rendered audio, and morphs, splits, scenes, transpose, panic, 32+8 program slots and Live Mode all round-trip and reach the signal. 231/231 controls are pointer-reachable at 1440x900, all 73 keys sit inside the keybed, the five reference colours match within deltaE 7.5, and deck/keybed/width/aspect land on target (0.5400 / 0.4600 / 0.9400 / 3.0951). The one structural miss is horizontal: the six section widths are hardcoded to the superseded 13/21/15/9/21/21 ratios (src/model/variant.ts:35-40), so Piano is 0.146 against a specified 0.085 and Program 0.087 against 0.125 - visible as a cramped, overlapping Program column. Narrow viewport is a plain downscale, recognizable but not operable.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 100 |
| Playability & control | 20% | 100 |
| Feature completeness | 35% | 100 |

### Priority issues

- **major** — Six section widths hardcoded to superseded spec fractions: src/model/variant.ts:35-40 sets fractions 0.13/0.21/0.15/0.09/0.21/0.21. specs/nord-stage-4.visual.json v1.3.0 specifies 0.14/0.20/0.085/0.125/0.25/0.20 (photo-measured, corrected 2026-07-04). Measured on the rendered page at 1440x900 against an instrument width of 1353.6 px: Piano 0.1457 (dev 0.0607), Synth 0.2040 (dev 0.0460), Program 0.0874 (dev 0.0376), Performance 0.1263 (dev 0.0137). Section boundaries read off the reference photograph (deck resampled to 1800 px) agree with the spec, not with the build: Piano occupies about 0.067 and Program about 0.139 of the deck there. Worst deviation is 5x the 0.012 tolerance.
- **major** — Narrow viewport is a uniform downscale with no responsive adaptation: At 390x844 the instrument renders 378x122 CSS px. Nothing clips and there is no horizontal scroll, but 186 of 231 controls have a minimum dimension under 8 px (median 3.6 px, 10th percentile 2.3 px, largest 9.5 px) and every silkscreen legend is illegible. The instrument also sits at y=299 with roughly 300 px of empty background above it.
- **minor** — Rotary Speaker block rendered on a dark inset plate instead of exposed red chassis: specs/nord-stage-4.visual.json sectionLandmarks.performance declares surface 'exposed red chassis' and reference/nord-stage-4-73.jpg shows the Rotary Speaker controls silkscreened directly on the red chassis with only a thin outline. The build wraps them in a blue-gray plate about 32% of the Performance section width. The landmark is still rendered in its own section so it is counted present, and it is not the 'full dark inset plate' the forbidden list targets, but it contradicts the photograph. The plate also overlaps the 'CTRL PEDAL' legend, which is cut mid-word.
- **minor** — Truncated and overlapping panel legends: 11 legends overflow their box and are cut with an ellipsis at 1440x900 (measured via scrollWidth > clientWidth): 'RATE/TIME', 'ARP - POLY - GATE', 'UP - DOWN - U/D - RND', 'TRI - SAW - SAW - SQ - S&H', 'OSC PITCH - OSC CTRL - FILTER', 'ENV TO CTRL - VEL OFF', 'TRACK 1/3 - DRIVE OFF', 'ROOM - STAGE - BOOTH - HALL - SPRING...' among others. In the over-narrow Program column the 'MORPH ASSIGN' header is clipped at the top edge and 'PROGRAM' overprints 'NUM PAD'; in Layer Effects the Reverb block's bottom ON/GLOBAL legend is cut by the section edge. Legend font sizes run 3.25-5.95 px.
- **minor** — Candidate evidence misattributes its section ratios to the spec: artifact/tests/feature-matrix.json (visual.section-layout) and evidence/stage3-visual-audit.md both state 'Six ordered sections at 13/21/15/9/21/21% widths ... per nord-stage-4.visual.json'. The shipped spec v1.3.0 says otherwise, so the audit's drift check validated the wrong target.
- **minor** — Clav, Digital and Misc piano types have no bundled model: IMPLEMENTATION_DETAILS.json declares that selecting these three of the six piano types flashes the LED, reports 'Piano not found' and plays nothing rather than substituting a voice. The declaration is honest and matches the spec's missingModelState, but three of the six required piano types remain silent in the final artifact.
- **minor** — Synth OLED does not follow non-oscillator edits: Driving Filter Freq updated the Program OLED status line to 'Filter Freq 617 Hz' but the Synth OLED kept showing 'OSC WAVEFORM / Saw / OSC CTRL 5.0 / ANALOG TYPE'. On the hardware the synth display follows the parameter being edited.

### Technical gate

Passed.
