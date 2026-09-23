# GPT-6 Sol High — Stagebench evaluation

- Run: `gpt-6-sol`
- Status: complete
- Aggregate: **77/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 89 |
| 2 | Piano library and working effects | 53 |
| 3 | Complete Stage 4 system | 74 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Live additive Web Audio synthesis for one basic piano-like voice. No recorded samples or external audio assets are used in Phase 1.
- Generated sound sources: Basic synthesized piano — Three sine partials per note with velocity-dependent amplitude and brightness, attack/decay envelope, and note release.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: No bundled recorded piano samples are claimed; Phase 1 permits an honestly described synthesized voice.
- Audio note: Panel controls are decorative and do not alter the signal path.

### Phase 2: Piano library and working effects

- Audio strategy: One lazy Web Audio context; two Piano layer buses through ordered per-layer effects and a shared rotary into master gain and limiter. Grand, Upright, Electric use bundled recorded samples. Clav, Digital, Misc and loading/error fallback use live synthesis.
- Generated sound sources: Clav, Digital, Misc and playable sample fallback — Live oscillator synthesis with note envelope, timbre filter, unison and resonance oscillator; no generated buffer is described as a recording.; Reverb impulse responses — Deterministic synthetic impulse data generated in AudioBuffer.
- Recorded sample provenance: Grand — AKAI Splendid Steinway — https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano (Public Domain); Upright — FreePats Kawai KW — https://github.com/freepats/upright-piano-KW (CC0 1.0); Electric — Greg Sullivan Wurlitzer EP200 — https://github.com/smpldsnds/sfzinstruments-greg-sullivan-e-pianos (CC BY 3.0 Unported)
- Bundled audio: 77 files (12.7 MB)
- Audio note: Electric uses Greg Sullivan Wurlitzer EP200 under CC BY 3.0 Unported; credit and license apply to redistributed sample files.
- Audio note: The original FLAC sources for Upright are retained alongside compressed OGG playback derivatives.
- Audio note: The sampled sets have multiple root pitches and recorded velocity layers. Grand upper register reuses a single recorded soft layer where no hard source file exists.
- Audio note: If any playback sample fails to fetch/decode, status reports sample error and synthesized fallback remains playable.
- Audio note: Electric recordings are by Greg Sullivan and distributed under CC BY 3.0 Unported. The bundled OGG files came from the smpldsnds mirror of the original sfzinstruments/GregSullivan.E-Pianos repository.
- Audio note: Upright OGG playback files were derived from the listed FreePats FLAC sources using FFmpeg mono Opus, retaining the first nine seconds. Both originals and derivatives are listed in the Upright set.

### Phase 3: Complete Stage 4 system

- Audio strategy: One lazy Web Audio context: recorded Piano A/B, live additive Organ A/B with one shared effect chain, live Synth A/B/C with independent effect chains, shared rotary, master gain, limiter, and one destination.
- Generated sound sources: Clav, Digital, Misc and playable sample fallback — Live oscillator synthesis with note envelope, timbre filter, unison and resonance oscillator; no generated buffer is described as a recording.; Reverb impulse responses — Deterministic synthetic impulse data generated in AudioBuffer.; Organ and Synth live synthesis — Live Web Audio oscillators, harmonic drawbar/register mixes, FM frequency modulation, detune stacks, noise buffers, filters, envelopes, vibrato and LFO. White Noise buffer is generated at runtime; no generated buffer is described as a recording.
- Recorded sample provenance: Grand — AKAI Splendid Steinway — https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano (Public Domain); Upright — FreePats Kawai KW — https://github.com/freepats/upright-piano-KW (CC0 1.0); Electric — Greg Sullivan Wurlitzer EP200 — https://github.com/smpldsnds/sfzinstruments-greg-sullivan-e-pianos (CC BY 3.0 Unported)
- Bundled audio: 77 files (12.7 MB)
- Audio note: Electric uses Greg Sullivan Wurlitzer EP200 under CC BY 3.0 Unported; credit and license apply to redistributed sample files.
- Audio note: The original FLAC sources for Upright are retained alongside compressed OGG playback derivatives.
- Audio note: The sampled sets have multiple root pitches and recorded velocity layers. Grand upper register reuses a single recorded soft layer where no hard source file exists.
- Audio note: If any playback sample fails to fetch/decode, status reports sample error and synthesized fallback remains playable.
- Audio note: Electric recordings are by Greg Sullivan and distributed under CC BY 3.0 Unported. The bundled OGG files came from the smpldsnds mirror of the original sfzinstruments/GregSullivan.E-Pianos repository.
- Audio note: Upright OGG playback files were derived from the listed FreePats FLAC sources using FFmpeg mono Opus, retaining the first nine seconds. Both originals and derivatives are listed in the Upright set.
- Audio note: sampleSources entries each represent an instrument set with name, source, and license; files list the members of each set for checksum verification.

## Phase 1: Complete surface and basic piano

**89/100**

Geometrically exact and behaviourally honest, visually thin. Every computed measurement lands inside tolerance: width 0.94000, aspect 3.09514 vs 3.0951, deck 0.53925 / keybed 0.46075, six section fractions off by <=3.3e-06, 73/43/30 keys all inside the keybed at black-height 0.60994, and 5/5 reference colours within deltaE 12 (worst 2.26). All 33 documented landmarks render in their own sections and no forbidden descriptor is satisfied. Audio is what it claims: three sine partials per note, no samples anywhere in the bundle, velocity 20 vs 120 giving 0.00443 vs 0.07400 RMS, sustain via Space and CC64, 24-voice oldest-first stealing, blur and CC123 returning output to exactly 0.0. Pointer, 10-point touch, computer keyboard and Web MIDI all reach one lifecycle, and Master Level provably does not touch the signal. Costs: the legend and OLED layer collides and overflows across most sections, one control (EQ Mid) is buried under Compressor Amount and unreachable by pointer, on-screen and typed notes have fixed velocity, and the surface omits many photographed controls without declaring it.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 93 |
| Feature completeness | 20% | 83 |

### Priority issues

- **major** — Control legends collide and OLED text overflows its display: At the canonical 1440x900 size the .control-label elements (positioned at left:-20%; width:140% of each control) overlap across most sections: 'PITCH STICK'/'MODULATIC WHEEL', 'ROTARY SLOW STOP'/'ROTARY FAST', piano 'LEVEL A'/'LEVEL B', 'LAYER SCENBLAYER SCENE 2', 'COMPRESSOR AMOUNT' over 'EQ BASS', and the nine organ drawbar captions running together. The Program OLED's third line ('73 KEY HAMMER ACTION') overflows its 64.8x50.5px box onto the plate, and the Synth OLED is painted over the 'Mode Analog' and 'Mode FM' buttons. See scratch/eval-desktop.png and scratch/deck-zoom.png.
- **major** — EQ Mid is fully buried under Compressor Amount and unreachable by pointer: artifact/src/hardware.ts places 'EQ Mid' at x=49,y=67 and 'Compressor Amount' at x=50,y=67 with identical 18x16 boxes, so the later sibling covers the earlier one. All 25 elementFromPoint samples across EQ Mid's bounding box at 1440x900 unscrolled resolve to the Compressor Amount input, making it 114/115 reachable. It remains rendered and tab-focusable, so it is present but unoperable by pointer, and the phase gate requires every visible control to move or press.
- **minor** — Pointer and computer-keyboard notes have fixed velocity: artifact/src/App.tsx:153 uses a constant velocity of 105 for pointer input and :74 uses 95 for mapped computer keys, so dynamics are available only over MIDI (verified: MIDI velocity 20 -> 0.00443 RMS, 120 -> 0.07400 RMS, while all pointer notes measured 0.0587 +/- 0.001). Mapping pointer y-position or touch force within the key would restore expression for the primary on-screen input.
- **minor** — Photographed panel controls omitted without declaration: Against inputs/reference/nord-stage-4-73.jpg the render omits per-section Octave Shift, KB Zone and SUSTPED/PSTICK toggles, and Transpose, Master Clock and Panic (absent from artifact/src/hardware.ts entirely), and collapses the Piano type six-LED column and Piano Select block into two generic buttons - 115 controls in total against several hundred in the photo. evidence/stage1-visual-audit.md notes only that 'fine printed legends and some small hardware spacing are approximations'.
- **minor** — Voice decays identically across the whole range: artifact/src/piano.ts schedules one envelope (0.23*amp -> 0.11*amp at 140 ms -> 0.00012 at 8 s) with fixed partial ratios 1/2.003/3.008 regardless of note number, so E1 and E7 ring for the same eight seconds and no register-dependent inharmonicity, hammer noise or stereo spread is present.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**53/100**

Geometry, inventory and keybed are essentially exact: at 1440x900 the instrument measures 1353.59x437.33 px (width fraction 0.9400, aspect 3.0951), deck 0.5392 / keybed 0.4447, all six section fractions within 0.00005 of spec, 73 keys (43/30) all inside the keybed at black-key height 0.6099, 33/33 landmarks present, 0 forbidden elements by the DOM rules, and 5/5 reference colours inside dE 12. 114/115 panel controls are pointer-reachable (EQ Mid is buried under Compressor Amount). The Phase 2 audio work is where it breaks. Fetch is called unbound (src/stage.ts:185/213), so the build issues zero sample requests and sits permanently in the labeled synthesized fallback: Grand, Upright, Electric and Misc render identically (tail RMS 0.038928). A truncated electric/ab6mp.ogg would keep it in fallback anyway. Reverb's wet path is inaudible (tail RMS 1e-6 at 100% wet) and its six types are indistinguishable. Everything else measures well: one AudioContext, ordered per-layer chains into one limiter, no clipping at 10 voices, working layers, octave, group, To Rotary, and all piano performance controls moving the signal in the right direction.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 48 |
| Playability & control | 20% | 75 |
| Feature completeness | 25% | 45 |

### Priority issues

- **critical** — Recorded sample libraries never load in the published build (unbound fetch): src/stage.ts:185 keeps native fetch as an instance property and src/stage.ts:213 calls it as this.fetchAsset(...), which throws "Failed to execute 'fetch' on 'Window': Illegal invocation". In build/ a real click on a key issues 0 requests for /samples/*, every load rejects, and the app settles permanently on 'Sample error · synthesized fallback playable'. Grand, Upright, Electric and Misc then render bit-identical sine output (tail RMS 0.038928 for all four), so Phase 2's central deliverable — three audibly distinct recorded sample sets — is absent at runtime. Re-binding fetch in the page makes the three types distinct, so one line separates the artifact from its intended behaviour.
- **critical** — build/samples/electric/ab6mp.ogg is truncated and undecodable: The 8108-byte file fails Chrome decodeAudioData with 'EncodingError: Unable to decode audio data' (ffprobe reports 'End of file'). StageAudio.loadSamples marks the whole library failed when any entry rejects, so even with the fetch binding fixed the build reports fallback rather than ready (55 of 56 files decode). The vitest suite passes because it checks the file's sha256 and pre-extracted .f32 fixtures, never a browser decode.
- **major** — Reverb wet path is inaudible and its six types are indistinguishable: With dry/wet at 100% the rendered tail RMS is 0.000001 (band energies [0.0018, 0.0001, 0.0001, 0.0001]); the convolver's default normalization over the 0.35-4.2 s synthetic impulses reduces the wet signal to near silence. Switching Reverb on therefore only attenuates the dry path (0.038928 x 0.65 = 0.025303, exactly the measured value), and Room, Booth, Spring, Stage, Hall and Cathedral all render tail RMS 0.025303 with band energies equal to four decimals. specs/nord-stage-4.effects.json requires 'Dry/Wet (fully wet at max)' and every listed type to be audibly distinct.
- **major** — IMPLEMENTATION_DETAILS.json declares recorded playback that never happens: The file states 'Grand, Upright, Electric use bundled recorded samples' and enumerates 77 files with checksums, root notes and velocity layers, but no sample is fetched, decoded or played in the sealed build, and no declared gap covers this. The running UI is honest (it labels the synthesized fallback), so the inaccuracy is in the declaration rather than the interface.
- **minor** — EQ Mid knob is completely buried under Compressor Amount: At 1440x900 'effects.eq-mid' (46.7x33.7 px at x=1236.2, y=320.2) and 'effects.compressor-amount' (same size at x=1238.8, y=320.2) overlap almost exactly; a 5x5 elementFromPoint grid over EQ Mid resolves to the compressor knob at all 25 points, so 114 of 115 panel controls are operable. src/hardware.ts places both at (49,67) and (50,67) percent of the effects section.
- **minor** — Panel indicators do not follow layer or FX focus: The 'Piano Layer A' and 'Piano Layer B' buttons are independent toggles, so both can report aria-pressed="true" at the same time, and the effects knobs and unit LEDs keep one flat hardware map: after switching FX focus to Piano B, 'Delay Feedback' still shows 90 / rotate(108deg) while layer B stores 0.35. The audio graph follows focus correctly; only the panel feedback does not.
- **minor** — Silkscreen legends overlap and clip at the rendered size: Labels render at 0.39cqw (5.3 px at 1440x900, 4.09 px at 390x844). In the desktop capture 'PITCH STICK'/'MODULATION WHEEL', 'ROTARY SLOW STOP'/'ROTARY FAST', 'LAYER SCENE 1'/'LAYER SCENE 2' and 'COMPRESSOR AMOUNT'/'REVERB ON' collide, the nine drawbar footage legends run together, and the ORGAN, SYNTH and LAYER EFFECTS headings are overlapped by controls.
- **minor** — Phase 2 evidence defers the browser interaction pass: evidence/stage2-visual-audit.md states 'No Phase 2 visual measurement or console result is claimed here' and hands the capture and console check to the operator. The declaration is honest, but it is why two runtime-only defects (unbound fetch, undecodable ogg) shipped: both are invisible to the jsdom/fake-AudioContext test suite and appear on the first real page load.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**74/100**

Geometry, inventory and keybed are essentially exact on the published build at 1440x900: deck 0.5392 / keybed 0.4608, width 0.940, aspect 3.0951, section deviation <=0.0104, all 33 landmarks in their own sections, 73 keys (43/30) all inside the keybed at a 0.610 black-key fraction, 5/5 reference colours within deltaE 3.8, and no forbidden descriptor satisfied. Behaviour is broad and mostly real: one AudioContext, per-layer buses, genuinely separate organ/piano/synth synthesis, 32+8 programs with truthful dirty flag and verified store/recall/discard, 11 split positions with crossfades, scenes, morphs, transpose and Panic. Three things hold it back. The shipped build never plays its recorded pianos: StageAudio's default fetchAsset is an unbound window.fetch, so every sample request rejects with 'Illegal invocation' and zero sample files are ever requested - Grand, Upright and Electric all fall back to identical sines. The panel does not report the instrument: knob positions and engine ON LEDs never follow program recall, scenes or morphs. And the deck is unreadable, with 5.2px legends and 65 overlapping label pairs. One control (effects.eq-mid) is fully buried.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 68 |
| Playability & control | 20% | 83 |
| Feature completeness | 35% | 75 |

### Priority issues

- **critical** — Published build never fetches its recorded pianos: the default sample fetcher is an unbound window.fetch: Serving build/ and playing a key, the status region reports 'Sample error · synthesized fallback playable' on every run. The cause is in the StageAudio constructor: `private fetchAsset: typeof fetch = fetch` is an unbound reference, and loadSamples() calls it as `this.fetchAsset(...)`, so the browser rejects every request with TypeError "Failed to execute 'fetch' on 'Window': Illegal invocation". Measured on the un-instrumented page at 1440x900: the network log records 0 requests to samples/* and 0 decodeAudioData calls, and the internal buffer map is still empty (size 0, one MISS on 'samples/grand/FF-C4.ogg') when a note is played. Patching window.fetch to a bound wrapper makes all 56 requests fire and 55 decode - which is exactly why an instrumented probe hides this bug. Because loadSamples() sets this.failed when any result rejected, the status reads 'fallback' and startLayer() finds no buffer for any note, so it assigns oscillator.type 'sine' for Grand, Upright AND Electric: three of the six piano types are audibly identical in the shipped build and the recorded-library deliverable is never exercised. A second, independent asset defect sits underneath it: build/samples/electric/ab6mp.ogg is truncated (ffprobe: 'End of file', 8108 bytes) and is the one payload that fails decodeAudioData even when fetching is repaired. The status label is honest, so this is a correctness/asset defect rather than a dishonesty one.
- **major** — Panel control positions and engine ON LEDs never track the instrument state: src/App.tsx holds panel positions in a `hardware` record that is written only by the panel's own update() handler (App.tsx:104) and never reconciled with stage state. Measured on build/: console 'Organ drawbar 1' = 2 leaves the panel drawbar at 70; recalling program 1.4 B3 Gospel leaves Master Level 68, Piano Level A 68 and Filter Freq 45 unchanged; the panel modulation wheel stays at 25 when the Morph Wheel is moved to 80. Worse, the ON LEDs are wrong even at first paint — PIANO ON reads aria-pressed='false' while stage.pianoOn is true, and ORGAN ON stays 'false' after loading an organ program or toggling the organ on from the console. A player reading the panel is told the wrong thing about which engines are sounding.
- **major** — Silkscreen legends are sub-legible and collide; the Synth OLED overlaps its neighbours: All 115 .control-label elements compute to font-size 5.248px at 1440x900 and a pairwise bounding-box test finds 65 overlapping label pairs (e.g. 'Rotary Slow Stop'/'Rotary Fast', 'Level A'/'Level B', the four organ model labels, 'String Res'/'Soft Release'/'Sustain Pedal'). The .synth-oled box intersects the 'Mode Analog' and 'Mode FM' labels. The result, visible in artifact/evidence/stage3-desktop.png, is a panel whose legends read as texture rather than text — the layout is right but the deck cannot be read.
- **major** — Every parameter change rebuilds all eight effect chains, regenerating reverb impulses mid-performance: applyState() disposes and recreates the effect chain for both piano layers, all three synth layers and the shared organ chain on every commit, and createEffectUnit() regenerates the reverb impulse response (up to 4.2 s x 2 channels computed in a JS loop for 'Cathedral') each time. Instrumented on build/ with Reverb on: dragging the panel Master Level knob through 20 steps created 20 ConvolverNodes and 360 AudioNodes (counter 75 -> 435). Any continuous control move while playing therefore allocates and discards the whole graph repeatedly. No test covers the cost.
- **minor** — effects.eq-mid is completely buried under effects.compressor-amount: hardware.ts places 'EQ Mid' at (49,67) and 'Compressor Amount' at (50,67) within the effects section, so the two knobs coincide. A 5x5 elementFromPoint grid over the EQ Mid box at 1440x900 resolves to effects.compressor-amount at all 25 points; the control renders (so it counts as present) but no pointer can ever operate it on the panel. It remains reachable from the HTML console below the chassis.
- **minor** — Morph assign latch is ignored by the console controls that carry the same parameters: editMorphable() is called only from the panel's update() handler, so latching a morph source and then moving a console slider silently edits the value instead of recording an assignment — verified: latching Wheel and setting the console 'Organ level' to 20 left morphs {} in the stored program, while the same gesture on the panel Organ Level A fader recorded {from:0.65,to:0.2}. The console nonetheless renders its own 'Wheel assign'/'Pedal assign' buttons, which set the latch that console controls then ignore.
- **minor** — Rotary has no real stop, and Synth layer C has no panel control: organ.json requires 'Rotary routing with slow/fast/stop'. The panel 'Rotary Slow Stop' button only clears rotaryFast; the only stop available is Rotary On/Off, which bypasses the effect rather than decelerating the rotor, and the rotary itself is one StereoPanner + waveshaper with a 0.3 s ramp (no horn/drum split). Separately, the chassis exposes only Synth Layer A and B buttons, so the third synth layer required by synth.sources is reachable only from the HTML console.
- **minor** — Phase 3 engine distinctness is proven only against a fake AudioContext: TASK.md's audio test rules state that a state-only test with fakes is not enough where behaviour is claimed audible. src/phase3.test.tsx proves organ-model and synth-waveform distinctness by counting node types and parameter values on a hand-written Context stub, and no Phase 3 test renders a signal (the PCM fixtures in tests/fixtures/pcm cover only the Phase 2 recorded pianos). The engines do differ in the running build, but the regression net under them is structural.
- **major** — Every parameter commit throws an uncaught InvalidAccessError and leaks the old organ effect chain: applyState()'s organ-chain teardown calls extraLevels['Organ:A'].disconnect(oldChain.input) and extraLevels['Organ:B'].disconnect(oldChain.input) on nodes that were never connected to that input, so the setTimeout callback throws before reaching oldChain.dispose(). Measured on build/ at 1440x900: the first Master Level change after audio starts raises an uncaught "InvalidAccessError: Failed to execute 'disconnect' on 'AudioNode': the given destination is not connected" (build/assets/index-Dk2pBGTQ.js:9:68920), and one error is raised per commit thereafter. The consequence is that the previous organ chain is never disposed or disconnected, compounding the per-commit graph rebuild: 20 Master Level steps with Reverb on created 20 ConvolverNodes and 380 AudioNodes (instrumented counters 58 -> 438).

### Technical gate

Passed.
