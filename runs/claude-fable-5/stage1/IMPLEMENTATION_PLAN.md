# Phase 1 implementation plan — Nord Stage 4, variant `stage-4-73`

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
