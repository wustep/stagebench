# Gemini 4 Neon High — Stagebench evaluation

- Run: `gemini-neon-high-p3`
- Status: in-progress
- Aggregate: **95/100**
- Coverage: 1/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 96 |
| 2 | running | — |
| 3 | queued | — |

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
