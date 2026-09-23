# GPT-6 Luna Max — Stagebench evaluation

- Run: `gpt-6-luna`
- Status: complete
- Aggregate: **72/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 82 |
| 2 | Piano library and working effects | 75 |
| 3 | Complete Stage 4 system | 62 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Locally generated additive piano synthesis rendered into Web Audio buffers; no network or recorded sample assets are used.
- Generated sound sources: Stage 4 Phase 1 additive piano voice — The tone uses five inharmonic sine partials and a natural decay. This is generated synthesis, not a recording or sample library.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Audio is created only after user note input and routed through one master gain node.
- Audio note: All held sources are released on blur, hidden document, MIDI disconnect, and component cleanup.
- Audio note: No external URL is required for audio or rendering.

### Phase 2: Piano library and working effects

- Audio strategy: One Web Audio context loads bundled sample recordings for Grand, Upright, and Electric. Clav, Digital, Misc, and sample-load fallback use generated synthesis. Six ordered effects per Piano layer feed a shared rotary modulation stage, layer gains, master gain, limiter, and the context destination.
- Generated sound sources: Generated Clav — Used for the selectable Clav type.; Generated Digital Piano — Used for the selectable Digital type.; Generated Mallet Piano — Used for the selectable Misc type.; Generated Piano fallback — Fallback status names the selected instrument whose sample load failed. All keys remain playable when Web Audio is available.
- Recorded sample provenance: Salamander Grand Piano V3 — https://github.com/sfzinstruments/SalamanderGrandPiano (Creative Commons Attribution 3.0 Unported (CC BY 3.0; https://creativecommons.org/licenses/by/3.0/)); Upright Piano KW Kawai — https://github.com/freepats/upright-piano-KW (Creative Commons Zero 1.0 Universal (CC0 1.0; https://creativecommons.org/publicdomain/zero/1.0/)); jRhodes3d Mark I Rhodes — https://github.com/sfzinstruments/jlearman.jRhodes3d (Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0; https://creativecommons.org/licenses/by-nc/4.0/))
- Bundled audio: 106 files (3.3 MB)
- Audio note: All 105 selected converted recording files are listed with their path, upstream source file, sampled MIDI root, velocity layer, and size in the source entries above; public/samples/library.json is the runtime inventory.
- Audio note: Selected FLAC recordings are converted to mono Ogg Vorbis at 44.1 kHz and trimmed to no more than six seconds. The app fetches local public assets only.
- Audio note: Electric sample redistribution is restricted to noncommercial use by CC BY-NC 4.0 and requires attribution; commercial redistribution requires a separate license.
- Audio note: The graph uses one AudioContext. Every voice is owned by its input note and Piano layer; sustain honors SUSTPED; all active sources and graph nodes are released on cleanup.

### Phase 3: Complete Stage 4 system

- Audio strategy: One Web Audio AudioContext routes bundled Grand, Upright, and Electric recordings plus generated piano voices, four distinct live Organ models, and category-specific Synth oscillators through per-section buses, effects, master gain, limiter, and one destination.
- Generated sound sources: Generated Clav — Used for the selectable Clav type.; Generated Digital Piano — Used for the selectable Digital type.; Generated Mallet Piano — Used for the selectable Misc type.; Generated Piano fallback — Fallback status names the selected instrument whose sample load failed. All keys remain playable when Web Audio is available.; Live Organ models — Four distinct B3, Vox, Farf, and Pipe 1 engines; no organ recordings are bundled.; Live Analog Synth — Pure, Sync, Multi, Super, and FM-H categories use distinct source and modulation paths.
- Recorded sample provenance: Salamander Grand Piano V3 — https://github.com/sfzinstruments/SalamanderGrandPiano (Creative Commons Attribution 3.0 Unported (CC BY 3.0; https://creativecommons.org/licenses/by/3.0/)); Upright Piano KW Kawai — https://github.com/freepats/upright-piano-KW (Creative Commons Zero 1.0 Universal (CC0 1.0; https://creativecommons.org/publicdomain/zero/1.0/)); jRhodes3d Mark I Rhodes — https://github.com/sfzinstruments/jlearman.jRhodes3d (Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0; https://creativecommons.org/licenses/by-nc/4.0/))
- Bundled audio: 106 files (3.3 MB)
- Audio note: sampleSources lists instrument sets and source licenses; sampleFiles records the selected file paths, upstream source files, MIDI roots, velocity layers, and sizes. public/samples/library.json is the runtime inventory.
- Audio note: Selected FLAC recordings are converted to mono Ogg Vorbis at 44.1 kHz and trimmed to no more than six seconds. The app fetches local public assets only.
- Audio note: Electric sample redistribution is restricted to noncommercial use by CC BY-NC 4.0 and requires attribution; commercial redistribution requires a separate license.
- Audio note: The graph uses one AudioContext. Every voice is owned by its input note and Piano layer; sustain honors SUSTPED; all active sources and graph nodes are released on cleanup.

## Phase 1: Complete surface and basic piano

**82/100**

Phase 1 builds a real instrument, then loses a third of its panel to one layout bug. Geometry at 1440x900 is near-exact: width fraction 0.9400, aspect 3.09514 (spec 3.0951), deck/keybed 0.5398/0.4602, all six section fractions within 0.00001 of spec. Keybed is exact: 73 keys, 43 white, 30 black, every key inside the keybed, black-key height fraction 0.6099 (target 0.61). All five reference colours match within deltaE 1.21. The defect: .instrument-section sets overflow:hidden on a 200.25px band whose content is taller, so 30 of 107 controls never render and 10 more are part-clipped; 32 fail pointer hit-testing. Piano timbre and detail switches, Store/Split, the three morph buttons, both synth envelopes, LFO/arp, compressor, reverb and layer focus are gone. At 390x844 it is 72 of 107. The visual audit claims these controls 'remain in the rendered chassis'; they do not, and no test measures layout. Audio and input are strong: pointer, independent multi-touch, computer keys and Web MIDI share one lifecycle; velocity 15 to 110 moves peak RMS 0.018 to 0.224; sustain, stealing and blur/disconnect cleanup all verified; Master Level honestly changes nothing (0.2009 vs 0.1989).

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 87 |
| Feature completeness | 20% | 67 |

### Priority issues

- **critical** — overflow:hidden on each deck section clips 30 of 107 controls out of the instrument at 1440x900: .instrument-section is a 200.25px-tall band with overflow:hidden, but several sections lay out more content than that. Measured unscrolled at 1440x900, 30 controls have a visible fraction of exactly 0.00 inside their own section and 10 more are partly clipped; 32 of 107 fail a 5x5 document.elementFromPoint hit-test. Whole required landmark groups vanish: piano timbre, the six piano-detail switches, Store and Split, the three morph assign buttons, the amp and mod envelopes, LFO and arpeggiator, compressor, reverb and layer focus. Example chain: synth-amp-attack box [462, 497] inside a section whose box is [232, 432].
- **major** — At 390x844 only 30 of 107 controls are reachable and 72 render not at all: The silhouette survives the narrow profile intact (378x122.125, aspect 3.0952, width fraction 0.9692, deck/keybed 0.5392/0.4608, all 73 keys in one row, no horizontal overflow), but the same section clipping removes 72 of 107 controls and leaves only 30 pointer-reachable. White keys are 8.56px wide. The instrument stays recognizable; the panel stops being usable.
- **major** — The visual audit asserts the clipped controls 'remain in the rendered chassis': artifact/evidence/stage1-visual-audit.md, under 'Corrections and known deviations', says 'Controls are intentionally dense at narrow widths because the instrument retains its hardware aspect ratio. They remain in the rendered chassis and retain full accessible names.' The accessible-names half is true; the rendering half is contradicted by measurement (0.00 visible fraction for 30 controls at desktop, 72 at narrow). The honesty contract requires evidence not to claim behavior the artifact does not have.
- **minor** — regression.chassis maps to a test with no layout or overflow assertions: artifact/src/App.test.tsx:136 checks only for the absence of an h1 and the presence of .instrument, .keybed, .instrument-top-rail and .deck-front-rail in jsdom. The feature ID it satisfies is specified as 'no marketing hero, detached rails, missing keys, overflow, or clipped chassis at 1440x900 and 390x844'. Nothing in the suite measures a box, so the clipping regression passes every gate in inputs/verification.json.
- **minor** — Organ drawbars render as 25x25 squares rather than drawbar stems: The nine drawbars are present in the organ section with 8-segment LED ladders, but their border boxes measure 25.17 x 25.1 px, a height/width ratio of 1.00 against hardware drawbars that are several times taller than wide. Under the spec's own forbiddenDetection vocabulary a drawbar-like control is 'at least 3x taller than it is wide', and none of the nine qualifies. The five layer faders are similar (42.5 x 45.0, ratio 1.06) with no visible travel slot.
- **minor** — Per-control legends are illegible or ellipsized at rendered size: In the 1440x900 capture the drawbar legends truncate to 'Organ d...' and knob legends such as 'Filter Cutoff' and 'Oscillator Shape' render at roughly 3-4px and cannot be read at 1:1. Group headings (ORGAN, DRAWBARS, PERCUSSION, OSCILLATOR, FILTER, EFFECT 1) are legible, so the section structure reads correctly while the silkscreen does not.
- **minor** — Both OLEDs show fixed strings instead of live values: The program OLED renders the constant 'STAGE 4 - 73 / PHASE 1 / DECORATIVE DISPLAY' and the synth OLED 'SYNTH / INACTIVE'. Turning the program dial, pressing program buttons or moving any knob leaves both unchanged. This is honest for a phase where panel controls are decorative and both are labelled 'decorative in Phase 1', but it means neither display reads a live value.
- **minor** — Top-rail legends are out of order against the sections beneath them: The six .instrument-top-rail spans read PROGRAM, ORGAN, PIANO, PERFORMANCE, SYNTH, LAYER EFFECTS while the sections below them are, in DOM and visual order, performance, organ, piano, program, synth, effects. The rail therefore prints PROGRAM above the red performance band that carries Master Level and the rotary speaker, and PERFORMANCE above the program band that carries the OLED and program dial. The rail is aria-hidden, so this is visual only and does not affect the measured section fractions.
- **minor** — Held keys past the 32-voice cap stay lit with no voice behind them: Firing 40 concurrent MIDI note-ons leaves 40 keys at aria-pressed=true while NoteLifecycle's maxVoices is 32, so eight keys show pressed with their voice already stolen. Defensible as key-state rather than voice-state, but the panel is reporting something the engine is not doing.
- **minor** — Synth band satisfies the spec's 'uniform repeated knob matrix' rule: The synth section's filter row and amp-envelope row form a 4x2 block of identical knobs: synth-filter-cutoff/resonance/drive/envelope and synth-amp-attack/decay/sustain/release all measure 76.52 x 35.75 px, on column centres 838.7/917.2/995.8/1074.3 (pitches 78.5/78.6/78.5) and two row centres 425.1/479.5 (pitch 54.4). That meets forbiddenDetection's 'uniform repeated knob matrix' rule literally - at least 8 controls whose widths and heights are within 5% of their medians and whose centres form a regular grid. It is counted once, for the synth section.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**75/100**

Phase 2 audio is real and honest. One AudioContext (tap on build/ at 1440x900) feeds per-layer buses, master gain, limiter and a single destination; all six piano types sound and differ (spectral centroid 339-966 Hz, no identical pair); Grand/Upright/Electric play bundled .ogg recordings with complete CC-BY/CC-BY-NC provenance, and blocking /samples/ yields a labeled playable fallback. All seven effect units and every listed type measurably alter the signal; layers, octave, focus, MIDI velocity (rms 0.00044-0.02932 over vel 10-127) and CC64 sustain all work, and the panel tracks them. Two defects dominate. Chassis geometry is near-exact (deck 0.5398, aspect 3.0951, worst section deviation 0.0004, 73/73 keys inside the keybed, 5/5 reference colours), but Phase 2's denser panels overflow their overflow:hidden sections: 16 controls (Store/Split/3x Morph, both envelopes, LFO/Arp) render below the deck under the keybed, unreachable and invisible, costing 4 required landmarks and breaking the Phase 1 'every control moves' gate. Engaging effects also collapses level: each unit -33..-55% rms, all six -98.6%.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 67 |
| Playability & control | 20% | 75 |
| Feature completeness | 25% | 95 |

### Priority issues

- **critical** — 16 panel controls overflow their section and are unreachable behind the keybed: At 1440x900 on build/, .instrument-section is overflow:hidden with a fixed 200.25 px height; the Phase 2 Program and Synth stacks are taller than that. program-store/split and the three morph-assign buttons (y 455.0-501.6) and every Amp Envelope, Mod Envelope, LFO and Arpeggiator control (y 461.6-606.0) fall below the section bottom (y 432.5) and are clipped away by that overflow:hidden, with the keybed occupying the band where they would sit. A 5x5 document.elementFromPoint grid on each resolves only to .piano-key elements, so 16 of 137 controls cannot be operated, and program-live-mode/layer-scene and the four Filter knobs are half-clipped. This breaks the Phase 1 hard gate 'Every visible panel control moves or presses accessibly' and removes four required landmarks (program store/split, program morph assign, synth envelopes, synth LFO/arpeggiator).
- **major** — Level collapses as effect units are engaged: Cumulatively enabling the six documented units on one unchanged note drove rms from 0.01845 to 0.00026 (-37 dB); individually each unit costs 33-55%. dryWetGains in artifact/src/audio-graph.ts:506 sets dry = 1 - mix with no wet-path make-up gain, so the chain the spec requires is unusable at performance level even though the limiter and master path are correct.
- **major** — Silkscreen legends collide and truncate in the dense sections: At rendered size the Piano band prints 'PIANO LAYERS', 'PIANO TYPE' and 'PIANO DETAIL' on top of each other and overlaps the GRAN/UPRI, A FOCUS/B FOCUS and SUSTPED/PSTICK captions; the Layer Effects band prints 'AMP SIMULATOR AND EQ', 'COMPRESSOR', 'DELAY', 'REVERB', 'LAYER FOCUS', 'ROUTING' and 'ROTARY' across the knobs beneath them; all nine organ drawbars read 'Organ d…'; and the 'PERFORMANCE KEYBOARD' line of the nord mark is cut off. Verified in 3x device-scale crops of the served build.
- **minor** — Narrow viewport keeps the silhouette but loses most controls: At 390x844 the chassis, six bands and all 73 keys survive inside the keybed with no horizontal scroll (docW 390, width fraction 0.969, aspect 3.0952), but only 61 of 137 controls pass the hit test and section headings overprint each other across Piano, Program and Layer Effects.
- **minor** — Top-rail legends do not match the bands they head: The decorative rail in artifact/src/App.tsx prints PROGRAM, ORGAN, PIANO, PERFORMANCE, SYNTH, LAYER EFFECTS with justify-content:space-around, while the deck order is Performance, Organ, Piano, Program, Synth, Effects — so 'PROGRAM' sits over the performance band and 'PERFORMANCE' over the program band. Section geometry itself is unaffected.
- **minor** — Two ampEq types render identically: 'To Rotary' is implemented as a bare pass gain (artifact/src/audio-graph.ts:321) and measured a spectral cosine of 1.000 against 'Twin'; it only changes behaviour when the shared rotary is also engaged, so on its own the panel offers a type that does nothing.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**62/100**

Geometry, keybed and colour are effectively exact: aspect 3.0951, width fraction 0.940, six section fractions within 0.00038, 73/43/30 keys all inside the keybed, black-key height 0.610, 5/5 reference colours under deltaE 1.3. Two failures dominate. (1) The deck is allocated 0.500/0.500 instead of 0.54/0.46 and .deck-sections is clipped at 200px with overflow:hidden, so 66 of 202 controls -- nearly the whole Synth band plus Store/Split/Morph/Master-Clock -- render below the cut and no pointer can reach them at 1440x900. (2) The Layer Effects are inaudible: with the graph instrumented, enabling Reverb at depth 100 changes exactly one gain (1 -> 0) and silences the layer, every unit only attenuates, delay yields no repeats, A-Pan yields no modulation (mod index 0.021 vs 0.023 dry) and rotary slow/fast/off are identical. Engines themselves are real and distinct, splits, morphs, scenes, programs, MIDI and the arpeggiator all work.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 57 |
| Playability & control | 20% | 66 |
| Feature completeness | 35% | 67 |

### Priority issues

- **critical** — Deck content is clipped: 66 of 202 controls are unreachable at 1440x900: .deck-sections is 200.25 px tall and every [data-section-id] section is overflow:hidden, while laid-out content continues to y=910. A 5x5 elementFromPoint hit test at 1440x900 unscrolled resolves to the control for only 136/202. Synth 15/66, Program 14/25, Organ 30/34. Unreachable controls include every synth envelope, LFO, arpeggiator, voice and layer-level control, Store, Store As, Split, Zone Count, Panic, all three Morph Assign buttons and the whole Master Clock group. This is a layout failure, not a z-order one: the controls exist and are correctly named, they are simply cut off.
- **critical** — Layer Effects are inaudible; every unit is a pure attenuator and Reverb silences the layer: Instrumenting BaseAudioContext without touching the destination, enabling Reverb On with depth 100 changes exactly one gain in the graph (Gain#111, 1 -> 0) and the wet gain after the convolver (Gain#37) stays at 0 both before and after; rendered output goes from RMS 0.01975 to 0.00000, and at depth 50 to exactly 0.00989. Delay at mix 90 / feedback 80 changes one gain to 0.1 and leaves no repeats in the release tail. Effect 1 'A-Pan' at depth 100 gives modulation index 0.021 against 0.023 dry over an 11.6 ms window. Amp+EQ at drive 100 / treble 100 leaves the spectral centroid at 67.2 vs 67.1. Rotary slow and fast both give mean RMS 0.01908 vs 0.01907 dry, and remain identical (0.00613 vs 0.00615) when Amp mode is set to 'To Rotary'. The wet branches of all six units plus Rotary never open, so Phase 2's effects.processing requirement has regressed in the sealed Phase 3 build. Root cause: the unit's wetGain node is never connected to the unit output (artifact/src/audio-graph.ts:457-469, 1269-1270), so the wet branch is a dead end and the mix control only attenuates dry.
- **major** — Deck/keybed split is 0.500/0.500 instead of the specified 0.54/0.46: Instrument border box 204.83-642.16 (437.33 px). Top rail 17.41 + deck-sections 200.25 = 218.65 px of deck; front rail 17.41 + keybed 200.25 = 218.68 px. deckFraction 0.500 against target 0.54 +/-0.025, i.e. 0.015 outside tolerance. The deck being short is the direct cause of the overflow clipping above.
- **major** — Piano type LEDs do not follow program recall: After storing a Clav program to slot 7 and switching to program 2, the Program OLED reads 'Upright Piano' while piano-type-clav still reports aria-pressed=true. After a page reload on slot 7, the OLED reads 'Synth Clav' while piano-type-grand is the lit button. The organ model buttons do track recall correctly, so this is specific to the piano type selector.
- **major** — Silkscreen legends render at 4.8-5.3 px and the top-rail band labels are mismatched: Computed font-size for .control-name is 4.80 px (median and minimum) with a maximum of 5.33 px across headings and OLEDs, well below legibility at the rendered size, and three legend pairs overlap outright. The top-rail labels are also out of order against the bands they sit above: 'PROGRAM' spans x 153-185 over the Performance section (x 44-233) and 'PERFORMANCE' spans x 791-839 over the Synth section (x 787-1125).
- **minor** — Drawbars are horizontal sliders and Pipe reuses the B3 spectrum: Each drawbar measures 25.2 x 12.2 px -- wider than tall -- whereas reference/nord-stage-4-73.jpg shows nine tall vertical drawbars with red and white caps; none of the organ controls satisfies the spec's 'at least 3x taller than wide' drawbar test. Separately, Pipe against B3 gives spectral cosine 0.985 and centroid 27.9 vs 25.7, while the organ spec requires four audibly distinct engines (Pipe 2 may reuse Pipe 1, not Pipe 1 reuse B3).
- **minor** — Drawbars cannot be operated from the keyboard: organ-drawbar-2 is an input[type=range] with step=1; focusing it and pressing ArrowUp eight times leaves value at 50, presumably because the value is re-quantised to eight drawbar detents after each 1-unit step. A pointer drag across the same control moves it to 100.
- **minor** — Master Level is not persisted across a reload: Master Level set to 33 survives program changes (it is a global, correctly not marked dirty) but reverts to 72 after a page reload, even though the 493 KB 'stagebench-stage4-state-v1' localStorage key restores the program bank.
- **minor** — Phase 3 evidence does not disclose the clipping or the dead effects path: artifact/evidence/stage3-visual-audit.md asserts that 'the inherited chassis ... six sections, and their measured horizontal proportions remain in place' and lists the Phase 3 organ/synth/program controls as bound, without noting that a third of them are clipped out of the deck, and the unsupported list does not mention that the Layer Effects units are inaudible. No claim is outright false about inventory, but the audit reads as a pass over a surface that regressed.

### Technical gate

Passed.
