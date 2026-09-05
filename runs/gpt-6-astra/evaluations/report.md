# GPT-6 Astra High — Stagebench evaluation

- Run: `gpt-6-astra`
- Status: complete
- Aggregate: **89/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 91 |
| 2 | Piano library and working effects | 72 |
| 3 | Complete Stage 4 system | 88 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: One original piano-like additive synthesis voice, rendered into generated mono buffers at note onset and played through Web Audio. No recorded samples and no network audio assets.
- Generated sound sources: Basic additive piano — Six additive partials with slight inharmonicity, harmonic-dependent exponential decay, a 4 ms attack and 60 ms buffer-tail fade; partials above 45% of sample rate omitted. Up to 16 note buffers cached.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Piano timbre is an approximation, not the Nord Piano Library or a recorded acoustic piano.
- Audio note: Held/sustained notes decay naturally and end after eight seconds. Sustain postpones the damper release; it does not loop the waveform.
- Audio note: UI sustain, keyboard Space and per-device/channel MIDI CC64 are combined independently.
- Audio note: All panel controls including Master Level are presentation-only. The audio master is fixed at 0.32.
- Audio note: Browser OfflineAudioContext tests render this actual audio graph and verify non-silence, continuous velocity response, release and sustain duration. Fake boundaries separately verify deterministic ownership and node/listener cleanup.

### Phase 2: Piano library and working effects

- Audio strategy: One AudioContext with one stereo AudioWorklet. Original synthesized models for all six types; Grand/Upright/Electric explicitly labeled playable fallbacks because no recorded assets were supplied in inputs/. Recorded-library hard gate is NOT satisfied.
- Generated sound sources: Grand synthesis fallback — Six decaying, mildly inharmonic additive partials; Upright synthesis fallback — Brighter partial spectrum and stronger inharmonicity; Tine synthesis fallback — Fundamental with transient seventh harmonic; Clav synthesis — Bright rapidly decaying plucked harmonics; Digital synthesis — Velocity-sensitive FM with decaying modulation index; Mallet synthesis — Three noninteger-ratio partials with separate decay rates
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: There are no bundled recordings. The recorded Grand/Upright/Electric hard gate remains unmet under the input-only constraint.
- Audio note: Soft/sostenuto pedal, half pedaling and pedal noise are not implemented or claimed.
- Audio note: String resonance is additive sympathetic resonance when other voices or the pedal are held, not a recording.
- Audio note: All notes naturally decay and are retired after 12 seconds at the latest.
- Audio note: The inherited Phase 1 BrowserAudio and tests remain intact as historical regression fixtures; the production app uses LayerAudio and LayeredPianoEngine.
- Audio note: All-effects stop clears voice and delay/reverb history. The worklet owns no application timers. Disposal closes the context, port and callbacks.

### Phase 3: Complete Stage 4 system

- Audio strategy: One AudioContext and one stereo AudioWorklet integrate two Piano layers, two Organ layers, and three Synth layers through six inherited effect chains and one shared master/limiter destination. Organ and Synth use original live synthesis, not recordings or vendor DSP. Piano Grand/Upright/Electric retain explicitly labeled synthesis fallbacks because no source recordings were supplied.
- Generated sound sources: Grand synthesis fallback — Six decaying, mildly inharmonic additive partials; Upright synthesis fallback — Brighter partial spectrum and stronger inharmonicity; Tine synthesis fallback — Fundamental with transient seventh harmonic; Clav synthesis — Bright rapidly decaying plucked harmonics; Digital synthesis — Velocity-sensitive FM with decaying modulation index; Mallet synthesis — Three noninteger-ratio partials with separate decay rates; B3 / B3 Bass organ — Nine additive tonewheel partials; B3 Bass restricts the same engine to 16-foot and 8-foot drawbars. Deterministic pseudorandom key click and decaying second/third harmonic percussion.; Vox organ — Transistor-style odd-harmonic partial mixtures with drawbar-dependent rank weighting.; Farf organ — Thresholded drawbar registers with saturated fundamental/second-harmonic mixtures.; Pipe 1 / Pipe 2 organ — Additive pipe ranks with mild rank detuning and additional harmonic components; Pipe 2 reuses a brighter registration.; Analog Synth: Pure, Sync, Multi, Super, FM-H — Fourteen generated waveforms: Sine, Triangle, Saw, Square, Pulse 33, Pulse 10, White Noise, Sync Saw, Sync Square, Multi Saw, Multi Saw 8ve, Super Saw, Super Square, FM 2-op (algorithm A). Pure ignores Osc Ctrl by specification; Sync changes slave pitch, Multi/Super change detuning, FM-H changes modulation amount.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: No bundled recordings: the inherited Grand/Upright/Electric recorded-library hard gate remains unmet. Synthesized fallback labels and empty recorded provenance are retained.
- Audio note: Organ and Synth are original approximations of the documented families, not vendor DSP or sampled instruments. B3 Bass and Pipe 2 reuse their documented parent engines.
- Audio note: Piano notes retain the inherited 12-second retirement cap. Organ/Synth voices continue while held; release, Panic and disposal clean up owned voices. Arp hold intentionally retains notes until released by hold-off, voice replacement or Panic.
- Audio note: Organ A/B levels precede their shared effects to retain individual layer balance; this is an approximation of the nominal post-effect level order.
- Audio note: Phase 1 BrowserAudio and Phase 2 LayeredPianoEngine remain regression fixtures. Production App defaults to SystemEngine, which extends the inherited engine and shares LayerAudio.
- Audio note: Production DSP is tested directly with deterministic rendered Float32Arrays. Phase 3 browser OfflineAudioContext/worklet evidence has not completed; no browser success is claimed.
- Audio note: Soft/sostenuto pedal behavior is not implemented. Piano string resonance remains an additive simulation.

## Phase 1: Complete surface and basic piano

**91/100**

A strong, honest Phase 1. Measured against the served build/ at 1440x900 the chassis is effectively exact: deck/keybed 0.53998/0.46002, width 0.94002, aspect 3.09511 vs 3.0951, six section fractions within 1e-5. 73 keys (43/30, E1-E7) all inside the keybed, black-key height 0.61. All 33 section landmarks present, 155/155 controls reachable by the 5x5 elementFromPoint test, 0 forbidden descriptors satisfied, 5/5 reference colours within deltaE 12. Audio is real: silence 0.000 -> 0.080 RMS on a held key -> 0.000 on release, accurate pitch across five octaves, exponential decay, 0.22 s release, MIDI velocity 20 vs 127 at 0.006 vs 0.117, sustain from UI/Space/CC64, a 32-voice cap, all-notes-off on blur, disconnect and Stop notes. Pointer, independent multi-touch, keyboard with repeat suppression and Web MIDI all reach one lifecycle; every failure path degrades truthfully with a clean console, and the decorative boundary is enforced in the graph, not just asserted. Weaknesses are detail, not structure: 139 of 155 legends render at 3.45 px with 11 overlapping other controls, both OLEDs are static, pointer velocity is fixed, and the voice is a flat six-partial approximation.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 91 |
| Feature completeness | 20% | 100 |

### Priority issues

- **minor** — Silkscreen legends are illegible at rendered size and collide with hardware: At 1440x900, 139 of the 155 .legend spans compute to font-size 3.45174px (7 at 4.06px, 9 at 4.74px); at 3x magnification they resolve only as grey smears. 11 legend boxes overlap a different control's border box by >2px in both axes (organ-vibrato-mode over organ-vibrato-a and organ-vibrato-b; effects-compressor-on over effects-compressor-amount; synth-amp-envelope over synth-amp-velocity; effects-delay-tap-tempo over effects-delay-rate and effects-reverb-rate), and 12 legend pairs overlap each other so the program morph-assign row runs together into one unreadable line. In the performance rotary stack each legend lands over the button above its own, making the whole column read as mislabelled.
- **minor** — Both primary OLEDs are static and never read a live value: The program OLED holds 'PHASE 01 / Basic piano / SYNTHESIZED VOICE / Panel is decorative' and the synth OLED holds 'OSCILLATOR / Panel only / ENGINE INACTIVE' through every interaction measured - playing notes, latching sustain, moving knobs, connecting and disconnecting MIDI. The displays are correctly placed and well rendered but carry no state; live status appears only in the surrounding page text. The text is honest for a decorative panel, so this is a completeness limit rather than a false claim.
- **minor** — Pointer and touch play at a fixed velocity: Pointer presses are dispatched at a constant velocity 96 regardless of where on the key they land - measured maxRms 0.0801 pressing at 10% of key height versus 0.0808 at 95%. Only pen pressure and MIDI vary velocity, so mouse and touch players get one dynamic level. IMPLEMENTATION_DETAILS.json does not claim otherwise, and MIDI velocity response is correct (0.006 at velocity 20 vs 0.117 at 127).
- **minor** — Voice level and timbre are flat across the keybed: Onset RMS measured 0.0757 / 0.0758 / 0.0759 / 0.0752 / 0.0705 at MIDI 28, 40, 60, 79 and 100 - essentially constant across five octaves, with the same six-partial structure at every pitch, no attack transient and no sympathetic resonance. Pitch, decay and release are all correct; the character is simply uniform in a way real piano registers are not.
- **minor** — Test coverage for the 11 feature IDs is thin: src/audio.test.ts (75 lines), src/inputs.test.ts (46), src/App.test.tsx (48) and tests/browser.mjs (114) total 283 lines and 20 vitest cases covering all 11 required Phase 1 feature IDs. Every ID does map to a real, non-empty test and every behaviour I re-verified in the running build held, but each ID rests on only a handful of assertions, so the suite would not catch much regression in Phase 2.
- **minor** — A typographic study heading sits above the instrument: The page opens with 'INTERACTIVE INSTRUMENT STUDY / Nord Stage 4 / 73' and a '01 - SURFACE + PIANO' badge, occupying the top 187 px before the chassis begins. It is set type, not a marketing hero image - the build ships no image asset at all (zero url() references in the CSS, no jpg/png/webp in either bundle), so specs presentation.allowReferenceImageAsRenderedBackground is honoured - and the instrument still fits without vertical scroll (scrollHeight 900 == viewport). Worth noting only because presentation.allowMarketingHeroAboveInstrument is false and this occupies a fifth of the fold.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**72/100**

Measured against the published build/ on port 4172. Panel fidelity is near-exact: deck 0.53998 / keybed 0.46002, width 0.94002, aspect 3.09511 vs 3.0951, worst section deviation 0.00001, 73 keys (43/30) all inside the keybed, black-key height 0.60999, 5/5 reference colours (worst dE 4.44), 33/33 landmarks in their own sections, 155/155 controls reachable by 5x5 elementFromPoint hit-testing, all 11 forbidden rules zero. Phase 2 behaviour is real, not just declared. I verified the AudioNode graph directly (one context, one AudioWorkletNode -> destination) and A/B-rendered every effect unit, all 30 types, both layers and every piano control: each moves the signal as documented, bypass restores the dry path, a 15-note chord peaks at 0.77 unclipped, and pointer, keyboard and MIDI reach one lifecycle with no console errors. Two things hold it back: the required recorded Grand/Upright/Electric sample sets do not exist (empty manifest, all six types synthesised), declared openly but not substitutable; and the silkscreen is poor at size - 15 overlapping legend pairs, one legend outside its section, a Program OLED clipping the name the audit claims fits.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 66 |
| Playability & control | 20% | 92 |
| Feature completeness | 25% | 70 |

### Priority issues

- **critical** — No recorded sample sets: the Grand/Upright/Electric hard gate is unmet: src/library.ts ships bundledManifest = [] and build/ contains no audio assets (only index.html, one CSS, two JS files), so PianoLibrary.load fails closed to status 'fallback' and all six piano types are synthesised in src/dsp.ts. The Phase 2 contract requires Grand, Upright and Electric to be bundled, redistributable recorded sample sets. The six types are still audibly distinct (minimum pairwise band-spectrum distance 0.088) and the artifact declares the gate unmet in IMPLEMENTATION_DETAILS.json, labels the models 'synthesis fallback', flags the three type LEDs .missing and prints 'RECORDINGS UNAVAILABLE' in the Program OLED - the failure is honest, but the required capability is absent.
- **major** — Silkscreen legends collide, clip, and print over their own controls: At 1440x900 a DOM sweep of the 155 .legend spans found 15 overlapping legend pairs (piano-soft-release ~ piano-string-resonance, piano-octave-down ~ piano-octave-up, program-wheel-morph ~ program-aftertouch-morph ~ program-control-pedal-morph ~ program-split-on, program-page-previous ~ program-page-next, the layer-level/layer-button pairs in organ, piano and synth) and one legend (effects-effects-variation) rendered outside its section box. 3x section crops additionally show 'DELAY TAP TEMPO' printed across the delay knob, 'COMPRESSOR AMOUNT'/'COMPRESSOR ON' across the Mod 2 strip, and 'B3 VOX FARF' hidden behind the organ-model button. The rubric asks for legends legible at rendered size.
- **major** — Compressor, A-Wah and Reverb behave as large level drops rather than effects: Against a dry baseline of rms 0.04026, engaging the compressor at Amount 0.9 renders 0.00676 (Normal) / 0.00509 (Fast) with no makeup gain, mod1 A-Wah at Amount 0.9 renders 0.00417, and Reverb at Dry/Wet 0.8 renders 0.0056-0.0081 across all six types. Each is measurably an effect and each bypasses cleanly back to ~0.0403, but a 6-10x output drop is what a player hears first. Reverb Booth's measured tail ratio (0.184) is also marginally longer than Room's (0.167), inverting the manual's Booth-is-shortest ordering.
- **minor** — The primary Program OLED clips the live model name it exists to display: The .program-oled <strong> measures scrollWidth 86 px against clientWidth 74 px with white-space:nowrap and overflow:hidden on the OLED, so 'Grand synthesis fallback' renders cut off at the right edge. evidence/stage2-visual-audit.md claims the reduced font makes the complete name fit; it does not. The rest of the OLED (layer, type, library status, FX focus) updates live and correctly.
- **minor** — Effects band renders five strips instead of the photograph's two groups, and Compressor has no strip: reference/nord-stage-4-73.jpg shows Layer Effects as two grouped blocks; the artifact renders five equally ruled strips (Mod 1, Mod 2, Amp/EQ, Delay, Reverb). The Compressor has no strip of its own - #effects-compressor-amount, #effects-compressor-on and the 'COMP' legend sit on top of the Mod 2 / Amp-EQ strips. This does not trip the 'single undifferentiated control grid' rule (0 controls match the uniform w+h median) and all controls stay reachable, so it is a placement divergence rather than a forbidden element.
- **minor** — Compressor Fast mode and Amp/EQ Treble are not reachable from the hardware panel: src/hardware.ts gives the compressor only an amount knob and an ON button, and the Amp/EQ strip only rate/amount/selector/on plus EQ bass and mid. Compressor Normal/Fast (a required parameter) and the Treble band are therefore adjustable only in the accessible 'Piano & effects controls' editor below the instrument, not on the panel. Both do work and are measurable there (Normal rms 0.00676 vs Fast 0.00509).
- **minor** — Toolbar Sustain button does not reflect keyboard or MIDI pedal state: Holding Space or sending MIDI CC64 127 audibly engages sustain (release tail ratio 0 -> 0.3663 and 0 -> 0.4176 respectively) but the toolbar Sustain button's aria-pressed stays false, because the engine tracks the 'ui' pedal owner only. The panel therefore under-reports an active pedal from two of the three input paths.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**88/100**

Measured against build/ at 1440x900 in Chromium; every computed number was re-measured independently and reproduced. Geometry is near exact: deck 0.53998 / keybed 0.46002, width 0.94002, aspect 3.09511, worst section deviation 0.000007 on the deck span (0.0075 on full chassis width, still in tolerance); 73 keys (43/30) all inside the keybed, black-key height 0.60999; 5/5 reference colours within deltaE 4.2; 33/33 landmarks in-section, 155/155 controls reachable by 5x5 elementFromPoint, 0 forbidden descriptors. Behaviour is real: one AudioContext; piano decays to 0.318 of onset after 1.1 s while organ (1.148) and synth (1.178) sustain; drawbars, filter types, three envelopes, LFO and a clock-synced arp all move the signal; 4 split zones route exactly; an 11-field program round-trips losslessly; MIDI note/velocity/CC64/CC1 work; Panic silences. Deductions: the three acoustic pianos are declared synthesis fallbacks, LP24 is no steeper than LP12, legends overprint in all six sections, pointer strike position carries no velocity, rotary Fast is shallower than Slow, and the 390 px deck is fully operable only via Inspect surface.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 90 |
| Playability & control | 20% | 91 |
| Feature completeness | 35% | 85 |

### Priority issues

- **major** — Piano Grand/Upright/Electric are synthesis fallbacks, not recorded sample sets: IMPLEMENTATION_DETAILS.json declares sampleSources: [] and missingRequiredSets: [Grand, Upright, Electric], and the running build confirms it - the program OLED reads 'Grand synthesis fallback' and the status line 'Piano recordings unavailable'. This is the inherited Phase-2 piano.instrument-library requirement left unmet because no source recordings were supplied. It is declared honestly and labelled in the UI rather than faked, so it costs breadth rather than integrity, but the three acoustic piano types are additive/FM syntheses.
- **minor** — Silkscreen legends overprint each other across all six sections: At 1440x900 the deck sets 192 of its 272 text leaves below 6 px (median 3.45 px) and 40 pairs of label boxes overlap. Measured: 'SOFT RELEASE' (x 512.9 w 26.4) overlaps 'STRING RESONANCE' (x 528.7) by 10.6 px and renders as 'SOFT RELESTARSIEG RESONANCE'; 'OCTAVE DOWN'/'OCTAVE UP', the program morph row, 'MASTER CLOCK'/'TRANSPOSE' and several effects labels collide with neighbouring knobs the same way. The labels are nowrap with overflow:visible, so they overprint rather than truncate, and none overflows the chassis edge.
- **minor** — Pointer strike position carries no velocity: Dispatching pointerdown on key 60 at 15% and at 95% of the key height produced an identical 0.079361 max RMS. MIDI velocity works correctly (20 -> 0.006471, 127 -> 0.123461), so the dynamics path exists but is not driven from pointer geometry.
- **minor** — Quantised panel controls appear inert to a single arrow key: The nine organ drawbars, synth-oscillator, synth-arp-range and program-program-dial are input[type=range] with min 0, max 100, step 1, but quantise the value to a detent (drawbars to 9 positions). A single ArrowRight or ArrowUp therefore rounds back to the same detent and the control reads unchanged; PageUp/PageDown, Home/End and pointer drag all work. Keyboard operability is technically present but not discoverable at the documented step.
- **minor** — Rotary speed states are weakly differentiated: Re-measured with Organ To Rotary and Rotary On: bypassed 2.75 Hz / depth 0.0059, Slow 2.80 Hz / 0.0317, Fast 4.15 Hz / 0.0119, Stopped 0.30 Hz / 0.0147. The rate does rise from Slow to Fast and Stop removes the rotation, so the effect is routed and differentiated, but Fast modulates a third as deeply as Slow and the Slow rate sits well above a Leslie chorale (~0.8 Hz), so the two speeds do not read as slow and fast by ear.
- **minor** — LP24 is not steeper than LP12: At a fixed 0.55 cutoff on a saw, 2-9 kHz band energy re-measured 6.018e-6 for LP12 and 9.043e-6 for LP24 - the 24 dB/oct type passes slightly more stopband energy than the 12 dB/oct one, so the two lowpass slopes are not differentiated. The other filter types are correct (HP low-band 1.629e-7 vs LP12 1.320e-4). This is why synthSystem is rated 3.
- **minor** — evidence/stage3-evidence-status.json contradicts the sealed evidence set: That file lists stage3-desktop.png, stage3-narrow.png and stage3-capture.json under captures.missingFiles with status 'missing', but all three are present in the sealed artifact and inputs/verification.json records them as passing with a 1440x900 and a 390x844 capture. The self-report understates rather than overstates what exists (the captures were taken by the sealing harness after the artifact's own audit was written), so it is a staleness wrinkle, not a false claim of completion.
- **minor** — Section fractions are exact against the deck span, ~0.0075 out against the full chassis width: The six section plates are inset about 40 px inside the 1353.63 px instrument, so the section span is 1312.97 px. Against that span the fractions are 0.14000/0.20000/0.08499/0.12500/0.25001/0.20000 (worst deviation 0.000007). Against the full instrument width they are 0.13579/0.19399/0.08244/0.12125/0.24250/0.19399 (worst deviation 0.0075). Both are inside the 0.012 tolerance, so the score is unaffected, but the reported 1e-05 is the span-based reading, not a denominator-independent one.

### Technical gate

Passed.
