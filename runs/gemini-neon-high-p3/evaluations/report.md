# Gemini 4 Neon High — Stagebench evaluation

- Run: `gemini-neon-high-p3`
- Status: in-progress
- Aggregate: **95/100**
- Coverage: 2/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 96 |
| 2 | Piano library and working effects | 94 |
| 3 | running | — |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Recorded multi-sample acoustic grand piano (26 minor-third root notes D#1–F#7 across 3 velocity layers v3/v10/v16 from Salamander Grand Piano V3, 78 stereo Ogg Vorbis q4 files) with equal-temperament retuning via playbackRate, velocity-sensitive gain curve, damper release, sustain CC64, deterministic polyphony voice stealing, and a truthfully labeled live harmonic-synthesis fallback when samples are loading or unavailable.
- Generated sound sources: Harmonic Piano Synthesis Fallback — Live Web Audio additive/filtered triangle+sine harmonic voice used only while recorded samples are still loading or if sample fetching/decoding fails. Clearly labeled as fallback in UI status.
- Recorded sample provenance: Salamander Grand Piano V3 — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/grand/salamander-grand-v3/ (upstream: https://github.com/sfzinstruments/SalamanderGrandPiano at 3382bf9496bb) (CC-BY-3.0)
- Bundled audio: 78 files (4.1 MB)
- Audio note: All 78 bundled audio files under public/samples/grand/ are verbatim trimmed and re-encoded cuts from inputs/samples/grand/salamander-grand-v3/Samples/ with no pitch-shifting, time-stretching, or layering baked into the files.
- Audio note: Fine retuning offsets from upstream Data/tune_ret.txt are applied at runtime via AudioBufferSourceNode.playbackRate for accurate A440 equal temperament.
- Audio note: Phase 1 connects only keybed/MIDI/computer-keyboard note input and sustain (CC64 / Space) to the basic piano voice; all panel controls remain truthfully decorative.

### Phase 2: Piano library and working effects

- Audio strategy: Single AudioContext architecture feeding two Piano layer buses (A, B) with per-layer Timbre EQ, model voicing, and ordered Layer Effects chains (Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb), plus one shared Rotary Speaker reached post-Reverb via To Rotary, layer levels, Master Level gain, soft-knee DynamicsCompressorNode limiter, and brickwall WaveShaperNode safety clipper to one destination. Grand (78 stereo OGG), Upright (52 stereo OGG), Rhodes Mk I (15 mono OGG), and Wurlitzer EP200 (25 mono OGG) are bundled recorded cuts from inputs/samples/ (170 files total). Clav, Digital, Misc piano types, sympathetic string resonance, reverb impulse responses, and the labeled sample-failure fallback are live/generated Web Audio synthesis.
- Generated sound sources: Clavinet D6 & Harpsichord 8' Live Synthesis — Live Web Audio sawtooth/square harmonic plucked synthesis with resonant pickup highpass/peaking EQ and decaying lowpass envelope; Soft Release disabled per manual p. 25.; DX E.Piano & FM Bell Grand Live Synthesis — Live Web Audio 2-operator FM synthesis (carrier + frequency-modulated sine modulator with velocity-scaled modulation index and fast bell decay + warm body harmonic).; Concert Marimba & Warm Vibraphone Live Synthesis — Live Web Audio bar synthesis combining fundamental sine, 4th/3.98x harmonic overtone decay, and 5.5 Hz motor fan amplitude modulation on Vibraphone.; Simulated Sympathetic String Resonance — Live Web Audio sympathetic overtone resonance activated when String Res is enabled and sustain pedal or companion notes are held.; Procedural Stereo Reverb Impulse Responses (Booth/Room/Spring/Stage/Hall/Cathedral) — Deterministic seeded PRNG exponentially decaying filtered stereo AudioBuffers (plus dispersive metallic chirp for Spring) generated in memory per AudioContext in src/audio/effectUnits.ts.; Harmonic Piano Synthesis Fallback — Live Web Audio additive/filtered triangle+sine harmonic voice used only while recorded samples are loading or if sample fetching/decoding fails. Truthfully labeled as fallback in UI status and Program OLED.
- Recorded sample provenance: Salamander Grand Piano V3 — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/grand/salamander-grand-v3/ (upstream: https://github.com/sfzinstruments/SalamanderGrandPiano at 3382bf9496bb) (CC-BY-3.0); Upright Piano KW — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/upright/upright-piano-kw/ (upstream: https://github.com/freepats/upright-piano-KW at 570f6c60ed2e) (CC0-1.0); Rhodes Mark I, GM version (Discord SFZ GM Bank) — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/electric/learman-rhodes-gm/ (upstream: https://github.com/sfzinstruments/Discord-SFZ-GM-Bank at 7a9c478fe331) (CC0-1.0); Greg Sullivan's E-Pianos — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/electric/greg-sullivan-e-pianos/ (upstream: https://github.com/sfzinstruments/GregSullivan.E-Pianos at 8c3e581acda3) (CC-BY-3.0)
- Bundled audio: 170 files (6.2 MB)
- Audio note: All 170 bundled audio files under public/samples/ (78 Grand, 52 Upright, 15 Rhodes Mk I, 25 Wurlitzer EP200) are verbatim onset-trimmed, faded, and Ogg Vorbis q4 re-encoded cuts from inputs/samples/ with no pitch-shifting, time-stretching, or layering baked into the files.
- Audio note: Fine tuning offsets from upstream SFZ/Data metadata are applied at runtime via AudioBufferSourceNode.playbackRate for accurate A440 equal temperament.
- Audio note: Rhodes Mk I is recorded at a single dynamic per note in the pack; velocity dynamics are shaped at runtime via gain and dynamic lowpass filtering.
- Audio note: Phase 2 connects Piano (Layers A/B, 6 types, models, performance/acoustic/timbre controls, SUSTPED/PSTICK), Layer Effects (Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb, Rotary via To Rotary, Focus/Group/Global/Bypass), Master Level, and Pitch Stick. Organ, Synth, and Program controls remain truthfully decorative.

## Phase 1: Complete surface and basic piano

**96/100**

A strong, honest Phase 1. Geometry is essentially exact at 1440x900: deck/keybed 0.54000/0.45997, width fraction 0.94000, aspect 3.09514, worst section-fraction deviation 0.000012, 73/43/30 keys all inside the keybed, black-key height 0.60994, and all five reference colours within deltaE 0.36. All 33 section landmarks render in their own sections, all 146 panel controls (and all 73 keys) pass a 5x5 elementFromPoint hit-test, and no forbiddenDetection rule fires. Source honesty is excellent: blocking /samples/ flips the build to 3 oscillators / 0 buffer sources with the status 'harmonic synthesis fallback active' and the OLED reading 'Synth Fallback', exactly as declared; unblocked, three pointer notes produce 3 AudioBufferSourceNodes with 5.5/4.6/3.6 s buffers matching the declared trims. Inputs, lifecycle and the 32-voice deterministic stealing all behave; zero console errors across a full interaction pass. The weaknesses are surface detail: many buttons are blank rectangles, effect-type LED clusters carry no printed type names, the Synth OLED stays static while its own encoders move, control density is visibly thinner than the photograph, and that shortfall is not declared.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 100 |
| Playability & control | 55% | 100 |
| Feature completeness | 20% | 83 |

### Priority issues

- **minor** — Many panel buttons render as blank caps with no silkscreen legend: Across the Synth (LFO, OSCILLATORS, FILTER, AMP, VIBRATO, ARPEGGIATOR), Layer Effects (delay type, ping-pong/filter, comp on, reverb tone/type) and Program (PRESET LIBRARY trio, PROGRAM 1–8) bands, a large share of buttons are empty rounded rectangles. In reference/nord-stage-4-73.jpg every one of these carries printed text (WAVEFORM, PITCH/SMP, ENV TO PITCH, ENVELOPE, VELOCITY, TYPE, GROUP, MST CLK, ORGAN/PIANO/SYNTH, SYSTEM/SOUND/…). The names survive only in aria-labels, so a sighted player reading the panel cannot identify them.
- **minor** — Effect-type and option LED clusters carry no printed type names: MOD 1, MOD 2, AMP SIM/EQ and REVERB each render a 2x3 dot grid of type LEDs with no legend beside the dots, so the selected type is unreadable from the panel — #fx-mod1-type cycles to 'PUMP' and #fx-reverb-type to 'CATH' in their aria-labels, but nothing on the surface says so. The reference prints the type names next to each LED. Knobs also lack the numbered 0–10 tick scales that the reference prints around nearly every knob.
- **minor** — Synth OLED is static while its own encoders and selectors change state: #synth-oled reads 'SYNTH · PHASE 1 / Decorative / AUDIO IN PHASE 3' and never changes. Driving #synth-enc-wave to aria-valuetext 95%, cycling #synth-mode to EXTERN and #synth-filter-type all left it byte-identical. The program OLED by contrast reads fully live values (P1:01, SUST ON/OFF, model name, NOTE C4 VEL 96). One of the two primary displays therefore never reflects the presentation state of the controls sitting directly under it, which the reference display does.
- **minor** — Panel control inventory is visibly thinner than the variant photograph: 146 panel controls render. Reference controls with no operable counterpart include ALL FX OFF and the per-unit GROUP buttons in Layer Effects; MENU, PATTERN, GROUP, KB SYNC and EXCLUDE in Synth; STORE AS, PRESET NAME, NUM PAD, PEDAL, SET KEY and PEDAL TAP in Program; and SUSTPED/PSTICK in Organ and Piano, which appear only as silkscreen with no control or LED. The program band also shows more empty red area above and below its OLED than the packed reference.
- **minor** — The control-inventory shortfall is not declared: evidence/stage1-visual-audit.md declares the micro-silkscreen simplification and the section-fraction choice under 'Known Deviations', and its landmark walkthrough enumerates what is present section by section, but it never states that the controls listed in the issue above are absent. Behavioural declarations in IMPLEMENTATION_DETAILS.json are all accurate; it is the surface inventory that is understated.
- **minor** — At 390x844 only about a third of the instrument is visible at a time: The chassis renders 1180 px wide inside .ns4-stage-scroller (scrollWidth 1200, clientWidth 390, overflow-x auto), so five of the six sections require horizontal scrolling and there is no scaled overview. Geometry and legibility are fully preserved (deck fraction 0.5400, aspect 3.0952, 73/73 keys inside the keybed, no document overflow, 0 console errors), but roughly 430 px of viewport below the status bar sits empty rather than being used to show more of the instrument.
- **minor** — Ninth drawbar top legend reads '2 2/3' instead of a distinct rank name: The organ drawbar top legends read BASS16, STR16, FLUTE8, OBOE8, TRMP8, STR8, FLUTE4, STR4, '2 2/3'. The ninth duplicates a footage value rather than naming a rank, where the other eight all name one; the footage row underneath already reads 16' 5⅓' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1' correctly.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**94/100**

A strong Phase 2 artifact. Panel geometry is essentially exact at 1440x900 (deck/keybed 0.540/0.460, width 0.9400, aspect 3.0952, worst section-fraction deviation 0.00001), 73/43/30 keys all inside the keybed, all five reference colours match within deltaE 0.36, all 33 section landmarks render in their own section, all 149 panel controls pass a 5x5 elementFromPoint hit-test, and no forbiddenDetection rule fires. Audio is real and well built: one AudioContext, the documented chain order in source, master gain + limiter + brickwall to one destination; six piano types measurably distinct (centroid 472-3090 Hz); every effect unit and listed type measurably alters the render (reverb T30 240-2520 ms Booth to Cathedral, delay repeats at the tap interval with the feedback filter shifting repeat centroid 564-1690 Hz, ring-mod carrier down 37 dB, rotary 1.2/5.3 Hz). Weak spots are cosmetic and marginal: silkscreen legends are 4-5.5 px and unreadable at rendered size, String Res moves the signal only ~0.5 dB and only with the pedal down, the three synthesised types are mono, and the narrow viewport shows only a third of the instrument.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 92 |
| Playability & control | 20% | 92 |
| Feature completeness | 25% | 100 |

### Priority issues

- **minor** — Silkscreen legends render at 4.3-5.5 px and are not legible at 1440x900: Measured computed font sizes in the rendered deck: ns4-legend-micro 5 px, ns4-legend 5.5 px, ns4-drawbar-top 4.3 px, ns4-subbox-title 5 px, ns4-fx-unit-title 5 px, ns4-morph-header and ns4-prog-bank-header 4.8 px, all in Barlow Condensed 600/700. At native resolution the glyphs collapse into texture - a 1:1 crop of the Delay group shows 'TEMPO' and 'FDBK' as unreadable smudges. The rubric asks for legends legible at rendered size; only the plate titles (9 px) and the brand mark (16 px) actually read.
- **minor** — String Res moves the render by only ~0.5 dB and only with the sustain pedal down: With String Res on and the sustain pedal held, the tapped render of a second note measured rms 0.0385 against 0.0365 with it off, and 0.0421 against 0.0404 in a repeat run - about 0.4-0.5 dB, with no rise at the 2x (523 Hz) or 3x (785 Hz) partials where the added resonance lives. On the companion-note path (C3 held 600 ms, then C4 struck, pedal up) String Res on measured 0.0348 and 0.0355 against 0.0351 and 0.0360 with it off, i.e. no measurable effect, even though src/audio/stageAudioEngine.ts:527 gates on otherHeldCount > 0 as well as on the pedal.
- **minor** — The three synthesised piano types render fully mono: Electric, Clav, Digital and Misc all measured a stereo difference ratio of exactly 0.000 on C4, against 0.614 for Grand and 0.456 for Upright. The Rhodes is mono in the shared pack and is not charged for that, but Clav, Digital and Misc are synthesised from scratch and could have been given width; as rendered they sit dead centre, which a player would notice next to the two stereo acoustic banks.
- **minor** — At 390x844 only about a third of the instrument is visible at a time: The chassis keeps its full 1180 px CSS width inside a 390 px horizontal scroller (scrollWidth 1200, clientWidth 390), so nothing collapses or clips and every control stays full size and operable, but the instrument can never be seen whole and roughly half the viewport height (below y=560 of 844) is empty background. A fit-to-width view, or a scaled overview alongside the scroller, would keep the instrument recognisable as one object.
- **minor** — Panel legend and accessible name disagree on the rotary CLOSE MIC button: In the performance band the silkscreen legends read DRIVE / CLOSE MIC / STOP MODE / SLOW - FAST / MORPH, but the buttons underneath carry the accessible names 'Rotary Drive On', 'Rotary Stop Mode' and 'Rotary Speed Slow Fast'. The button sitting under CLOSE MIC is named Rotary Drive On, so a screen-reader user and a sighted user are told different things about the same control. Rotary close mic is an excluded feature, so nothing functional is claimed falsely - this is a labelling mismatch only.
- **minor** — Second Grand and Upright models are the same recording re-voiced, undisclosed: src/model/instrumentState.ts:56-80 defines 'Studio Grand 2' as the salamander grand bank with brightnessOffsetDb 4.5 and 'Felt Upright' as the Kawai bank with lowpassHz 1850, both declared sourceKind 'recorded'. Measured, 'Felt Upright' drops the centroid from 1227 Hz to 783 Hz, so it is a real tonal variant - but presenting it as a distinct model without noting in IMPLEMENTATION_DETAILS.json that it is the same recording slightly overstates the library. Only one model per type is required, so this costs nothing against the contract.

### Technical gate

Passed.
