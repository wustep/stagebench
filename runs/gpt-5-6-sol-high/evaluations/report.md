# GPT 5.6 Sol High — Stagebench evaluation

- Run: `gpt-5-6-sol-high`
- Status: complete
- Aggregate: **72/100**
- Coverage: 3/3 phases

## Phase scores

| Phase | Scope | Score |
| --- | --- | ---: |
| 1 | Complete surface and basic piano | 75 |
| 2 | Piano library and working effects | 72 |
| 3 | Complete Stage 4 system | 70 |

## Implementation details

Generated from package manifests, detected audio assets, and benchmark-authored audio provenance.

### Phase 1: Complete surface and basic piano

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: Live Web Audio synthesis: a velocity-shaped, filtered three-oscillator modeled-piano voice with per-note attack, decay, release, sustain ownership, and a single master gain path.
- Generated sound sources: Modeled piano oscillator bank
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: No recorded samples, generated buffers, network assets, or third-party audio files are used.
- Audio note: The UI labels this voice as a modeled piano and never describes it as a recording.
- Audio note: If Web Audio is unavailable or startup fails, the status explicitly reports a silent visual fallback.

### Phase 2: Piano library and working effects

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One lazy Web Audio context owns two Piano layer buses, six ordered per-layer effect units, shared post-reverb Rotary routing, layer levels, master gain, limiter, and one destination. Deterministic offline DSP mirrors the audible controls for rendered-audio verification.
- Generated sound sources: Grand multi-sample PCM bank; Upright multi-sample PCM bank; Electric multi-sample PCM bank; Clav, Digital, Misc, and failure-fallback synthesis; Reverb impulse responses
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: The isolated workspace supplied no redistributable acoustic-piano recordings. Grand, Upright, and Electric are bundled generated PCM plans, not recordings, and are never described as recorded samples.
- Audio note: This truthfully deviates from the Phase 2 hard gate requiring recorded sample sets; no provenance claim is fabricated.
- Audio note: All sound generation and processing is local and works without network access.
- Audio note: A PCM-loading/startup failure reports 'PCM library failed · synthesized playable fallback active' and continues through the synthesized path.

### Phase 3: Complete Stage 4 system

- Application libraries: `@vitejs/plugin-react` ^6.0.2, `react` ^19.2.7, `react-dom` ^19.2.7, `typescript` ~6.0.2, `vite` ^8.1.0
- Development and test tooling: `@testing-library/jest-dom` ^6.9.1, `@testing-library/react` ^16.3.2, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `jsdom` ^28.0.0, `oxlint` ^1.69.0, `vitest` ^4.1.0
- Audio strategy: One lazy Web Audio context owns the inherited Piano A/B racks, Organ A/B source rendering into one shared Organ effect target, independent Synth A/B/C effect targets, one shared Rotary route, master gain, limiter, and one destination. Deterministic local renderers exercise the identical canonical parameters for cross-browser audio verification.
- Generated sound sources: Grand, Upright, and Electric multi-root/multi-velocity PCM plans; Clav, Digital, Misc, and failure-fallback synthesis; B3, Vox, Farf, Pipe 1, B3 Bass, and Pipe 2 organ engines; Pure, Sync, Multi, Super, and FM-H synth sources; Reverb impulse responses
- Recorded sample provenance: No recorded or external sample sources declared
- Bundled audio files: None detected
- Audio note: All sound generation and processing is local and works without network access.
- Audio note: The isolated workspace supplied no redistributable acoustic-piano recordings. Grand, Upright, and Electric remain generated PCM plans, never described as recorded samples.
- Audio note: This preserves the inherited Phase 2 recorded-sample hard-gate deviation honestly; no provenance claim is fabricated.
- Audio note: A PCM-loading/startup failure reports a synthesized playable fallback rather than claiming the primary library is ready.

## Phase 1: Complete surface and basic piano

**75/100**

Phase 1 delivers the full Nord Stage 4 73 surface on one continuous red chassis with a measured 3.0951:1 aspect ratio, 54/46 deck/keybed split, and an exact 73-key E1-E7 keybed (43 white / 30 black). The six sections render in the documented order (Performance, Organ, Piano, Program/Morph, Synth, Layer Effects) and exactly two elements carry data-primary-oled (Program and Synth). Runtime inspection at 1949px viewport found 146 buttons and 57 ranges; 129 controls are marked data-functional=false with '(decorative)' in their accessible names, and the Program/Synth OLEDs read 'PANEL ONLY / PROGRAM ENGINE OFF' and 'ENGINE OFF / DECORATIVE PANEL'. The basic piano is a live three-oscillator modeled voice (triangle fundamental + sine partials at 2.01/3.98 with a velocity low-pass) honestly labeled 'Modeled piano ready'; IMPLEMENTATION_DETAILS.json declares no recorded samples. Driving the keyboard confirmed a keydown creates one voice (status 'Modeled piano ready · 1 voices'), and PianoNoteEngine implements 24-voice polyphony with oldest-sequence stealing, sustain, release, and blur/disconnect/unmount cleanup. Inputs cover pointer, independent multitouch, mapped computer keys with repeat suppression, and Web MIDI note/velocity/CC64 plus denied/disconnected handling. 15 candidate tests pass. The recreation is clean and geometrically faithful but visually schematic and lower-density than the reference photo, with tiny legends acknowledged at 390px.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Complete visual fidelity | 45% | 75 |
| Basic Piano functionality | 25% | 75 |
| Surface interaction and honesty | 15% | 75 |
| Engineering quality | 15% | 75 |

### Priority issues

- Visual rendering is a clean but schematic recreation with notably lower control density and flatter materials than the reference photo; legends are very small at 390px.
- The basic piano voice is honest live synthesis rather than a bundled sample (expected for Phase 1).

### Technical gate

Passed.

## Phase 2: Piano library and working effects

**72/100**

Phase 2 brings the Piano section, Layer Effects, and Master Level alive while keeping Organ, Synth, and Program honestly decorative. Runtime inspection confirmed the boundary exactly: 65 data-functional=true controls (22 piano, 43 effects/master) and 0 functional controls in organ/synth/program. Six selectable piano types (Grand/Upright/Electric/Clav/Digital/Misc) render as distinct offline PCM voices, two layers support enable/focus/level/octave/SUSTPED/PSTICK, and performance controls (KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res) plus Master Level all measurably change the rendered signal (proven by rms/signature tests). The effects graph is one AudioContext with per-layer Piano A/B buses feeding an ordered node chain (Mod1->Mod2->Delay(with filtered feedback loop)->Amp/EQ->Compressor->Reverb->Rotary->layer level->master gain->limiter->one destination); every unit is real DSP with distinct types, and focus/group/global/bypass/dry-wet/order/To-Rotary routing is implemented and tested. 30 candidate tests pass across the DSP boundary. The one material defect is a declared hard-gate deviation: Grand/Upright/Electric are generated multi-root/multi-velocity PCM (SAMPLE_BANKS source 'generated-pcm'), NOT recorded sample sets. This is disclosed honestly in IMPLEMENTATION_DETAILS.json and asserted in tests, so it never fakes recordings, but the recorded-sample-set requirement for the three acoustic families is entirely unmet.

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Visual and interaction retention | 10% | 75 |
| Piano library and performance | 35% | 67 |
| Effects and signal graph | 30% | 75 |
| System behavior and UX | 10% | 75 |
| Engineering quality | 15% | 75 |

### Priority issues

- HARD-GATE DEVIATION: Grand/Upright/Electric are generated PCM (SAMPLE_BANKS source 'generated-pcm'), not recorded/redistributable sample sets, so piano.instrument-library's recorded-sample requirement is unmet. Declared honestly in IMPLEMENTATION_DETAILS.json and tests, so it is not faked.
- Piano voices render full 2.4s buffers synchronously on note-on, a main-thread cost that could add latency under dense polyphony.

### Technical gate

Passed.

## Phase 3: Complete Stage 4 system

**70/100**

Phase 3 completes the instrument: Organ, Synth, and the full Program/performance system come alive on one AudioContext. Runtime inspection found 192 data-functional=true controls and only 4 unsupported controls (Monitor Level, Panel Lock, Aftertouch morph, Osc Shape), each labeled '(unsupported)' and listed in the audit — excellent binding coverage with no generic no-op fallbacks. I verified the program workflow in the browser: clicking Program button 3 changed the OLED from '1.1 Studio Grand' to '1.3 B3 Gospel'; editing Transpose showed the truthful 'E' dirty flag ('1.3 E ... +1 ST'); selecting another program then returning showed the edit discarded ('1.3 B3 Gospel +0 ST'). 32 slots across 4 pages + dial + numeric list + Store/Store As naming + 8 Live slots are implemented. Splits (11 positions, Off/±6/±12 crossfades, zone routing), two Scenes, Wheel/Control-Pedal morphs (assign/interpolate/clear), master clock (tap+dial), Transpose ±6, and Panic are all real logic in programs.ts. The Organ engine renders distinct B3/Vox/Farf/Pipe spectra with nine drawbars, percussion, key click, and vibrato/chorus; the Synth engine renders five waveform categories (Pure/Sync/Multi/Super/FM-H) with category-correct Osc Ctrl, four filters, three envelopes, LFO, voice modes, glide/unison/vibrato, and a clocked arp/gate — all proven distinct by tests, and I confirmed live category/waveform switching updates the Synth OLED. 46 tests pass; capture logs show zero console/page errors. The main architectural limitation: only Piano A/B traverse the live per-layer Web Audio effect racks; Organ and Synth are rendered offline (renderOrganNote/renderSynthNote + processEffectChain baked at note-on) and connected directly to master, so they share one context/destination and apply effects+rotary audibly but do NOT route through the inherited live effect buses, and live effect automation does not update sustaining organ/synth notes. Per-note synchronous offline rendering of ~2.4s buffers plus multi-pass effect chains on the main thread, with no explicit polyphony cap in StagePianoEngine, is a load/latency risk under dense integrated play. The inherited Phase 2 recorded-sample deviation remains (generated PCM, honestly labeled).

### Category scores

| Category | Weight | Score |
| --- | ---: | ---: |
| Final visual fidelity | 5% | 75 |
| Complete feature system | 35% | 75 |
| Audio quality and integration | 30% | 58 |
| Full-system behavior | 20% | 75 |
| Engineering quality | 10% | 75 |

### Priority issues

- Organ and Synth do not route through the inherited live per-layer effect buses; their effects and rotary are baked offline at note-on and connected straight to master, so live effect automation does not affect sustaining organ/synth notes and two parallel effect implementations exist (one context/destination is still honored).
- Per-note synchronous offline rendering of ~2.4s buffers plus multi-pass effect chains on the main thread, with no explicit polyphony cap in the running StagePianoEngine, is a latency/CPU risk under dense integrated polyphony.
- Inherited Phase 2 deviation persists: Grand/Upright/Electric are generated PCM plans, not recorded sample sets (honestly declared, never presented as recordings).

### Technical gate

Passed.
