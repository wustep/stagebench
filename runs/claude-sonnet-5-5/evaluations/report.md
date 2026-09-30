# Claude Sonnet 5.5 High — Stagebench evaluation

- Run: `claude-sonnet-5-5`
- Status: complete
- Aggregate: **94/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 96 |
| 2 | Piano library and working effects | 85 |
| 3 | Complete Stage 4 system | 100 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: One piano-like voice made of GENERATED audio buffers. Each note is rendered on demand by src/audio/pianoDsp.ts (additive synthesis: up to 18 inharmonic partials with per-partial exponential decay, two slightly detuned strings for the lower partials, a filtered hammer-noise burst, four velocity layers for brightness) and played through AudioBufferSourceNode → voice gain → master gain → dynamics-compressor limiter → destination. No recordings, no network, no bundled sample files. If buffer generation is unavailable an oscillator (triangle) fallback voice plays and the UI reports status 'fallback'.
- Generated sound sources: Additive piano voice (generated buffers) — generated-buffer; Oscillator fallback voice — live-synthesis
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Nothing in this phase is a recording of a real piano. The piano sounds synthetic by design.
- Audio note: Panel controls (including Master Level) are presentation state only; they are not connected to the audio graph.
- Audio note: Sustain works from the on-screen pedal button, the Space key and MIDI CC64. Velocity comes from MIDI, from the strike position along a clicked key, and is fixed (96) for the computer keyboard.

### Phase 2: Piano library and working effects

- Audio strategy: One AudioContext. Layer voices → layer bus → timbre EQ → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb → layer level → master gain → soft clip → limiter → destination; layers routed "To Rotary" pass through one shared Rotary between the layer level and the master gain. Grand, Upright and Electric play bundled RECORDED sample sets (Ogg Vorbis, offline, several root notes and velocity layers, levelled to one velocity curve). Clav, Digital and Misc are LIVE SYNTHESIS (oscillators + filters). While a recorded set is loading, or if it fails to load or decode, notes play a labelled fallback: the Phase 1 GENERATED additive-synthesis buffers (status "loading" / "fallback", never "ready"), and a plain oscillator if buffers cannot be created at all. Every effect is real Web Audio processing of the layer signal; reverb uses GENERATED impulse responses (not recordings).
- Generated sound sources: Additive piano fallback voice (generated buffers) — generated-buffer; Reverb impulse responses (generated buffers) — generated-buffer
- Recorded sample provenance: Salamander Grand (Grand) — https://archive.org/details/SalamanderGrandPianoV3 (CC-BY-3.0); Upright KW (Upright) — https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW (CC0-1.0); Wurlitzer EP200 (Electric) — http://www.sullivang.net/ (CC-BY-3.0); Pianet T (Electric) — http://www.sullivang.net/ (CC-BY-3.0)
- Bundled audio: 236 files (6.6 MB)
- Audio note: Nothing generated or synthesised is described as a recording: only the four "recorded-sample-set" entries in sampleSources are recordings.
- Audio note: Grand: Salamander Grand Piano V3 (CC BY 3.0, Alexander Holm) — 30 roots (every minor third) × 3 of its 16 velocity layers. Upright: Upright Piano KW (CC0) — its two velocity layers. Electric: Wurlitzer EP200 and Hohner Pianet T (CC BY 3.0, Greg Sullivan). Attribution text for each set is in its sampleSources entry and reproduced in the app source (src/audio/library/manifest.json).
- Audio note: The Wurlitzer EP200 map is the author’s: its softest layer has roots up to 11 semitones apart, so some notes are shifted by up to ±6 semitones (audible as a changed timbre). Other layers and models are denser.
- Audio note: Recorded release samples (hammer noise, pedal-down resonance samples) are not used. String Res is SIMULATED sympathetic resonance: quiet, slow-attack copies of harmonically related strings are added. Pedal noise and half-pedaling are excluded features.
- Audio note: Soft pedal and sostenuto are NOT implemented (optional in the spec); the sustain pedal is full on/off. SUSTPED and PSTICK are per layer. The pitch stick bends layers with PSTICK on by ±2 semitones (source detune).
- Audio note: KB Touch (Heavy/Medium/Light) reshapes the key velocity before it selects the recorded layer and level. Dyn Comp raises the level of soft strokes without changing which layer (timbre) is chosen. Timbre, Unison, Soft Release, String Res and Master Level are all rendered by the audio engine; Soft Release is unavailable for Clav, String Res only for Grand/Upright, Dyno 1/2 only for Electric (the panel snaps back).
- Audio note: Amp models (Small, JC, Twin) are documented approximations: distinct voicing filters + clipping curves + speaker roll-off, not circuit models. Phaser "feedback colour" is approximated by a higher all-pass Q (a feedback loop without a delay node is not allowed in Web Audio). Mod 1 Wah/A-Wah/Pump/RM/Trem/A-Pan and Mod 2 Chorus/Flanger/Phaser/Vibe/Ensemble/Spin are real signal processors of the layer signal.
- Audio note: Signal-order deviation: the layer level sits before the shared Rotary (the rotary is one instance, so layer levels have to be applied per layer before their signals are summed into it). Reverb still precedes the Rotary and everything reaches the destination through the master gain, soft clip and limiter.
- Audio note: Effect focus follows layer focus; the Piano FX FOCUS button swaps A/B, Shift or a long press toggles group mode; Delay, Compressor and Reverb have Global (also Shift + ON). Organ/Synth effect focus buttons do not change anything in this phase (their LEDs never light). "To Rotary" only routes while the Amp/EQ unit is switched on.
- Audio note: The Layer Effects ON button bypasses every unit including the Rotary routing. Bypass and parameter changes are ramped over 20 ms.
- Audio note: Layer buttons follow manual p. 23: tap = focus / switch, hold 0.5 s = turn off (the last layer cannot be turned off), press both together or Shift+press = add. Both layers together use up to 24 voices in total (a key uses one voice per enabled layer).
- Audio note: Decorative in this phase (move and light, do nothing, annotated in the accessibility tree): all Organ, Synth and Program controls, the modulation wheel, KB ZONE, AUX KB, SOLO, INFO/MODEL LIST, the rotary ORGAN / STOP MODE / CLOSE MIC buttons.
- Audio note: Unsupported (spec-excluded): pedal noise, half-pedaling, Triple Pedal, size classes/INFO, preset library, per-type Variations, Reverb Chorale, Delay feedback-loop effects (Chor/Vibe/Ens/Flam/Space) and Analog mode, Mod 1 Pump/Wah pedal modes, Rotary close mic and stop angle. Their controls exist, move and do nothing.
- Audio note: Master Clock sync of LFO/Delay is Phase 3 and not implemented; Delay tap tempo and the tempo knob agree (tap sets the knob).
- Audio note: Ogg Vorbis decoding is required for the recorded sets. A browser that cannot decode it, or a missing file, produces the labelled fallback state ("Piano not found … Fallback voice"), the type LED flashes, and the app stays playable.
- Audio note: Web Audio nodes: one AudioContext; oscillator LFOs are only created for units that have been switched on; retired effect branches are disposed after a 60 ms crossfade; dispose() disconnects and stops everything.
- Audio note: Tests render the real engine on node-web-audio-api (OfflineAudioContext, dev dependency): decoded recordings, effects, controls and pedals are asserted through the rendered signal, not through fakes.

### Phase 3: Complete Stage 4 system

- Audio strategy: One AudioContext for the whole instrument. Piano layers A/B, Organ layers A/B and Synth layers A/B/C are sound sources; each has a bus/level and enters the Layer Effects chains: Piano A, Piano B, one shared Organ chain (Organ A and B mix into it after their own level and vibrato/chorus) and Synth A, B, C each have their own chain: source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb → layer level → master gain → soft clip → limiter → destination; chains routed to the Rotary (Organ button, or "To Rotary" on any chain) pass through the one shared Rotary. Grand, Upright and Electric play bundled RECORDED sample sets (Ogg Vorbis, offline, several root notes and velocity layers). Clav, Digital, Misc, the four organ models and the whole synth are LIVE SYNTHESIS (oscillators, periodic waves, wave shapers, filters); they use no recordings. While a recorded set is loading, or if it fails to load or decode, notes play a labelled fallback: the GENERATED additive-synthesis buffers, and a plain oscillator if buffers cannot be created at all. Every effect is real Web Audio processing of the layer signal; reverb uses GENERATED impulse responses (not recordings). The program system (32 programs, 8 Live slots, splits, scenes, morphs, master clock) is state, not audio: the morph-resolved state drives one graph.
- Generated sound sources: Additive piano fallback voice (generated buffers) — generated-buffer; Reverb impulse responses (generated buffers) — generated-buffer; Noise and click buffers (generated) — generated-buffer; Periodic waves, shaper curves and LFO tables (generated) — generated-table
- Recorded sample provenance: Salamander Grand (Grand) — https://archive.org/details/SalamanderGrandPianoV3 (CC-BY-3.0); Upright KW (Upright) — https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW (CC0-1.0); Wurlitzer EP200 (Electric) — http://www.sullivang.net/ (CC-BY-3.0); Pianet T (Electric) — http://www.sullivang.net/ (CC-BY-3.0)
- Bundled audio: 236 files (6.6 MB)
- Audio note: Nothing generated or synthesised is described as a recording: only the four "recorded-sample-set" entries in sampleSources are recordings.
- Audio note: Grand: Salamander Grand Piano V3 (CC BY 3.0, Alexander Holm) — 30 roots (every minor third) × 3 of its 16 velocity layers. Upright: Upright Piano KW (CC0) — its two velocity layers. Electric: Wurlitzer EP200 and Hohner Pianet T (CC BY 3.0, Greg Sullivan). Attribution text for each set is in its sampleSources entry and reproduced in the app source (src/audio/library/manifest.json).
- Audio note: The Wurlitzer EP200 map is the author’s: its softest layer has roots up to 11 semitones apart, so some notes are shifted by up to ±6 semitones (audible as a changed timbre). Other layers and models are denser.
- Audio note: Recorded release samples (hammer noise, pedal-down resonance samples) are not used. String Res is SIMULATED sympathetic resonance: quiet, slow-attack copies of harmonically related strings are added. Pedal noise and half-pedaling are excluded features.
- Audio note: Soft pedal and sostenuto are NOT implemented (optional in the spec); the sustain pedal is full on/off. SUSTPED and PSTICK are per layer. The pitch stick bends layers with PSTICK on by ±2 semitones (source detune).
- Audio note: KB Touch (Heavy/Medium/Light) reshapes the key velocity before it selects the recorded layer and level. Dyn Comp raises the level of soft strokes without changing which layer (timbre) is chosen. Timbre, Unison, Soft Release, String Res and Master Level are all rendered by the audio engine; Soft Release is unavailable for Clav, String Res only for Grand/Upright, Dyno 1/2 only for Electric (the panel snaps back).
- Audio note: Amp models (Small, JC, Twin) are documented approximations: distinct voicing filters + clipping curves + speaker roll-off, not circuit models. Phaser "feedback colour" is approximated by a higher all-pass Q (a feedback loop without a delay node is not allowed in Web Audio). Mod 1 Wah/A-Wah/Pump/RM/Trem/A-Pan and Mod 2 Chorus/Flanger/Phaser/Vibe/Ensemble/Spin are real signal processors of the layer signal.
- Audio note: Signal-order deviation: the layer level sits before the shared Rotary (the rotary is one instance, so layer levels have to be applied per layer before their signals are summed into it). Reverb still precedes the Rotary and everything reaches the destination through the master gain, soft clip and limiter.
- Audio note: Effect focus follows layer focus in all three sections; the Piano FX FOCUS button swaps A/B, the Organ button focuses the one shared organ chain, the Synth button steps A, B, C; Shift or a long press toggles group mode (Piano, Synth); Delay, Compressor and Reverb have Global (also Shift + ON) reaching all six chains. "To Rotary" only routes while the Amp/EQ unit is switched on; the Organ ORGAN button routes the shared organ chain regardless.
- Audio note: The Layer Effects ON button bypasses every unit including the Rotary routing. Bypass and parameter changes are ramped over 20 ms.
- Audio note: Layer buttons follow manual p. 23 for Piano, Organ and Synth: tap = focus / switch, hold 0.5 s = turn off (the last layer cannot be turned off), press two together or Shift+press = add. A layer button of a section that is off switches the section on. A key uses one voice per enabled layer, up to 24 note-lifecycle voices; the Organ and Synth engines have their own caps (32 organ voices, 8 per synth layer / 24 total).
- Audio note: Organ: layer level is applied before the shared organ chain (a documented deviation: the two layers must be mixed before they can share effects). Organ keys are not velocity sensitive. Key click is always on for B3 and B3 Bass (the spec gives it a fixed level and no control). Tonewheel foldback, leakage and wear are not modelled.
- Audio note: Synth: only Analog mode exists (Samples is optional and not built, Extern is excluded; the MODE selector stays on Analog). See src/audio/synth/*.test.ts for the measured behaviour; approximations are listed in IMPLEMENTATION_PLAN.md (known gaps).
- Audio note: Programs: 32 program slots and 8 Live slots are plain JSON (the whole canonical state minus Master Level, wheel, pitch stick, control pedal and solo), persisted in localStorage when available; 21 factory programs are built from the same reducers the panel uses. Morphs, splits, scenes, master clock and transpose are part of a program. Live slots store every edit automatically.
- Audio note: Master Clock (30-300 BPM, tap or dial) locks the arpeggiator/gate, the synth LFO, the Delay and Mod 1 (LFO types only; Ring Mod and A-Wah have no LFO) when their rate knob has been set with Shift held. External MIDI clock and pedal tap are excluded.
- Audio note: Unsupported (spec-excluded, listed in the app under "Unsupported controls" and in IMPLEMENTATION_PLAN.md): pedal noise, half-pedaling, per-type Variations, Reverb Chorale, Delay feedback-loop effects and Analog mode, Mod 1 pedal modes, Rotary close mic and stop angle, Organ Preset/Sync, aftertouch morph, pedal tap, the preset library, Section Edit, Copy/Paste, arpeggiator pattern/group, LFO and filter group modes, Keep Edits, Exclude, Shift menus. Their controls exist, move and do nothing.
- Audio note: Ogg Vorbis decoding is required for the recorded sets. A browser that cannot decode it, or a missing file, produces the labelled fallback state ("Piano not found … Fallback voice"), the type LED flashes, and the app stays playable.
- Audio note: Web Audio nodes: one AudioContext; oscillator LFOs are only created for units that have been switched on (including the organ vibrato sweep); retired effect branches are disposed after a 60 ms crossfade; dispose() disconnects and stops everything, including the organ and synth engines, the arpeggiator timer chain and the program system.
- Audio note: Tests render the real engine on node-web-audio-api (OfflineAudioContext, dev dependency): decoded recordings, effects, controls and pedals are asserted through the rendered signal, not through fakes.

## Phase 1: Complete surface and basic piano

**96/100**

Phase 1 is delivered in full and the honesty contract holds under measurement. Served build/ (python http.server, no rebuild) in headless Chromium at 1440x900 with an analyser tap spliced in front of ctx.destination: a pointer strike on MIDI 60 produced maxRMS 0.108, level stays within ~2.5 dB from E1 to E7 (0.0966-0.1282), decay is monotonic (0.1196 -> 0.0270 over 2.4 s) and release lands at 0.240 s. Velocity tracks strike position (5.7x) and MIDI velocity (16.9x, vel 10 vs 126). Pointer, independent multi-touch, mapped computer keys and a faked Web MIDI port each drive the same lifecycle; sustain from Space and CC64 holds past 1.2 s and releases in 0.315 s. 30 simultaneous note-ons cap at exactly 24/24 with peak 0.975 (no clipping), and blur, page-hidden and device removal each return 0/24 with RMS 0.00000. All 182 controls move on keydown and update aria values; 0 lack names, roles or values. Master Level driven to 0 leaves output unchanged, matching the declaration that the panel is presentation-only. No console errors in any pass. The voice itself is honestly synthetic and mono.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 100 |
| Feature completeness | 20% | 100 |

### Priority issues

- **minor** — Stolen voices leave their keys rendering as pressed: With 30 MIDI note-ons held, the voice pool correctly capped at 24/24 but 30 keys still reported data-pressed="true"/aria-pressed="true", because key state is derived from held input sources (NoteLifecycle.holders) rather than from live voices. The keybed therefore shows six notes as sounding that were stolen and are silent. Measured in scratch/audio5.mjs on the served build at 1440x900.
- **minor** — Mono voice with per-buffer peak normalisation flattens the level contour: artifact/src/audio/pianoDsp.ts:113-116 peak-normalises every rendered buffer and renders a single channel, so loudness comes only from velocityGain() at the voice gain. Measured first-strike maxRMS varied just 0.0966-0.1282 from E1 to E7 and the image is dead centre; a real piano loses level and brightness towards the top and has a stereo spread. Acceptable for a Phase 1 basic voice and honestly declared, but audible.
- **minor** — Decorative inertness is disclosed globally, not per control: All 182 controls move and report state, and the status bar, both OLEDs and IMPLEMENTATION_DETAILS.json say the panel does not change the sound. No individual control carries an aria-description or visual affordance marking it inert, so a user operating one knob in isolation — particularly through a screen reader — gets no local signal that it is presentation-only.
- **minor** — No machine-readable declaration of unimplemented scope: Gaps are declared truthfully but only in free text (IMPLEMENTATION_DETAILS.json audio.notes, IMPLEMENTATION_PLAN.md, the status-bar hint). There is no structured field listing unimplemented or spec-excluded controls (e.g. piano-ped-noise, which the piano spec excludes), so the declaration cannot be diffed automatically against the spec's excluded set as later phases add real behaviour.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**85/100**

Phase 2 is substantially real, not decorative. Measured in the sealed build: one AudioContext, exactly one connection into the destination (from the master limiter), per-layer buses, documented unit order. All six piano types load and render distinctly (centroid 886/831/659/887/263/295 Hz; tails 0.19-0.42 s); Grand/Upright/Electric are 236 bundled Ogg recordings with CC-BY/CC0 provenance, fetched offline with zero failures. Every effect unit and all 25 listed types measurably change the signal: delay repeats at 0.27 s with the filter acting on the loop only, reverb tails ordered Booth 0.29 s to Cathedral 3.42 s, compressor crest 4.72->1.96, amps and 24 dB filters reshaping the spectrum, rotary panning and driving. All-effects bypass returns exactly the dry signal. Master and layer level follow v^2 and are silent at 0; 20 keys at once peaked 0.80, no clipping, no console errors. Declarations are honest, including the one order deviation (rotary after layer level) forced by the single shared rotary. Detail is simplified where a Nord player would notice: synthesised Clav/Digital/Misc, close JC/Twin amps, no Master Clock sync. I drove layer A, not B, and no live MIDI device.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 82 |
| Playability & control | 20% | 75 |
| Feature completeness | 25% | 100 |

### Priority issues

- **minor** — Master Clock sync for LFO and Delay is not implemented: specs/nord-stage-4.effects.json lists 'Master Clock sync' among Mod 1 and Delay parameters. The build has no working sync: program-master-clock-tap is annotated decorative and IMPLEMENTATION_DETAILS.json declares sync as Phase 3. Tap tempo and the tempo knob do agree (3 taps ~440 ms apart moved the knob to 0.678), so the gap is narrow and honestly declared.
- **minor** — Shared Rotary sits after the per-layer level, not before it: signalContract.requiredOrder puts Rotary before Layer level, but src/audio/graph.ts routes level -> toRotary -> shared rotary -> master. With rotaryInstancesPerProgram = 1 the layers must be levelled before they are summed, so the deviation is forced; reverb still precedes the rotary and the deviation is declared. Measured: one destination feeder, the limiter.
- **minor** — JC and Twin amp models are only marginally apart: At drive 0.8 on the same note: Small rms 0.3029 / centroid 1330 Hz, JC 0.2370 / 1072 Hz, Twin 0.2380 / 1120 Hz. The three are measurably different (the spec's floor), but JC and Twin differ far less than a JC-120 and a Twin do; 2.5-6 kHz energy 1.72e-5 vs 2.39e-5 is the main separation.
- **minor** — Wurlitzer's softest velocity layer is sparsely mapped: src/audio/library/manifest.json shows the electric-wurlitzer soft layer with 10 roots (up to 11 semitones apart), so some soft notes are pitch-shifted by up to +/-6 semitones and change timbre audibly. This is declared in IMPLEMENTATION_DETAILS.json; the other sets are denser (Grand 30 roots x 3 layers).
- **minor** — Soft and sostenuto pedal behaviour absent (spec-optional): Sustain is full on/off in src/audio/lifecycle.ts; no half-pedalling, soft or sostenuto behaviour. The piano spec lists these as optional with an honest approximation allowed, and IMPLEMENTATION_DETAILS.json states they are not implemented, so nothing is overclaimed.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**100/100**

A complete, honest Nord Stage 4. Measured against build/ served statically at 1440x900, every computed axis is at ceiling: deck/keybed 0.5400/0.4600, width 0.9400, aspect 3.09514, worst section-fraction deviation 9e-6; 73 keys (43/30, E1-E7 contiguous) all inside the keybed with black-key height 0.60994; 33/33 landmarks, 182/182 controls reachable by 5x5 elementFromPoint hit-test, 0 forbidden descriptors; 5/5 reference colours within deltaE 1.6. Audio is real and shared: one AudioContext, one destination, piano/organ/synth linear-spectrum cosines 0.65-0.84, six organ models (centroids 262-1797), all 14 required synth waveforms distinct, all six effect units and the rotary measurably alter the signal. Programs (32+8 Live), store/dirty/discard, splits with Off/+-6/+-12 crossfades, scenes, morphs, transpose and Panic all behave; 21 decorative controls are each tied to a real spec exclusion. No console errors across the whole pass. Shortfalls are cosmetic: morph does not move the level LED graph, and the Rotary Speaker block is a dark well where the photograph shows red chassis.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 100 |
| Playability & control | 20% | 100 |
| Feature completeness | 35% | 100 |

### Priority issues

- **minor** — An active morph moves the audio but not the level LED graph: With a Wheel morph assigned to piano level A (data-morph="0.95:0"), driving the wheel from 0 to 100 took the rendered signal from rms 0.12489 to 0.00000, but the fader's LED ladder stayed at 11 lit at every wheel position and aria-valuenow stayed 95. The same holds for drawbars: with a morph on organ drawbar 1 the LED graph stayed at 8 lit across the wheel sweep. The cause is visible in artifact/src/engine/bind/organ.ts:150, where the ladder's graph value is computed from the stored layer.drawbars[i] rather than the morph-resolved value, and the level faders have no graph override at all. The morph range is indicated (11 is-morph LEDs), so the assignment is discoverable, but on the hardware the level graph tracks the morph in real time. Cosmetic only - the parameter itself is correct and audible.
- **minor** — Rotary Speaker block sits in a dark well where the photograph shows exposed red chassis: The reference (inputs/reference/nord-stage-4-73.jpg, performance band) prints the Rotary Speaker group directly on the red chassis inside a thin light outline with a light title tab. The build instead encloses it in a dark inset well: the .frame--well element behind rotary-drive/organ/close-mic/stop-mode/speed computes to rgb(44,48,58), 36.8x123.9 px. This does not trip the 'full dark inset plate' rule - dark coverage of the performance band is 0.102, far below the 0.8 threshold - and the block's horizontal placement is right (x 0.1185-0.1358 of instrument width against the spec's 'roughly 0.10-0.13'), but the surface material contradicts sectionLandmarks.performance.surface, 'exposed red chassis'.
- **minor** — Program dial is not the largest rotary, and OLED tint is green/cyan rather than white: On the hardware the Program dial is visibly the biggest rotary on the panel; here program-dial measures 15.97x15.97 px, smaller than the synth dials at 16.91x16.91 and the arp/LFO/filter knobs at 18.94x18.94. Separately, both OLEDs render green (program) and cyan (synth) text on near-black, where the reference photograph shows white text. Neither affects behaviour, and the rest of the display treatment - the waveform and envelope plots, the multi-line status rows - is well above the bar.
- **minor** — At 390x844 the fit view is too small to operate without the zoom affordance: In the default narrow layout the instrument is 366.6x118.4 px, so the deck is about 64 px tall and individual controls are roughly 5 px - readable as a picture of the instrument but not operable. The build ships an explicit, labelled answer: a 'Zoom in to inspect panel (scrolls sideways)' button that scales the instrument to 1099.8 px inside a container with overflow-x auto (scrollWidth 1100 vs clientWidth 367), where drawbars, LED ladders and silkscreen are legible and 35 controls are hit-testable at scroll 0 with the rest reachable by scrolling. Nothing clips or collapses - all 73 keys and all 182 controls stay in the layout, aspect ratio holds at 3.0953, and document scrollWidth equals clientWidth at 390 - so this is a noted limitation of the fit view, not a failure.
- **minor** — forbiddenPresent needs the descriptor rules read as excluding printed silkscreen, not just control legends: Taken at its most literal, the displayElement definition in specs/nord-stage-4.visual.json ('multi-character alphanumeric text on a dark fill inside a section - excluding a control's own printed legend') catches the panel's group silkscreen: .frame-title elements such as 'ROTARY SPEAKER' (on rgb(44,48,58)) and 'MOD 1' / 'AMP SIM/EQ' (on rgb(60,66,77), which is referenceColors.panelBlueGray itself). That reading would score two forbidden 'OLED display' occurrences in the performance and effects bands purely from correct silkscreen, and by the same logic every legend on every dark inset plate in the instrument. I applied the exclusion to printed legends generally, which leaves the two .oled elements as the only displayElements and all eleven rules unsatisfied; recording this so the count is reproducible. A future spec revision should say 'excluding printed panel legends' rather than 'a control's own printed legend'.

### Technical gate

Passed.
