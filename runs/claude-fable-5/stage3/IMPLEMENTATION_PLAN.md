# Implementation plan — Nord Stage 4, variant `stage-4-73`

This file contains the Phase 3 plan (current) followed by the inherited Phase 2 and Phase 1 plans (kept intact below).

---

# Phase 3 implementation plan — Organ, Synth and the Program/Performance system

Assigned variant: **stage-4-73**. Assigned specs: `specs/nord-stage-4.programs.json` (programs/splits/scenes/morphs/clock/transpose), `specs/nord-stage-4.organ.json`, `specs/nord-stage-4.synth.json`, plus the inherited visual/piano/effects specs. Manual pages read: 13 (Store), 27–33 (Organ), 34–46 (Programs, Splits, Scenes, Morphs, Mst Clk, Transpose), 53–63 (Synth). The sealed Phase 2 artifact is preserved and extended.

## Hard gates

Phase 3 hard gates (verbatim from `specs/benchmark-phases.json`, phase 3):

- Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- All inherited visual, piano, effects, and input behavior remains regression-free.

Shared completion gates (verbatim from the manifest):

- All benchmark-owned and candidate-authored tests pass.
- The browser console contains no errors during the required interaction pass.
- Every claimed audio feature is connected to the audible signal graph.
- The latest phase preserves all inherited tests, visual evidence, and behavior.
- IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
- The evaluated source, build, and evidence match the sealed verification digest.

## Architecture: 7 layers, 6 chains, one context

The Phase 2 engine generalizes from 2 piano layers/chains to **7 layers** (Piano A/B, Organ A/B, Synth A/B/C) and **6 effect chains** (piano A, piano B, one shared organ chain per the organ spec, synth A/B/C). Every chain reuses the identical Phase 2 structure (voice bus → timbre EQ → dyn-comp → level → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb → master/rotary). Organ layers pre-mix through per-layer strips (entry gain → scanner vibrato/chorus → level gain) into the shared organ chain; each synth layer has a strip (entry → gate chopper) into its own chain plus a per-layer LFO and vibrato oscillator. One AudioContext, one master gain → limiter → destination — no second context anywhere.

- **Organ voices** (`src/audio/organ.ts`): additive oscillator banks per model — B3/B3 Bass: nine drawbar-gained sine tonewheels with foldback above the top wheel, single-triggered 2nd/3rd percussion, key-click noise transient; Vox: filtered triangle/saw registers with the 8'+4' bright sawtooth bank; Farf: buzzy saw/square register set; Pipe 1/2: sine-partial ranks with per-note detune and chiff noise. Drawbar moves retarget partial gains live on sounding voices. No release tail; damper ignored (canonical).
- **Synth voices** (`src/audio/synth.ts`): Pure (native waves + pulse PeriodicWaves + looped noise buffer), Sync (saw/square through a swept resonant formant bandpass), Multi (4 detuned saws / 2+2 octave), Super (7 center-weighted saws/squares), FM-H (2-op sine FM); LP12/LP24/HP/BP filters with keyboard tracking, resonance, drive waveshaper, dedicated filter envelope (detune-cents sweep clamped to Nyquist headroom), oscillator envelope (Osc Ctrl or pitch), amp ADSR with 4-step velocity; per-layer LFO (triangle/saw/inv-saw/square/S&H) to Osc Pitch/Osc Ctrl/Filter Freq with clock sync; Poly/Mono/Legato with Low/High/last priority and glide; unison; vibrato (wheel-scaled or on); deterministic arpeggiator/gate scheduled on the audio clock (pure `arpSequence` generator, xorshift-seeded Random).
- **Programs** (`src/state/instrument.ts`): 32 slots (4 pages × 8) + 8 Live slots; `serializeProgram`/`applyProgram` round-trip every supported parameter; dial/page/button browsing, Shift+dial numeric list view; STORE destination step + confirm, STORE AS naming flow (dial edits characters, ◂▸ cursor); dirty indicator; edits discarded on program change with single-level Undo; Live Mode auto-stores every edit; persistence through an injectable `ProgramStorage` (localStorage in the browser).
- **Splits/zones**: three split points (Low/Mid/High) at the 11 documented positions, crossfade Off/±6/±12 (linear across 2× width), per-layer contiguous zone ranges stepped by KB ZONE, split LEDs above the keybed.
- **Scenes**: Layer Scene I/II swap the per-layer enable sets only; sound parameters are shared.
- **Morphs**: Wheel and Control Pedal (panel wheel, on-screen pedal, MIDI CC1/CC11) with latched assign capture, from→to per destination (layer levels, drawbars, synth params, effect params, rotary speed), interpolated in `morphedState` — the engine renders from the morphed EFFECTIVE state while base program values stay untouched; zeroing back onto the base clears an assignment.
- **Master Clock/Transpose/Panic**: tap/set BPM 30–300 syncing delay/LFO/arp divisions; global transpose ±6 semitones applied at note-on; Panic = immediate all-notes-off including latched arp state.

## Control binding

Every panel control that is not spec-excluded now has a canonical binding through the presentation front door (`src/state/presentation.ts`) into the `InstrumentStore`. The truthfully unsupported set (spec-excluded features, marked decorative and asserted by tests): `morph-at` (aftertouch), `preset-organ/piano/synth` + `organ-preset` (preset libraries), `section-edit`, `layer-init`, `mon-copy` (menu-only utilities), `synth-mode` (Samples/Extern modes; Analog is the only engine).

## Test plan

| Feature area | Test files |
| --- | --- |
| programs.store/dirty/undo/live/list | `src/state/programs.test.ts` |
| splits/scenes/morphs/clock/transpose state | `src/state/programs.test.ts` |
| engine integration (single context, zones, transpose, voice modes, arp, panic, morph-to-graph) | `src/audio/stage3-engine.test.ts` |
| organ/synth audible distinctness, drawbars, filter, morph audibility (real rendered audio) | `src/audio/render-stage3.test.ts` |
| every bound panel control audibly/canonically reacts (systematic audit) | `src/state/bindings-audit.test.ts` |
| inherited phase 1+2 behavior | all inherited test files, updated only where they asserted the old "Organ/Synth/Program are decorative" contract |

## Build order

1. This plan. 2. Program-scope state model + factory programs + serialization. 3. InstrumentStore actions for organ/synth/programs/splits/scenes/morphs/clock/transpose. 4. Organ + synth voice modules. 5. Engine generalization (7 layers/6 chains/strips/arp scheduler). 6. Panel bindings + LEDs/OLED readouts + split LEDs + MIDI CC1/CC11. 7. Phase 3 test suites; evolve inherited contract tests. 8. All four pnpm gates. 9. Browser interaction pass + visual audit + truthful IMPLEMENTATION_DETAILS.json + feature matrix.

---

# Phase 2 implementation plan — Piano library and working effects

Assigned variant: **stage-4-73**. Assigned specs: `specs/nord-stage-4.visual.json` (v1.1.0), `specs/nord-stage-4.piano.json` (v1.0.0), `specs/nord-stage-4.effects.json` (v1.0.0). Manual pages read: 23–26 (Piano), 47–52 (Layer Effects). The sealed Phase 1 artifact is preserved and extended.

## Hard gates

Phase 2 hard gates (verbatim from `specs/benchmark-phases.json`, phase 2):

- At least three selectable bundled recorded Piano sample sets are audibly distinct, work offline, and have complete redistributable source/license/file provenance.
- All input paths share one deterministic note lifecycle with sustain, velocity, polyphony, release, cleanup, and failure handling.
- Piano controls that claim sonic behavior measurably change rendered audio.
- Every required representative effect processes real audio, supports bypass, and changes the rendered signal.
- One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- The Phase 1 surface, exact keybed, and basic interaction remain regression-free.

Shared completion gates (verbatim from the manifest):

- All benchmark-owned and candidate-authored tests pass.
- The browser console contains no errors during the required interaction pass.
- Every claimed audio feature is connected to the audible signal graph.
- The latest phase preserves all inherited tests, visual evidence, and behavior.
- IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
- The evaluated source, build, and evidence match the sealed verification digest.

## Piano source / provenance plan

All recorded material is obtained exclusively through the npm registry (the only permitted network source), copied into `public/samples/` so the built app plays fully offline, and declared in `IMPLEMENTATION_DETAILS.json` and `public/samples/SOURCES.md`:

1. **Grand — "Salamander Grand"**: Salamander Grand Piano V3 (Yamaha C5, recorded by Alexander Holm; source archive.org/details/SalamanderGrandPianoV3; license **CC BY 3.0**), via npm packages `@audio-samples/piano-mp3-velocity4/-velocity8/-velocity13`. 30 root notes (A/C/D♯/F♯ per octave, A0–C8) × **3 recorded velocity layers** (Salamander layers 4, 8, 13 of 16) = 90 mp3 files.
2. **Upright — "Tack Upright"**: GM Honky-tonk piano program (detuned tack-upright character) rendered note-per-note from the MIDI-JS Soundfonts collection (gleitz, **MIT**; collection rendered from the FluidR3_GM/MusyngKite/FatBoy banks — the packaging does not identify the exact bank and this is declared honestly), via npm package `web-music-score-samples` folder `003-honkytonk-piano`. 19 root notes (C/E/A♭ per octave) × 1 recorded velocity layer.
3. **Electric — "Tine EP"**: GM Electric Piano 1 (tine/electromechanical character) from the same MIDI-JS Soundfonts collection via `web-music-score-samples` folder `004-electric-piano-1`. 19 root notes × 1 recorded velocity layer.

Velocity handling is truthful: the Grand crossfades three recorded layers; the Upright/EP have one recorded layer and shape velocity with gain plus a velocity-keyed lowpass (declared as such). A synthesized oscillator voice (the Phase 1 voice) remains available **only** as a labeled fallback after primary sample failure and is never presented as recorded material. Reverb impulse responses, the optional pedal-noise thump, and all effect processing are generated/live DSP and are declared as generated, never as samples.

## Signal graph (one AudioContext, one destination)

```
keys/MIDI ─ InstrumentController ─ engine.noteOn/off (per enabled Piano layer A/B)
  Voice: AudioBufferSourceNode(nearest root, playbackRate shift, unison copies)
         → per-voice gain envelope (velocity, release, sustain/sostenuto/soft)
  ↓
Layer bus A/B: voice sum → timbre EQ → dyn-comp → layer level gain
  → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb   (ordered chain per layer)
  → [Amp/EQ type "To Rotary"?] → Rotary Speaker (single instance, last) ─┐
  → otherwise ───────────────────────────────────────────────────────────┤
                                                              master gain (Master Level knob)
                                                              → limiter (DynamicsCompressor)
                                                              → analyser tap → destination
String-resonance send: layer voice bus → resonance convolver → back into that layer chain (String Res on + pedal down).
```

- Delay feedback filtering/effects live **inside the feedback loop** (repeats only, never the dry path).
- Reverb precedes Rotary. Rotary is one instance per program, last in the path.
- Every gain/frequency change uses short ramps (`setTargetAtTime`/linear ramps) — click-free bypass by dry/wet crossfade.
- Engines/effects never create a second context or a parallel destination; a shared analyser before the destination powers browser verification.

## Control-to-state/audio mapping

Canonical state lives in a new `InstrumentStore` (`src/state/instrument.ts`); the panel writes through the existing panel-store front door, which forwards **bound** control IDs to canonical actions and keeps everything else presentation-only (still-decorative Organ/Synth/Program controls). The engine subscribes to the store and applies changes to the live graph.

| Control (id) | Canonical state | Audible effect |
| --- | --- | --- |
| `piano-layer-a/b`, `piano-level-a/b` | layer enable, level | voices routed/attenuated per layer |
| `piano-on` | piano section on | section mute |
| `piano-type`, `piano-model` | per-layer type/model selection (Grand/Upright/Electric populated; Clav/Digital/Misc truthfully "Piano not found") | instrument sample-set switch, loading/ready/error/fallback feedback on Program OLED + type LEDs |
| `piano-kb-touch` | touch curve Heavy/Mid/Light | velocity mapping |
| `piano-dyn-comp` | dynamic compression 0–3 | per-layer compressor |
| `piano-timbre` | timbre step (acoustic Soft/Mid/Bright; electric adds Dyno 1/2) | per-layer EQ voicing |
| `piano-unison` | unison 0–3 | detuned, panned extra sample voices |
| `piano-acoustics` | Soft Release / String Res / Ped Noise toggles | release length, pedal-down resonance send, pedal thump |
| `piano-octave-down/up` | per-layer octave shift ±1 | sample pitch selection |
| `fx-focus-piano` | FX focus Piano A/B (follows layer focus; Group mode shares chains) | which chain the effect knobs edit |
| `all-fx-off` | all-effects bypass | full chain bypass, click-free |
| `mod1-*`, `mod2-*` | type/rate/amount/on per chain | LFO pan/tremolo/ring-mod/wah…, phaser/flanger/chorus… |
| `delay-*` (incl. new `delay-filter`) | tempo/feedback/mix/on, feedback filter Off/LP/HP/BP, feedback effect, analog, tap tempo, global | real delay loop |
| `amp-*`/`eq-*` | type (Neutral/Twin/JC/Small/LP24/HP24/To Rotary), drive, bass/mid/treble, mid-freq | waveshaper drive + 3-band EQ / resonant 24 dB filters / rotary routing |
| `comp-amount`, `comp-on` | amount/fast/global | DynamicsCompressor |
| `reverb-*` | type (six), dry/wet, bright/dark, global | convolver with generated IRs (declared generated) |
| `rotary-speed`, `rotary-stop-mode`, `rotary-drive` | slow/fast/stop, drive | rotor/horn LFO rates with acceleration, drive shaper |
| `perf-master-level` | master volume | master gain |
| `perf-pitch-stick` | pitch bend ±2 semitones (piano spec architecture) | live playbackRate bend |
| `panic` | panic | immediate all-notes-off + pedal reset |

Pedals: MIDI CC64 (continuous: full + half-pedal), CC66 sostenuto, CC67 soft; computer-keyboard Space = sustain, KeyZ = soft, KeyX = sostenuto. All feed the single note lifecycle; SUSTPED LED and status strip reflect pedal state truthfully.

Still decorative (truthfully, Phase 3 scope): all Organ-section controls, all Synth-section controls, Program/Morph controls except Panic, mod wheel, rotary organ-source/morph buttons, Solo/Store/Live/etc. The status strip says exactly which families are functional.

## Test plan

Deterministic unit/state tests keep using injectable fakes; **real rendered-audio tests** run in `pnpm test` through `node-web-audio-api` (real OfflineAudioContext rendering in Node, no network/devices/output), reading the bundled sample files from `public/samples/`. Feature-matrix mapping:

| Feature ID | Test files |
| --- | --- |
| piano.instrument-library | `src/audio/library.test.ts`, `src/audio/render-library.test.ts` |
| piano.layers | `src/audio/layers.test.ts` |
| piano.velocity-controls | `src/audio/piano-controls.test.ts`, `src/audio/render-piano-controls.test.ts` |
| piano.pedals | `src/audio/pedals.test.ts` |
| piano.fallback | `src/audio/fallback.test.ts` |
| effects.graph | `src/audio/graph.test.ts` |
| effects.routing | `src/audio/effects-routing.test.ts` |
| effects.processing | `src/audio/render-effects.test.ts` |
| regression.phase1 | all inherited Phase 1 test files (kept and green) |

Inherited Phase 1 tests are preserved; where Phase 1 asserted "every control is decorative", the same files now assert the truthful Phase 2 split (functional Piano/effects/master/Panic vs still-decorative Organ/Synth/Program) without weakening any Phase 1 behavior check.

## Build order

1. This plan. 2. Bundle samples + provenance. 3. Extend injectable audio boundaries/fakes (buffer sources, delay, waveshaper, convolver, panner, decode). 4. Canonical `InstrumentStore` + hardware-model functional flags. 5. Engine refactor to layer/bus/master architecture (identical input behavior). 6. Sample library, selection, loading/fallback, pedals, piano performance controls. 7. Effect units + routing + rotary in documented order. 8. Panel binding + LEDs + OLED feedback. 9. Offline rendered-audio test suite; all four pnpm gates. 10. Browser interaction pass (all pianos, layers, every input, rapid notes, pedals, focus/bypass/params, asset failure, Panic), visual comparison against Phase 1 evidence at 1440×900 and 390×844, `evidence/stage2-visual-audit.md`, truthful `IMPLEMENTATION_DETAILS.json` + `tests/feature-matrix.json`.

---

# Phase 1 implementation plan — Nord Stage 4, variant `stage-4-73` (inherited, unchanged)

Assigned variant: **stage-4-73** (Nord Stage 4 73, hammer action, 73 keys E–E).
Assigned specs: `specs/nord-stage-4.visual.json` (v1.1.0) and `specs/nord-stage-4.piano.json` (v1.0.0).
Reference image: `inputs/reference/nord-stage-4-73.jpg` (11600×3866). Manual: `inputs/reference/manual.pdf` (edition N, OS 1.6x); Piano chapter pages 23–26 read.

## Hard gates (verbatim from `specs/benchmark-phases.json`, phase 1)

1. The selected variant's exact keybed count and range are modeled and playable.
   - For stage-4-73: 73 keys, E to E (MIDI 28–100), 43 white / 30 black, hammer action styling.
2. The complete visible control surface is present; Program and Synth are the only primary OLED locations.
3. The red chassis is continuous and the measured section geometry matches the assigned reference.
4. One basic Piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain input, polyphony, and cleanup.
5. All visible panel knobs, buttons, wheels, faders, encoders, and drawbars move or press but are truthfully non-functional and do not alter audio.
6. Two measured desktop comparison-and-repair passes and one narrow capture are complete.

Shared completion gates (verbatim from the manifest):

- All benchmark-owned and candidate-authored tests pass.
- The browser console contains no errors during the required interaction pass.
- Every claimed audio feature is connected to the audible signal graph.
- The latest phase preserves all inherited tests, visual evidence, and behavior.
- IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
- The evaluated source, build, and evidence match the sealed verification digest.

## Measured bounds and ratios (from variant registry + reference)

- Source canvas 11600×3866; instrument bounds x=1292 y=410 w=9013 h=2912; **aspect ratio 3.0951** (w/h).
- Vertical allocation: control deck incl. top rail **0.54**, keybed incl. bottom rail **0.46** (tolerance 0.025).
- Horizontal sections (order and fraction of deck width): performance 0.13, organ 0.21, piano 0.15, program 0.09, synth 0.21, effects 0.21.
- Desktop 1440×900: instrument width 88–97% of viewport (target ≈94% → ~1354×437 px), no vertical scroll.
- Narrow 390×844: whole instrument scaled to fit width; nothing clipped.
- Reference colors: chassis #79232c/#721f29, panel blue-gray #3c424d, key black #0b0b0b, key white #dcdcdc.
- Black key height fraction of white key: 0.61.

## Section inventory (landmarks from reference photo crops + visual spec)

- **Performance (13%, exposed red, no OLED):** Master Level knob, wooden pitch stick, chrome mod wheel, "nord stage 4" + "HAMMER ACTION 73" branding. Rotary Speaker strip (Drive knob w/ ON LED, Organ/Close Mic button, Stop Mode/Angle button, Slow–Fast speed button + LEDs, Morph button) sits at the performance/organ boundary.
- **Organ (21%, dark inset plate, no OLED):** section ON + FX Focus LED + Solo; two layer faders w/ green LED ladders; A/B layer On/Off buttons w/ SUSTPED/PSTICK LEDs; Organ Model button w/ six model LEDs (B3, Vox, Farf, Pipe 1, Pipe 2, B3 Bass); Vib/Chorus select + On buttons (C1–C3/V1–V3 LEDs); B3 Percussion Volume Soft / Decay Fast / Harmonic Third / On buttons; Preset/Sync button; Octave Shift pair; KB Zone LEDs; **nine physical drawbars** with red LED ladders and footage legends 16′, 5⅓′, 8′, 4′, 2⅔′, 2′, 1⅗′, 1⅓′, 1′.
- **Piano (15%, dark inset plate, no OLED):** section ON + FX Focus + Solo; two layer faders w/ ladders; A/B On/Off buttons; Acoustics button (Soft Rel / String Res / Ped Noise LEDs); Unison button (1–3); KB Touch button (Heavy/Med/Light); Dyn Comp button (1–3); Timbre rocker (Soft/Mid/Bright, Dyno 1/2); Piano Select box: six type LEDs (Grand, Upright, Electric, Clav, Digital, Misc), type button, Info button, Model dial (List); Octave Shift pair; KB Zone LEDs.
- **Program/Morph (9%, red surface, PRIMARY OLED #1):** Morph Assign Wheel / A.T. / Ctrl Ped buttons (+ Clear Morph); Split On/Set (+ Set Key); Mst Clk Tap/Set; Transpose On/Set; Panic (decorative this phase); Prog View / Preset Name; red Store + Store As buttons; Preset Library Organ/Piano/Synth buttons; program OLED; large Program encoder w/ List; Page/Cat ‹ › buttons (Bank); Live Mode button; Num Pad legend; Layer Scene II button; eight numbered Program buttons (secondary legends System/Sound/Organize/Aux KB/Output/Pedal/MIDI/Extern); Solo/Undo, Section Edit, Layer Init, Mon|Copy/Paste buttons; Shift/Exit rocker. Note: visual spec says "five live-program buttons"; the reference photo and manual show eight numbered Program/Live buttons plus a Live Mode button — the reference/manual wins, documented in the visual audit.
- **Synth (21%, dark inset plate, PRIMARY OLED #2):** section ON + FX Focus + Solo; synth OLED; three soft encoders under the display (Info/List/List); Mode button (Samples/Analog/Extern LEDs); Arpeggiator/Gate group (Rate/Time knob + Mst Clk, Poly/Arp/Gate mode button, Range knob, Menu button); Voice group (Mono/Legato button, Glide knob); Vibrato group (mode button, Menu button); Waveform/Keep Edits button; Sound Init button; LFO group (Waveform button, Rate/Time knob, Mod Amt knob); Oscillators group (Pitch/Smp button, Envelope button, Osc Ctrl knob, Env Amt knob); Filter group (Type button, Envelope button, Freq knob, Res/Freq HP knob, Env Amt knob, Filter On button); Amp Envelope button; Unison button; three layer faders (A/B/C) w/ ladders and On/Off buttons; KB Hold and Arp Run buttons; Octave Shift pair; KB Zone LEDs.
- **Layer Effects (21%, dark inset plate, no OLED):** section ON; FX Focus column (Organ A/B, Piano A/B, Synth A/B/C LEDs; All FX Off button; two Group buttons); Mod 1 (Rate + Amount knobs, variation button, On button); Mod 2 (Rate + Amount knobs, variation button, On button); Amp Sim/EQ (Drive, Freq, Bass, Mid, Treble knobs, variation button, On button); Delay (Tempo knob, variation button, Feedback knob, Tap/Set button, Analog button, Dry/Wet knob, On button); Comp (Amount knob, On button); Reverb (Bright/Dark button, variation button, Dry/Wet knob, On button).

Forbidden landmarks honored: no OLED anywhere except Program + Synth; no wide displays; no drawbars outside Organ; no marketing hero, no reference-image overlay, no detached frame.

## Key model

- 73 keys, MIDI 28 (E1) … 100 (E7); 43 white, 30 black; standard C-octave black-key placement pattern, E–E span.
- White key width = keybed width / 43; black key width ≈ 0.57 × white; black key height = 0.61 × white key height; per-class horizontal offsets (C#/D#/F#/G#/A#) match a real keybed.
- Keys are buttons with stable IDs `key-<midi>` and accessible names like "E1"…"E7"; visible depression on press; pointer/touch/keyboard/MIDI all drive the same note lifecycle.

## Audio source plan

- One basic Piano-like voice implemented as **honestly-declared live oscillator synthesis** (no recorded samples in Phase 1): per note, detuned triangle/sine partial stack → per-voice lowpass (velocity- and pitch-keyed cutoff) → per-voice gain envelope (fast attack, exponential decay, release) → master gain → soft limiter (DynamicsCompressor when available) → destination.
- Injectable `AudioBoundary` (context factory) and timer boundary; deterministic unit tests use fakes; real browser check uses the actual Web Audio graph.
- Lifecycle: lazy context start on first input gesture; statuses `idle → loading → ready | fallback | error` (fallback = minimal gain-only graph when the preferred graph fails); truthful status strip below the instrument (not a panel control).
- Polyphony cap 24 voices, deterministic oldest-first stealing; retrigger quick-releases the prior voice of the same note; sustain (from keybed input boundary: MIDI CC64 or held space key) defers releases; all-notes-off on blur/MIDI-disconnect/unmount only (Panic panel button stays decorative).

## Decorative interaction contract

Every visible panel control: stable ID, accessible name/role/value, pointer + keyboard operation, visible movement (knob rotation, fader/drawbar travel, button LED/latch, springy wheel/stick). All state lives in a presentation-only store; nothing routes to the audio engine or fakes system behavior. Tests assert engine isolation.

## Test mapping (feature matrix)

| Feature ID | Test files |
| --- | --- |
| visual.key-count | `src/model/keys.test.ts`, `src/components/keybed.test.tsx` |
| visual.section-layout | `src/components/surface.test.tsx` |
| visual.control-inventory | `src/model/hardware.test.ts`, `src/components/surface.test.tsx` |
| interaction.keys | `src/components/keybed.test.tsx` |
| interaction.decorative-controls | `src/components/decorative-controls.test.tsx` |
| accessibility.controls | `src/components/accessibility.test.tsx` |
| regression.chassis | `src/components/chassis.test.tsx` |
| piano.basic-note-lifecycle | `src/audio/note-lifecycle.test.ts` |
| piano.basic-inputs | `src/input/inputs.test.tsx`, `src/input/midi.test.ts` |
| piano.basic-sustain-polyphony | `src/audio/sustain-polyphony.test.ts` |
| piano.basic-status-cleanup | `src/audio/status-cleanup.test.ts` |

Inherited starter test `src/App.test.tsx` is kept as a file and updated to assert the replaced surface renders (the starter file itself instructs replacement; no benchmark feature test is deleted).

## Build order

1. This plan. 2. Typed key + hardware models. 3. Chassis/sections/keybed. 4. Section controls + decorative interaction. 5. Injectable audio/MIDI/timing boundaries + note lifecycle. 6. Basic piano voice, sustain/polyphony/cleanup, status. 7. Tests green (`pnpm test`, `typecheck`, `lint`, `build`), real-browser interaction pass, two desktop visual repair passes + narrow check, `evidence/stage1-visual-audit.md`, truthful `IMPLEMENTATION_DETAILS.json` and `tests/feature-matrix.json`.
