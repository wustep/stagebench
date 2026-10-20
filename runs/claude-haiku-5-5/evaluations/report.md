# Claude Haiku 5.5 High — Stagebench evaluation

- Run: `claude-haiku-5-5`
- Status: in-progress
- Aggregate: **84/100**
- Coverage: 1/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 80 |
| 2 | running | — |
| 3 | queued | — |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Live synthesis only. The single Phase 1 piano voice is generated in the browser with Web Audio oscillators (six inharmonic sine partials, per-partial exponential decay, velocity-dependent partial levels and low-pass cutoff). No recorded or bundled audio files are used.
- Generated sound sources: Phase 1 additive piano voice — Six sine partials per note at equal-tempered frequencies with a small inharmonic stretch (B = 0.0004), amplitudes proportional to k^-1.1 and rising with velocity, a velocity-scaled low-pass (1.2–10.2 kHz), exponential decay with a note-length-dependent time constant, and a release ramp on note-off. Generated at note-on; not a recording.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: No sample sets are bundled in Phase 1. Grand, Upright and Electric recorded sample sets are Phase 2 scope; the piano spec allows honest synthesis for Phase 1.
- Audio note: No generated buffer is described as a recording. Nothing in the bundle is recorded audio.
- Audio note: The Web Audio path is: each voice -> voice low-pass -> master gain (0.3) -> AudioContext destination. No bypass.
- Audio note: The AudioContext is created on the first user gesture. If Web Audio is missing the instrument reports a labelled silent fallback; if the context refuses to resume it reports an error. The status line in the page shows which applies.
- Audio note: Pointer and computer-keyboard velocity is fixed at 100 in Phase 1 (KB Touch is Phase 2). MIDI uses the incoming note velocity.
- Audio note: Sustain applies to every voice in Phase 1 because there are no layers yet. Per-layer SUSTPED routing is Phase 2.
- Audio note: Known audio gaps: no pedal noise, no string resonance, no unison or soft-release shaping, no timbre filtering, no layer behaviour. All panel controls in the piano, effects, organ, synth and program sections are decorative in Phase 1.

## Phase 1: Complete surface and basic piano

**80/100**

A disciplined, honest Phase 1. Geometry is near-exact at 1440x900: deck 0.5400 / keybed 0.4600, width 0.9400, aspect 3.09514, 73/43/30 keys all inside the keybed, black-key height 0.60996, and all five reference colours at CIE76 dE 0.00. All 33 section landmarks render in their own band, no forbiddenDetection rule fires, and only the synth width fraction (0.01315) falls outside tolerance. The piano voice is genuinely live-synthesised — three network requests, no sample APIs in the bundle — and it is dependable: velocity 12.1x over MIDI, sustain holding a tail to RMS 0.0091 at 600 ms against 0.0000 unsustained, 16-voice stealing, and clean all-notes-off on blur, visibility change and MIDI disconnect, with zero console output throughout. The deck is where it falls down. A dead onPointerEnd handler leaves all 52 continuous controls tracking a released pointer and the pitch stick never recentring; row overflow buries piano.layer-b-octave and program.button-8 beyond any pointer; legends overprint each other in all six sections and knob caps render as ellipses. The audit is candid but wrongly claims no control leaves its section.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 77 |
| Feature completeness | 20% | 83 |

### Priority issues

- **major** — Two panel controls are impossible to operate with a pointer: At 1440x900, piano.layer-b-octave (rect x 638.2 w 17.2) overflows 31.5px past the piano section and program.button-8 (rect x 798.1 w 25.0) overflows 29.0px past the program section; both are covered by the neighbouring section's .row. An exhaustive 1-pixel elementFromPoint scan of each bounding box found zero reachable points, and a real page.mouse press-drag at each centre left aria-valuenow at 50 and aria-pressed at 'false'. This contradicts the Phase 1 hard gate 'Every visible panel control moves or presses accessibly'. Cause: .row uses flex-wrap: nowrap with .section overflow: visible (artifact/src/styles.css:106,153-161), so rows wider than their section spill into the next band.
- **major** — Drag gestures never end: all 52 continuous controls follow a released pointer: useContinuous returns a handler named onPointerEnd (artifact/src/components/Controls.tsx:75-83), spread onto each control at lines 109, 123, 138, 152 and 166. onPointerEnd is not a React DOM event name, so it is never bound and drag.current is never cleared on pointer up. Measured: synth.filter-cutoff was dragged to 96 and released, then moving the mouse over it with no button pressed drove it to 38. The same dead handler means performance.pitch-stick never springs back to centre — it read 94 and stayed at 94 after mouse-up, where the code intends to reset it to 0.5.
- **major** — Legends overprint each other in all six sections: At the rendered 236px deck height, legend text clamps to its 6px floor and still collides. In the piano band 'Layer A focus', 'Layer A on', 'Piano type' and 'Layer A octave' are printed on top of one another; in the program band the group titles 'PAGE' and 'STORE AND SPLIT' overprint the Program 2-7 legends; in the synth band the four envelope legends collide under overlapping 'FILTER' and 'ENVELOPE' titles. Captured at 3x in scratch/eval1-crop-piano.png, -program.png and -synth.png. The artifact declares the collisions but calls them purely visual; they also make several controls unidentifiable on the panel. reviewer: re-measured - the collisions are not confined to four sections. Legend-on-legend intersections at 1440x900: organ 1, piano 4, synth 4, effects 1; group-title-on-legend intersections: performance 3, organ 5, piano 4, program 7, synth 2. All six sections are affected. Legend font-size resolves to 7.58012px, not the 6px clamp floor (clamp(6px, 0.56cqw, 9px) at a 1353.59px container).
- **minor** — Knob caps render as ellipses and slivers rather than circles: styles.css:284-291 sizes .knob-face with equal width and height but leaves it a shrinkable flex child, so it is compressed vertically wherever the row is tight. effects.amp-drive, effects.amp-tone and effects.amp-level render as near-flat slivers, and the synth, effects, performance and organ knobs are all tall ellipses. A knob that is not round is the first thing a player notices on a Nord panel. reviewer: mechanism and defect confirmed (.knob-face is width/height var(--d) with border-radius 50% at styles.css:284-291, compressed as a shrinkable flex child), but two details corrected: effects.amp-drive measures 10.97x13.89 and is a tall ellipse, not a sliver - amp-tone and amp-level at 15.48x2.31 are the slivers; and 26 of 38 knob faces deviate more than 12% from square, most of them flattened rather than tall, while 12 are effectively round. Worse than reported: piano.layer-a-octave and piano.layer-b-octave render with a .knob-face height of exactly 0.
- **minor** — Visual audit claims zero controls outside their section; 11 are: evidence/stage1-visual-audit.md records 'Controls or groups outside their section | 0 | 0 | pass'. Measured against each section's own box at 1440x900: piano.layer-a-on -30.4px, piano.layer-a-focus, piano.layer-b-level, piano.layer-b-octave +31.5px, piano.soft-release, piano.section-on, program.button-1 -28.0px, program.button-7, program.button-8 +29.0px, performance.pitch-stick and performance.mod-wheel +1.8px bottom. Two of them are the unreachable pair above.
- **minor** — Synth section width fraction is just outside tolerance: The synth band measures 0.23685 of the instrument width against the specified 0.25, a deviation of 0.01315 against a 0.012 tolerance; it is the worst of the six (next worst: organ and effects at 0.00859). Sections are flex-grown from the spec fractions but each one's padding and inset-plate margins are consumed inside the flex item (styles.css:105,114), so the wider sections lose proportionally more width.
- **minor** — Only 37% of the instrument is reachable at 390x844, with no scroll affordance: The instrument keeps a fixed 1000px width inside a nested overflow-x: auto region (styles.css:590-599). Nothing clips or collapses and geometry is exact, but key 60 sits at x=458.9 — off-screen at the scroller's origin — and macOS overlay scrollbars give no visible cue that the region scrolls. Declared as a deliberate deviation in the visual audit. reviewer: all numbers reproduce. Kept as a minor issue, but narrowRetention is re-rated 3 rather than 2 - see that criterion's reviewer note.
- **minor** — Keybed keys carry no role, name or tab stop; computer keys reach 17 of 73 notes: All 73 .key elements measured with tabIndex < 0, no role and no aria-label, so the keybed is invisible to assistive technology and cannot be played from the keyboard focus ring, unlike the 103 panel controls which are all tabbable and named. The computer-key map covers MIDI 60-76 only (artifact/src/input/computerKeys.ts:4-21) and the octave-shift control is decorative in Phase 1, leaving 56 of the 73 keys unreachable without a pointer or MIDI.
- **minor** — Every audio test runs against a fake AudioContext: artifact/src/audio/pianoVoice.test.ts, engine/pianoEngine.test.ts and engine/noteController.test.ts all assert against artifact/src/audio/testing/fakeAudioContext.ts; there is no OfflineAudioContext or rendered-signal test anywhere in the artifact (grep for OfflineAudioContext returns nothing). The task's audio test rules require more than a state-only test with fakes when behaviour is claimed audible. The behaviour is in fact audible — I measured it — so this is a test-evidence gap, not a functional one.
- **minor** — Synth OLED truncates its own text: #synth\.oled renders 'SYNTH / NOT ACTIVE IN PHA…' — .readout-line sets text-overflow: ellipsis with nowrap (styles.css:487-494) and the display is only 38% of its section width, so the honest status message is cut mid-word. The accessible name still carries the full string. reviewer: confirmed - the second .readout-line has scrollWidth 113 against clientWidth 98. The display is 36.4% of its section width, not 38%.

### Technical gate

Passed.
