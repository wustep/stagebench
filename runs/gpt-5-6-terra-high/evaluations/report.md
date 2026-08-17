# GPT 5.6 Terra High — Stagebench evaluation

- Run: `gpt-5-6-terra-high`
- Status: complete
- Aggregate: **58/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 67 |
| 2 | Piano library and working effects | 38 |
| 3 | Complete Stage 4 system | 34 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Live Web Audio synthesis: triangle fundamental plus a quiet sine overtone through a per-note ADSR-like gain envelope. This is an honestly labeled piano-like fallback, not a recorded sample set.
- Generated sound sources: Web Audio OscillatorNode — Triangle fundamental and sine overtone generated live for each key; no recordings or downloaded assets.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Phase 1 exposes one playable synthesized piano-like voice only.
- Audio note: Panel controls other than the keyboard and sustain input are decorative presentation controls and are intentionally not connected to audio.
- Audio note: AudioContext creation is lazy and Web MIDI denial/unavailability is reported in the visible status text.

### Phase 2: Piano library and working effects

- Audio strategy: One lazy Web Audio AudioContext with two owned piano-layer inputs, ordered effect nodes, layer output gains, one master gain, one DynamicsCompressor limiter, and one destination. The current instrument is a labeled live-synthesis fallback; it does not contain recorded sample assets.
- Generated sound sources: Web Audio OscillatorNode — Grand, Upright, Electric, Clav, Digital, and Misc use deliberately different live oscillator spectra, filters, envelopes, octave and unison behavior. These are generated sources, not recordings.; Web Audio AudioBuffer — Short randomized impulse buffers are generated at runtime for reverb coloration. They are generated effect buffers, not recordings.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: The status display explicitly says 'Sample assets unavailable · playable synthesis fallback'; it does not report a primary sample library ready.
- Audio note: Each generated layer routes source → Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb → optional Rotary → layer level → master gain → limiter → destination.
- Audio note: Organ, Synth, and Program controls remain presentation-only in Phase 2. Excluded pedal-noise, half-pedaling, Triple Pedal modeling, size classes, INFO, Sound Manager, and piano preset library are unsupported.

### Phase 3: Complete Stage 4 system

- Audio strategy: One lazy Web Audio AudioContext owns all keyboard-triggered Piano, Organ, and Synth fallback sources. They enter the inherited effect buses, master gain, limiter, and single destination; Panic and unmount release every owned voice.
- Generated sound sources: Web Audio OscillatorNode — Piano fallback types plus Organ B3/Vox/Farf/Pipe and Synth waveform categories are generated oscillator/filter/envelope profiles. They are live synthesis, never recordings.; Web Audio AudioBuffer — Runtime-generated impulse buffers provide reverb coloration and are not recordings.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: The status display truthfully identifies the unavailable sample assets and the playable synthesis fallback.
- Audio note: The UI stores all supported Program state, but deliberately labels only the benchmark's spec-excluded program/menu/preset features as unsupported in the implementation plan.
- Audio note: Organ and Synth source selections are implemented as distinct generated profiles in the existing context; no second AudioContext is created.

## Phase 1: Complete surface and basic piano

**67/100**

A compact and genuinely honest Phase 1 undermined by geometry. The audio declaration survives instrumented measurement: 62 oscillators, 0 buffer sources, 0 decodes, 0 network requests, one AudioContext, and decorative panel controls that move output by 0.000009 RMS. Pointer, computer keys and Web MIDI each drive a full note lifecycle, with 8.5:1 velocity, working CC64 and Space sustain, deterministic 16-voice stealing at peak 0.648 (no clipping), and blur silencing everything to exactly zero. Against that: the keys row overflows its container by 208px, so B6-E7 render off the chassis and are clipped away, and black keys drift up to 6.5 white-key widths left of position. Nineteen of 38 continuous controls are not pointer-operable at their own face because each range input escapes its label - master-level ignores a drag, the Modulation One knob turns effects-2, and ten synth knobs hit-test to the keybed, so clicking one plays a note. The voice never decays: held RMS is flat at 0.1325 from 0.5s to 4s. Gates reproduce on a clean install, but one 45-line jsdom file with no audio assertions backs all 11 feature IDs.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 70 |
| Playability & control | 55% | 68 |
| Feature completeness | 20% | 58 |

### Priority issues

- **critical** — Keybed overflows its container by 208px; the top four keys are clipped off the chassis and unplayable: White keys use flex:1 but each renders its note name as text, so min-width:auto floors them at ~33.7px while 43 keys must fit 1239.9px. The row overflows by 208px. key-95, key-96, key-98 and key-100 (B6, C7, D7, E7) start beyond the shell's right edge (1413.8/1447.9/1481.8/1515.8 vs shell right 1396.8) and are removed by overflow:hidden; key-93 is half clipped. All 25 elementFromPoint grid points on those four keys resolve to something else, so they cannot be played by pointer at all - only over MIDI. The phase hard gate reads 'the exact keybed count and range for the assigned variant are modeled and playable'.
- **critical** — Half the continuous controls are not pointer-operable, and several route the gesture to a different control: Each knob/fader label contains an opacity:0 range input declared position:absolute with no positioned ancestor, so it escapes the label and stretches to the panel width (e.g. synth knob inputs measure 314.9px wide). Hit-testing the centre of each control's visible affordance: 19 own, 18 miss, 1 lands on the decorative face. Real mouse drags across the face changed nothing for #master-level (68->68) and #effects-0 (35->35); the Modulation One face resolves to #effects-2 and effects-4's to #effects-7, so dragging one knob turns another; synth-1..synth-10 resolve to the keybed or a piano key, so clicking the visible Filter Frequency knob plays a note. Six controls (program-button-1, morph-aftertouch, synth-9, synth-10, synth-filter-type, synth-arp) fail all 25 grid points.
- **major** — The piano voice has no decay - a held note sustains indefinitely: The envelope ramps to 0.46*velocity at +12ms, down to 0.2*velocity at +350ms, and then holds that value forever. Sampling the analyser while holding #key-60 gave RMS 0.132557 / 0.132522 / 0.132563 / 0.132542 at 0.5s / 1.0s / 2.0s / 4.0s - flat to five significant figures. Combined with a spectrum of only two partials (1x and 2.01x) the result reads as a thin organ tone rather than a piano.
- **major** — Synth control bank is clipped by the deck edge and Program buttons are buried under the OLED: .control-bank.synth carries padding-top:27% and .control-bank.program 40%, pushing their controls past the deck's bottom edge (deck ends at y=467; synth-9/synth-10 sit at y=496.6, synth-filter-type/synth-arp at y=488.8). At 1440x900 the entire Synth knob row is visibly sliced in half by the deck boundary and painted over by the keybed, and program-button-1 sits behind the Program OLED. The Layer Effects knob captions also overprint the knobs above them and the Performance status text overprints the octave buttons.
- **major** — Black keys are misaligned by up to 6.5 white-key widths and are nearly as wide as the white keys: Black keys are positioned with left: calc(whiteBefore * (100%/43) - 1.14%), i.e. against a nominal 28.83px white-key pitch, while the white keys actually measure 33.67px. The error accumulates monotonically: -0.5 white keys at MIDI 30, -3.48 median, -6.5 at the top of the keybed. Black-key width is 0.847 of white-key width (hardware is roughly 0.55), so adjacent black keys butt together into solid blocks (key-90 1138.5-1167.1, key-92 1167.4-1195.9, key-94 1196.2-1224.7). Black-key height fraction is correct at 0.6100 against the specified 0.61.
- **major** — Spec-named Rotary Speaker block and Layer Scene buttons are absent: specs/nord-stage-4.visual.json sectionLandmarks lists 'rotary speaker controls' in the performance band, with a note pinning it to the exposed red chassis below Master Level at roughly x 2200-2500 of 11600 in the variant photo. Nothing renders there; the only rotary controls are #organ-rotary inside the organ plate and an 'effects-7' Rotary knob in Layer Effects. The program section requires 'Live Mode and Layer Scene buttons' and ships only #program-live. Landmark coverage measured 31/33.
- **minor** — Pedal-down retrigger of a sustained note is killed when the pedal lifts: noteOff parks a note id in a `sustained` Set while the pedal is down; setSustain(false) then calls noteOff for every parked id. If the same key is struck again before the pedal lifts, the fresh voice is released along with the parked one. Also, four independent pointer presses of one key stack four voices out of the sixteen-voice budget, and one pointerup silences all four (measured RMS 0.2155 -> exactly 0).
- **minor** — Pointer velocity is inverted relative to the hardware: velocity = 1 - offsetY/height, so striking the front tip of the key is quietest and the far end is loudest. Measured with a real mouse: 8% of key height gave RMS 0.04036, 92% gave RMS 0.009811. The mapping is continuous and monotonic, just backwards from the leverage of a hammer-action key.
- **minor** — All 11 feature IDs map to one 45-line test file with no audio assertions: tests/feature-matrix.json points every ID, including regression.chassis and the three piano audio IDs, at src/App.test.tsx, which contains 4 jsdom tests asserting key count, an aria-pressed toggle, a pointer press, and a Space keydown. The task's audio test rules (output differs from silence; velocity and sustain move the signal; node counts return to baseline) are not exercised anywhere, and there is no MIDI, polyphony, stealing, cleanup or layout test.
- **minor** — oxlint runs with no ignore config, so the lint gate lints node_modules: On a clean install `pnpm run lint` emitted roughly 45,000 warnings, essentially all of them from node_modules/.pnpm/typescript and jsdom, and still exited 0. The gate passes but provides no signal about the candidate's own source. A console deprecation warning for appearance:slider-vertical also fires on every load (present in the sealed capture too).

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**38/100**

A compact Phase 2 shell whose audio layer is far less finished than its panel implies. Real wins: six audibly distinct piano types (pairwise spectral cosine down to 0.09), working KB Touch, Dyn Comp, Timbre, Unison, Soft Release and Master Level (peak ratio 0.3000 for a 30/100 move), two-layer enable/level/octave/focus, a genuine Amp Sim/EQ and Compressor, a limiter with no clipping, pointer/keyboard/pedal input, and all four gates reproducing on a clean install. Three defects are decisive. Polyphony does not exist: a second key silences the first (130.8 Hz energy 0.027633 held alone, 0.000046 with a second note, 0.000043 when never played), because every note-on rebuilds the layer chain. Any panel interaction while playing closes the AudioContext and stops all sound (capture truncated at 0.85 s, 0.000000 energy after, ctx.state 'closed'; 92 contexts built in one session). Two units are inert: Rotary is created but never connected (484 StereoPannerNodes, zero graph edges) and Reverb's ON toggle renders bit-identically to off; Mod 1 and Mod 2 hold no modulator, collapsing 12 listed types into 4 behaviours. The sample-library gap is declared honestly; none of these are.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 33 |
| Playability & control | 20% | 42 |
| Feature completeness | 25% | 45 |

### Priority issues

- **critical** — Playing a second key silences the first — the instrument is effectively monophonic: play() calls configure() before every note-on, and configure() -> buildLayer() disconnects the previous layer input and output gains (artifact/src/App.tsx:55-58, 85, 151). Voices created by earlier notes remain attached to the orphaned input node and go silent instantly. Measured on the published build with a Goertzel at 130.813 Hz over the 0.95-1.6 s window: note 48 held alone 0.027633; note 48 held with note 60 added at 0.6 s 0.000046; note 48 never played 0.000043; both keys struck together 0.000012. A two-note chord cannot be played, which also fails the inherited Phase 1 requirement for concurrent voices and deterministic stealing.
- **critical** — Touching any panel control while playing closes the AudioContext and cuts all sound: The keyboard/MIDI useEffect depends on `play`, which is re-created whenever layers, effects or piano state change, so React runs its cleanup — `stop(); audio.current?.dispose()` — on every state change; dispose() calls context.close() (App.tsx:114-115, 151-155). Measured: holding a note and clicking one effect ON button truncated the recording at 0.85 s with exactly 0.000000 energy afterwards and ctx.state == 'closed'; the same happened when moving the Master Level slider mid-note (1.5 s requested, 0.488 s captured). One probe session constructed 92 AudioContexts. Every parameter change is therefore an abrupt global dropout rather than a click-free ramp.
- **critical** — Rotary is created but never connected; To Rotary routing is inert: buildLayer() creates a StereoPannerNode and sets its pan, then never calls connect() on it (App.tsx:59, 68-69). A connect()-level census of a whole session recorded 484 StereoPannerNode creations and zero edges involving one. Measured consequence: toggling ROTARY on/off is bit-identical (aligned residual 0.000000, specRel 0.00000, spectral cosine 1.000000), its amount slider is bit-identical across 2 -> 98, and selecting Amp/EQ type 'To Rotary' renders identically to 'EQ only'. The spec lists Rotary as required and IMPLEMENTATION_DETAILS.json describes it as part of the chain.
- **major** — Reverb's ON button does nothing; the convolver is always in the path: The ConvolverNode is wired dry+wet in parallel (compressor->convolver->output and compressor->output) and its impulse is regenerated from `wet` regardless of the unit's on flag (App.tsx:68-69). Reverb ON vs OFF measured bit-identical twice in independent sessions (residual 0.000000, specRel 0.00000, cos 1.000000). The amount slider does change the tail, which makes the unit read as working if only the knob is A/B'd. Reverb types Room, Stage and Hall are also the same algorithm with the same parameters (Stage|Hall residual 0.000000).
- **major** — Mod 1 and Mod 2 contain no modulator; 12 listed types collapse to 4 behaviours: Mod 1 is a single static GainNode and Mod 2 a single static BiquadFilter (App.tsx:63-64). No AudioParam ever appears as a connect() target anywhere in the session, so there is no LFO, no envelope follower and no delay line. Measured: A-Pan, Tremolo, Ring Mod, A-Wah and Wah render bit-identically to one another (residual 0.000000 for all 10 pairs), with only 'Pump' differing as a level change (cos 0.999999, rms 0.897x); Chorus/Flanger/Ensemble/Spin render identically (residual 0.00000-0.00091) and Phaser/Vibe identically to each other. A-Pan leaves L/R correlation at 1.0.
- **major** — String Res lights up but has no audio effect: setSustain() answers a String Res request with `window.setTimeout(() => undefined, 1)` (App.tsx:113) — a timer that does nothing. Late-session A/B with silence gating: off vs on residual 0.4322 / specRel 0.2372 against off vs off (same setting twice) residual 0.4088 / specRel 0.2628, i.e. the difference is the repeat noise; a cleaner earlier pass measured off|on residual 0.00092, cos 0.99999. The button reports aria-pressed=true, so it fakes success. String Res is a required Phase 2 control and is not declared unimplemented anywhere.
- **major** — Delay is never bypassed: mod2->delay->amp is a permanent edge alongside mod2->amp (App.tsx:69), so a delayed copy is summed whether or not the unit is on; only the feedback gain is gated. Measured: delay off vs on is identical for the first 170 ms (residual 0.000000) and differs only in the repeats (cos 0.99778). The delay's amount slider also produced no change at all (residual 0.000000, specRel 0.00000 across 2 -> 98) because tempo and feedback are driven by a `rate`/`feedback` pair the panel never exposes.
- **major** — Plan and feature matrix claim behaviour the build does not have: IMPLEMENTATION_PLAN.md ticks four of the five Phase 2 hard gates as met, including 'Every functional piano and effect control measurably changes rendered audio' and 'Each effect unit and type processes real audio with working bypass and dry/wet'; both are contradicted above. tests/feature-matrix.json maps all 20 required feature IDs — effects.processing, effects.graph, piano.velocity-controls, piano.fallback, piano.basic-sustain-polyphony among them — to one 76-line jsdom file with 6 DOM-attribute tests and zero audio assertions, so nothing in the suite could have caught the inert units or the missing polyphony.
- **minor** — Whole effect graph rebuilt per note, including a randomised convolution impulse: configure() runs inside every note-on, so both layer chains are torn down and rebuilt per key press. One session created 2179 GainNodes, 1027 BiquadFilters, 576 DynamicsCompressors, 484 DelayNodes and 484 ConvolverNodes; each convolver fills a fresh buffer of up to 2.1 s x 2 channels with a Math.random loop on the note-on path (App.tsx:73-79). The randomised impulse also means the same note never renders the same tail twice.
- **minor** — Piano OCT+ is partly buried under the Program section, and two controls share the name 'Master Level': 5x5 elementFromPoint hit-testing at 1440x900 gives #piano-octave-up 10/25 reachable points (its centre resolves to #program-dial, which is why a framework click on it times out); #piano-level 15/25, #piano-pstick 15/25, #master-level 19/25. Separately, the decorative Performance knob 'master-level-decorative' and the functional '#master-level' fader both expose the accessible name 'Master Level', so a screen-reader user has two identically named controls of which one is inert.
- **minor** — No lint configuration; oxlint walks node_modules on a clean install: The artifact ships no .oxlintrc.json and package.json runs bare `oxlint`. On a fresh `pnpm install --frozen-lockfile` in a scratch copy the lint gate linted node_modules/.pnpm/typescript@6.0.3/.../_tsc.js and emitted warnings from vendored code. All four gates still exit 0 and the build reproduces the sealed bundle name (index-_TzmgSzH.js), so this is portability noise rather than a failing gate.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**34/100**

A complete, well-organised Stage 4 surface with an honest fallback declaration and a genuinely working program system, built on an audio engine that does not do what the panel says. Organ and Synth are the piano voice relabelled: every note renders the same two-oscillator subgraph, 14 synth waveforms collapse to 4 timbres (Sine vs Square specDist 1.55 against a 2.21 noise floor), the nine drawbars are inert (all-0 vs all-8 specDist 0.97), and the synth filter, LFO, envelopes and arpeggiator never reach audio. Neither engine can sound at all unless the same-letter piano layer is enabled (rms 8.3e-5 vs 0.093). Worse, every note-on rebuilds both layer racks and disconnects the sounding voices, so the instrument cannot play a chord: holding C3+A3+C4 leaves the C3 fundamental at -103 dB. Every panel click closes the AudioContext, losing the next note. Geometry, colour and key counts are excellent (aspect 3.0950 vs 3.0951, deck 0.5400, 5/5 reference colours), but the white keys cannot shrink to fit and five run off the chassis. Programs, splits, scenes, transpose and Panic are the strongest part and measurably work.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 25 |
| Playability & control | 20% | 50 |
| Feature completeness | 35% | 38 |

### Priority issues

- **critical** — The instrument cannot play a chord - each note-on disconnects the sounding voices: play() calls configure() before every noteOn, and configure() rebuilds both layer racks, disconnecting the previous input/output gains that all sounding voices are wired into. Measured: holding C3+A3+C4 together, the 130.8 Hz bin reads -103.4 dB (vs -37.7 dB for C3 alone and -103.9 dB when C3 is not played) and only the last note survives; 8 keys held give rms 0.0564 / peak 0.185, identical to one note. It also leaks the discarded racks - 153 GainNodes, 34 ConvolverNodes and 34 StereoPannerNodes created after six notes.
- **critical** — Organ and Synth are the piano voice under a different label: Both engines route their note events into the same createVoice() path, mapping organ models and synth waveforms onto the six piano oscillator profiles. Node census shows only 2 OscillatorNodes -> BiquadFilterNode -> GainNode per note whatever the engine. Sine vs Square measured specDist 1.55 and Square vs White Noise 2.27, both inside the 2.21 repeat-measurement floor; 'White Noise' renders a pitched tone. This is the Phase 3 hard gate 'not renamed copies of one oscillator'.
- **critical** — Organ and Synth are silent unless the same-letter piano layer is enabled: Organ A and Synth A/C borrow piano layer bus A and Organ B / Synth B borrow bus B, but the bus output gain is driven by the PIANO layer's enabled flag. With Organ A on and Piano A off the rendered rms is 8.3e-5 (-61 dB relative to 0.093 with Piano A on); Synth A alone measures 6.1e-5. The organ and synth can never be played without the piano layered on top.
- **critical** — The nine organ drawbars and all percussion/vibrato/rotary controls are inert: Setting all nine drawbars from 0 to 8 changes the rendered signal by specDist 0.967 (rms ratio 0.963), inside the 2.21 noise floor. Percussion on/off 0.906, vibrato Off->C3 0.941, rotary Fast + drive 100 0.987 - all inert. The organ spec requires 'Nine drawbars with LED graphs driving the audible spectrum per model'. The LED ladders are also static art, rendering a fixed 3/4/5 repeating pattern regardless of drawbar position.
- **major** — Every panel interaction closes the AudioContext and the next note is lost: The keyboard/MIDI effect depends on play(), which is recreated on every state change, so its cleanup runs audio.dispose() -> context.close() after any panel click. Instrumenting the constructor: 11 clicks produced 11 AudioContext constructions and 11 closes, and the context read state 'closed' between them. The first note after each interaction renders rms exactly 0.000000 over a 400 ms held key with currentTime still 0.0053 s.
- **major** — Rotary is not connected to the graph; Delay and Reverb on/off buttons are inert: 34 StereoPannerNodes were created and the connect census contains zero edges touching a StereoPannerNode, so the rotary unit has no path to the destination - toggling ROTARY gives specDist 0.751. Delay and Reverb are always in the chain with a parallel dry leg and only their internal coefficients change, so DELAY on/off measures specDist 1.038 and REVERB on/off 1.055, both below the 2.21 floor. Sibling types are also one node with different coefficients: mod2 Chorus vs Flanger specDist 0.516 and reverb Room vs Cathedral 1.233 are indistinguishable.
- **major** — Synth filter, LFO, arpeggiator reach nothing and envelope controls do not exist: Filter frequency 0 vs 100 specDist 1.39, resonance 1.52, drive 0.82, LFO Off vs Filter Freq at rate 100 0.73 - all inside the noise floor. With ARP RUN latched a 2.2 s held note showed rms coefficient of variation 0.2047 versus 0.2058 with the arp off: no retriggering. No attack/decay/release control is rendered anywhere in the Synth section, though the spec requires oscillator, filter and amplifier envelopes.
- **major** — Five white keys run off the chassis and the black keys are the wrong width and misaligned: The white keys carry their note-name text and default min-width:auto, so they measure 30.3-34.2 px each and total 1447.8 px inside a 1239.9 px container. Keys key-93, 95, 96, 98 and 100 extend past the chassis right edge at x=1396.8 (the last ends at 1547.8) and are clipped by overflow:hidden - 68/73 keys inside the keybed. The black keys are 28.52 px against a 30.33 px white key (0.940 ratio, hardware is near 0.55) and are laid out on a 100%/43 grid that no longer matches the overflowing whites, so they drift off the white-key boundaries.
- **major** — Deck controls overflow their panels across neighbouring sections and the keybed: The section grid is exact, but the contents are not contained: the Organ LEVEL slider crosses into the PIANO plate, the nine drawbar thumbs hang about 70 px below the ORGAN plate over the top of the keybed, the Program row sliders cross into SYNTH, and #master-level-decorative extends outside the chassis. Two controls are unreachable by the 5x5 elementFromPoint test as a direct result ('Control pedal position' and #effects-reverb-on). The candidate's own stage3-visual-audit.md reports none of this.
- **major** — Organ drawbar/percussion state is outside the program record and the dirty flag misses it: The program snapshot covers piano, effects, organ layers, synth, split, scenes, clock, transpose and morphs, but not organDrawbars or the percussion/key-click/vibrato/rotary state. Moving Organ drawbar 1 from 0 to 8 leaves the OLED reading 'Stored program' with no '· E', and those values are neither stored nor restored on program change - they leak across programs.
- **major** — Morph assignment never drives its destination: Arming WHEEL MORPH and pressing ASSIGN lights the destination label (.morph-lit), but moving the morph wheel from 0 to 100 left the Synth filter frequency input reading 72 and the rendered signal unchanged (specDist 2.36 against a 2.21 floor). Both morph sources are display-only.
- **major** — Turning Split on silences the keyboard above the first split point: The piano layers are hard-wired to zone 1 and the Piano section has no zone selector, so with Split on, the low point at C3 and Organ A in zone 2, note 48 rendered rms 0.0507 while note 60 rendered exactly 0.000000. The crossfade selector only changes the OLED text.
- **minor** — Pitch stick and modulation wheel move but reach no audio and are not declared unsupported: Pitch Stick 50 -> 100 gives specDist 2.50 (noise floor 2.21) and rms ratio 0.979; Mod Wheel gives specDist 0.66. Both are stored as presentation state only, while the Piano section carries a PSTICK enable toggle implying the pitch stick works. Velocity is also inverted on the key face: the top of the key is loudest (rms 0.0489) and the bottom quietest (0.0126).
- **minor** — The panel is built from native form controls at 3-8 px type: One knob cap exists in the whole instrument; 25 native <select> elements and dozens of native range inputs stand in for the hardware, and the LAYER EFFECTS section is seven structurally identical rows. Legends resolve to 3-8 px at 1440x900 and the PERFORMANCE status line is overprinted by the octave buttons.
- **minor** — No state survives a reload: After a full store/recall pass localStorage and sessionStorage both hold 0 keys, so the 32 programs and 8 Live slots are session-only. Not a spec violation on its face, but it means the auto-storing Live slots lose their edits on refresh.

### Technical gate

Passed.
