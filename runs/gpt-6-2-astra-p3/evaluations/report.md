# GPT 6.2 Astra High — Stagebench evaluation

- Run: `gpt-6-2-astra-p3`
- Status: complete
- Aggregate: **98/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 100 |
| 2 | Piano library and working effects | 94 |
| 3 | Complete Stage 4 system | 100 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Stereo grand multisamples at minor thirds, two recorded dynamics. Velocity sets gain and layer. During loading or decode failure a decaying harmonic oscillator voice is available.
- Generated sound sources: Live oscillator fallback; periodic wave with decaying gain.
- Recorded sample provenance: Salamander Grand Piano V3 — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/grand/salamander-grand-v3/ (upstream: https://github.com/sfzinstruments/SalamanderGrandPiano at 3382bf9496bb) (CC-BY-3.0)
- Bundled audio: 50 files (6.6 MB)
- Audio note: 25 roots from MIDI 27 through 99 in minor thirds. The nearest root is transposed at playback. Velocities 1–69 use v4, 70–127 use v10, with continuous per-strike gain scaling.
- Audio note: 32 logical voices. At capacity, steal the oldest released voice, then the oldest sustained voice, then the oldest held voice. Stolen voices fade over 15 ms. Ordinary damper release takes 190 ms.

### Phase 2: Piano library and working effects

- Audio strategy: Nearest recorded root at the touch-adjusted velocity. Grand selects v4/v10 at MIDI velocity 70 and Upright switches from L to H above 80. Rhodes uses one recorded dynamic, the original harp sustain loops, velocity-sensitive gain and filtering. Clav, Digital, Misc and the fallback use live synthesis.
- Generated sound sources: Live harmonic oscillators and decay envelopes; Sympathetic partials of undamped acoustic strings; Deterministic stereo reverb impulses generated in memory
- Recorded sample provenance: Salamander Grand Piano V3 — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/grand/salamander-grand-v3/ (upstream: https://github.com/sfzinstruments/SalamanderGrandPiano at 3382bf9496bb) (CC-BY-3.0); Upright Piano KW — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/upright/upright-piano-kw/ (upstream: https://github.com/freepats/upright-piano-KW at 570f6c60ed2e) (CC0-1.0); Rhodes Mark I, GM version (Discord SFZ GM Bank) — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/electric/learman-rhodes-gm/ (upstream: https://github.com/sfzinstruments/Discord-SFZ-GM-Bank at 7a9c478fe331) (CC0-1.0)
- Bundled audio: 123 files (9.4 MB)
- Audio note: 25 roots from MIDI 27 through 99 in minor thirds. The nearest root is transposed at playback. Velocities 1–69 use v4, 70–127 use v10, with continuous per-strike gain scaling.
- Audio note: 32 logical voices. At capacity, steal the oldest released voice, then the oldest sustained voice, then the oldest held voice. Stolen voices fade over 15 ms. Ordinary damper release takes 190 ms.

### Phase 3: Complete Stage 4 system

- Audio strategy: Nearest recorded root at the touch-adjusted velocity. Grand selects v4/v10 at MIDI velocity 70 and Upright switches from L to H above 80. Rhodes uses one recorded dynamic, the original harp sustain loops, velocity-sensitive gain and filtering. Clav, Digital, Misc and the fallback use live synthesis. Organ and Synth use sample-clocked generators in the audio worklet on the piano context.
- Generated sound sources: Live harmonic oscillators and decay envelopes; Sympathetic partials of undamped acoustic strings; Deterministic stereo reverb impulses generated in memory; Organ oscillators, pipe and transistor ranks, seeded key click, shared-age percussion and pitch modulation; Analog and FM oscillators, pulse and noise sources, envelopes, modulation and resonant filters in src/synthesis.ts
- Recorded sample provenance: Salamander Grand Piano V3 — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/grand/salamander-grand-v3/ (upstream: https://github.com/sfzinstruments/SalamanderGrandPiano at 3382bf9496bb) (CC-BY-3.0); Upright Piano KW — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/upright/upright-piano-kw/ (upstream: https://github.com/freepats/upright-piano-KW at 570f6c60ed2e) (CC0-1.0); Rhodes Mark I, GM version (Discord SFZ GM Bank) — Stagebench sample pack stagebench-raw-samples@2.0.0, inputs/samples/electric/learman-rhodes-gm/ (upstream: https://github.com/sfzinstruments/Discord-SFZ-GM-Bank at 7a9c478fe331) (CC0-1.0)
- Bundled audio: 123 files (9.4 MB)
- Audio note: 25 roots from MIDI 27 through 99 in minor thirds. The nearest root is transposed at playback. Velocities 1–69 use v4, 70–127 use v10, with continuous per-strike gain scaling.
- Audio note: 32 logical voices. At capacity, steal the oldest released voice, then the oldest sustained voice, then the oldest held voice. Stolen voices fade over 15 ms. Ordinary damper release takes 190 ms.

## Phase 1: Complete surface and basic piano

**100/100**

A strong, faithful Phase 1 artifact. Measured against the published build at 1440x900: 73/73 keys (43 white, 30 black, E1-E7) all laid out inside the keybed, black-key height fraction 0.6094, deck/keybed 0.5344/0.4656, width fraction 0.9320, aspect 3.0928 - every chassis measurement inside tolerance. All 33 spec section landmarks render in their own sections, all 146 panel controls pass a 5x5 elementFromPoint hit test, and every forbidden-detection rule evaluates to zero. All five reference colours match within deltaE 2.4. Sound is genuinely sampled: 50 declared Salamander files fetched and played through AudioBufferSourceNodes (0 oscillators once loaded), with the declared oscillator fallback appearing only when sample loading is blocked. Pointer, multi-touch, computer keyboard and Web MIDI all drive one lifecycle; 40 simultaneous note-ons resolve to exactly 32 live voices; blur, CC123 and MIDI disconnect clear every voice. Weaknesses are cosmetic: overlapping silkscreen legends, static OLEDs, and a section band 3.9% short of the deck extent.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 100 |
| Playability & control | 55% | 100 |
| Feature completeness | 20% | 100 |

### Priority issues

- **minor** — Silkscreen legends collide in the rear-panel row and the Program band: Measuring the bounding boxes of all 592 <text> nodes in the rendered instrument at 1440x900 finds 10 overlapping pairs. Three are the rear-panel connector labels running into each other ('CONTROL PEDAL'/'ORGAN SWELL' by 5.4 px, 'ORGAN SWELL'/'SUSTAIN PEDAL' by 3.7 px, 'SUSTAIN PEDAL'/'TRIPLE PEDAL' by 2.5 px), which on the reference photograph are set on two lines and stay separate. Three more jumble the Program band, where the 'PAGE / CAT' silkscreen runs across the 'PROGRAM' dial legend (22.2 px) and over both page-button legends. Two more sit in the effects band ('AMP SIM / EQ' over 'SMALL - ROTARY', 'REVERB' over 'BOOTH - STAGE').
- **minor** — Panel displays and LEDs carry no live instrument state: The two OLEDs are static strings. Capturing #program-oled's innerHTML before and after driving the piano type and model controls, and again while a note was held, returned byte-identical markup reading 'PIANO / GRAND / Stage 4 73 / Acoustic Grand'. Likewise #control-deck's markup is byte-identical with the sustain pedal engaged and released, so no panel LED follows sustain, loading, ready or error state - those are reported only in the page chrome below the instrument. The layer ON/OFF green lamps are hardcoded lit (artifact/src/Panel.tsx:304) and do not track their own button's pressed state.
- **minor** — The six-section band spans only 96.1% of the deck extent: The six section groups span 1289.88 px of the instrument's 1342.08 px width, starting flush at the left edge and ending 52 px short on the right. The visual spec photo-measured its fractions over the deck extent x 1300-10300, which is effectively the instrument's full 1292-10305 bounds, so measured on that basis every section reads low: performance 0.1361, organ 0.1889, piano 0.0822, program 0.1217, synth 0.2406, effects 0.1917 (worst deviation 0.0111, still inside the 0.012 tolerance). Normalised to the band itself the proportions are near-exact (worst deviation 0.0035), so this is a datum offset rather than mis-proportioned sections.
- **minor** — White keys render 7.8 px wide at 390x844: At the narrow profile the instrument occupies 366.6 x 118.5 px (94.0% of the viewport) and nothing clips, but a white key's border box measures 7.78 px wide and the smallest silkscreen renders at about 2.2 CSS px, so accurate two-handed touch play and legend reading both require the zoom control. The zoom does work (two presses gave a 733 px instrument inside a 367 px scroll container, up to 400%), so this is a scale compromise rather than a failure.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**94/100**

A complete, honest Phase 2. Measured in the published build/ at 1440x900: deck/keybed 0.5344/0.4656, width fraction 0.932, aspect 3.0928, worst section-fraction deviation 0.0035, 73 keys (43/30) all inside the keybed at black-height 0.6094, 33/33 landmarks, 219/219 controls pointer-reachable, 0 forbidden, 5/5 reference colours within deltaE 2.4. Audio is real throughout: six piano types separated by 7.3-26 dB of 1/3-octave spectral shape and 200-2075 ms decays; all 24 effect types measurably behave like their namesakes (delay taps at the set 274/139 ms, feedback filter moves the tail 11-31 dB while the dry path moves 0.68 dB, compressor narrows 21.2 dB to 5.3 dB, reverb 290-1940 ms, rotary pans at 0.66/5.40 Hz and modulates the reverb tail, proving reverb precedes it); KB Touch, Dyn Comp, Timbre, Unison, Soft Release and String Res each move the signal correctly. One context, one destination, one limiter. Shortfalls are detail: 2 of the pack's 8 grand layers with a hard switch at velocity 70, Twin vs JC only 1.60 dB apart, and an undeclared presentation-only Model dial.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 92 |
| Playability & control | 20% | 100 |
| Feature completeness | 25% | 95 |

### Priority issues

- **minor** — Piano Model dial is presentation-only but not declared unsupported: #piano-piano-model has no entry in src/bindings.ts, so dragging it changes only local presentation state while its accessible description reports the live model name. IMPLEMENTATION_DETAILS.json surface.panelBehavior states that Piano controls 'operate the shared audio graph' and surface.unsupported does not mention the model dial. Because the build ships one model per type there is nothing for the dial to select, so no required behaviour is missing - but the declaration overstates what the Piano plate does.
- **minor** — Grand uses 2 of the pack's 8 Salamander velocity layers, switched not crossfaded: src/piano.ts:331 picks a layer with a single hard threshold at touch-adjusted velocity 70 (81 for Upright), and IMPLEMENTATION_DETAILS.json bundles only v4 and v10 for each of the 25 grand roots. The shared pack carries eight Salamander layers, so the available timbral resolution is halved four times over and the transition is a step rather than a crossfade. The pack's Wurlitzer EP200, Pianet T and CP80 are not used at all, so Electric rests entirely on the one-dynamic Rhodes.
- **minor** — Twin and JC amp models are only 1.60 dB apart in spectral shape: Measured on the same held note, mean 1/3-octave distance between the Twin and JC amp types is 1.60 dB, against 12.8-36.9 dB for the filter types and 3.9-6.0 dB for Small versus the rest. They are not identical - level differs by 3.2 dB and crest factor by 2.5 dB because the cabinet lowpass (3800 vs 6500 Hz) and tanh drive (2.6 vs 1.3) differ - so effects.json's 'must not sound identical' is satisfied, but a player who knows a Twin Reverb from a JC-120 would find them closer than the hardware.
- **minor** — Delay feedback filter and Compressor Fast are editor-only, not on the panel: effects.json lists 'Feedback filter Off/LP/HP/BP' among the Delay parameters and 'Fast mode' among the Compressor parameters. Both are implemented and measurably change the rendered signal (the filter moves the delay tail 11.3-31.3 dB), but they are reachable only from the in-app layer editor dialog opened from the voice name below the chassis; no control or shift-function on the rendered Layer Effects plate selects them.
- **minor** — Silkscreen legends render at about 3.6 CSS px and lose the hardware's red shift lettering: The default Ink size is 4.8 viewBox units and the instrument renders 1342 px wide for an 1800-unit viewBox, so secondary legends draw at roughly 3.6 CSS px and are illegible at 100%. Downscaling the reference photograph to the same 1342 px makes its silkscreen equally unreadable, so this is faithful rather than wrong, and a 1-4x zoom is provided. The real divergence is treatment: the hardware prints shift functions such as MST CLK, TO ROTARY and GLOBAL in red and sets the type lists in white boxes, while the build renders them in plain light silkscreen directly on the plate, and its OLEDs carry an inverted light header bar the hardware does not have.
- **minor** — At 390x844 the control deck is 47 px tall, so panel use depends on the zoom control: The instrument keeps its proportions exactly (366.6 x 118.5 px, aspect 3.0928, width fraction 0.940, deck/keybed 0.534/0.466) and every one of the 146 panel controls still passes the 5x5 elementFromPoint test, but the deck band is only 47 CSS px high and individual keys about 5 px wide, so precise operation at the default scale is impractical. The 1-4x zoom with a scrolling viewport and the playing guide mitigate this; the viewport width fraction is itself pinned to 0.88-0.97 by the spec, so the build cannot simply draw it larger.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**100/100**

A complete and measurably correct Nord Stage 4 73. Geometry sits inside every tolerance (deck 0.5344, keybed 0.4656, width 0.9320, aspect 3.0928, worst section deviation 0.0111); 73 keys (43/30) all lay inside the keybed at a 0.6094 black-key height ratio; all five reference colours match within deltaE 4.6; 33/33 landmarks render in their own section and all 146 panel controls are pointer-reachable by 5x5 hit-test, with no forbidden descriptor satisfied. The three engines are genuinely separate: organ and synth differ by 89.8 dB RMS over 16 harmonics, raising the 2-2/3' drawbar lifts the 3rd partial 33.0 dB, synth cutoff moves the harmonic centroid 5.90 -> 2.11, and the arpeggiator retriggers at 4.55 Hz against a 4.5 Hz setting. One AudioContext feeds a shared chain: delay on the organ lane taps at 1.55 s against a 1.5 s setting; rotary runs 0.68 / 5.02 Hz. Programs round-trip with a truthful E marker, edit-discard and Live auto-store; scenes, 11-position splits, morphs (76 -> 95.68 at wheel 82), transpose (+5.03 st) and Panic all behave across engines. Panel sub-legends are the one real simplification.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 100 |
| Playability & control | 20% | 100 |
| Feature completeness | 35% | 100 |

### Priority issues

- **minor** — The six deck sections tile only 96.1% of the instrument width: The deck's SVG viewBox is 1800 units wide but the section table (src/hardware.ts:32-39) places the six bands across 0-1730, leaving a 52.2 px (3.9% of width) strip of bare red chassis to the right of Layer Effects at 1440x900. Every band is therefore slightly narrow: performance 0.1361 vs 0.14, organ 0.1889 vs 0.20, piano 0.0822 vs 0.085, program 0.1217 vs 0.125, synth 0.2406 vs 0.25, effects 0.1917 vs 0.20. The worst deviation, organ at 0.0111, still falls inside the 0.012 tolerance, but only just. Measuring the reference photograph scaled to the same 1342 px instrument width puts the Layer Effects plate edge at 0.982 of width, so the hardware leaves about 1.8% of chassis there against this build's 3.9%.
- **minor** — Percussion alternate legends and their state LEDs are missing: On the reference photograph each B3 Percussion button carries a second silkscreen line with its own LED - VOLUME/SOFT, DECAY/FAST, HARMONIC/THIRD, plus POLY - and a B3 player reads percussion state off exactly those three LEDs. The build prints only VOLUME, DECAY and HARMONIC with a single POLY mark and signals state by lighting the button body instead (verified: toggling organ-percussion-volume switches its fill from mat-black to mat-red and lights an LED at rgb(255,102,86)). The behaviour is correct and legible through the accessible description, but the panel loses the hardware's at-a-glance labelling. The organ section header likewise omits the FX FOCUS and SOLO legends the photograph carries.
- **minor** — The B3 model has no tonewheel leakage, crosstalk or foldback: Tone.organ (src/synthesis.ts:87-133) sums nine pure sine ranks with per-model waveshaping, scanner vibrato, key click and percussion, but models none of the leakage, crosstalk or high-rank foldback that gives a real B3 its noise bed and its top-octave character. Measured partials above the 9th sit below -99 dB, where a tonewheel organ has a continuous leakage floor. Nothing in the pack is needed for this - it is pure synthesis - so a B3 player would hear the model as unusually clean. The required engine distinctions are all met regardless.
- **minor** — Delay Tap is the only panel control with no accessible description: Of the 146 panel controls, 145 expose a live aria-description carrying the current value or state; effects-delay-tap exposes none. The control is functional - it feeds the tap-tempo averager in Panel.tsx's change handler - but a screen-reader user gets no readout of what tapping it did, where every other control reports its value. Separately, multi-value selector buttons such as organ-organ-model expose aria-pressed="true" for every value other than the first, which misreports a six-way selector as a two-state toggle; the correct value is still carried in aria-description.
- **minor** — Spec and photograph disagree about whether the six section fractions tile the full width: specs/nord-stage-4.visual.json lists six horizontalSections fractions that sum to exactly 1.0, which implies the bands tile the instrument edge to edge. Measuring reference/nord-stage-4-73.jpg cropped to the variant's measuredInstrumentBounds and scaled to 1342 px shows the Layer Effects plate ending at fraction 0.982 and the performance band starting at 0.000, so on the hardware the plates cover about 98.2% of the width, not 100%. Any faithful rendering is therefore penalised slightly when its band widths are divided by the full instrument width. Reported per the rubric's instruction to flag spec/photograph disagreements; it does not change this artifact's measurements, which are reported against the full width as specified.

### Technical gate

Passed.
