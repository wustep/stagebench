# GPT 6.1 Sol High — Stagebench evaluation

- Run: `gpt-6-1-sol`
- Status: complete
- Aggregate: **90/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 94 |
| 2 | Piano library and working effects | 85 |
| 3 | Complete Stage 4 system | 86 |

## Audio provenance

Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.

### Phase 1: Complete surface and basic piano

- Audio strategy: Original generated piano-like PCM buffers, synthesized analytically for each note and velocity. Not recordings or Nord samples.
- Generated sound sources: Phase 1 analytic struck-string voice — Seven slightly inharmonic sinusoidal partials; 4 ms attack, partial-dependent exponential decay, velocity-dependent harmonic brightness and velocity^1.45 amplitude. Ten-second mono PCM generated at AudioContext sample rate for MIDI notes 28–100. No recorded samples, external assets, or network audio loading.
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio: None detected
- Audio note: Every panel input, including Master Level, changes only normalized presentation state. It never changes this audio graph.
- Audio note: Sustain is merged across the utility UI, computer Space, and per-port/channel MIDI CC64 owners. Pedal-up releases unheld voices only when the final pedal source is up.
- Audio note: AudioContext creation, backend, MIDI permission request, and browser input target are injectable. Audio-clock release uses source.stop rather than JavaScript timers.
- Audio note: Unit tests evaluate the exact PCM used by the backend and graph ownership. Browser tests additionally render the production audio graph through OfflineAudioContext, requiring no physical output device.
- Audio note: The synthesis approximates a struck-string piano; it does not claim the timbre or samples of a Nord instrument.

### Phase 2: Piano library and working effects

- Audio strategy: Bundled, byte-identical recorded Grand/Upright/Electric FLAC multisamples; original analytic Clav/Digital/Misc synthesis and explicitly labeled sample-failure fallback. Native Web Audio buffer voices and AudioWorklet layer DSP.
- Generated sound sources: Phase 1 analytic struck-string voice — Seven slightly inharmonic sinusoidal partials; 4 ms attack, partial-dependent exponential decay, velocity-dependent harmonic brightness and velocity^1.45 amplitude. Ten-second mono PCM generated at AudioContext sample rate for MIDI notes 28–100. No recorded samples, external assets, or network audio loading.; Clav / FM Digital / Vibraphone Misc — Analytic PCM, not recordings. Clav decaying harmonic pluck; Digital decaying FM; Misc inharmonic mallet. Failed sampled types use the inherited analytic struck-string renderer, explicitly labeled fallback.; Sympathetic string resonance — Additional quiet inharmonic partials when another same-layer note or routed sustain is held. Simulation, not resonance samples.
- Recorded sample provenance: Salamander Grand Piano V3 — Yamaha C5 — https://github.com/sfzinstruments/SalamanderGrandPiano (CC-BY-3.0); Upright Piano KW — Kawai — https://github.com/freepats/upright-piano-KW (CC0-1.0); Wurlitzer EP200 — https://github.com/sfzinstruments/GregSullivan.E-Pianos (CC-BY-3.0)
- Bundled audio: 183 files (145.9 MB)
- Audio note: Two enabled layers create separate owned voices from each input owner. Layer-disable kills only that layer. SUSTPED is independent per layer; final pedal-owner release or disabling a route damps unheld voices. Soft Release extends release from 220 to 480 ms except Clav.
- Audio note: Short native gain/detune ramps and 15 ms streaming parameter/bypass smoothing avoid gain discontinuities. Type changes fade effect mix out before changing algorithms and then fade in. Rotary speed accelerates over 600 ms.
- Audio note: Graph has two stereo layer processors and exactly one shared Rotary processor. Layer level follows Rotary, preserving specified order without merging layer ownership. All-effects bypass disables both chain processors and rotary.
- Audio note: Layer focus selects piano state and follows into effects. Manual Organ/Synth focus is a visibly unavailable audio target; those section controls stay decorative. Piano group copies current settings then edits both. Delay/Compressor/Reverb global mode copies and edits both existing Piano chains; no unavailable Organ/Synth audio is claimed. Shift+On toggles global mode.
- Audio note: Local effects tempo provides Mod1/Mod2/Delay sync; tap updates seconds and BPM together. Program Master Clock stays decorative.
- Audio note: Tests share the exact streaming DSP implementation with the worklet. Native OfflineAudioContext tests decode the bundled recordings and render the production layer graph, timbre filters, unison, release gains, master and limiter.
- Audio note: Cleanup stops/disconnects all owned sources and per-voice filters/panners, terminates worklet processors, closes ports/context, disconnects buses/levels/master/limiter and clears decoded sample buffers. No audio release timers are used.
- Audio note: Amp simulations and Rotary are documented DSP approximations, not Nord hardware models. Room/Booth/Stage/Hall/Cathedral use distinct delay lengths and decays; Spring uses additional dispersive allpass filtering.

### Phase 3: Complete Stage 4 system

- Audio strategy: Preserved bundled Grand/Upright/Electric recordings, analytic Clav/Digital/Misc/fallback buffers, and original streaming Organ and Analog/FM Synth AudioWorklets. One injected AudioContext and one destination.
- Generated sound sources: Phase 1 analytic struck-string voice — Seven slightly inharmonic sinusoidal partials; 4 ms attack, partial-dependent exponential decay, velocity-dependent harmonic brightness and velocity^1.45 amplitude. Ten-second mono PCM generated at AudioContext sample rate for MIDI notes 28–100. No recorded samples, external assets, or network audio loading.; Clav / FM Digital / Vibraphone Misc — Analytic PCM, not recordings. Clav decaying harmonic pluck; Digital decaying FM; Misc inharmonic mallet. Failed sampled types use the inherited analytic struck-string renderer, explicitly labeled fallback.; Sympathetic string resonance — Additional quiet inharmonic partials when another same-layer note or routed sustain is held. Simulation, not resonance samples.; Organ tonewheel, transistor and pipe ranks — Live additive tonewheel partials, Vox saw/sine and filtered/unfiltered mix, Farf thresholded registers, Pipe harmonic ranks. B3 Bass limits B3 to 16/8 foot drawbars; Pipe 2 adds brighter principal partials. Seeded deterministic click transient, single-trigger percussion and vibrato/chorus. Approximate engines, not Nord recordings.; Analog and harmonic FM Synth — Live fourteen required waveforms in Pure/Sync/Multi/Super/FM-H categories. No recorded synth samples. Category-specific sync ratio, stacked detuning and harmonic FM depth; two-stage biquad filters, three ADR envelopes with maximum decay sustain, deterministic LFO/sample-hold, mono/legato/priority/glide, unison/vibrato and sample-clock arp/poly/gate.
- Recorded sample provenance: Salamander Grand Piano V3 — Yamaha C5 — https://github.com/sfzinstruments/SalamanderGrandPiano (CC-BY-3.0); Upright Piano KW — Kawai — https://github.com/freepats/upright-piano-KW (CC0-1.0); Wurlitzer EP200 — https://github.com/sfzinstruments/GregSullivan.E-Pianos (CC-BY-3.0)
- Bundled audio: 183 files (145.9 MB)
- Audio note: All inherited sample recordings, hashes, licenses, source manifests and Piano DSP are retained. Phase 1 WebAudioBackend remains solely as the regression/test fallback backend; production App uses LayerAudioBackend for every engine.
- Audio note: Layer disable stops only owned voices; sustain respects per-layer routes; program changes, Panic, blur, disconnect, visibility and unmount clear notes and tails. Input reset listeners clear keyboard and MIDI ownership queues on Panic.
- Audio note: Five persistent streaming engine worklets (Organ A/B, Synth A/B/C), six effects worklets and one shared Rotary worklet use the one injected context. Streaming release/arp timing uses samples, with no audio timers. synchronize() provides an acknowledged command barrier for deterministic native offline rendering.
- Audio note: Organ A/B must mix before their shared effects; their individual level gains precede that common chain. Other layer levels remain after Rotary. Every audible path passes Master and limiter.
- Audio note: Effects group edits the focused Piano/Synth section; Shift+global unit On copies/edits all six chains. Organ focus uses its shared chain. All-effects bypass includes Rotary.
- Audio note: Master Clock BPM is shared by arp/LFO/Delay/Mod1, with editable subdivisions. Keyboard sync resets streaming and effect modulation clocks when the first owned note starts. Four taps set tempo; holding MST CLK while turning Program dial edits 30–300 BPM.
- Audio note: Morph assignment captures start/end paths without changing stored base settings; editing previews endpoints audibly, then unlatching restores the current source interpolation. Assigned knobs show green indicators; drawbar/fader graphs show assigned ranges. Wheel/Pedal interpolation also applies to synced rate subdivisions. CC1 and CC11 route to the same runtime sources.
- Audio note: Original DSP approximations, not hardware emulations. Simple oscillator formulas can alias at high pitches. No optional Synth samples, extra oscillator categories, extra filters, or FM-I algorithms are claimed.
- Audio note: Rotary horn and bass rotor speeds accelerate over 600 ms, including Stop and continuous morphable speed. Short ramps smooth native layer gains/pitch and streaming cutoff/resonance/drawbars/Osc Ctrl; inherited effects retain 15 ms bypass/parameter smoothing.
- Audio note: Cleanup kills source ownership, clears DSP notes/arp state, disconnects every source/filter/panner/bus/level/master/limiter/worklet, closes ports/context, resolves pending acknowledgements and clears sample buffers. Tests compare production DSP PCM and native OfflineAudioContext output with tolerant relationships.

## Phase 1: Complete surface and basic piano

**94/100**

A complete, honest Phase 1. The published build genuinely synthesises: one 10 s 48 kHz buffer per note-on, correct pitch across all 73 keys (41 / 261.5 / 2637 Hz at E1/C4/E7), 4.5 ms attack, 220 ms damper ramp, 32-voice cap with deterministic stealing, and cleanup to zero on blur, visibilitychange, MIDI disconnect, CC123 and unmount. Pointer, multi-touch, QWERTY and Web MIDI all reach one lifecycle, including denied/disconnected MIDI and a truthful audio-error state. The decorative boundary is airtight: operating all 140 controls created 0 AudioContexts and 0 sources, and Master Level left the rendered peak bit-identical. Every audio claim in IMPLEMENTATION_DETAILS.json reproduced under measurement. Two real shortfalls. Voice character is simplified - decay is pitch-independent (E1 and E7 share an identical RMS envelope) and partials roll off to -60 dB by h6. And chord attacks smear: a 10-note burst spreads 53 ms (16 notes, 91 ms) because each note-on renders 480,000 samples on the main thread; that is undeclared. Panel inventory is complete but legends render at 3.65 px with 12 overlapping labels, so controls are identifiable by accessible name, not by sight.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 25% | 85 |
| Playability & control | 55% | 100 |
| Feature completeness | 20% | 90 |

### Priority issues

- **major** — Chord attacks smear by up to 91 ms from main-thread buffer synthesis: Each note-on synthesises a 480,000-sample (10 s @ 48 kHz) buffer on the main thread before calling source.start() with no scheduled time. Timing source.start against AudioContext.currentTime in the published build: 1 note 6-10 ms latency, 5 notes spread 26.7 ms, 10 notes 53.3 ms, 16 notes 90.7 ms. A ten-finger chord therefore arrives audibly arpeggiated. Rendering a shorter buffer, rendering off the main thread, or scheduling all starts at a common lookahead time would fix it. The limitation is not declared in IMPLEMENTATION_DETAILS.json.
- **minor** — Decay rate is identical at every pitch: renderPiano uses decay exp(-t*(0.65+h*0.42)) with no pitch term. Measured RMS envelopes at [0,0.5,1,2,4,6] s for MIDI 28, 40, 60, 76 and 100 agree to three significant figures (0.156 / 0.093 / 0.054 / 0.018 / 0.0022 / 0.00025). On a real piano the top octave dies in one to two seconds while the bottom rings for twenty, so the keybed sounds uniform top to bottom.
- **minor** — Timbre is thin and lacks non-harmonic detail: Goertzel analysis of the build's C4 PCM gives h2..h6 at -14.7, -22.3, -29.8, -41.1 and -60.5 dB relative to the fundamental, with nothing measurable above h6. There is no hammer or key-off noise, no sympathetic resonance, no string detune and the output is mono. Inharmonicity is present and correct (h7 at 1.00270x ideal), so the structure is right; the spectrum is simply soft.
- **minor** — Panel legends render at 3.65 px with 12 overlapping label pairs: All 140 .control-legend elements compute to font-size 3.6547px at 1440x900, and 12 pairs of legend bounding boxes overlap. Control group titles are similarly small (0.29cqw ~= 3.9 px). Controls remain identifiable through accessible names and the Inspect 4x zoom, and stage1-visual-audit.md declares the approximation, but the printed surface cannot be read at the canonical desktop viewport.
- **minor** — regression.chassis viewport assertions are not run by the gated test script: tests/feature-matrix.json maps regression.chassis to src/App.test.tsx and tests/browser-check.mjs, but the no-overflow / no-clipping assertions at 1440x900 and 390x844 exist only in browser-check.mjs, which needs a running Vite server and is not picked up by 'pnpm test' (vitest run over src/). jsdom cannot assert layout, so the gated suite does not cover that clause. The behaviour itself is correct: I measured scrollWidth/Height 1440x900 and 390x844 with 73 keys and 140 controls present at both.
- **minor** — Computer keyboard is limited to a fixed 17 keys with no octave shift: computerKeys in src/hardware.ts maps KeyA..Semicolon to MIDI 60-76 (C4-E5) with no transpose or octave control, so 56 of the variant's 73 keys are unreachable from QWERTY. The footer documents the mapping honestly and the Phase 1 contract only requires the keyboard to reach the note lifecycle, which it does.
- **minor** — Draft capture files left in the sealed artifact root: artifact/ carries stage1-desktop-draft.png and stage1-browser-draft.json (25 bytes, only a consoleErrors key) alongside root duplicates of the evidence files. stage1-desktop.png, stage1-narrow.png and stage1-visual-audit.md are byte-identical to their evidence/ copies, but stage1-capture.json differs between artifact root and evidence/, so the root copy is a stale earlier run. Only the evidence/ copies are referenced by verification.json.

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**85/100**

A strong Phase 2. The published build serves three genuine bundled recorded sample sets (183 FLACs, 153 MB, all 183 SHA256 digests matching manifest.json, CC-BY-3.0/CC0 from three different publishers, 20-36 roots and 2-4 recorded velocity bands each) and three honestly-declared synthesis types; all six are audibly distinct through the live graph (spectral cosine 0.61-0.88). The effect chain is real streaming DSP in an AudioWorklet: every one of the 25 listed types measurably changes a standardized signal (min pairwise diff 0.0389, all vsDry >= 0.063 except To Rotary, which is a route and was verified through the shared Rotary), reverb decay orders Booth<Room<Spring<Stage<Hall<Cathedral as specified, delay feedback filtering leaves the dry attack bit-identical, bypass is click-free (max jump 5.45e-4) and returns the exact dry signal. Exactly one AudioContext, two layer buses, one shared Rotary, master gain + limiter, one destination, no clipping (peak 0.145 on 12 voices). Chief shortfall: Delay Dry/Wet, delay feedback filter, Amp Drive, Amp Mid Freq, clock sync and Group mode exist only in a supplemental drawer, not on the panel.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 55% | 82 |
| Playability & control | 20% | 92 |
| Feature completeness | 25% | 85 |

### Priority issues

- **major** — Six required effect parameters are reachable only from the supplemental drawer, not the panel: The panel's Layer Effects section holds 29 controls and its Delay group has only Time, Feedback, Tap and On. Delay Dry/Wet, the Delay feedback filter (Off/LP/HP/BP), Amp Drive, Amp Mid/Filter Frequency, Master Clock sync for Mod 1/Mod 2/Delay, and Group mode exist only as #setting-delay-dry-wet, #setting-delay-feedback-filter, #setting-amp-drive, #setting-eq-mid-filter-frequency, #setting-mod1-clock-sync/#setting-mod2-clock-sync/#setting-delay-clock-sync and #setting-piano-group inside the collapsed 'Piano & effects settings' drawer below the instrument. All of them do reach audio (drawer-driven Delay at Dry/Wet 1, 0.4 s, feedback 0.85 produced repeats across all eight recorded envelope segments), so this is control placement rather than missing behaviour — but specs/nord-stage-4.effects.json lists them as required unit parameters and the real panel carries a Dry/Wet knob and a Group path.
- **minor** — Panel-absent effect parameters are not named in the declared gaps: IMPLEMENTATION_DETAILS.json declaredGaps[1] notes only that 'supplemental settings sit below the instrument, closed by default'. It does not say which required effect parameters (Delay Dry/Wet, feedback filter, Amp Drive, Amp Mid Freq, clock sync, Group) are unavailable on the panel itself, so the declaration does not disclose the gap a panel-driven evaluation finds.
- **minor** — Compressor Fast mode and Reverb Bright/Dark are near-inaudible: Rendering build/audio/dsp.js at 8 kHz on a standardized burst, switching the compressor between Normal and Fast at amount 1 changed the signal by an RMS difference of only 0.00403, and sweeping Reverb Bright/Dark from 0 to 1 by 0.02009 — against 0.14913 for compressor Amount and 0.31326 for reverb Dry/Wet. The manual describes Fast mode as recovering quicker and pumping at high amounts, which this attack/release change (2/45 ms vs 12/250 ms) barely delivers on the rendered signal.
- **minor** — Timbre's effect on the acoustic pianos is very subtle: Switching the Grand from Timbre Off to Bright moved the 2.9-5.1 kHz share of the recorded live-graph spectrum only from 1.913% to 2.317% (RMS 0.005220 -> 0.005151). It is one biquad per voice with fixed frequency and gains [0,0,5,7,10,-6] dB (src/layer-audio.ts:65); Dyno 1 and Dyno 2 are further shelf variants rather than tine preamp emulations. The control is measurable and honestly documented, but shallower than the manual's Soft/Mid/Bright/Dyno description.
- **minor** — Moving a Layer level fader steals layer and FX focus: src/panel.ts:49 calls focusLayer(state, target) whenever piano-layer-a-level or piano-layer-b-level changes, so trimming Layer B's level silently re-targets piano editing and the effect chain from A to B. I confirmed the side effect while probing: adjusting Layer B's fader moved subsequent effect edits onto Layer B's chain. Related: the drawer summary continued to read 'FX Piano A' after #effects-organ-focus set the FX section to Organ.
- **minor** — Panel effect knobs are silently inert under Organ/Synth FX focus: With #effects-organ-focus selected, src/panel.ts:63 gates effect edits on fxSection === 'Piano', so setting #effects-reverb-amount to 20 left it at its previous 0.9 with the title still reading 'Reverb amount · 0.9'. The control refuses rather than faking success, and IMPLEMENTATION_DETAILS.json notes[3] calls this 'a visibly unavailable audio target', but nothing on the panel itself marks the knobs as unavailable in that state.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**86/100**

A dense, genuinely functional Stage 4. Geometry is essentially exact at 1440x900 (deck 0.54000, keybed 0.46000, width 0.94000, aspect 3.09514, worst section deviation 0.00001); keybed is 73 keys / 43 white / 30 black, E1-E7, all inside the keybed, black-key fraction 0.60991; 33/33 landmarks present, 140/140 controls pointer-reachable, 0 forbidden descriptors, 5/5 reference colours within deltaE 3. Audio is real and shared: one AudioContext and one destination, 6 buses -> 6 chain worklets -> rotary -> master -> limiter. Offline renders of the shipped DSP show 6 distinct organ models, 9 independently audible drawbars, percussion/click/vibrato, 14 distinct synth waveforms with category-correct Osc Ctrl (exactly 0 on Pure), working filters/envelopes/LFO/unison/arp, and six effect units that each change the signal. Programs round-trip through the panel and across reload with a truthful dirty flag; scenes, splits, morphs, transpose and Panic work across all three engines. Main weaknesses: audio was load-gated so early noteOns were silent until the full ~153MB sample library finished; silkscreen legends are ~3.7 px and overprint each other into unreadable bands (drawbars, pedal/routing rows), 10/140 controls are not pointer-reachable at 390x844, and morph destinations are a curated allow-list rather than the parameter space.

### Axis scores

| Axis | Weight | Score |
| --- | ---: | ---: |
| Sound | 45% | 77 |
| Playability & control | 20% | 91 |
| Feature completeness | 35% | 93 |

### Priority issues

- **major** — Control legends overprint and are illegible at rendered size: src/styles.css sets .control-legend to font-size .27cqw (3.65 px at 1440x900) with white-space:nowrap, centred on each control. Because adjacent controls are closer than their captions are wide, legends overlap: in the organ band the nine drawbar captions ('DRAWBAR 16', 'DRAWBAR 5 1/3', ...) merge into one unreadable strip, and 'SUSTAIN PEDAL' overprints 'PITCH STICK ROUTING'; the piano band overlaps 'SOFT RELEASE'/'STRING RESONANCE' and 'PIANO TYPE'/'MODEL SELECTOR'; the synth band overlaps 'LFO AMOUNT'/'ENVELOPE AMOUNT'. On reference/nord-stage-4-73.jpg every caption is separately legible. Visible in scratch/deck-left.png and scratch/deck-right.png (3x upscales of the rendered build).
- **major** — 10 of 140 controls are not pointer-reachable at 390x844: A 5x5 document.elementFromPoint hit-test over each control's interactive element returns 140/140 reachable at 1440x900 but only 130/140 at 390x844. The failures are organ-layer-a-level, piano-layer-a-level, synth-layer-a-level, synth-layer-b-level, synth-waveform, synth-arpeggiator-mode, synth-arpeggiator-hold, synth-filter-drive, synth-amp-attack and synth-mod-attack - all ~3-5 px wide at that scale, where legends and neighbouring elements win the hit-test. The footer Inspect slider (1x-4x with horizontal scroll) restores access, so this is degraded usability rather than a dead control.
- **major** — First-gesture silence: audio load-gated until full ~153MB sample library finished: On the sealed Stage 3 artifact as evaluated, audio startup awaited the entire piano sample library (183 FLACs, ~153MB) inside `initialize()` before the graph was considered ready. Early `noteOn` calls for keys released during that wait were dropped, so first gestures were silent until the full download/decode completed. A note held until ready did speak. This failed musical quality under load / first-play reliability for the published sealed build. (A preview play-path fix landed later in PR #35; digests/artifacts of the sealed record are intentionally unchanged here — this amendment is report and score honesty only.)
- **minor** — Morph destinations are a fixed allow-list: src/audio.ts morphDestinations enumerates roughly 90 paths (rotary speed, the seven layer levels, the 18 organ drawbars, synth ctrl/cutoff/res/LFO rate+amount/arp rate, and 11 effect parameters per chain). Anything outside it - filter type, envelope times, waveform selection, every switch parameter - silently cannot be morphed: arming a morph source and then moving such a control just changes the value with no assignment created. The behaviour is consistent and the panel shows which controls are assigned, but it is narrower than the hardware and is not called out in the UI's scope notes.
- **minor** — Several controls carry non-hardware semantics, discoverable only in the footnote: Oscillator Mix drives coarse pitch, Oscillator Shape drives Osc Env amount, and the Amp/Mod 'Sustain' knobs set envelope *velocity* rather than a sustain level; Split Set is reachable only via a 500 ms long-press of Split On (src/App.tsx onPointerUp) and opens a settings dialog. These reassignments are declared honestly in the 'Unsupported controls & scope notes' paragraph, so no control fakes success, but the panel legends still read SUSTAIN/MIX/SHAPE and a player reading the surface would be misled.
- **minor** — Worst-case polyphony load is untested: A note-on can start one voice per enabled layer (up to 7), and each organ/synth voice runs its own VoiceDSP additive/filter loop inside the worklet, so a 32-voice cap can mean 32 concurrent DSP voices across five stage-engine processors plus six stage-layer chains and the rotary. Nine simultaneous notes played cleanly with no console errors in this headless run, but nothing in the artifact's evidence or tests measures render-quantum overruns or dropouts at the polyphony limit.

### Technical gate

Passed.
