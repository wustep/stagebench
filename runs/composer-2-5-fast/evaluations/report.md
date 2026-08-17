# Composer 2.5 Fast — Stagebench evaluation

- Run: `composer-2-5-fast`
- Status: complete
- Aggregate: **46/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 51 |
| 2 | Piano library and working effects | 36 |
| 3 | Complete Stage 4 system | 13 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Phase 1 basic piano via honest additive synthesis (triangle + sine overtone oscillators with AD envelope). No recorded samples in Phase 1.
- Generated sound sources: basic-piano-voice — Dual-oscillator piano-like tone with velocity-scaled gain and exponential decay
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Phase 1 uses live Web Audio synthesis only; recorded sample sets are Phase 2 scope.
- Audio note: Polyphony limit 32 with deterministic oldest-voice stealing.
- Audio note: Sustain pedal supported via note lifecycle and MIDI CC64.

### Phase 2: Piano library and working effects

- Audio strategy: One AudioContext with Piano A/B layer buses, per-layer effect chains (Mod1→Mod2→Delay→Amp/EQ→Compressor→Reverb), shared Rotary via To Rotary, master gain and limiter. Grand/Upright/Electric/Clav/Digital/Misc use programmatically synthesized offline sample sets (not field recordings).
- Generated sound sources: piano-sample-sets — Six type-specific sample sets synthesized via OfflineAudioContext at load time: distinct harmonic profiles, decay, and brightness per type. 5 root notes × 2 velocity layers each.; synth-fallback-voice — Triangle + sine overtone used when sample load fails or error state; effects-impulse-responses — Procedural reverb impulses generated at runtime per reverb type
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Grand, Upright, and Electric are audibly distinct synthesized sample sets — honestly declared as generated, not recordings.
- Audio note: Organ, Synth, and Program controls remain presentation-only (Phase 1 honesty preserved).
- Audio note: Master Level knob scales master gain; Panic via blur/all-notes-off clears voices.
- Audio note: Sustain honors per-layer SUSTPED toggle.
- Audio note: Polyphony limit 32 with deterministic oldest-voice stealing per layer pool.

### Phase 3: Complete Stage 4 system

- Audio strategy: One AudioContext with Piano A/B layer buses, shared Organ bus + effect chain, Synth A/B/C independent effect chains, inherited Mod1→Mod2→Delay→Amp/EQ→Compressor→Reverb order, shared Rotary, master gain and limiter. Piano Grand/Upright/Electric use programmatically synthesized offline sample sets. Organ uses live additive synthesis (tonewheel/transistor/pipe models). Synth uses live Web Audio oscillators with filters, envelopes, LFO, and deterministic arpeggiator.
- Generated sound sources: piano-sample-sets — Six type-specific sample sets synthesized via OfflineAudioContext at load time.; organ-additive-engines — Live B3/Vox/Farf/Pipe additive synthesis with drawbar harmonic weighting, B3 percussion/key click, vibrato/chorus; synth-oscillator-engines — Live Pure/Sync/Multi/Super/FM-H oscillator stacks with LP/HP/BP filters, envelopes, LFO, arpeggiator; effects-impulse-responses — Procedural reverb impulses generated at runtime per reverb type
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Grand, Upright, and Electric are audibly distinct synthesized sample sets — honestly declared as generated, not recordings.
- Audio note: Organ and Synth are live synthesis engines, not sample playback.
- Audio note: Programs serialize all supported state except Master Level; 32 slots + 8 Live auto-store slots.
- Audio note: Spec-excluded controls listed in unsupported-controls.ts remain presentation-only.
- Audio note: Panic (Shift+Transpose) sends all-notes-off and resets transpose/mod wheel/control pedal.

## Phase 1: Complete surface and basic piano

**51/100**

A complete, honest, thin Phase 1. The surface is fully inventoried — 163 stably-identified, aria-labelled controls across six sections, two OLEDs in the right places, 73 keys (43W/30B) all pointer-reachable — but drawn as a uniform grid of HTML range sliders, the presentation the visual spec forbids, on the superseded section fractions (piano 0.1486 vs 0.085). The piano voice is real, correctly pitched across E1-E7 and cleanly velocity-scaled (maxRMS 0.1995 vs 0.0433), and the decorative boundary holds: Master Level moves and changes nothing audible. Polyphony caps deterministically at 32; blur kills every voice. Against that, three things Phase 1 names outright are absent from the running build: Web MIDI is never requested, sustain is unreachable through every input (dead code path at state/instrument.ts:90), and node cleanup leaks — the overtone oscillator is never stopped, 96 created against 48 stopped. A held note never decays past 65%, 32 voices clip at 2.58 full scale, and 15 controls are clipped out of reach by overflow:hidden. All four gates reproduce on a clean install and the rebuild is byte-identical to the served bundle.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 60 |
| Playability & control | 55% | 50 |
| Feature completeness | 20% | 43 |

### Priority issues

- **critical** — Sustain is unreachable through every input the build offers: With focus cleared (activeElement BODY), holding Space and playing a note leaves the status line at 'Piano: ready · Voices: 0' and the post-release signal at maxRMS 5.5e-6 against 0.106 while held — identical to the unsustained control run. Cause: src/state/instrument.ts:90 returns early when COMPUTER_KEY_MAP[e.key.toLowerCase()] is undefined, which it always is for ' ', so the `e.code === 'Space'` branch two lines below is unreachable. The only other routes are MIDI CC64 (no Web MIDI exists) and the decorative SUSTPED switch (clicking it flips aria-checked but a following note still stops dead, maxRMS 8.7e-6). Sustain is a named Phase 1 hard gate and is also claimed in IMPLEMENTATION_DETAILS.json.
- **critical** — Web MIDI is not implemented at all: navigator.requestMIDIAccess is never called in the running build (instrumented counter 0 across every session) and the identifier does not appear anywhere in build/assets/index-C05RWeRt.js. src/input/midi.ts defines only a mock port object, and src/state/instrument.ts:26 wires the app to createMockMidiPort('connected') — a port nothing ever feeds. The note/velocity/CC64 handlers are live code with no transport. The Phase 1 contract lists Web MIDI note input as included scope and piano.basic-inputs requires it; nothing declares it missing.
- **major** — Every note permanently leaks one running OscillatorNode: engine.ts:94 creates an `overtone` oscillator but ActiveVoice only stores the triangle one, so releaseVoice (engine.ts:167-174) calls stop() on half the oscillators. Instrumented create/stop counts came out at exactly 2:1 in three independent sessions (96/48, 84/42, 28/14). Node counts never return to baseline after cleanup, which the shared completion gates require, and a long session accumulates unbounded live nodes.
- **major** — A held note never decays — the envelope floors at 65% and stays there: maxRMS of a held C4 sampled at ~300 ms intervals: 0.1671, 0.1525, 0.1367, 0.1218, 0.1102, 0.1099, 0.1101, 0.1102, 0.1101 across four seconds. engine.ts:102 ramps to max(amp*0.65, 0.001) at t+1.2 s and schedules nothing after, so the voice becomes a steady tone. No piano behaves this way and a player notices immediately.
- **major** — Hard clipping under polyphony — no headroom or limiter: Master gain is a fixed 0.35 (engine.ts:38) feeding destination directly. 30 simultaneous voices measured analyser peak 2.20 of full scale; 32 voices measured 2.58. Anything past roughly a two-handed chord distorts.
- **major** — 15 controls are rendered but clipped out of pointer reach; 146 at narrow width: `.panel-controls { overflow: hidden }` (src/styles.css:108-115) clips the last wrapped row of the dense panels. The 5x5 document.elementFromPoint grid at 1440x900 unscrolled resolves 148/163; the misses are organ-layer-b-enable, organ-layer-a/b-octave, piano-string-res, piano-sustped, piano-pstick, piano-section-on, program-transpose, program-dirty, synth-arp-range, synth-voice-poly/mono/legato, synth-glide, synth-unison. At 390x844 only 17/163 are reachable. The Phase 1 gate requires every visible control to move or press.
- **major** — The visual audit reports 'Deviation: None' for section widths that are 0.064 out: evidence/stage1-visual-audit.md tabulates all six section widths as matching spec, but the implementation hard-codes the superseded fractions (src/model/hardware.ts:32-39). Measured at 1440x900: piano 0.1486 vs spec 0.085, program 0.0892 vs 0.125, synth 0.2081 vs 0.25 — worst deviation 0.0636 against a 0.012 tolerance. src/model/hardware.test.ts pins the wrong values, so the regression test protects the error.
- **major** — No test asserts a rendered audio signal: All 26 tests assert voice counts and aria attributes on hand-built fakes. Grepping the test files for OfflineAudioContext, startRendering, getChannelData and measureOutputLevel returns nothing — engine.ts exports measureOutputLevel and no test calls it. tests/feature-matrix.json maps the four audio-bearing piano IDs to these state-only tests, which is what let the dead Space-sustain path and the oscillator leak ship green.
- **major** — Every black key sits about one white key to the right of its correct position: src/components/keybed.tsx:63 computes left = ((whiteBefore + 0.72) / whiteCount) * 100, which places a black key inside the following white key rather than straddling the boundary before it. Measured at 1440x900, F#1 (MIDI 30) has its horizontal centre over the A1 white key (MIDI 33); the same offset holds for every black key sampled. The topmost black key (MIDI 99) also overflows the keybed right edge by 9.7 px, so 72/73 keys fall inside the keybed box.
- **minor** — Rotary Speaker block is placed in the Organ section, not the Performance band: specs/nord-stage-4.visual.json lists 'rotary speaker controls' as a required performance landmark and notes the block sits on the exposed red chassis there. src/model/hardware.ts:119-122 declares organ-rotary-drive/slow/fast/stop with section 'organ', so they render inside the Organ plate and the performance band is missing a required landmark.
- **minor** — LED indicators are rendered as user-operable switches: The 15 'led' controls render as role=switch buttons with a click handler (src/components/controls.tsx:71-85), so an output-only indicator can be toggled by the user. They move and report state, so the honesty contract is not broken, but the hardware semantics are inverted.
- **minor** — Duplicate computer-key mappings and an unmemoised MIDI port: COMPUTER_KEY_MAP (src/model/keyboard.ts) maps both 'a' and ',' to 48, 's' and '.' to 50, 'd' and '/' to 52, so releasing either key stops a note the other may still be holding. Separately, src/state/instrument.ts:26 builds a new mock MIDI port on every render while that port is in the attach effect's dependency array, so handlers detach and re-attach on every state change.
- **minor** — lint lints node_modules: `pnpm run lint` is bare `oxlint` with no ignore configuration, so it walks the installed dependency tree and emits hundreds of warnings from rolldown/undici sources. It exits 0, so the gate passes, but the signal is unusable.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**36/100**

Measured against build/ (bundle index-2MeMSDML.js) on 127.0.0.1:5512, driving the page with Playwright and a recording tap patched onto the AudioContext destination. The skeleton is right — one AudioContext, A/B layer buses, master gain into a limiter into one destination, six selectable piano types with LED/OLED feedback, layer enable/level/octave and KB Touch, Dyn Comp, Soft Release and String Res all measurably moving the rendered signal, 25 simultaneous voices with clean cleanup and no console errors. The sound itself does not hold up. A runtime graph trace shows both ConvolverNodes with zero inbound edges and both Delay nodes fed only by their own feedback gain: Mod 2, Delay and Reverb never touch the audio, and their knobs move parallel gains so they look alive. Full delay mix/feedback produces no repeats; Cathedral and Booth render identically. No named effect type is selectable anywhere (types are unlabeled 0-127 knobs), Rotary has no control at all, sustain is unreachable from keyboard, UI and MIDI, and Timbre retunes the piano instead of shaping it.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 32 |
| Playability & control | 20% | 50 |
| Feature completeness | 25% | 35 |

### Priority issues

- **critical** — Delay, Reverb and Mod 2 are disconnected from the signal path but their knobs still change the output: Instrumenting AudioNode.prototype.connect in the shipped build shows both ConvolverNodes with zero inbound edges and both main DelayNodes fed only by their own feedback GainNode; Mod 2's delay line is the same closed loop. Measured: delay at mix 127 / feedback 127 / time 127 adds no repeats and leaves the post-note tail at 0.000044, exactly the no-delay value; reverb at full wet renders Cathedral and Booth identically (RMS 0.002877 both) with a tail of 0.000029, below the dry tail; Mod 2 at maximum sits 0.00026 from neutral against a 0.00004 noise floor. Because each unit's dry and wet gains are summed in parallel, turning these units up does move the meter, so all three read as working effects while none of them processes audio. Half the required units are 'a label, enum, or disconnected node', which the effects spec names explicitly as not an effect.
- **critical** — IMPLEMENTATION_DETAILS.json declares audio processing that the build does not perform: The file declares 'effects-impulse-responses: Procedural reverb impulses generated at runtime per reverb type' with ConvolverNode as its node, and an audioStrategy of 'per-layer effect chains (Mod1→Mod2→Delay→Amp/EQ→Compressor→Reverb) … shared Rotary via To Rotary … Sustain honors per-layer SUSTPED toggle'. Measured against build/: the convolvers receive no signal, the delay lines receive no signal, the rotary cannot be enabled from any panel control, and sustain cannot be engaged from keyboard, UI or MIDI. The sample-provenance section is honest, but the effects and sustain claims describe behaviour the artifact does not have, which is the honesty-contract failure mode the benchmark exists to catch.
- **major** — Sustain is unreachable from every required input: Spec requires sustain from UI control, computer keyboard and MIDI CC64. Space is swallowed: the window keydown handler looks up COMPUTER_KEY_MAP[' '], finds nothing and returns before reaching its Space branch — with Space held, a note's envelope decays at the same time as without it and the status line never shows '· Sustain' (checked with focus on document.body, so this is not a focus-swallowing artifact). No panel control applies sustain (only the SUSTPED routing toggle exists). navigator.requestMIDIAccess is never called, so there is no MIDI input at all; the engine's sustain logic is only reachable from unit tests.
- **major** — No effect type is selectable by name, and only one type branch exists in the audio code: Every unit's 'type' is an unlabeled 0-127 knob (Mod 1 Type, Amp Sim Type, Reverb Size). None of the 24 named types in the effects spec appears anywhere in the DOM. In the audio code only Mod 1 type === 2 branches (and only to double an LFO gain); Mod 2's type is stored and never read; amp types differ only by a wet-gain multiplier, measured 0.00016-0.00023 spectral distance apart with centroids 274.8-277.4 Hz, so LP24/HP24 do not filter; reverb types select impulse decays for a convolver that receives nothing.
- **major** — The shared Rotary has no panel control and can never be enabled: control-bindings reads fx-rotary-on, fx-rotary-drive and rotary speed, but none of those ids exists on the panel — a DOM sweep of the effects section returns 22 controls, none of them rotary. rotaryOn therefore stays false forever, so To Rotary routes the layer into a bypassed unit: clicking it moved the signal by 0.00002 spectral distance (noise floor 0.00004) while changing level. Delay/Comp/Reverb Global and Compressor Fast are missing from the panel for the same reason.
- **major** — Timbre changes pitch instead of tone, and one of its positions is a no-op: Timbre is applied as a sample playbackRate multiplier. Measured f0 across the cycle: Off 261.71 Hz, Soft 257.11 Hz (-30 cents), Mid 262.69 Hz (identical to Off), Bright 269.50 Hz (+51 cents). Instead of Soft damping highs and Bright emphasising treble, the control detunes the whole instrument by up to half a semitone, which a player would hear immediately as being out of tune with everything else.
- **major** — FX focus and group are inert, and both focus toggles can read as on at once: Clicking Layer B Focus leaves Layer A Focus at aria-checked="true" as well, because the mutual-exclusion branch only runs for controls of kind 'button' while these are toggles. Audibly, focus and group change nothing: spectral distance from baseline 0.00006 (focus B) and 0.00004 (group) at a 0.00004 noise floor. resolveEffectsForLayer returns the same state on every branch, and the piano type index is assigned to both layers together, so the two layers can never hold different sounds or different effect settings.
- **major** — Grand, Upright and Electric are not recorded sample sets: The Phase 2 contract requires bundled, redistributable recorded sample sets for these three. The build synthesizes all six types at load time (5 roots x 2 velocity layers, provenance 'synthesized'). Declared honestly, so this is a coverage gap rather than a false claim, but the gate is unmet and the resulting voices are filtered sine stacks with 200-325 ms decay-to-10% that do not read as pianos.
- **minor** — Bypass and compressor act mainly as volume changes: All Effects Bypass raises output from RMS 0.00177 to 0.00513 (+9.8 dB) because the bypass gain re-injects the unprocessed input without level matching, and Compressor amount 0 -> 127 raises output from 0.00180 to 0.00805 (+13 dB) while crest factor falls only from 16.4 to 15.8. Both make A/B comparison misleading: louder reads as better rather than as different.
- **minor** — Nothing in the build is ever stereo: Across all 27 effect trials and all 26 piano trials the L-R difference measured exactly 0.000000, including Unison 3 and Mod 1 A-Pan. The unison StereoPanner pair sums back into the same mono gain node, so panning and unison width cancel out; A-Pan reduces to tremolo.
- **minor** — Dead knobs inside the sections this phase makes functional: Model Dial (RMS 0.004195 / 0.004783 / 0.004342 at 0 / 64 / 127), Compressor Ratio (0.00035 spectral distance) and Master Wet (0.00006) all move, report values and change nothing audible. Piano and Layer Effects are the two sections Phase 2 declares functional, and none of these is listed as unsupported in IMPLEMENTATION_DETAILS.json or the visual audit.
- **minor** — Per-type brightness never reaches the harmonics: In artifact/src/audio/samples.ts only the fundamental oscillator passes through the per-type low-pass; every harmonic oscillator connects straight to the output gain. The brightness parameter (0.45 Grand-to-Clav range) therefore has no audible effect, which matches the measured spectra: centroid 252-290 Hz across all six types and a Digital-to-Misc spectral distance of 0.0004.
- **minor** — pnpm lint does not reproduce on a clean install: With a fresh pnpm install of artifact/, test (38 passing), typecheck and build all pass and the build reproduces the same bundle name as build/assets. `pnpm lint` exits 1: the package ships no oxlint configuration, so oxlint walks node_modules and emits ~45,000 warnings, of which only 4 come from src/. Recorded as portability rather than scored as a gate failure.

### Technical gate

Failed; score capped at 59.

## Phase 3: Complete Stage 4 system

**13/100**

A faithful outline of a Stage 4 73 wrapped around a hollow instrument. Geometry is good - 1396.8x451.3px, aspect 3.09507 vs 3.0951, deck 0.53997 / keybed 0.45999, width 0.97, 43+30 keys, black-key height 0.60994, 5/5 colours inside dE 12 - but the section widths keep the superseded coarse fractions (piano 0.1486 vs 0.085) and .panel-controls{overflow:hidden} buries 15 of 163 controls out of pointer reach. Every control is a native range slider: no knob caps, no drawbars, no LED ladders. Behaviour is where it breaks. Organ and Synth render pure silence (rms 0.000143, 0 voices) because defaultLayerScene ships their scene flags false and no control can flip them, so two of the three Phase 3 engines cannot be played. The 32-slot program system is a tested module the app never imports, so no program, split, scene or morph workflow works. In the effects graph all 12 DelayNodes have no path to the destination and all 6 ConvolverNodes have no input: Delay, Mod 2 and Reverb are level changes with no echo or tail, and the rotary never engages. Mod 1, Amp/EQ, Compressor, bypass, master level, piano layers, polyphony and cleanup are real. There is no Web MIDI at all, and sustain never engages.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 21 |
| Playability & control | 20% | 8 |
| Feature completeness | 35% | 6 |

### Priority issues

- **critical** — Organ and Synth engines are silent in the shipped build: With Piano Layer A off and Organ A/B + Synth A/B/C enabled (all drawbars 8, levels 127) the destination renders the DC floor (rms 0.000143) and the voice counter stays at 0. defaultLayerScene() ships organA/organB/synthA/synthB/synthC = false; noteOn() skips a layer whose scene flag is false and applyState() pins those layer input gains to 0. The only keys that could flip the scene ('program-scene-i-active', 'program-scene-ii-active') are never written by any rendered control, so there is no route to make either engine sound. Two of the three engines that define Phase 3 cannot be played.
- **critical** — The program system is implemented but never mounted: src/state/programs.ts implements 32 slots, 8 Live slots, store/store-as, dirty tracking and localStorage persistence, and programs.test.ts passes against it - but nothing in the app imports it. Driving Program 1-8, Page Up/Down, Store, Store As and Live Mode in the build changes only the buttons' own aria-pressed; the Program OLED never leaves 'Grand Model', localStorage stays empty and a reload recalls nothing. A green test suite is covering a module that is not in the product.
- **critical** — Delay, Mod 2 and Reverb are disconnected from the signal path in all six effect chains: Graph census of the live AudioContext: all 12 DelayNodes have zero path to the destination (each is a closed delayNode->filter->feedback->delayNode loop that the chain neither feeds nor reads), and all 6 ConvolverNodes have in-degree 0 while still being wired to reverbWet. Measured on rendered signal: Delay at time/feedback/mix maxed is indistinguishable from dry (rms 0.001365 vs 0.001418, tailSum 7.29 vs 7.33, identical envelope, no echo); Reverb at max is the dry signal scaled 1.6x with LESS tail than dry; Mod 2 at max is level-only. Their knobs still change the output level, so the units read as working while producing none of their namesake behaviour.
- **major** — 15 panel controls are rendered but can never be reached by a pointer: .panel-controls sets overflow:hidden with no scroll affordance (styles.css:108-115); at 1440x900 the Synth panel reports scrollHeight 227 vs clientHeight 189. A 5x5 elementFromPoint grid over every control box finds 148/163 reachable; organ-layer-b-enable, organ-layer-a/b-octave, piano-string-res, piano-sustped, piano-pstick, piano-section-on, program-transpose, program-dirty, synth-arp-range, synth-voice-poly/mono/legato, synth-glide and synth-unison get zero hits, and 17 more are half-clipped. Program Transpose is the only control bound to transposition, so an entire documented feature is behind a clipped edge.
- **major** — No Web MIDI implementation and no working sustain: navigator.requestMIDIAccess occurs zero times in src/ and zero times in build/assets/index-BfTeCzmF.js; useInstrument defaults to createMockMidiPort('connected'), an in-memory stub only tests can drive, so no hardware controller can reach the instrument. Separately, the Space keydown handler returns before its own e.code === 'Space' branch because COMPUTER_KEY_MAP has no space entry (instrument.ts:141-143); measured with focus cleared, holding Space and releasing a note still drops it to 'Voices: 0'. Both are Phase 1 hard-gate behaviours regressed by Phase 3.
- **major** — Rotary speaker is permanently disengaged and Slow/Fast do nothing: SharedRotary.apply() is driven by fx.rotaryOn || organ.rotaryRoute, read from 'fx-rotary-on' and 'fx-organ-rotary' - neither of which exists as a rendered control - so its wet gain never leaves 0 and its LFO never reaches the audio path. Measured with To Rotary engaged and drive 127: slow and fast are indistinguishable (sustain CV 0.5605 vs 0.5641, tailSum 9.76 vs 9.63) and neither shows any amplitude modulation. The Rotary Slow/Fast/Stop buttons light as engaged regardless.
- **major** — Organ model switches are non-exclusive and only B3 is ever applied: The four model switches are ControlKind 'toggle', so interactControl bypasses cyclePresentationControl and never clears the siblings - after clicking B3 then Vox, both report aria-checked=true and both LEDs are lit. presentationToAudioState then resolves the model with ORGAN_MODELS.find(), which returns B3 first, so Vox/Farf/Pipe can never take effect even if the organ were audible.
- **major** — Section widths follow the superseded coarse spec fractions: SECTIONS in src/model/hardware.ts still uses 0.13/0.21/0.15/0.09/0.21/0.21, the values specs/nord-stage-4.visual.json v1.3.0 explicitly corrected on 2026-07-04. Measured rendered widths are 0.1288/0.2080/0.1486/0.0892/0.2081/0.2080 against the spec's 0.14/0.20/0.085/0.125/0.25/0.20: the Piano band is 75% wider than specified (deviation 0.0636), Synth is 17% narrower (0.0420) and Program is 29% narrower (0.0359). Five of six are outside the 0.012 tolerance, and the narrow Program band is what pushes Transpose and the Dirty indicator off the bottom of their panel.
- **minor** — Default program is permanently tremolo-modulated: Mod 1 ships at amount 64 with bypass false, so applyMod1 sets mod1LfoGain to 0.24 and its 4.5 Hz LFO modulates mod1Wet.gain from the first note. Every default piano note visibly warbles (envelope 6.0-5.0-3.8-2.4-1.8-1.8-2.5-3.1-3.5, ~220ms period) and the warble disappears under All Effects Bypass. The panel is at least honest about it - the Mod 1 Amount knob is genuinely at its midpoint - but the instrument's idle sound is wrong.
- **minor** — Top black key overhangs the keybed: keybed.tsx:63 positions black keys at ((whiteBefore + 0.72) / 43) * 100%. For the final black key that is 99.35% with a 1.35% width, so it spans to 100.7% - measured at x 1405.34 + 18.72 = 1424.06 against a keybed right edge of 1414.39, a 9.7px overhang. 72 of 73 key boxes fall inside the keybed.
- **minor** — Rotary Speaker block is placed in the Organ section rather than the performance band: organ-rotary-slow/fast/stop/drive are declared with section 'organ' (hardware.ts:119-122) and render inside the dark Organ plate. The spec's sectionLandmarks and reference/nord-stage-4-73.jpg both place the Rotary Speaker block on the exposed red chassis of the performance band, below Master Level. This is the one required landmark of 33 that is not rendered in its own section.

### Technical gate

Failed; score capped at 59.
