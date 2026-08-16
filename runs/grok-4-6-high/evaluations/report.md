# Grok 4.6 High — Stagebench evaluation

- Run: `grok-4-6-high`
- Status: complete
- Aggregate: **66/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 72 |
| 2 | Piano library and working effects | 67 |
| 3 | Complete Stage 4 system | 54 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Live additive synthesis of a single piano-like voice. No recorded samples are used.
- Generated sound sources: phase1-basic-piano — additive-sine-partials
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Phase 1 provides one synthesized piano-like voice only.
- Audio note: Panel controls including Master Level are decorative and do not change the audible signal.
- Audio note: Sustain is driven by the Sustain pedal UI, the Space key, and MIDI CC64.
- Audio note: Generated buffers are never described as recordings.

### Phase 2: Piano library and working effects

- Audio strategy: Recorded sample playback for Grand, Upright, and Electric; live synthesis for Clav, Digital, and Misc; one AudioContext with per-layer effect chains, master gain, and limiter.
- Generated sound sources: clav-digital-misc-and-fallback — live-oscillators
- Recorded sample provenance: Grand — FluidR3 GM acoustic grand — FluidR3 GM acoustic_grand_piano notes packaged by midi-js-soundfonts (Frank Wen / Michael Deal). Recorded piano, not generated. (MIT); Upright — Upright piano KW (Kawai) — FreePats Upright piano KW, recorded from a Kawai upright in a living room by Gonzalo and Roberto (2017). (CC0 1.0); Electric — FluidR3 GM electric piano 1 — FluidR3 GM electric_piano_1 (recorded tine EP) packaged by midi-js-soundfonts. (MIT)
- Bundled audio: 166 files (12.0 MB)
- Audio note: Generated buffers are never described as recordings.
- Audio note: Master Level, Piano section, and Layer Effects are functional. Organ, Synth, and Program remain decorative.
- Audio note: Sustain honors per-layer SUSTPED from the UI pedal, Space key, and MIDI CC64.
- Audio note: Asset failure sets status to fallback (not ready), flashes the type LED, and reports LOAD FAIL on the Program display.

### Phase 3: Complete Stage 4 system

- Audio strategy: Recorded sample playback for Grand, Upright, and Electric; live synthesis for Clav, Digital, Misc, Organ (B3/Vox/Farf/Pipe), and Synth analog engines; one AudioContext with per-layer effect chains, a shared organ chain, master gain, and limiter.
- Generated sound sources: clav-digital-misc-and-fallback — live-oscillators; organ-b3-vox-farf-pipe — live-oscillators; synth-analog — live-oscillators
- Recorded sample provenance: Grand — FluidR3 GM acoustic grand — FluidR3 GM acoustic_grand_piano notes packaged by midi-js-soundfonts (Frank Wen / Michael Deal). Recorded piano, not generated. (MIT); Upright — Upright piano KW (Kawai) — FreePats Upright piano KW, recorded from a Kawai upright in a living room by Gonzalo and Roberto (2017). (CC0 1.0); Electric — FluidR3 GM electric piano 1 — FluidR3 GM electric_piano_1 (recorded tine EP) packaged by midi-js-soundfonts. (MIT)
- Bundled audio: 166 files (12.0 MB)
- Audio note: Generated buffers are never described as recordings.
- Audio note: Organ and Synth share the Phase 2 AudioContext, effect graph, master path, and destination.
- Audio note: Master Level is not stored in programs. Live slots auto-write edits. Dirty E compares the sounding patch to the last loaded slot.
- Audio note: Unsupported panel controls: program-morph-at (aftertouch morph), organ-preset-1 and organ-preset-2 (preset/Drawbar Live library).

## Phase 1: Complete surface and basic piano

**72/100**

A small, disciplined Phase 1 artifact (~3.2k LOC) whose audio and honesty work is strong and whose layout is not. Measured on rendered signal: pointer, computer keyboard and Web MIDI each drive a full note lifecycle (RMS 0 -> 0.11 -> 0 within ~300 ms), velocity maps monotonically (MIDI 20 -> 0.021, 100 -> 0.113; pointer key-top 0.030 vs key-bottom 0.155), sustain works from the UI pedal, Space and CC64, blur/MIDI-disconnect silence everything, and node accounting balances (505 created / 504 disconnected). IMPLEMENTATION_DETAILS.json is exactly true: the spectrum is six sine partials, no sample assets ship, and Master Level plus every panel control are provably inert. Two real defects: a held note plateaus at a fixed level instead of decaying and is then hard-cut at 8.0 s, and 50 of 151 controls (organ 19/36, piano 16/25, synth 15/38) are pointer-unreachable because the section boxes overflow (piano scrollHeight 501 vs clientHeight 214) and are painted under the keybed or past the chassis edge - contradicting the sealed visual audit's 'no clipping, no overflow'.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 70 |
| Playability & control | 55% | 78 |
| Feature completeness | 20% | 58 |

### Priority issues

- **critical** — One third of the control surface is unreachable by pointer at 1440x900: 5x5 document.elementFromPoint hit-testing of every [data-control-id] on the published build, unscrolled at 1440x900, finds 50 of 151 controls with no self-hit: organ 19/36, piano 16/25, synth 15/38. The sections are 216 px tall with overflow:visible while their content is taller (piano scrollHeight 501 / clientHeight 214, organ 395/214, synth 329/214), so the surplus rows are painted under the keybed (probing organ-model-b3 returns the key element data-key=39) or beyond the chassis (piano-sustped at y=697 vs chassis bottom 660; rotary-on spanning x=1375-1458 past the 1440 px viewport). Phase 1's hard gate requires every visible panel control to move or press accessibly; these can only be driven blind via Tab.
- **major** — Held notes are hard-cut at 8.0 seconds with no release: Oscillators are scheduled with osc.stop(when + MAX_NOTE_SEC) where MAX_NOTE_SEC = 8 (artifact/src/audio/piano-engine.ts:10, :149) while the voice gain is still at its 0.28 sustain plateau. Measured on the analyser tap, a held MIDI 55 reads 0.0386 RMS at 7.97 s and 0 by 8.07 s - the note disappears mid-hold with a discontinuity rather than decaying or releasing. Any pedalled or long-held chord loses its notes at the same instant.
- **major** — No continuing decay: the voice plateaus like an organ: The envelope is attack 5 ms, decay 450 ms to 28% of peak, then a flat sustain (artifact/src/audio/piano-engine.ts:6-9). Sampled every 500 ms, a held MIDI 60 stays within 0.0388-0.0397 RMS from 0.5 s to 8 s. A real piano note decays continuously; combined with a pure six-sine-partial spectrum and no attack transient, the voice reads as a sine-stack organ rather than a piano to a knowledgeable player.
- **minor** — Sealed visual audit claims no clipping or overflow: artifact/evidence/stage1-visual-audit.md states 'Entire chassis remains in view; no clipping, no overflow' and tabulates each section's landmarks as present. Measurement of the published build contradicts this for 50 controls across three sections. The audit also lists 'Known deviations' but does not mention the overflow.
- **minor** — Audio tests validate a self-authored simulator, not browser signal: Every audio assertion (piano-lifecycle.test.ts, piano-sustain-polyphony.test.ts) calls renderPianoScript, which builds a SoftwareAudioContext - the candidate's own ~310-line DSP model (artifact/src/audio/software-context.ts) - and asserts RMS on its output. No test touches a browser AudioContext or OfflineAudioContext, so the tests would pass unchanged even if the real Web Audio path were wrong. The production path does use the native AudioContext when present (software-context.ts:307-309), and I confirmed real rendered output independently.
- **minor** — Section legends render at 5.76px; narrow viewport leaves 37/151 controls reachable: Computed font-size for section switch legends is 5.76px at 1440x900. At 390x844 the chassis is 367x122 px with a 342x51 px keybed and only 37 of 151 controls pass the same hit test, so the panel is essentially display-only on a phone.
- **minor** — One console error on load: Loading build/index.html logs a single 'Failed to load resource: 404' - a missing favicon, not application code. No page errors or uncaught exceptions occurred during the entire interaction pass, including the forced audio-failure run.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**67/100**

A genuinely working Phase 2 audio build. One AudioContext, per-layer buses, the documented chain order, master gain + limiter, one destination (measured: 1 context, 1 destination connect). Three real recorded banks (waveform correlation 0.10-0.49 between grand/upright/electric, 17 roots each, 66 valid WAVs, zero network requests after load) and six audibly distinct types. Every effect unit and every listed type measurably changes rendered signal: delay repeats track the tempo knob to within 2 ms, reverb tails run 220-910 ms across the six types, all seven amp types differ. Inputs are excellent: pointer, computer keys, Web MIDI, CC64/Space/UI sustain, per-layer SUSTPED, 36-note polyphony with clean silence afterwards, visible failure state, zero console errors. Weak spots are panel truth and gain staging: type and layer-focus LEDs contradict the actual state, Timbre (including Dyno 1/2) does not measurably change the signal, the model encoder is inert, the compressor mostly adds level, and maxed drive clips the destination at peak 1.41.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 67 |
| Playability & control | 20% | 65 |
| Feature completeness | 25% | 70 |

### Priority issues

- **major** — Destination clips at peak 1.41 with drive controls maxed: A 10-note chord at velocity 1.0 with Amp drive 1.0, amp type To Rotary and rotary drive 1.0 rendered destination peak 1.43 and 1.41 across two runs (rms 0.61-0.68). The master DynamicsCompressor limiter (threshold -8 dB, ratio 20, effects.ts:751-768) does not hold the output below full scale, because the drive waveshaper tanh(x*(1+12*drive)) supplies more than 18 dB of gain before it. The same chord bypassed peaks at 0.271.
- **major** — Timbre (and Dyno 1/2) does not measurably change rendered audio: Grand at MIDI 72 velocity 1.0, four shots averaged per setting: centroid 2036 / 1949 / 2024 / 2177 Hz for Off/Soft/Mid/Bright with high-band energy non-monotonic (Soft 13.15 > Bright 10.70). On Electric the six settings gave 743 / 833 / 731 / 844 / 825 / 768 Hz with no ordering, so Dyno 1 and Dyno 2 are indistinguishable from Off. piano-engine.ts:485-495 places the lowpass cutoff at 4.7-13 kHz, above the useful bandwidth of the 22.05 kHz sample bank.
- **major** — Focus and type LEDs contradict the instrument state: After clicking the layer B focus button, both A and B focus LEDs read aria-pressed=true while the panel reported layer B; one click of the A focus button then turned A's LED off without moving focus, and a second click was needed to return. Separately, cycling the TYPE button through all six piano types left piano-type-grand lit and the other five dark at every step - typeLedValues() at apply-control.ts:165 is exported but never imported.
- **major** — Compressor adds level rather than reducing dynamic range: At amount 0.95 the loud-to-soft (velocity 1.0 vs 0.2) span narrowed only from 12.46 dB to 10.35 dB while overall level rose 10.15 dB. The audible result is a volume boost, not the dynamic-range control the manual describes. Fast mode is measurable (peak 0.227 -> 0.203, crest 6.27 -> 5.63).
- **major** — All five Phase 2 hard gates self-certified despite measurable failures: IMPLEMENTATION_PLAN.md marks every hard gate [x], including the requirement that every functional control measurably changes rendered audio and agrees with its panel feedback. Measured counter-examples: Timbre/Dyno, the inert model encoder, the piano type and focus LEDs, and the delay tap knob. The visual audit's claims 'Per-unit LEDs match processing' and 'OLED now shows the focused piano model name' are also not borne out.
- **minor** — Piano MODEL encoder is inert and undeclared: apply-control.ts:92 writes layers[focus].model but no code in src/audio or src/components reads it, so the model dial changes neither audio nor the Program display, which always shows the type label. The piano spec's modelDialSelectsWithinType and modelNameShownInProgramDisplay are unmet, and the gap is not declared.
- **minor** — FX focus buttons write state nothing reads: apply-control.ts:62-64 sets state.fxSectionFocus from the three focus buttons, but no consumer exists in the artifact; knob edits always target the focused piano layer. Effect focus therefore only follows layer focus, and the manual focus buttons are decorative without being declared as such.
- **minor** — No panel readout of the selected effect type, and tap tempo desyncs its knob: Mod 1, Mod 2, Amp, Reverb and the delay filter all cycle through their types via plain LED toggle buttons with static labels, so the player cannot see which of six types is active. Tapping the delay TAP button twice 500 ms apart produced 500 ms repeat spacing in the audio while the DELAY TEMPO knob stayed at aria-valuenow 0.45.
- **minor** — Sampled notes loop instead of decaying, and levels jump between types: piano-engine.ts:370-372 sets loop=true with loopStart 0.14 s on every sampled voice, so a held piano note sustains indefinitely at the 28% plateau rather than decaying. Rendered RMS also jumps about 11 dB between sampled types (0.0095-0.0114) and synthesised ones (0.0212-0.0347), so switching type changes loudness as much as timbre.
- **minor** — Chorus and Ensemble render no stereo width: Measured (L-R) RMS relative to L was 0.000 for every Mod 2 type including Chorus and Ensemble; only Mod 1 A-Pan (0.948) moves the stereo field. The effects spec describes Chorus as detuned widening and Ensemble as three cross-connected modulated delay lines, both stereo effects on the hardware.
- **minor** — Candidate audio tests assert on a self-written simulator, not browser-rendered signal: Every audio test routes through renderPianoScript (piano-engine.ts:607-619), which builds the candidate's own SoftwareAudioContext (src/audio/software-context.ts, 713 lines) under vitest with environment 'jsdom'; no OfflineAudioContext or browser is involved. The suite is therefore not a mock-only suite - it does real DSP - but effect correctness is validated against the candidate's own model, which is how issues such as the inaudible Timbre filter (asserted only as meanAbsDiff > 0.001 in src/piano-velocity-controls.test.ts) pass while failing in the real browser graph.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**54/100**

Deep, largely honest system underneath a broken deck layout. Engines are genuinely separate and measurably distinct (piano grand/electric/clav/digital spectral centroids 1835/1181/1544/853 Hz; organ B3 2nd harmonic -94.8 dB vs Vox -44.2 dB; six synth waveforms), one AudioContext, delay/reverb A/B cleanly. But .chassis{overflow:hidden} plus section content taller than its 215.6 px box buries 72 of 198 controls under the keybed: no organ model/percussion/rotary switches, no piano model/timbre/detail controls, no LFO or arpeggiator, no transpose/panic/split controls are reachable at 1440x900. Program recall changes the audio (B3 Gospel 0.517 RMS vs grand 0.017) but moves zero panel controls. The organ reads ON at load yet is silent until organ-on is cycled. B3 Gospel with 17 notes hard-clips at peak 1.671. Geometry, keybed and colour are excellent: 73/43/30 keys all inside the keybed, black-key fraction 0.6099, all five reference colours within deltaE 2.2.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 60 |
| Playability & control | 20% | 50 |
| Feature completeness | 35% | 50 |

### Priority issues

- **critical** — Section content overflows the deck and is buried under the keybed, making 72 of 198 controls unreachable: Each .section is a fixed-height flex child (215.6 px at 1440x900) but its children lay out to roughly twice that, and .chassis{overflow:hidden} (artifact/src/styles.css:56) plus the later-painting .keybed-shell hides everything past the deck. A 5x5 document.elementFromPoint probe over every [data-control-id] at 1440x900, page unscrolled, resolves 126/198. The casualties are whole landmark groups: all five organ model switches, all four percussion controls, all three rotary controls, organ vibrato, the piano model encoder, all four piano timbre knobs, both piano-detail switches, all four piano zone buttons, transpose up/down, panic, all three split points and the split crossfade, and the entire synth LFO and arpeggiator block. At 390x844 only 32/198 are reachable.
- **critical** — Program recall updates the audio and the OLED but not a single panel control: Snapshotting aria-pressed/aria-valuenow for all 198 controls before and after selecting program 4 (B3 Gospel, which sets pianoOn=false, organOn=true, percOn=true, rotaryOn=true at artifact/src/model/instrument-state.ts:713-724) yields 0 differences, and the same for slot 8. The audio does change (0.51734 RMS / centroid 378 Hz vs 0.01653 / 1833 Hz), so the panel is actively reporting a state the instrument is not in — the honesty contract inverted.
- **major** — Organ is silent on load while its panel says ON: On a fresh page the organ section reports organ-on aria-pressed="true" and organ-layer-a-enable="true" with drawbars 8/8/8, yet pressing C4 with the piano muted measures 0.00000 RMS at the destination. Toggling organ-on off and on with nothing else changed produces 0.10775 RMS. Reproduced in three independent browser sessions.
- **major** — Organ programs hard-clip the output under normal polyphony: Holding 17 notes on program 1.4 (B3 Gospel) measures peak sample 1.6712 with 30 of 30 sampled frames above 0.999, taken at the output of the DynamicsCompressor that feeds AudioDestinationNode. The same chord on piano peaks at 0.2704 and on the synth lead at 0.3324. Per-engine level spread on a single note is 17 dB (Farf 0.0148 to B3 0.1078).
- **major** — Store never commits on the second press because it is gated on a latching toggle: artifact/src/model/apply-control.ts:193 runs beginStore only when value >= 1, but program-store is a LedButton that toggles 1/0. Press 1 enters store mode, press 2 sets the value to 0 and does nothing, so the OLED stays on "STORE 1.5" through program selects, Live Mode and page navigation until a third press. program-exit has the same shape.
- **minor** — Rendered aspect ratio is 2.9994 against a 3.0951 target: The instrument box measures 1353.59 x 451.28 px at 1440x900. The element advertises data-aspect="3.0951" and .stage sets aspect-ratio (artifact/src/styles.css:42), but the rendered height exceeds what that ratio implies, putting the instrument 0.0957 outside the +/-0.06 tolerance and making the chassis noticeably squatter than the reference.
- **minor** — Effects plate legends overlap and the rotary column is cut off at the chassis edge: The six section flex-bases sum to the deck content width while five 0.45% gaps are added on top, so the sections overrun the deck by ~29.7 px and the effects section ends at x=1410.6 against a chassis right edge of 1396.8. In the rendered deck "COMPRESSOR ON" prints over the DELAY column and "REVERB BRIGHT" over "ROTARY SPEAKER DRIVE".
- **minor** — MIDI CC1 and pitch bend are ignored: artifact/src/input/midi.ts:86-107 handles note on/off, CC64 and CC11 only. Sending 0xB0 01 127 and 0xE0 00 100 to an injected input port left perf-mod-wheel and perf-pitch-stick at aria-valuenow="0". Note on/off and sustain do work end to end.

### Technical gate

Passed.
