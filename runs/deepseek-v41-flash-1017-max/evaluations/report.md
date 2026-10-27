# DeepSeek V4.1 Flash Max — Stagebench evaluation

- Run: `deepseek-v41-flash-1017-max`
- Status: complete
- Aggregate: **79/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 81 |
| 2 | Piano library and working effects | 59 |
| 3 | Complete Stage 4 system | 72 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Live synthesis only. One piano-like voice is generated in JavaScript from an additive partial bank with per-partial inharmonicity, per-partial decay, a deterministic hammer transient and a per-note release curve. The rendered samples are written into an AudioBuffer and played through Web Audio (source -> voice gain -> master gain -> destination). No recorded audio is loaded, bundled, fetched or streamed anywhere in this project.
- Generated sound sources: Modelled piano voice — Deterministic additive synthesis: up to 24 stretched partials per note (inharmonicity 0.00022 + 0.00085 * register), amplitudes tilted by 1/n^0.95 and rolled off by exp(-(n-1) * (1.05 - 0.98 * velocity)), plus a 14 ms deterministic noise burst shaped by the same velocity. Velocity changes both level (0.84 * v^1.25) and spectrum, so a hard stroke is brighter rather than merely louder.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: The Program display labels the voice 'Modelled piano' so the interface never implies a recorded grand.
- Audio note: No sample set is used for any type, so the piano.json requirement for recorded Grand/Upright/Electric sets is out of Phase 1 scope and is not claimed here.
- Audio note: Polyphony is capped at 16 voices with deterministic oldest-first stealing; both the cap and the stealing order are covered by tests.
- Audio note: Sustain is a real lifecycle state: released notes are held while the pedal is down and damped when it lifts.
- Audio note: Master path: every voice connects through one master gain node at 0.72 fixed gain, then to destination. Nothing bypasses it.
- Audio note: Release is a scheduled gain curve (1 -> 0 over 0.46 to 0.18 s depending on register), applied to the voice's own gain node; the source is stopped just after the curve completes.
- Audio note: Velocity-0 strikes render silence rather than a very quiet note.
- Audio note: The engine reports its real state (idle / loading / ready / suspended / error / fallback) and the Program display prints it verbatim. A browser without Web Audio gets a 'NO AUDIO OUTPUT' fallback in which the keybed still responds but is honestly silent.

### Phase 2: Piano library and working effects

- Audio strategy: Hybrid, and declared per type. Grand, Upright and Electric play bundled *recordings* (three separate licensed sample sets, shipped inside the build and loaded from the bundle with no network at runtime). Clav, Digital and Misc are *modelled*: they are generated in JavaScript from the additive partial bank in src/audio/pianoModel.ts, with per-model character applied in src/audio/pianoVoice.ts. Every voice — sampled or modelled — then runs through the same layer effect chain, layer level, master gain, limiter and single destination.
- Generated sound sources: Modelled piano body (Grand/Upright/Electric asset-failure fallback) — Deterministic additive synthesis used only when a recorded set fails to load. Up to 24 stretched partials with per-partial inharmonicity and decay, a deterministic hammer transient, velocity-dependent brightness, and a per-note damper release. This is never presented as a recording: the display reports 'Piano not found' and the library status reports state=fallback.; Clav (modelled) — The additive model with a clavinet character: a fast exponential decay and an added third-harmonic transient for the plucked bite. Declared 'modelled' in the model catalogue and printed as 'Clav D6 (modelled)' in the display.; Digital (modelled) — The additive model with a clean digital-piano character: a gentle high roll-off, a slightly longer sustain and no hammer noise.; Misc mallet (modelled) — The additive model with a marimba/vibraphone character: a hard fast decay plus strong 4x and 7x partials.; Reverb impulse responses — Six generated impulse responses (Room, Booth, Spring, Stage, Hall, Cathedral) built from a deterministic PRNG: a pre-delay, early reflections and an exponential noise tail whose length comes from the type's declared decay. Spring additionally has five dispersive taps. No recorded IRs are used.; Amp / cabinet / drive curves — A fixed tanh soft-clip transfer curve shared by every saturator (drive is applied as input gain), plus a transparent-below-the-knee output ceiling curve. The Twin, JC and Small models are documented approximations built from a tone stack and cabinet corner frequencies, not measured impulse responses.
- Recorded sample provenance: Salamander Grand Piano V3 — Yamaha C5 — https://github.com/sfzinstruments/SalamanderGrandPiano — recorded by Alexander Holm; original release at https://archive.org/details/SalamanderGrandPianoV3 (CC BY 3.0 Unported (https://creativecommons.org/licenses/by/3.0/)); VSCO 2 Community Edition — Upright Piano — https://github.com/sgossner/VSCO-2-CE — 'Upright Piano' folder, recorded by Simon Dalzell of Ivy Audio, Winter 2015-16; redistributed by Versilian Studios LLC (CC0 1.0 Universal (public domain dedication)); Greg Sullivan's E-Pianos — Yamaha CP80 Electric Grand — https://github.com/sfzinstruments/GregSullivan.E-Pianos — 'CP80' instrument, sampled by Greg Sullivan (http://www.sullivang.net/), SFZ mapping by kinwie (CC BY 3.0 Unported (https://creativecommons.org/licenses/by/3.0/))
- Bundled audio: 235 files (8.2 MB)
- Audio note: Recorded and modelled sources are never mixed silently: the model catalogue declares each model's source, the Program display prints 'recorded' only for the three sample sets, and the library chip reports SAMPLES READY, LOADING SAMPLES, MODELLED or PIANO NOT FOUND.
- Audio note: Root notes and velocity layers are per file in src/audio/sample-manifest.json, which also marks every file as kind=recorded or kind=derived (a derived file is a re-pitched copy of a stated source root, used only to fill a gap wider than four semitones).
- Audio note: Per-file level trims live in src/audio/sample-gains.json. They are gains only — no EQ, compression or other tone shaping — measured from each file's own loudness so a quiet ppp layer is audible while the layer ordering stays natural.
- Audio note: Polyphony is 16 voices per layer with deterministic oldest-first stealing; each layer steals independently.
- Audio note: Sustain is a real per-layer route: SUSTPED decides whether the pedal holds that layer's notes, and lift damps exactly the layers it was holding.
- Audio note: Only the sustain pedal is implemented. Soft pedal, sostenuto and half-pedaling are deliberately not claimed, and MIDI CC66/CC67 are ignored rather than silently mapped.
- Audio note: Every audible parameter change uses a short ramp (setTargetAtTime, ~12-20 ms), and unit bypass is a crossfaded gain pair rather than a disconnect, so switching never clicks.
- Audio note: The chain output has a soft ceiling so panel EQ boosts (+/-15 dB) cannot leave a chain above full scale; below that knee the stage is transparent, and the master limiter remains the only stage that acts on normal playing.
- Audio note: Organ, Synth and Program audio are not implemented in this phase and are listed as unsupported below.

### Phase 3: Complete Stage 4 system

- Audio strategy: Hybrid, and declared per source. Grand, Upright and Electric play bundled *recordings* (three separate licensed sample sets loaded from the bundle). Clav, Digital and Misc are modelled additive synthesis. The Organ and Synth engines are live *synthesis* with no sample content at all: organ registrations are rendered to looped buffers from harmonic partial tables, and synth notes are rendered sample-by-sample from the oscillator, filter, envelope and LFO generators. Reverb impulse responses are generated at runtime; no recorded IRs are bundled. Every source is declared below, and no generated buffer is described as a recording.
- Generated sound sources: Modelled piano body (Grand/Upright/Electric asset-failure fallback) — Deterministic additive synthesis used only when a recorded set fails to load. Up to 24 stretched partials with per-partial inharmonicity and decay, a deterministic hammer transient, velocity-dependent brightness, and a per-note damper release. This is never presented as a recording: the display reports 'Piano not found' and the library status reports state=fallback.; Clav (modelled) — The additive model with a clavinet character: a fast exponential decay and an added third-harmonic transient for the plucked bite. Declared 'modelled' in the model catalogue and printed as 'Clav D6 (modelled)' in the display.; Digital (modelled) — The additive model with a clean digital-piano character: a gentle high roll-off, a slightly longer sustain and no hammer noise.; Misc mallet (modelled) — The additive model with a marimba/vibraphone character: a hard fast decay plus strong 4x and 7x partials.; Reverb impulse responses — Six generated impulse responses (Room, Booth, Spring, Stage, Hall, Cathedral) built from a deterministic PRNG: a pre-delay, early reflections and an exponential noise tail whose length comes from the type's declared decay. Spring additionally has five dispersive taps. No recorded IRs are used.; Amp / cabinet / drive curves — A fixed tanh soft-clip transfer curve shared by every saturator (drive is applied as input gain), plus a transparent-below-the-knee output ceiling curve. The Twin, JC and Small models are documented approximations built from a tone stack and cabinet corner frequencies, not measured impulse responses.; Organ tonewheel registration (B3) — Looped buffer rendered from nine sine partials at the tonewheel footage intervals, each with a low-level octave and twelfth leakage. No sample content.; Organ transistor registration (Vox) — Seven reedy partials through a fixed formant, plus a filtered/unfiltered mix drawbar and a squared divider component. No sample content.; Organ register-sum registration (Farf) — Nine on/off register selectors, each contributing its own voice character (flute, oboe, trumpet, string) as a harmonic series. No sample content.; Organ pipe registration (Pipe 1 and Pipe 2) — Nine principal ranks, each a full harmonic series; Pipe 2 uses a brighter weighting of the same ranks. No sample content.; B3 percussion and key click — A single decaying envelope over the 2nd or 3rd harmonic for percussion, and a seeded short noise burst for the key click. Both generated at note on.; Synth oscillators — Pure shapes from band-limited single-cycle tables; a hard-synced oscillator; three- and six-saw Multi stacks; a seven-voice Super stack with spread panning; and a two-operator FM algorithm. No sample content.; Synth filter, envelopes and LFO — RBJ biquad coefficients for LP12/LP24/HP/BP with per-sample cutoff modulation, AD/AR envelopes, tanh drive, and five LFO waveforms including a seeded Sample & Hold. No sample content.
- Recorded sample provenance: Salamander Grand Piano V3 — Yamaha C5 — https://github.com/sfzinstruments/SalamanderGrandPiano — recorded by Alexander Holm; original release at https://archive.org/details/SalamanderGrandPianoV3 (CC BY 3.0 Unported (https://creativecommons.org/licenses/by/3.0/)); VSCO 2 Community Edition — Upright Piano — https://github.com/sgossner/VSCO-2-CE — 'Upright Piano' folder, recorded by Simon Dalzell of Ivy Audio, Winter 2015-16; redistributed by Versilian Studios LLC (CC0 1.0 Universal (public domain dedication)); Greg Sullivan's E-Pianos — Yamaha CP80 Electric Grand — https://github.com/sfzinstruments/GregSullivan.E-Pianos — 'CP80' instrument, sampled by Greg Sullivan (http://www.sullivang.net/), SFZ mapping by kinwie (CC BY 3.0 Unported (https://creativecommons.org/licenses/by/3.0/))
- Bundled audio: 235 files (8.2 MB)
- Audio note: Recorded and modelled sources are never mixed silently: the model catalogue declares each model's source, the Program display prints 'recorded' only for the three sample sets, and the library chip reports SAMPLES READY, LOADING SAMPLES, MODELLED or PIANO NOT FOUND.
- Audio note: Root notes and velocity layers are per file in src/audio/sample-manifest.json, which also marks every file as kind=recorded or kind=derived (a derived file is a re-pitched copy of a stated source root, used only to fill a gap wider than four semitones).
- Audio note: Per-file level trims live in src/audio/sample-gains.json. They are gains only — no EQ, compression or other tone shaping — measured from each file's own loudness so a quiet ppp layer is audible while the layer ordering stays natural.
- Audio note: Polyphony is 16 voices per layer with deterministic oldest-first stealing; each layer steals independently.
- Audio note: Sustain is a real per-layer route: SUSTPED decides whether the pedal holds that layer's notes, and lift damps exactly the layers it was holding.
- Audio note: Only the sustain pedal is implemented. Soft pedal, sostenuto and half-pedaling are deliberately not claimed, and MIDI CC66/CC67 are ignored rather than silently mapped.
- Audio note: Every audible parameter change uses a short ramp (setTargetAtTime, ~12-20 ms), and unit bypass is a crossfaded gain pair rather than a disconnect, so switching never clicks.
- Audio note: The chain output has a soft ceiling so panel EQ boosts (+/-15 dB) cannot leave a chain above full scale; below that knee the stage is transparent, and the master limiter remains the only stage that acts on normal playing.
- Audio note: The Organ and Synth engines contain no recorded audio. Their buffers are rendered at runtime from the tables and generators in src/audio/organModel.ts and src/audio/synthModel.ts, and are described as synthesis everywhere.
- Audio note: Every rendered organ registration is a seamless whole-cycle loop whose pitch is corrected by the source's playback rate, so the played note is in tune rather than a few cents sharp.
- Audio note: Synth voices are rendered to a buffer and played as one source. The array the browser plays is the array the tests measure, which is why the filter, envelope and LFO claims are asserted sample-for-sample.
- Audio note: The arpeggiator steps on an injected clock, so a fixed tempo and note set produce a deterministic sequence in the tests.
- Audio note: Master Level is a performance control and is deliberately absent from the program state, so a program change neither stores nor restores it.

## Phase 1: Complete surface and basic piano

**81/100**

Strong Phase 1. Measured against build/ at 1440x900 the geometry is essentially exact: deck 0.53998 / keybed 0.46002, width 0.948, aspect 3.09519, six section fractions within 1e-5 of spec, 73 keys (43/30, E1-E7) all inside the keybed, black-key height 0.6099, 5/5 reference colours at dE76 <= 0.54, 33/33 landmarks, 167/167 controls reachable by 5x5 elementFromPoint hit-test, 0 forbidden descriptors. The piano voice is genuinely live-synthesised (C4 262.3 Hz, velocity 1->127 peak 0.0265->0.6605 with rising brightness, source -> voiceGain -> masterGain -> destination, no network audio), and pointer, multi-touch, computer keyboard, UI pedal and Web MIDI all reach one lifecycle with 16-voice oldest-first stealing, blur and panic cleanup. The defects are in finish and truthfulness: the synth OLED is painted over by the opaque section plate and is invisible (region luminance 61-91), the program OLED is washed out by a translucent overlay, deck legends run 3.0-4.5 px with 8 overlapping label pairs, MIDI unplug is missed unless the port leaves access.inputs (disconnect feature items only partly met), and the audit/feature-matrix cite evidence pointers the sealed capture does not contain.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 85 |
| Feature completeness | 20% | 68 |

### Priority issues

- **major** — Synth OLED is painted over by the section plate and renders nothing: .section::before is position:absolute with z-index:0 and an opaque linear-gradient(168deg, rgb(69,75,87), rgb(60,66,77), rgb(47,52,62)), while .oled.glass-synth is a static, non-positioned child, so the plate paints over the display's inline text. The synth display box (803.3,252.8 137x22) measures pixel range 61-91 (std 7.9) in my headless render of build/ and identically in artifact/evidence/stage1-desktop.png, although the DOM reports visible children with colours rgb(219,255,242)/rgb(242,196,106). One of the two required primary OLEDs, and the only on-screen statement that the panel is decorative, is therefore invisible.
- **major** — MIDI unplug does not stop sounding voices unless the port leaves access.inputs: src/input/midi.ts syncInputs() reports a disconnect only when present.size === 0. Firing access.onstatechange with port.state = 'disconnected' while the port stayed in access.inputs left 'Modelled piano - 2 voices | C4 G4' sounding and the status at 'MIDI 1 IN'; deleting the entry from the map produced 'MIDI LOST' and stopped both voices. Chromium keeps a disconnected MIDIInput in MIDIAccess.inputs with state 'disconnected', so a real unplug mid-note takes the first path and strands the voices.
- **minor** — Program OLED reads as a red panel rather than a screen: The program section's ::before overlay (linear-gradient(rgba(0,0,0,0.26), rgba(0,0,0,0.06), rgba(0,0,0,0.18)), position:absolute, z-index:0) paints over the display's text, which is otherwise white/amber on the red chassis with no dark glass of its own. Sampled over the display box (626,250 154x33) the brightest pixel is 158/255 and the dominant fill is rgb(112,26,35); 'Audio engine not started' and the chip row are barely separable from the chassis.
- **minor** — Deck legends are 3.0-4.5 px and eight label pairs overlap: 360 of 364 text leaves inside .deck compute to font-size 3.00-4.51 px at 1440x900 (only the 'nord' 25.25 px and 'stage 4' 12.56 px branding and the 6.83 px display title are larger). Eight label pairs overlap by more than 1 px in both axes: piano 'ACOUSTICS' across 'ZONE 2', 'ZONE 3' and 'ZONE 4' (14.6 x 2.7 px each) and synth 'VOICE / VIBRATO' across 'FREQ' (12.1 x 5.0 px), '0' and '10'. One control pair also overlaps: synth.filter.freq x synth.voice.mode by 19.8 x 2.4 px.
- **minor** — Section silkscreen legends are clipped by the plate they sit above: The same absolutely positioned plate covers the top of each .section-print legend: 'SYNTH SECTION' 26% covered, 'ORGAN SECTION' and 'EFFECTS' 19%, 'PROGRAM' 6%. The plate's inset top is 6.64 px while the legends start at the section's top edge, so the band titles render visibly cut in half.
- **minor** — At 390x844 the instrument becomes a 4029 px vertical stack: The six sections stack at 350 px wide and y = 32 / 463.5 / 1234.3 / 1708.6 / 2176.5 / 2940.9, with the keybed below at 366x150; document scrollHeight is 4049 px. The first viewport shows only the performance band and the top of the organ band, so the Stage 4 silhouette is gone even though nothing clips and all 167 controls stay sized and inside the viewport width. The 'HEADPHONES' rear-rail legend extends 13 px past the instrument's right edge and is clipped.
- **minor** — Audit and feature matrix cite evidence that the sealed capture does not contain: artifact/tests/feature-matrix.json references evidence/stage1-capture.json#/measured/keybed, #/measured/sections, #/measured/controls, #/forbiddenChecks, #/audio and #/interactionPass; the file holds only version, phase, url, capturedAt, browser, deviceScaleFactor, locale, timezone, colorScheme, reducedMotion and captures. The audit also claims 'Overlapping control pairs 0' (measured 1) and a '390 x 4049 px' narrow capture (the sealed PNG is 390 x 844).
- **minor** — Keybed keys are aria-hidden with no role: All 73 [data-key-id] elements are divs carrying aria-hidden="true" with no role, name or tabindex, and .keybed itself exposes no role, so the playable surface is invisible to assistive technology and unreachable by Tab. The mapped computer keyboard (Z S X D C V G B H N J M , L . ; / Q 2 W 3 E and Space) is the only keyboard route to a note.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**59/100**

Geometry, keybed, colour and inventory are spec-exact at 1440x900: 0.540/0.460 deck split, 0.948 width, aspect 3.095, section fractions within 1e-5, 73 keys (43/30, 0.61 black height) inside the keybed, 167/167 controls reachable, 5/5 colours, 0 forbidden. The Phase 2 audio is real but uneven. One AudioContext, three recorded sample sets and six distinct piano types work, and most piano detail controls measurably change output. In the live build, though, Ring Mod and the HP24 filter are silent, the Rotary does not modulate, and octave shift does nothing. All-effects bypass, group and global modes exist only in state, with no panel control. The effect panel shows stale values when FX focus changes layers. The artifact's evidence comes from a harness path that bypasses the live adapters, so it overclaims several of these. Narrow view stacks into a 4121 px column with a 9 px-key keybed at the bottom.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 58 |
| Playability & control | 20% | 65 |
| Feature completeness | 25% | 55 |

### Priority issues

- **major** — Ring Mod and HP24 filter output silence in the live build: Peak 0.0000 for Mod1 RM at all amounts and Amp HP24 at all Freq settings (also LP24 ~0.0002 at max freq); the harness renders them, but the shipped engine path does not.
- **major** — Rotary speaker produces no rotation: Via To Rotary, rotary off/on-slow/on-fast give identical stereo (side/mid 0.000) and AM; only a static tone change from routing is heard.
- **major** — No panel control for all-effects bypass, group or global mode: EffectState.allOn, pianoGroup and per-unit global are never written by any panel binding, yet IMPLEMENTATION_DETAILS lists them as functional.
- **major** — Effect controls show stale values after FX focus change: Switching focus A to B leaves the knobs/LEDs showing the previous layer; the next toggle press writes the inverse of the displayed value to the newly focused chain.
- **major** — Piano octave shift does nothing: piano.octave.up/down leave the played pitch unchanged (dominant bin 527.3 Hz throughout) and no octave state is displayed.
- **minor** — Timbre LED disagrees with engine at load; no Off position: MID LED lit while display/audio use Soft (centroid 789 vs 969 for Mid).
- **minor** — Synth OLED hidden and several legends clipped/overlapping: Synth OLED painted under the plate; organ layer legends clipped; VOICE/VIBRATO overprints filter FREQ.
- **minor** — Narrow layout puts a 9 px-key keybed 3900 px down: At 390x844 the page is 4121 px tall and no key is reachable without scrolling.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**72/100**

A dense, measurement-accurate Stage 4 recreation whose panel fidelity is essentially exact — deck 0.5400/keybed 0.4600, width 0.9480, aspect 3.0952, worst section deviation 0.00001, 73/43/30 keys all inside the keybed at black-height 0.6099, 5/5 reference colours at deltaE<=0.72, 33/33 landmarks, 167/167 controls pointer-reachable, zero forbidden descriptors. Programs, splits, zones, crossfades, scenes, morphs, transpose and Panic all behave, 24 voices play clean through one AudioContext with a single destination connection and no console errors, and 20 spec-excluded controls are listed with citations. Two audible defects dominate the sound scores. (1) Every organ note is torn down ~25 ms after onset — the engine reclaims the voice on the last source's onended, and the key-click one-shot is pushed last — so the organ is a click, not a note, while the panel keeps reporting '1 voice'. (2) Delay and Reverb delete the dry path when enabled (energy 0.311 -> 0.014 and 0.193 -> 0.001; dry/wet 0 gives silence). Synth and piano are excellent. Reviewed: two evidence numbers corrected (performance-band dark coverage 0.195, not 0.000; narrow white-key width 8.5 px, not 5); no rating changed.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 62 |
| Playability & control | 20% | 83 |
| Feature completeness | 35% | 78 |

### Priority issues

- **critical** — Every organ note is torn down ~25 ms after onset, so the organ engine is inaudible: In the shipped build (build/assets/main-NV__Fi9w.js) a held organ note produces ~25 ms of signal at the destination and then exactly 0.0000 for the rest of the hold (measured every 8 ms over 1.2 s for both B3 and Vox). Instrumenting AudioBufferSourceNode shows the 4800-sample registration loop (buffer peak 0.583, loop=true) is start()ed at ctx t=1.040 and stop(null)'d at t=1.051 while the key is still down. Cause: artifact/src/audio/webAudioEngine.ts:568-575 reclaims the voice when the LAST entry of nodes.sources fires onended, and artifact/src/audio/organVoice.ts:187-195 pushes the ~12 ms key-click one-shot last; keyClick defaults to true (organState.ts:90) and no panel control turns it off. This fails the Phase 3 hard gate 'B3, Vox, Farf and Pipe organ engines ... are audibly distinct' and the organ.engine feature ID, and it breaks the honesty contract because the program display reports '1 voice' / '1O' for the entire silent hold.
- **major** — Delay and Reverb delete the dry signal when enabled; dry/wet 0 is silence: Enabling Reverb collapses destination energy over a 3 s window from 0.1933 to 0.0011 (peak 0.4342 -> 0.0208) and enabling Delay from 0.3108 to 0.0141, for every engine. Sweeping Reverb DRY WET gives 0.0000 output at aria 0, 0.0142 at 2, 0.0279 at 4 — at a fully dry setting the instrument is silent, which is the opposite of the required behaviour. artifact/src/audio/effectGraph.ts:77-81 ramps a unit's bypass-dry gain to 0 and its wet gain to 1 whenever the unit is on, and buildReverb (lines 846-869) feeds the wet bus only from convolver -> damping -> wetSend(gain = dryWet/10), so no dry component remains inside the unit. Mod 1, Mod 2, Compressor and Amp Sim are unaffected.
- **minor** — Morph assignment is not reachable from the three MORPH ASSIGN panel buttons: Pressing control-program.morph.wheel and then moving control-piano.layer.a.level (80 -> 90) produced no assignment: dragging the mod wheel to aria-valuenow 10 left the level at 90 and the editor's Wheel panel still read 'No assignments'. The morph system itself is correct (interpolation and per-destination clearing verified), and assignment is available from the SPLIT / ZONES / MORPH editor, but the hardware buttons the spec names as the assignment path did not complete the gesture in my pass.
- **minor** — Overlapping and clipped silkscreen legends in the narrowest sections: At 1440x900 the Piano band (116 px wide) prints 'ACOUSTICS' directly over the ZONE 2/3/4 button labels and the SOFT REL / STRING RES / PED NOISE row, and the 'TIMBRE' block label collides with the plate's bottom edge; the Synth band overlaps 'VOICE / VIBRATO' with 'MONO / LEGATO' and 'AMP / TIME' with 'ENVELOPE'; the 'EFFECTS' and 'ORGAN SECTION' titles are clipped by their plate's top edge. Several selector legends are ellipsis-truncated ('A-PAN / TREM / ...', 'EQ / SMALL / J...', 'ROOM / BOO...').
- **minor** — Voice counter reports organ voices that are not sounding: The program display's '0P / 1O / 0S' and '1 voice' readouts stay lit for the whole duration of a held organ key even though the destination has been silent since ~25 ms after onset. The panel state is derived from the engine's voice map rather than from anything audible, so it misreports the instrument's actual output for the organ section.
- **minor** — 44 repeated autoplay warnings on load: Loading build/index.html at 1440x900 emits 44 identical Chrome warnings ('The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture') before any interaction. No console errors occur at any point in the interaction pass, so the shared completion gate is met, but the repeated resume attempts are noisy.

### Technical gate

Passed.
