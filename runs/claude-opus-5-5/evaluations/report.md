# Claude Opus 5.5 High — Stagebench evaluation

- Run: `claude-opus-5-5`
- Status: complete
- Aggregate: **97/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 96 |
| 2 | Piano library and working effects | 95 |
| 3 | Complete Stage 4 system | 98 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Generated buffers (honest synthesis), no recordings. One basic piano voice: at page load the browser synthesizes 25 mono root tones (every 3 semitones, E1-E7) into AudioBuffers with src/audio/pianoTone.ts, and each note plays the nearest root through AudioBufferSourceNode (playbackRate within +/-1 semitone) -> BiquadFilter low-pass (velocity brightness) -> GainNode (velocity level + release envelope) -> master GainNode -> AudioContext.destination. While tones are still generating, or if generation fails, a clearly labelled live OscillatorNode (triangle) fallback plays through the same filter/gain/master chain.
- Generated sound sources: Basic piano tone (generated) — Additive synthesis of up to 28 inharmonic string partials (stiff-string stretch, hammer-position spectral weighting), two-stage prompt/aftersound exponential decay per partial, two strings detuned by 0.9 cents from E2 upward, and a 12 ms low-passed deterministic noise hammer transient (mulberry32 PRNG seeded per note). Normalized to 0.8 peak with 2 ms attack and 60 ms tail fades.; Fallback tone (live synthesis) — Web Audio triangle OscillatorNode with a decaying gain; used only while the generated tones are loading or after generation fails. The status panel and Program OLED label it 'Fallback tone'.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: No recorded samples are bundled or fetched in Phase 1; sampleSources is intentionally empty.
- Audio note: The UI states the truth: 'The piano is a synthesized tone generated in the browser, not a recording.'
- Audio note: Velocity scales both level (velocityGain) and brightness (velocityCutoff). Sustain comes from the keyboard Space bar, the on-screen sustain toggle, and MIDI CC64.
- Audio note: Polyphony is 24 voices with deterministic stealing (releasing, then oldest sustained, then oldest held).
- Audio note: Every panel knob, button, fader, drawbar, wheel and stick is decorative in Phase 1: presentation state only, connected to no audio node.
- Audio note: Tests render the real generated buffers and gain/filter automation with an in-repo sample-accurate Web Audio simulator (src/testing/simAudio.ts); no audio device, network or MIDI device is needed.

### Phase 2: Piano library and working effects

- Audio strategy: One AudioContext. Each note is routed by LayeredEngine to the enabled piano layers (A/B); each layer owns its voices (own NoteEngine). A voice is AudioBufferSourceNode(s) playing the nearest recorded zone for the touch-mapped velocity layer (or a generated buffer for Clav/Digital/Misc), unison copies through StereoPanners, a velocity low-pass and an envelope gain into the layer bus. Layer bus -> Timbre EQ (+ String Res comb bank) -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb -> layer level -> (direct | To Rotary -> shared Rotary) -> master gain (Master Level) -> limiter (DynamicsCompressor) -> destination.
- Generated sound sources: Digital Piano (synth) — Additive synthesis of inharmonic string partials with two-stage decay and a noise hammer transient (the Phase 1 tone), roots every 3 semitones. Also the labelled fallback for a recorded model whose pack fails to load.; FM E.Piano (synth) — Two-operator FM (sine carrier, decaying modulation index) plus a short 14th-harmonic tine transient.; Clavinet (synth) — Additive plucked-string harmonics shaped by pluck- and pickup-position combs, with a short deterministic tangent click.; Harpsichord (synth) — Additive 8' + 4' plucked choirs with slow decay.; Marimba (synth) — Damped tuned-bar modes at 1 : 3.93 : 9.24.; Vibraphone (synth) — Damped metal-bar modes at 1 : 4 : 10.1 with long ring.; Reverb impulse responses (generated) — Deterministic filtered-noise exponential tails per type (Booth 0.25 s … Cathedral 4.2 s RT) with falling damping; Spring adds a repeating dispersive chirp train. Used by ConvolverNodes.; Last-resort fallback tone (live synthesis) — Triangle OscillatorNode with decaying gain, used only if both a recorded pack and the generated Digital fallback are unavailable. Status and Program OLED label the fallback.
- Recorded sample provenance: Salamander Grand — Salamander Grand Piano V3 — https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html (CC-BY-3.0); Upright KW — Upright Piano KW (2022-02-21) — https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW (CC0-1.0); Wurlitzer EP200 — Wurlitzer EP200 Electric Piano v1.1 (Greg Sullivan E-Pianos, SFZ port by kinwie) — https://github.com/sfzinstruments/GregSullivan.E-Pianos (CC-BY-3.0); Rhodes (jRhodes3) — jRhodes3 GM subset (Discord SFZ GM Bank, 005-Electric Piano 1) — https://github.com/sfzinstruments/Discord-SFZ-GM-Bank (CC0-1.0)
- Bundled audio: None detected
- Audio note: Grand, Upright and Electric (two Electric models) are bundled recorded samples served from public/samples and loaded offline from the app bundle; Clav, Digital and Misc models are synthesized in the browser and labelled "(synth)" in the model names.
- Audio note: If a sample pack fails to load, the status reports "fallback" (never "ready"), names the failed pack, flashes the type LED, shows LOAD FAILED on the Program OLED, and the model plays the generated Digital piano as a labelled fallback.
- Audio note: Soft/sostenuto pedals are not implemented (optional in the spec) and are not claimed. String Res is a simulated sympathetic resonance (comb bank), as the spec allows.
- Audio note: Tests render the real sample packs, generated buffers and effect graphs with the in-repo Web Audio simulator (src/testing/simAudio.ts).

### Phase 3: Complete Stage 4 system

- Audio strategy: One AudioContext for every engine. LayeredEngine routes each physical key to the seven layers (Organ A/B, Piano A/B, Synth A/B/C) by section on/layer enable, split zone and crossfade gain, then octave shift and Transpose; each layer owns its voices. Piano voices are AudioBufferSourceNode(s) playing the nearest recorded zone (or a generated buffer for Clav/Digital/Misc) -> layer bus -> Timbre EQ (+ String Res) -> its own chain. Organ voices are live OscillatorNodes (sine / square / custom PeriodicWaves per model) -> per-layer Vox tone mix -> vibrato/chorus scanner -> layer level -> ONE shared organ chain. Synth voices are live OscillatorNodes (native and PeriodicWave waveforms), a looped generated noise buffer, ConstantSource envelopes, drive and two biquads -> layer bus -> arp gate -> its own chain -> layer level. Every chain is Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb, then (direct | shared Rotary: Organ via the Rotary ORGAN button, piano/synth via To Rotary) -> master gain (Master Level) -> limiter -> ceiling -> the single destination.
- Generated sound sources: Digital Piano (synth) — Additive synthesis of inharmonic string partials with two-stage decay and a noise hammer transient (the Phase 1 tone), roots every 3 semitones. Also the labelled fallback for a recorded model whose pack fails to load.; FM E.Piano (synth) — Two-operator FM (sine carrier, decaying modulation index) plus a short 14th-harmonic tine transient.; Clavinet (synth) — Additive plucked-string harmonics shaped by pluck- and pickup-position combs, with a short deterministic tangent click.; Harpsichord (synth) — Additive 8' + 4' plucked choirs with slow decay.; Marimba (synth) — Damped tuned-bar modes at 1 : 3.93 : 9.24.; Vibraphone (synth) — Damped metal-bar modes at 1 : 4 : 10.1 with long ring.; Reverb impulse responses (generated) — Deterministic filtered-noise exponential tails per type (Booth 0.25 s … Cathedral 4.2 s RT) with falling damping; Spring adds a repeating dispersive chirp train. Used by ConvolverNodes.; Organ key click / pipe chiff noise (generated) — 25 ms of deterministic xorshift noise with an exponential decay, played through a band-pass per key (B3/B3 Bass click, Pipe chiff).; Synth white noise (generated) — 1.5 s of deterministic PRNG noise, looped by an AudioBufferSourceNode for the White Noise waveform.; Organ engines (live synthesis) — Per key: nine drawbar oscillators. B3: pure sines at 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1' with top-octave foldback, key click, single-triggered 2nd/3rd-harmonic percussion. Vox: square-wave dividers with mixture drawbars II/III/IV and a filtered/unfiltered tone mix on drawbar 9. Farf: nine on/off tab registers with flute/strings/oboe/trumpet PeriodicWaves. Pipe 1/Pipe 2: flue/principal PeriodicWaves with slow speech, chiff and release; chorus = detuned celeste rank. B3 Bass reuses B3 (16'/8' only); Pipe 2 reuses Pipe with a brighter principal. Vibrato/chorus V1-V3/C1-C3 is a modulated-delay scanner per layer.; Synth engine (live synthesis) — Analog mode only. Pure: sine/triangle/saw/square OscillatorNodes and 33 %/10 % pulse PeriodicWaves, white noise; Sync: master saw/square with a resonant formant swept 0-3 octaves by Osc Ctrl (a documented approximation of hard sync); Multi: three detuned saws (+ octave saw); Super: seven detuned, stereo-spread saws/squares; FM-H: 2-operator FM (modulator 2 x f0) with Osc Ctrl as index. Unison 1-3, drive, LP12/LP24/HP/BP biquads with key tracking/resonance/envelope, ADR oscillator/filter/amp envelopes (ConstantSource), LFO (5 waveforms incl. a generated S&H PeriodicWave, 3 destinations, master-clock sync), vibrato, poly/mono/legato with priority and constant-rate glide, deterministic arpeggiator/gate.; Last-resort fallback tone (live synthesis) — Triangle OscillatorNode with decaying gain, used only if both a recorded pack and the generated Digital fallback are unavailable. Status and Program OLED label the fallback.
- Recorded sample provenance: Salamander Grand — Salamander Grand Piano V3 — https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html (CC-BY-3.0); Upright KW — Upright Piano KW (2022-02-21) — https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW (CC0-1.0); Wurlitzer EP200 — Wurlitzer EP200 Electric Piano v1.1 (Greg Sullivan E-Pianos, SFZ port by kinwie) — https://github.com/sfzinstruments/GregSullivan.E-Pianos (CC-BY-3.0); Rhodes (jRhodes3) — jRhodes3 GM subset (Discord SFZ GM Bank, 005-Electric Piano 1) — https://github.com/sfzinstruments/Discord-SFZ-GM-Bank (CC0-1.0)
- Bundled audio: None detected
- Audio note: Grand, Upright and Electric (two Electric models) are bundled recorded samples served from public/samples and loaded offline from the app bundle; Clav, Digital and Misc models are synthesized in the browser and labelled "(synth)" in the model names.
- Audio note: If a sample pack fails to load, the status reports "fallback" (never "ready"), names the failed pack, flashes the type LED, shows LOAD FAILED on the Program OLED, and the model plays the generated Digital piano as a labelled fallback.
- Audio note: Soft/sostenuto pedals are not implemented (optional in the spec) and are not claimed. String Res is a simulated sympathetic resonance (comb bank), as the spec allows.
- Audio note: Organ and Synth are live synthesis (OscillatorNode, PeriodicWave, ConstantSource and biquad graphs) in the same AudioContext; the only buffers they use are the generated click/chiff and white-noise buffers listed above. No organ or synth sound is a recording.
- Audio note: Programs (32 + 8 Live) store canonical state only (no audio) in localStorage; Master Level and the pitch stick are not stored.
- Audio note: Tests render the real sample packs, generated buffers, organ/synth voices and effect graphs with the in-repo Web Audio simulator (src/testing/simAudio.ts).

## Phase 1: Complete surface and basic piano

**96/100**

A near-reference Phase 1 build. Geometry is essentially exact at 1440x900 (deck 0.5397, keybed 0.4603, width 0.9300, aspect 3.0948, worst section deviation 4.6e-8) and all five reference colours match within dE 1.2. Inventory is complete: 33/33 section landmarks, 146/146 controls pointer-reachable by the 5x5 elementFromPoint grid, 73/73 keys inside the keybed (43 white / 30 black, black-key height 0.6099), zero forbidden descriptors satisfied. The generated additive piano tracks pitch (E2 82.43 Hz vs 82.41), holds level across E1-E7 (peak ~0.208), decays monotonically and never clips under 24 voices (peak 0.2394). Pointer, touch, computer keyboard and Web MIDI all reach one lifecycle; velocity, release, sustain (UI/Space/CC64), 24-voice stealing and blur all-notes-off all verified. Every panel control moves and reports state while changing no audio, and says so in aria-description. Shortfalls are small: the sustain toggle desyncs from Space/CC64, the Program OLED carries no live performance values, and micro-legends are sub-pixel at Fit scale.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 100 |
| Feature completeness | 20% | 100 |

### Priority issues

- **minor** — On-screen sustain toggle desyncs from Space bar and MIDI CC64: Holding Space or sending CC64=127 flips the live engine readout to 'sustain down', but the status-panel toggle stays labelled 'Sustain pedal up' with aria-pressed="false" (scratch/sus2.py: spaceDown -> {btn:'Sustain pedal up', pressed:'false', line:'0 / 24 voices - sustain down'}). Only clicking the toggle itself updates it. A user or screen-reader reading the control gets the opposite of the engine state, and the next click inverts rather than releases.
- **minor** — Program OLED carries no live performance values: While notes are sounding, both OLEDs render the same static text as at idle ('PHASE 1 - KEYBED / Basic Piano / Synth piano: ready / Panel: decorative'; 'SYNTH / Inactive / Not built in Phase 1'). Voice count, held notes and sustain state live only in the status panel below the instrument (scratch/panel.py oledWhilePlaying). The displays report engine readiness truthfully but do not read live values the way the hardware display does.
- **minor** — Micro-legends are sub-pixel at Fit scale: At 1440x900 the deck is 233.5 px tall (stage scale 0.8370) and at 390x844 it is 65 px (scale 0.2338), so group legends and shift legends render at roughly 3-4 px and are not readable without the built-in 2x/3x zoom. The artwork itself is reference-grade at 3x (drawbar footage legends, 8-step LED ladders, knob scale rings, 'HANDMADE IN SWEDEN BY CLAVIA DMI AB v2.0 Rev.B' silkscreen), so this is a rendered-size legibility limit rather than missing detail.
- **minor** — Mono voice with 3-semitone root spacing and one velocity layer: Rendered output is identical in both channels (summed absolute channel difference 0.000 over a 3 s render), and the voice is 25 roots every 3 semitones resampled +/-1 semitone with velocity applied as gain plus filter cutoff only. Declared honestly in IMPLEMENTATION_DETAILS.json and within Phase 1 scope, but a player will hear the uniform pitch-shift and the absent stereo image.
- **minor** — Shipped visual audit names the building model, weakening blind evaluation: artifact/evidence/stage1-visual-audit.md opens with a line identifying the model and configuration that produced the artifact. EVAL.md instructs the evaluator not to discover this; shipping it inside the sealed artifact makes that impossible to avoid on a first read. It did not enter this assessment, but the capture template should strip it.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**95/100**

Phase 2 lands close to the hardware. Geometry at 1440x900 is exact by construction: deck/keybed 0.53965/0.46035, width fraction 0.92999, aspect 3.09478 vs 3.0951, all six section fractions on target. 73 keys (43/30, E1-E7) lie inside the keybed at a 0.60995 black-key height fraction; all 33 sectionLandmarks render in their own section; 146 of 146 modelled controls pass a 5x5 elementFromPoint hit test; no forbiddenDetection rule fires (two OLEDs only, program and synth; performance carries no inset plate); 5/5 reference colours match. Behaviour is real, not staged: one AudioContext feeds per-layer chains into a limiter and one destination; six piano types (three bundled recorded packs, 3.5-10.7 dB apart against a 0.37 dB control) and six effect units with every spec'd type, working bypass, dry/wet, per-layer FX focus and To Rotary. Failure paths are honest and decorative controls declare themselves. Shortfalls are narrow: Rotary speed and drive are not measurable at the output, micro-legends are unreadable at 1:1, and 390 px needs the zoom control.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 91 |
| Playability & control | 20% | 100 |
| Feature completeness | 25% | 100 |

### Priority issues

- **minor** — Rotary speed and drive produce no measurable change in the rendered mix: With a piano layer routed through Amp Sim type 'To Rotary' (which itself changes the signal by 4.12 dB), toggling 'Rotary speed slow/fast' and sweeping 'Rotary speaker drive' from 40 to 127 - and separately 0 to maximum with layer and master level raised - moved the averaged mono output spectrum by 0.05-0.15 dB against a 0.37 dB same-setting control, with peak RMS 0.01822 vs 0.01863. The unit itself is real: src/audio/fx/rotary.ts builds a two-rotor speaker with doppler delay, AM, stereo sweep and a 0.5x-5.5x tanh drive stage, the panel binding reaches RotaryUnit.apply, and the repo's own rendered tests assert both parameters change the signal. The likely causes are the master limiter swallowing the drive gain and a rate change that lives in stereo modulation rather than in a time-averaged mono spectrum. Reported as a caveat on what is audible at the output, not as a missing unit.
- **minor** — Silkscreen legends are below legibility at the rendered 1:1 size: Panel legends are drawn at 3.3-3.6 design px, about 2.8-3.0 CSS px at the 0.837 render scale. At the default Fit scale (instrument 1339 px wide, 0.149 of the 9013 px reference) section headers and OLED text are legible but the per-control silkscreen is not, so a player reads the panel by layout memory rather than by its labels. The reference photograph at the same scale is marginally more legible.
- **minor** — Panel controls are impractically small at 390x844 without the zoom affordance: At Fit on a 390 px viewport the deck is ~68 px tall and individual buttons render at roughly 2-5 px; nothing clips and every control remains hit-testable, but operating the panel realistically requires switching to the provided 2x or 3x zoom.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**98/100**

A complete, high-fidelity Stage 4. Geometry at 1440x900 is essentially exact: width fraction 0.9300, aspect 3.0948 vs 3.0951, deck/keybed 0.5397/0.4603, worst section deviation 4.6e-08, 73/43/30 keys all inside the keybed, black-key height 0.6099, 5/5 reference colours within dE 1.3. All 33 required landmarks render in their own sections, all 146 controls pass a 5x5 elementFromPoint test, and every forbiddenDetection rule evaluates to zero. Behaviour matches: one AudioContext; three architecturally distinct engines 16-18 dB apart spectrally; effects focus following the engine; 32 programs round-tripping all 146 controls with a truthful dirty flag; Store/Store As/Live auto-store; the Shift+dial list view; 3-point splits with Off/±6/±12 crossfades and per-zone routing; scenes; wheel and pedal morphs reaching audio; ±6 transpose (1.416x); Panic. 20 voices peak 0.617, no clipping, full cleanup, no console errors. Gaps: MIDI CC11 does not drive the Control Pedal morph source (required, the only undeclared miss), and at 390x844 'Fit' the smallest control is 2.64 px, usable only via 2x/3x zoom. Ten decorative controls are spec-excluded or optional and labelled unsupported.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 100 |
| Playability & control | 20% | 91 |
| Feature completeness | 35% | 100 |

### Priority issues

- **minor** — MIDI CC11 does not drive the Control Pedal morph source: programs spec morph.controlPedalInput requires 'A virtual on-screen pedal and MIDI CC11 both drive the Control Pedal source'. With an injected MIDIAccess, [0x90..]/[0x80..]/[0xB0,64,..] all work, but [0xB0,11,127] left [data-testid=control-pedal] at 0 and no morph destination moved; the on-screen pedal alone drives the source (verified: RMS 0.03999 -> 0.00028 on an assigned synth-filter-freq). The MIDI status line is honest ('notes, velocity, CC64 sustain') but this control is not in the unsupported list, so it is an undeclared gap in a required feature.
- **minor** — Default narrow scale puts controls below a usable size: At 390x844 the instrument renders at 374x120.8 px: nothing is clipped, no horizontal page scroll, all 73 keys and 146 controls present and hit-testable, but the smallest control is 2.64 px wide and a white key 8.2 px. Operating the panel depends on the 2x/3x zoom buttons, and at 3x only 33 of 146 controls are on screen at once.
- **minor** — Arpeggiator ARP mode on a single held note is a shallow ripple: GATE mode is fully rhythmic (6 ms RMS series reaches exactly 0.0000 between steps, CV 0.727). ARP mode with one key held only ripples the level (CV 0.133 against 0.032 with the arp off) rather than retriggering the amplitude envelope to silence, so single-note arpeggios read less percussively than the hardware. Rate and range controls do move the pattern.

### Technical gate

Passed.
