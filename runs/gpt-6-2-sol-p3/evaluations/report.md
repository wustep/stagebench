# GPT 6.2 Sol High — Stagebench evaluation

- Run: `gpt-6-2-sol-p3`
- Status: complete
- Aggregate: **96/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 95 |
| 2 | Piano library and working effects | 93 |
| 3 | Complete Stage 4 system | 100 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: One recorded acoustic upright voice with two recorded dynamics and runtime pitch transposition from neighboring roots. Deterministic additive synthesis plays while the bank loads or if the bank is unavailable.
- Generated sound sources: In-memory damped partial buffers created on demand by src/piano/sound.ts. No generated audio files are bundled.
- Recorded sample provenance: Upright Piano KW — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/upright/upright-piano-kw/ (upstream: https://github.com/freepats/upright-piano-KW at 570f6c60ed2e) (CC0-1.0)
- Bundled audio: 51 files (1.8 MB)

### Phase 2: Piano library and working effects

- Audio strategy: Three offline recorded banks. Salamander C5 uses five recorded dynamics with crossfades between layers. Upright Piano KW uses two recorded dynamics. Rhodes Mark I uses one recorded dynamic, velocity-sensitive gain and filtering, and the author’s sustain loops at runtime. Nearby roots are transposed during playback. Clavinet, FM Stage Piano, Rosewood Marimba and the fallback are synthesized. All audio passes through per-layer effects and one master path.
- Generated sound sources: Runtime additive, FM and inharmonic partial buffers for Clavinet, FM Stage Piano, Rosewood Marimba and the piano fallback.; Runtime damped oscillator modes for sympathetic string resonance and seeded impulse responses for reverb.
- Recorded sample provenance: Salamander Grand Piano V3 — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/grand/salamander-grand-v3/ (upstream: https://github.com/sfzinstruments/SalamanderGrandPiano at 3382bf9496bb) (CC-BY-3.0); Upright Piano KW — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/upright/upright-piano-kw/ (upstream: https://github.com/freepats/upright-piano-KW at 570f6c60ed2e) (CC0-1.0); Rhodes Mark I, GM version (Discord SFZ GM Bank) — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/electric/learman-rhodes-gm/ (upstream: https://github.com/sfzinstruments/Discord-SFZ-GM-Bank at 7a9c478fe331) (CC0-1.0)
- Bundled audio: 224 files (19.6 MB)

### Phase 3: Complete Stage 4 system

- Audio strategy: Three offline recorded banks. Salamander C5 uses five recorded dynamics with crossfades between layers. Upright Piano KW uses two recorded dynamics. Rhodes Mark I uses one recorded dynamic, velocity-sensitive gain and filtering, and the author’s sustain loops at runtime. Nearby roots are transposed during playback. Clavinet, FM Stage Piano, Rosewood Marimba and the fallback are synthesized. Organ and Synth generate audio at runtime and share the piano AudioContext and master limiter. Organ A and B share one effects chain. Piano A/B and Synth A/B/C each have independent chains.
- Generated sound sources: Runtime additive, FM and inharmonic partial buffers for Clavinet, FM Stage Piano, Rosewood Marimba and the piano fallback.; Runtime damped oscillator modes for sympathetic string resonance and seeded impulse responses for reverb.; Organ uses additive tonewheel oscillators with seeded key-click noise and synthesized percussion, transistor waveforms for Vox and Farf, and additive pipe ranks. B3 Bass uses a restricted B3 registration and Pipe 2 uses brighter pipe ranks.; Synth uses Web Audio oscillators, runtime Fourier wave tables for pulse and hard-sync shapes, seeded white noise, and oscillator-to-oscillator FM. Envelopes, filters, LFOs, and arpeggiator/gate run inside the existing instrument graph.
- Recorded sample provenance: Salamander Grand Piano V3 — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/grand/salamander-grand-v3/ (upstream: https://github.com/sfzinstruments/SalamanderGrandPiano at 3382bf9496bb) (CC-BY-3.0); Upright Piano KW — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/upright/upright-piano-kw/ (upstream: https://github.com/freepats/upright-piano-KW at 570f6c60ed2e) (CC0-1.0); Rhodes Mark I, GM version (Discord SFZ GM Bank) — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/electric/learman-rhodes-gm/ (upstream: https://github.com/sfzinstruments/Discord-SFZ-GM-Bank at 7a9c478fe331) (CC0-1.0)
- Bundled audio: 224 files (19.6 MB)

## Phase 1: Complete surface and basic piano

**95/100**

A strong Phase 1 artifact. Measured against the published build served from build/ at 1440x900, every computed panel-fidelity measurement lands inside tolerance: deck/keybed 0.5400/0.4600, width fraction 0.9340, aspect 3.0952 vs 3.0951 specified, worst section-fraction deviation 0.0111 (tol 0.012), 73/73 keys (43 white, 30 black) laid out inside the keybed, black-key height 0.6099, all 33 section landmarks rendered in their own band, 220/220 controls reachable on a 5x5 elementFromPoint grid, 0 forbidden descriptors, 5/5 reference colours inside deltaE 12. The piano is honest and complete: declared upright bank verified in source and by blocking the sample fetch (status flips to 'Upright samples unavailable', the additive fallback still sounds at -15.9 dBFS); pointer, computer keyboard and Web MIDI each produce audio through one shared lifecycle; blur and MIDI unplug silence the output. Weaknesses are presentational: both OLEDs are static illustrations, 65 of 77 indicator lamps never follow their switch, 12 legend pairs overlap and 8 legends cross their section bounds, and a stolen voice leaves its key displayed as held.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 100 |
| Playability & control | 55% | 93 |
| Feature completeness | 20% | 93 |

### Priority issues

- **minor** — Both primary OLEDs are static illustrations: #program-oled and #synth-oled render fixed markup in artifact/src/hardware/Surface.tsx ('A:11 · PANEL / Nord Stage 4 / O B3 Soulful / P White Grand XL', 'OSC WAVEFORM · PANEL / Super Saw / DETUNE: 3.4'). Driving knobs, faders, drawbars and buttons, and playing notes, left both textContents byte-identical. The displays therefore never read a live value, and they name programs and sounds that do not exist. It is disclosed in evidence/stage1-visual-audit.md and in the in-app help, but a player reading the panel is told something the instrument is not doing.
- **minor** — 65 of 77 indicator lamps never follow their switch: Clicking all 98 panel buttons changed only 12 of the 77 .legend-lamp LEDs (the six section-on and six layer-on lamps, which are bound via controlId in artifact/src/hardware/panels.ts). The selection ladders beside stepping switches — organ model FARF/VOX/B3, piano type GRAND/UPRIGHT/ELECTRIC/CLAV/DIGITAL/MISC, mod/delay/reverb variation lists, KB ZONE, SUSTPED/PSTICK — are hard-coded on/off. Pressing #organ-model lights that button's own LED, which the hardware button does not have, while the ladder that does show the selection on the hardware stays fixed.
- **minor** — Legend collisions and legends crossing section bounds: At 1440x900 twelve pairs of .legend elements overlap by more than 1 px in both axes (for example 'MOD 2' over MOD 1's 'VARIATION ▾', 'AMP SIM / EQ' over MOD 2's 'VARIATION ▾', 'GLOBAL ▾' over 'DRY WET', 'FILTER ON' over 'ENV AMT', the program slot numbers 5-8 over the row-1 legends), and eight legends extend past their own section's left or right edge ('MASTER LEVEL', 'SLOW FAST', 'SECTION' in three sections, 'PRESET NAME', 'GROUP ▾', 'VELOCITY ▾'), so 'SECTION' renders clipped as 'CTION' at the piano and synth band edges. The ROTARY SPEAKER plate likewise overruns the performance/organ boundary.
- **minor** — Silkscreen type is below comfortable legibility at the rendered size: Of 254 legends, 168 render at 4.33 px and 82 at 3.66 px at 1440x900; only the six section titles reach 8.27 px. A 1:1 crop of the effects band shows group titles (DELAY, COMP, REVERB) and short words readable, while most parameter legends resolve as shapes rather than text. The artifact mitigates this at 390x844 with an 'Inspect controls' pan mode but offers no equivalent at desktop size.
- **minor** — A stolen voice leaves its key displayed as held: NoteLifecycle.stealVoice in artifact/src/piano/notes.ts deletes the entry from this.voices but leaves the token in this.owners, and publish() derives the held set from owners. Sending 30 MIDI note-ons against the 24-voice limit left 30 keys with data-held="true" while only 24 voices existed, so the keybed shows six notes as sounding that are not. Stealing order itself is correct and deterministic.
- **minor** — IMPLEMENTATION_DETAILS.json declares no Phase 1 gaps: The file contains only version, phase and the audio block (strategy, one sampleSource, 51 files). It is accurate as far as it goes and satisfies the schema, but the Phase 1 scope gaps — static OLEDs, presentation-only panel controls, fixed pointer velocity, unsupported pedal noise / half-pedalling / Triple Pedal / piano size classes / INFO view / preset library — appear only in evidence/stage1-visual-audit.md, which is not the file the criterion names.
- **minor** — Section bands span 95.55% of the instrument width: The .deck-sections container is 1285.17 px against an instrument width of 1344.95 px (controlAreaWidth 1720 of chassisWidth 1800 in artifact/src/hardware/Surface.tsx). Each section's fraction of the instrument is therefore about 4.4% under its spec value: performance 0.1338 vs 0.14, organ 0.1911 vs 0.20, piano 0.0812 vs 0.085, program 0.1194 vs 0.125, synth 0.2389 vs 0.25, effects 0.1911 vs 0.20. The worst deviation, 0.0111 at synth, is still inside the 0.012 tolerance, and the fractions are exact relative to the control band itself. The reference photograph puts the deck extent (x 1300-10300) essentially at the instrument bounds (x 1292, width 9013), so the inset is a small departure from the photo.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**93/100**

A strong Phase 2 artifact. Measured in the published build/ at 1440x900, the chassis is essentially exact (deck 0.5400, keybed 0.4600, aspect 3.0952, width 0.9340, six section fractions within 1e-4 of spec), the 73/43/30 keybed lays out entirely inside its well, all 154 panel controls and 73 keys pass a 5x5 elementFromPoint hit test, all 33 section landmarks render in their own band, no forbiddenDetection rule fires, and all five reference colours match within deltaE 0.8. Rendered-audio probes through a worklet tap on the build confirm real DSP: six spectrally distinct piano types, delay taps at 752/1506/2258 ms for 80 BPM with feedback filtering acting only on the repeats, reverb decay rising monotonically 0.11 s (Booth) to 2.82 s (Cathedral), tremolo and MST CLK rates matching the knob to 1%, and all-FX-off restoring the bypass spectrum exactly. The notable defect is the Grand bank's velocity crossfade, which inverts: a velocity-102 strike renders 4.2 dB quieter than velocity 93. Legend collisions and two largely static OLEDs are the main fidelity shortfalls.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 92 |
| Playability & control | 20% | 92 |
| Feature completeness | 25% | 95 |

### Priority issues

- **major** — Grand velocity crossfade inverts: a harder strike renders quieter: Sweeping strike velocity on the Grand (Salamander C5) in build/ and measuring the first 250 ms of each note, attack RMS rises monotonically to -32.54 dB at velocity 93, then falls to -36.74 dB at velocity 102 and -36.05 dB at 110 before recovering to -27.29 dB at 127 - a 4.2 dB drop for a harder strike, across the v10->v16 crossfade region. Reproduced twice with pen-pressure velocities and independently through KB Touch (attack peak -23.59 dB at strike 89 vs -25.46 dB at strike 101); Upright and Electric are monotonic over the identical sweep, and the bundled Grand layer files themselves are monotonic (mean volume -28.6 dB for 60-v1.ogg rising to -26.8 dB for 60-v16.ogg), so the fault is in the equal-gain crossfade in SampleBank.strike (src/piano/library.ts:68-81). The harness only measured the default Upright voice, so it did not catch this.
- **minor** — 18 legend pairs collide and 8 legends spill outside their band: At 1440x900, 18 of the 252 silkscreen legend spans overlap another legend's box and 8 extend past their own section's border box. Visible results include "UNDO" printed through "SECTION EDIT ▾" in the Program band, the section titles ORGAN/PIANO/SYNTH running into their own "SECTION" and "FX FOCUS" sublabels, "PROGRAM LIST" over "◀ PAGE / CAT ▶", the four lower program-slot names over their slot numbers, and "MOD AMT" over "OSC CTRL" in the Synth LFO block. Piano's "SECTION" spills 5.1 px left of its band and Program's "PRESET NAME" 4.3 px right. The reference photograph has no colliding silkscreen.
- **minor** — Synth OLED and most of the Program OLED are fixed text: src/hardware/Surface.tsx:166-174 renders the Synth OLED as constant JSX ("OSC WAVEFORM - PANEL", "Super Saw", "DETUNE: 3.4") that never changes when the Synth controls move, and four of the Program OLED's five lines ("A:11 - PANEL", "Nord Stage 4", "O B3 Soulful", "S Vista Pad Whl") are fixed; only the piano line is live. Driving the synth knobs and the program slot buttons in the build leaves both displays unchanged, so two of the instrument's three readouts show state the instrument is not in.
- **minor** — String Res barely changes the render and attenuates rather than resonates: With the sustain pedal latched and note 60 held, toggling String Res moves the 2nd and 3rd partial levels relative to the fundamental by only -1.20/-1.35 dB and -0.82/-0.67 dB across two repeats - reproducible but marginal, and in the attenuating direction. src/piano/voices.ts:119-134 adds oscillators at 2x and 3.002x the fundamental with uncontrolled phase, so they partially cancel the recorded partials instead of adding sympathetic ring.
- **minor** — Rhodes 'velocity-sensitive filtering' claim is not measurable: IMPLEMENTATION_DETAILS.json audio.strategy declares the Rhodes bank uses 'one recorded dynamic, velocity-sensitive gain and filtering'. Over a velocity sweep from 51 to 127 the Electric's spectral centroid is 292 Hz at every step while level rises 10 dB, because the per-voice lowpass opens from 3.6 kHz to 17.5 kHz while the Rhodes' energy lies entirely below 1.28 kHz. The gain half of the claim holds; the filtering half has no audible effect on this bank.
- **minor** — MODEL/LIST dial moves and reports a value but selects nothing: The Piano MODEL/LIST dial is bound read-only (src/hardware/bindings.ts:73 exposes only `text`), so it turns, updates aria-valuenow and shows "Piano Model Selector - Upright Piano KW" while changing no state. One model per type is within the contract, but the dial is not listed among the unsupported controls in evidence/stage2-visual-audit.md; only the in-app help text mentions it.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**100/100**

A complete and unusually honest Stage 4. Measured against the published build/ (which renders pixel-identical to artifact/evidence/stage3-desktop.png: 0 differing pixels at 1440x900), every chassis and keybed number lands inside tolerance (deck 0.53999, keybed 0.45998, width 0.93400, aspect 3.09518, worst section deviation 0.01112; 73/43/30 keys, black-key height 0.60994, all 73 keys inside the keybed), all 33 section landmarks render in their own band, all 163 panel controls are pointer-reachable by 5x5 hit-test, no forbidden descriptor fires under the spec's own detection rules, and all five reference colours match within deltaE 12. Organ, Piano and Synth are three genuinely separate engines in source and in rendered spectra; each inherits the six-unit shared chain in the documented order (delay taps at 500 ms on the Organ and Synth lanes, Piano left dry, Layer Effects ON removing them all). Programs, scenes, splits, morphs, transpose and Panic all behave. Weakest points are presentational: 18 overlapping silkscreen legends and most legends at 3.7-4.3 px, and a 390x844 default view that needs the zoom to be operable.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 100 |
| Playability & control | 20% | 100 |
| Feature completeness | 35% | 100 |

### Priority issues

- **minor** — Silkscreen legends overlap and are mostly below legible size at 1440x900: Of 302 rendered legend elements, 248 are drawn at 3.7 px or 4.3 px and only 4 at 8.3 px, and 18 pairs physically overlap by more than 1x1 px - for example 'PROGRAM LIST' over 'PAGE / CAT' (33.1x1.0 px), 'MOD AMT' over 'OSC CTRL' (16.1x3.3 px), 'PRESET LIBRARY' over 'SYNTH' (14.9x1.0 px) and 'UNDO' over 'SECTION EDIT' (12.9x2.9 px). The panel reads correctly as dense Nord nomenclature at a glance, but a player cannot actually read most of it without the Inspect-controls zoom.
- **minor** — 390x844 default view is recognizable but barely operable without the zoom: At 390x844 the whole instrument renders at 370.50x119.70 px with the correct 54/46 split (deck 64.63 px, keybed 55.06 px), no clipping and no horizontal overflow (scrollWidth 390 = innerWidth), and all 163 controls plus 73 keys still pass the 5x5 elementFromPoint test. But individual controls are around 3x2 px and white keys 8.11 px wide, so practical use depends on the 'Inspect controls' mode (which magnifies to a 1440 px pannable panel). Roughly 300 px of empty background sits above the instrument that could have carried the extra scale.
- **minor** — Vox registration spends two drawbars on the filtered/unfiltered mix: specs/nord-stage-4.organ.json describes Vox as 'seven partials plus a filtered/unfiltered mix drawbar'. src/audio/organ.ts generates partials only for drawbar indices 0-6 and then uses drawbars[7] for the lowpass-filtered path gain and drawbars[8] for the unfiltered reed path, i.e. two mix drawbars rather than one. The behaviour is musically sensible and both drawbars are live, but the ninth drawbar does not map to the spec's description.

### Technical gate

Passed.
