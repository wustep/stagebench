# Muse Spark 1.3 (OpenCode) — Stagebench evaluation

- Run: `muse-spark-1-3`
- Status: complete
- Aggregate: **55/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 67 |
| 2 | Piano library and working effects | 56 |
| 3 | Complete Stage 4 system | 34 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Phase 1 ships one basic piano voice as live additive synthesis: each note renders a deterministic generated PCM buffer (fundamental + 5 decaying partials, hammer transient, exponential envelope) through buffer-source -> per-note gain -> master gain -> destination. No recorded samples are used or claimed anywhere.
- Generated sound sources: basic-piano-note — generated PCM buffer (additive synthesis, rendered at note-on)
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: No recorded, bundled, or redistributable sample sets are used in Phase 1; sampleSources is therefore empty. Recorded Grand/Upright/Electric sets are Phase 2 scope.
- Audio note: Master bus fixed at 0.8 gain; every voice connects through it — nothing bypasses the master path.
- Audio note: Status contract: idle -> loading -> ready on success; error with message on context failure; fallback (labeled silent tracking) when no AudioContext exists.

### Phase 2: Piano library and working effects

- Audio strategy: Phase 2 keeps the Phase 1 basic voice untouched and adds the StageEngine: two piano layers (enable/focus/level/octave/SUSTPED/PSTICK, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res) playing bundled multi-root/multi-velocity sample sets for Grand/Upright/Electric or honest live synthesis for Clav/Digital/Misc, through per-layer chains (Mod1, Mod2, Delay with in-loop feedback filter, Amp Sim/EQ with To Rotary, Compressor, Reverb) into a shared Rotary, layer level, master gain (Master Level) and limiter, on ONE AudioContext. Offline deterministic mirrors in src/audio/render.ts let tests cross the audio boundary without audio output.
- Generated sound sources: basic-piano-note — generated PCM buffer (additive synthesis, rendered at note-on, Phase 1 voice preserved); clav-d6-synth — live honest synthesis (picked-string burst + short decay), rendered per note; digital-stage-synth — live honest synthesis (layered detuned stack + bell partial), rendered per note; marimba-synth — live honest synthesis (sine + 4th-partial mallet transient), rendered per note; reverb-impulses — generated deterministic decay noise used as convolver IRs (Room/Booth/Spring/Stage/Hall/Cathedral recipes)
- Recorded sample provenance: Studio Concert Grand (bundled synthetic-studio sample set, original, CC0-1.0) — scripts/generate-samples.mjs (deterministic seeded synthesis; re-running `pnpm samples` reproduces these bytes) (CC0-1.0 (original work created by this repository generator; NOT an acoustic piano recording)); Studio Upright (bundled synthetic-studio sample set, original, CC0-1.0) — scripts/generate-samples.mjs (deterministic seeded synthesis; re-running `pnpm samples` reproduces these bytes) (CC0-1.0 (original work created by this repository generator; NOT an acoustic piano recording)); Stage Tine EP (bundled synthetic-studio sample set, original, CC0-1.0) — scripts/generate-samples.mjs (deterministic seeded synthesis; re-running `pnpm samples` reproduces these bytes) (CC0-1.0 (original work created by this repository generator; NOT an acoustic piano recording))
- Bundled audio: 135 files (14.2 MB)
- Audio note: Honesty: the three bundled sets are ORIGINAL synthetic-studio bounces created by scripts/generate-samples.mjs — they are multi-root, multi-velocity, bundled (offline) sample assets, but they are NOT acoustic piano recordings and are never described as such (the manifest origin field and the UI/panel copy say 'synthetic-studio').
- Audio note: Signal order per layer: voice -> Mod1 -> Mod2 -> Delay (feedback filter in the regeneration loop, repeats only) -> Amp Sim/EQ -> Compressor -> Reverb -> [shared Rotary when To Rotary] -> layer level -> master gain -> limiter -> destination. One AudioContext, one destination; nothing bypasses master.
- Audio note: Fallback contract: any fetch/decode failure (or missing AudioContext) enters a labeled, playable synth fallback ('Sample fallback — synth voices in use'); the primary library is never reported ready on that path, the type selector keeps working, and the program display flags the missing model.
- Audio note: Still decorative in Phase 2: Organ audio, Synth audio, Programs/splits/scenes/morphs, and every control under the piano/effects specs' excluded lists.

### Phase 3: Complete Stage 4 system

- Audio strategy: Phase 3 completes the instrument on the SAME single AudioContext: the Phase 1 basic voice and Phase 2 piano/effects graph are untouched (lazy Phase 3 extension keeps the Phase 2 node shape byte-identical until first organ/synth use). Organ (2 layers, one shared chain) and Synth (3 layers, own chains) join the master gain/limiter/destination path. Canonical serializable programs (32 slots + 8 auto-storing Live) round-trip every supported parameter; splits/zones/crossfades, scenes, Wheel/Pedal morphs, Master Clock, Transpose, and Panic are live. Offline deterministic mirrors (organRender/synthRender/render) let tests cross the audio boundary without audio output.
- Generated sound sources: basic-piano-note — generated PCM buffer (additive synthesis, rendered at note-on, Phase 1 voice preserved); clav-d6-synth — live honest synthesis (picked-string burst + short decay), rendered per note; digital-stage-synth — live honest synthesis (layered detuned stack + bell partial), rendered per note; marimba-synth — live honest synthesis (sine + 4th-partial mallet transient), rendered per note; reverb-impulses — generated deterministic decay noise used as convolver IRs (Room/Booth/Spring/Stage/Hall/Cathedral recipes); organ-b3-tonewheel — live honest synthesis (per-partial oscillator stack, 9 B3 ratios + body shimmer, single-triggered shared percussion envelope, click transient, scanner vibrato/chorus bus); organ-vox-transistor — live honest synthesis (squarish transistor partials + filtered/unfiltered mix drawbar); organ-farfisa-registers — live honest synthesis (reedy sawtooth register stack, on/off past half); organ-pipe-flue — live honest synthesis (near-sine flue ranks + chiff transient; Pipe 2 brighter principal registration); synth-analog-fm-voices — live honest synthesis (14 required waves across Pure/Sync/Multi/Super/FM-H with category-correct Osc Ctrl, resonant filters, ADR envelopes, LFO, mono/legato/priority/glide, deterministic arp/gate)
- Recorded sample provenance: Studio Concert Grand (bundled synthetic-studio sample set, original, CC0-1.0) — scripts/generate-samples.mjs (deterministic seeded synthesis; re-running `pnpm samples` reproduces these bytes) (CC0-1.0 (original work created by this repository generator; NOT an acoustic piano recording)); Studio Upright (bundled synthetic-studio sample set, original, CC0-1.0) — scripts/generate-samples.mjs (deterministic seeded synthesis; re-running `pnpm samples` reproduces these bytes) (CC0-1.0 (original work created by this repository generator; NOT an acoustic piano recording)); Stage Tine EP (bundled synthetic-studio sample set, original, CC0-1.0) — scripts/generate-samples.mjs (deterministic seeded synthesis; re-running `pnpm samples` reproduces these bytes) (CC0-1.0 (original work created by this repository generator; NOT an acoustic piano recording))
- Bundled audio: 135 files (14.2 MB)
- Audio note: Honesty: the three bundled sets are ORIGINAL synthetic-studio bounces created by scripts/generate-samples.mjs — they are multi-root, multi-velocity, bundled (offline) sample assets, but they are NOT acoustic piano recordings and are never described as such (the manifest origin field and the UI/panel copy say 'synthetic-studio').
- Audio note: Signal order per chain: voice -> Mod1 -> Mod2 -> Delay (feedback filter in the regeneration loop, repeats only) -> Amp Sim/EQ -> Compressor -> Reverb -> [shared Rotary when routed] -> layer level -> master gain -> limiter -> destination. Six chains (Piano A/B, Organ shared, Synth A/B/C) + one Rotary on ONE AudioContext, one destination; nothing bypasses master. Organ voices route per-layer into the shared chain; synth voices render per note into their own chains.
- Audio note: Fallback contract: any fetch/decode failure (or missing AudioContext) enters a labeled, playable synth fallback ('Sample fallback — synth voices in use'); the primary library is never reported ready on that path, the type selector keeps working, and the program display flags the missing model.
- Audio note: Phase 3 honesty: every non-excluded control is bound (full table in evidence/stage3-binding-audit.md); the only decorative hardware control is Aftertouch morph (programs-spec excluded). Claimed optionals that work: single-level program-change undo, Solo audition, Rotary Stop, amp sustain-level knob. Master Level, pitch bend, wheel/pedal positions, rotary speed/drive, and all-bypass are live performance state, truthfully not stored in programs.

## Phase 1: Complete surface and basic piano

**67/100**

Structurally faithful, geometrically broken. At 1440x900 the six sections, 33/33 landmarks, 73/43/30 keybed, all 5 reference colours and 186/186 reachable controls are exact, and no forbidden descriptor fires. But the instrument renders 1382x781 - aspect 1.770 against the 3.0951 specified - so the silhouette is a squat slab, not a Stage 4. Audio is honest live additive synthesis (no assets in the build) with correct velocity scaling and verified blur/panic cleanup, yet it clips hard (v127 peak 1.02, 8 notes 3.05, 20 notes 4.45 at the destination tap) and has no release envelope: note-off calls source.stop(), RMS 0.156 to 0 in <60ms. Touch note-off never fires - press tags source 'touch', onPointerUp hardcodes 'pointer' - leaving stuck notes on a hard-gated input path that the 'multi-touch' test does not actually exercise. At 390x844, 64 of 186 controls miss unscrolled and 17 stay unreachable at every rail-scroll position, below overflow:hidden section clips - contradicting the audit's 'everything stays reachable' claim. Legends render at 6px with 31-34 truncated and 8 overlapping pairs.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 70 |
| Playability & control | 55% | 65 |
| Feature completeness | 20% | 68 |

### Priority issues

- **critical** — Instrument aspect ratio 1.770 against the specified 3.0951: The .instrument box renders 1382.391 x 781 at 1440x900. Width fraction (0.960) and the six section fractions (worst deviation 0.009) are all inside tolerance, but the chassis is 781px tall where 3.0951 would put it at ~447px, so the silhouette reads as a squat slab rather than a Stage 4. The deck band is fixed at 400px and the keybed at 300px in CSS; the visual audit records the keybed decision as a deliberate playability trade but does not acknowledge the resulting aspect failure.
- **critical** — Touch note-off never fires - every touch press is a stuck note: artifact/src/components/sections.tsx tags a press with source 'touch' when e.pointerType === 'touch', but onPointerUp, onPointerCancel and onLostPointerCapture all call onRelease(midi, 'pointer'). NoteManager.release then deletes a source that is not in the held note's set, sees sources.size still 1 and returns early, so the note is never released. Reproduced with CDP Input.dispatchTouchEvent: two touch points on key-c4-60 and key-g4-67 both sounded, and after touchEnd on both, aria-pressed stayed true and the voices kept running until PANIC. Touch is named in the Phase 1 hard gate, and the test that claims to cover it (src/inputs.test.tsx:42-53) fires pointerDown with no pointerType, so it exercises the mouse branch only.
- **major** — 17 of 186 controls are clipped and unreachable at 390x844: Each .deck-section is overflow-y hidden at clientHeight 398 while content runs to scrollHeight 552 (organ), 537 (program), 494 (piano) and 432 (effects). A 5x5 elementFromPoint grid resolves 122 of 186 controls unscrolled; sweeping the .page rail across its whole 0-194px range recovers 47 of the 64 misses, leaving 17 unreachable at any scroll position. Casualties include required landmarks: organ-level-a/b (the organ level LED ladders) render at y=498/549, below the deck bottom at y=445, and piano-octave, piano-detail-4/5/6 and the three program morph buttons clip the same way. evidence/stage1-visual-audit.md states the narrow profile keeps 'everything stays reachable and no key or control clips', which the measurement contradicts.
- **major** — Output clips hard - single note at v127 peaks 1.02, 20 notes peak 4.45: Measured with an AnalyserNode tapped onto the master->destination edge in the published build: velocity 127 on one note peaks 1.02345, 8 simultaneous notes 3.04952, 20 notes 4.44500. src/audio/engine.ts sets master gain to a fixed 0.8 with no limiter, no per-voice normalisation and no scaling by voice count, so the six summed partials clip the destination on any loud or polyphonic passage.
- **major** — No release envelope - note-off is a hard stop: PianoEngine.noteOff calls source.stop() and disconnects immediately with no gain ramp. A 20ms RMS trace of MIDI note 60 held 404ms shows a natural decay to 0.1563 at the moment of release, then 0.1133, 0.0525 and 0.0000 within ~60ms - a discontinuity at audible amplitude, so every key release produces a click and there is no damper tail. The spec's 'release' behaviour is only modelled by rendering a longer buffer when sustain is already down at note-on.
- **minor** — Panel shows keys down that are not sounding: The engine steals at 16 voices (pickStealVictim, oldest sustained first) but the UI holds every pressed pitch: 20 simultaneous MIDI notes leave 20 keys aria-pressed while at most 16 voices exist. Combined with the touch stuck-note bug, the keybed's visual state is not a reliable report of what is playing.
- **minor** — Legends render at 6px, 31 truncated and 8 overlapping: .ctl-legend is font-size 6px with nowrap, overflow hidden and max-width 52px. 31-34 of 113 legends (34 on the reviewer's remeasure) have scrollWidth greater than clientWidth, and 8 pairs overlap in the organ drawbar row, rendering as run-together text in the desktop capture. Legend text is also generic ('Organ drawbar 1 16''') where the reference silkscreens footage marks alone.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**56/100**

Structurally complete and unusually honest Phase 2, undermined by two shipped defects. The Stage engine is real: all six piano types render measurably distinct audio (pairwise log-spectral distance 7.0-60.4 dB), 135 bundled multi-root/multi-velocity WAVs back Grand/Upright/Electric, and every effect unit and listed type processes live audio (reverb decay orders Booth<Room<Stage<Hall<Cathedral; delay feedback filter alters repeats by 7.6-15.6 dB). But the app runs TWO AudioContexts: the Phase 1 additive voice sounds in parallel at roughly twice the Stage output (peak 0.411 vs 0.202) and ignores Master Level, Piano section off, every effect and the limiter - the Phase 2 hard gate and the artifact's own 'nothing bypasses master' claim are both false. Second, the Phase 2 panels overflow their 250-275px pane: at 1440x900 only 150 of 224 controls are hit-testable, with all of piano Layer B and FX chain B invisible. Geometry and colour are excellent (section fractions within 0.009, 5/5 reference colours, 73/43/30 keys inside the keybed) except aspect ratio 1.770 vs 3.0951 specified.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 51 |
| Playability & control | 20% | 65 |
| Feature completeness | 25% | 60 |

### Priority issues

- **critical** — Two AudioContexts: the Phase 1 voice bypasses Master Level, section-off, effects and the limiter: The shipped build constructs 2 AudioContexts (src/App.tsx defaultEngine + defaultStageEngine) and every key press drives both. Measured peaks with one key held: [ctx0 0.4049, ctx1 0.2021]. With Master Level at 0: [0.4109, 0.0]. With the Piano section off: [0.4109, 0.0]. The Phase 1 additive voice is the loudest thing in the instrument, is unaffected by piano type, effects, layer state or the master limiter, and cannot be turned down. This fails the Phase 2 hard gate 'One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination' and contradicts IMPLEMENTATION_DETAILS.json's 'nothing bypasses master'.
- **critical** — Phase 2 panels overflow their sections: 74 of 224 controls unreachable at 1440x900: p2-piano-panel (scrollHeight 539 in clientHeight 250) and p2-fx-panel (523 in 275) overflow sections with overflow:hidden. By the rubric's 5x5 elementFromPoint grid with the page unscrolled, 74 controls score zero hits: all of piano Layer B, all of FX chain B, chain A's Reverb row, and the buried Phase 1 controls piano-type-3..6, piano-detail-1..6 and fx-on-1..7. The content is only reachable by scrolling a nested pane that gives no visual affordance.
- **major** — Instrument aspect ratio 1.770 against 3.0951 specified: The chassis renders 1382.39 x 781 px at 1440x900. src/styles.css:38 caps width at (100vh-24px)*3.0951 but the deck (400px) and keybed (300px) are fixed pixel heights, so the silhouette is ~75% too tall for its width. Deck/keybed split, width fraction and the six section fractions are all inside tolerance; only the overall proportion is wrong.
- **major** — Hardware panel controls and the primary OLED do not track engine state: Selecting Electric and layer-A level 3 leaves decorative piano-type-1 (Grand) aria-pressed=true, piano-level-a at aria-valuenow=8, and program-display reading 'A:11 Stage Grand'. Only the small p2-* software strip tells the truth, so the instrument shows two contradicting piano type selectors and two contradicting level indications.
- **major** — Piano layer level 0 does not mute the layer: With layer B enabled at octave +24: level 10 gives peak 0.3007 and composite centroid 1062 Hz; level 0 still gives peak 0.2163 and centroid 727 Hz, against 0.2028 / 418 Hz with the layer disabled. The level control's bottom of range leaves the layer audible.
- **major** — Piano type buttons are not keyboard operable: The six p2-piano-{A,B}-type-* buttons (src/components/panels.tsx:145-162) carry only onPointerDown - no onClick, no onKeyDown. They take focus, but focus + Space and element.click() both leave aria-selected unchanged, so a keyboard-only user cannot change the piano instrument. Every other Phase 2 control is keyboard operable.
- **minor** — Amp/EQ type 'To Rotary' is inaudible; rotary speed barely so: Stepping the amp type to 'to-rotary' measures 0.41 dB log-spectral distance from 'eq' - at the 0.40 dB repeat-measurement noise floor. Routing only happens through the separate p2-fx-A-torotary toggle (then 5.80 dB and peak 0.202 -> 0.374). Rotary slow vs fast differs by only 0.64 dB.
- **minor** — Missing-model state and the visual audit overstate behaviour: With all /samples/** requests blocked the fallback is correctly labelled and playable, but p2-program-model still reads 'A:11 Studio Concert' instead of reporting the failure as the piano spec's missingModelState requires. evidence/stage2-visual-audit.md describes the p2 strips as scrolling 'internally' and the silhouette as pixel-identical, without disclosing that roughly half the Phase 2 controls are invisible and pointer-unreachable at the canonical viewport. Its 'every listed type reachable' and 'All controls are keyboard operable' claims are both directly falsified by measurement.
- **minor** — Legend collisions make silkscreen text unreadable: 16 legend pairs overlap by more than 35% of the smaller box at 1440x900 (organ 8, effects 7, piano 1) at 7-8px font sizes, notably the nine organ drawbar legends collapsing into one smear and the 'LAYER EFFECTS - PIANO CHAINS + ROTARY' head sitting on top of the inherited effects legends.
- **minor** — 'Recorded' sample sets are generator output: Grand/Upright/Electric are 135 bundled multi-root, multi-velocity WAVs that load offline and are audibly distinct, but they are produced by scripts/generate-samples.mjs rather than recorded. The manifest and IMPLEMENTATION_DETAILS.json state this plainly ('NOT acoustic piano recordings'), so the honesty contract is met while the phase gate's 'recorded sample sets' is not.

### Technical gate

Failed; score capped at 59.

## Phase 3: Complete Stage 4 system

**34/100**

Phase 3 delivers a very large, well-organised state layer but its two headline engines never reach audio. With an organ or synth layer enabled and the piano off (states verified during the note), the StageEngine context renders rms 0.004 and no voice node starts; every configuration produces only the Phase-1 buffer plus, when a Piano layer is on, the same piano sample. Two AudioContexts run, and the ctx0 path answers to neither Master Level nor any section enable. Transpose and morph assignment are display-only. What does work is solid: 32-slot programs with a truthful dirty flag, two-step Store, per-slot recall, pages, dial, list view and Live slots; splits, zones, crossfades and scenes at the state layer; MIDI (stub), sustain and Panic; and the inherited Phase-2 effect chain, which measurably reshapes the piano (reverb 7.2 dB, amp/EQ 5.6 dB). Panel fidelity is undermined by geometry and layout: aspect ratio 1.77 vs 3.0951, and 369 of 573 controls unreachable at 1440x900 because each section clips at 400 px. Keybed (73/43/30, all inside), section fractions and all five reference colours are exact.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 31 |
| Playability & control | 20% | 42 |
| Feature completeness | 35% | 32 |

### Priority issues

- **critical** — Organ and Synth engines produce no audio: With an organ or synth layer enabled and the piano section disabled (aria-pressed verified during the held note), the StageEngine context renders rms 0.0036/0.0041 and no AudioBufferSourceNode or OscillatorNode starts in it. Selecting any of the six organ models or fourteen synth waveforms (aria-selected confirmed) leaves the node trace byte-identical. The only voices ever produced are the Phase-1 buffer (len 70560) and the piano sample (len 110250), and the latter only when a Piano layer is on. This fails the Phase 3 hard gate on audibly distinct organ and synth sources.
- **critical** — Two AudioContexts; the Phase-1 path bypasses the master limiter and Master Level: An AudioContext counter records 2 running instances with separate destination edges (ctx0 GainNode->destination, ctx1 DynamicsCompressor->destination). With every section and layer off, ctx0 still renders rms 0.0896, and Master Level 7->0 silences ctx1 while ctx0 keeps sounding. IMPLEMENTATION_DETAILS.json states 'ONE AudioContext, one destination; nothing bypasses master', which the built app contradicts.
- **critical** — 369 of 573 controls are not pointer-operable at 1440x900: Each deck section computes to overflow:hidden with a fixed 400 px box (y 45-445). 325 controls have layout boxes below y=445 (e.g. p3-organ-B-drawbar-1 at y=524.1) where elementFromPoint returns .keybed or .pkey, and 44 more inside the box are overpainted by sibling .p2-toggle/.p2-panel nodes. Scrolling every internal container to its end raises reachability only from 204 to 205, so the p2-panel overflow-y the visual audit relies on does not recover them.
- **critical** — Instrument aspect ratio 1.77 against the variant's 3.0951: main.instrument measures 1382.39 x 781 px at 1440x900; the most generous chassis-only crop (y 21-751) still gives 1.894. The width fraction (0.960) and the 54/46 deck split (0.5544/0.4456) are in tolerance, so the chassis is roughly 1.75x too tall for its width. The artifact's own visual audit checks width fraction and section fractions but never the aspect ratio.
- **major** — Morph assignment never records a destination: p3-morph-wheel-arm latches ('latched, move a destination', aria-pressed=true) and p3-morph-targets lists Piano A level, but moving that stepper by real mouse click and by ArrowUp leaves p3-morph-wheel-count at '0 destinations', and perf-mod-wheel 0->10 changes nothing. The pedal morph behaves identically. Both arm buttons are additionally pointer-unreachable.
- **major** — Transpose is display-only: Driving p3-transpose to '+6 st' updates the control and the readout but leaves the rendered note's playbackRate at 1.1225, exactly the +0 value.
- **major** — Enabling an organ or synth layer silently re-enables the piano: Toggling p3-organ-A-on or p3-synth-A-on flips p2-piano-section-on and p2-piano-A-on back to true on every attempt, so a user cannot hold an organ- or synth-only configuration and any audition of those engines is actually the piano.
- **major** — Both primary OLEDs are frozen: program-display stays 'A:11 Stage Grand' and program-aux 'PAGE 1' while the live program is 1.5 on page 3; synth-display stays 'Saw Sync' regardless of the selected waveform.
- **major** — Layer-effects section is unreachable at 390x844: The instrument lays out 560 px wide in a 390 px viewport with scrollWidth 390 and no horizontal scroll; the effects band (x 460.8-561.0) is entirely off-screen and pointer reachability falls to 87/573.
- **minor** — Phase-3 panel headings overprint the Phase-1 section titles: In the 1440x900 capture the section titles ORGAN, PIANO, PROGRAM, SYNTH and LAYER EFFECTS are overlaid by the p3 panel headings and adjacent knob legends, and control labels truncate mid-word ('Piano layer A le...').
- **minor** — forbiddenDetection 'OLED display' fires on a prose label in the effects band: [data-testid="p3-unsupported-menu:prog-view-modes"] has the accessible name 'Prog View multi-modes (extra credit): programs spec optional; the display shows slot, name, and edit state.' The word 'display' in that name satisfies the spec's displayElement attribute rule, so the effects section trips the rule although the 252.7x2.5 px element is a text line, not a display. Reported as a spec-rule disagreement; counted once per the literal instruction.
- **major** — Split points and layer zones never reach the audio path: With p3-split-on and p3-split-low-active latched, p3-split-low-pos moved to F4 and p3-zone-pianoA-lo/hi set to Z2/Z4 (upper zones only), MIDI 40 - below the split and outside the layer's zone - still starts a piano voice at full level (ctx1 rms 0.080, one voice started), indistinguishable from MIDI 80 above the split. Split state, LEDs and crossfade steppers update correctly, so the split system is display-and-state only.

### Technical gate

Failed; score capped at 59.
