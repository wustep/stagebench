# Nord Stage 4 73 — Phase 1 Implementation Plan

## Scope & Reference Authority

This plan covers **Phase 1 (Complete surface and basic piano)** for the assigned hardware variant **Nord Stage 4 73** (`stage-4-73`, 73-key hammer-action keybed E1–E7, 43 white / 30 black keys, aspect ratio 3.0951).

Assigned specs:
- `inputs/specs/nord-stage-4.visual.json` (`nord-stage-4.visual.json`)
- `inputs/specs/nord-stage-4.piano.json` (`nord-stage-4.piano.json`)
- Variant geometry: `inputs/specs/nord-stage-4.variants.json` (`nord-stage-4.variants.json`)
- Product photo authority: `inputs/reference/nord-stage-4-73.jpg`

Note on horizontal section fractions: `nord-stage-4.visual.json` (v1.5.0, photo-measured against `nord-stage-4-73.jpg`) specifies Performance 14%, Organ 20%, Piano 8.5%, Program/Morph 12.5%, Synth 25%, and Layer Effects 20% (summing to 100%). Those photo-measured fractions take precedence over earlier coarse approximations.

## Phase 1 hard gates

- [ ] The exact keybed count and range for the assigned variant are modeled and playable.
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`

## Architecture

### 1. Normalized Hardware Model (`src/model/`)
- `src/model/variant.ts`: Exact Stage 4 73 keybed geometry (MIDI 28 E1 through MIDI 100 E7, 73 keys: 43 white, 30 black, `blackKeyHeightFraction = 0.61`), white/black placement math, computer-keyboard note map, and horizontal/vertical deck proportions.
- `src/model/controls.ts`: Typed, normalized inventory of every visible physical control across all six sections (`performance`, `organ`, `piano`, `program`, `synth`, `effects`) with stable IDs, accessible names, roles (`button`, `slider`, `switch`), value ranges, default presentation positions matching the product photo, and LED indicators.
- `src/model/hardwareState.ts`: Pure reducer/store holding presentation-only control positions/toggles (knobs, encoders, faders, drawbars, wheels, buttons). Updating a panel control updates only presentation state — never audio parameters, program state, or fake engine displays.

### 2. Audio, MIDI, Timing & Note Lifecycle (`src/audio/`)
- `src/audio/boundaries.ts`: Injectable interfaces for Web Audio (`AudioEngineContext`), Web MIDI (`MidiAccessProvider`), sample fetching (`SampleFetcher`), and timing (`Clock`).
- `src/audio/pianoSamples.ts`: Manifest and loader for the bundled recorded grand piano sample set (cut from `inputs/samples/grand/salamander-grand-v3/` — 25 minor-third root notes from D#1 to F#7 across 3 dynamic layers `v3`, `v10`, `v16`, trimmed for tight attack latency, faded cleanly, encoded in Ogg Vorbis). All files declared in `IMPLEMENTATION_DETAILS.json`.
- `src/audio/noteLifecycle.ts`: Deterministic note lifecycle engine handling note on/off, per-source key tracking (pointer IDs, touch IDs, computer keyboard keys, MIDI channel notes), repeat suppression, sustain pedal (CC64 + keyboard Space + dedicated sustain status), polyphony cap with deterministic oldest-released / oldest-held voice stealing, per-note release, and all-notes-off cleanup on blur/disconnect/unmount.
- `src/audio/pianoVoice.ts`: Playable Grand Piano voice supporting decoded Salamander Grand multi-sample playback (nearest root note with exact equal-temperament playbackRate, velocity layer selection + smooth velocity-to-gain curve, zero-click attack/release envelopes, master soft-limiter to prevent clipping on 10+ note chords) and an automatic, truthfully labeled synthesized harmonic-piano fallback if sample loading or decoding fails or is still in flight.
- `src/audio/midiController.ts`: Automatic Web MIDI initialization on load (and retry on first user gesture), listening to all connected inputs for Note On (0x90), Note Off (0x80), Note On vel=0, CC64 sustain, and CC120/123 All Sound/Notes Off, with truthful status reporting (`unsupported`, `denied`, `ready`, `disconnected`) and safe cleanup on device disconnect.

### 3. Visual Surface & Accessible Controls (`src/components/`)
- Continuous red brushed-metal chassis (`#851a25`..`#5a0c13`) with left/right grained dark-red wood cheeks, top rear-jack legend strip, and 54/46 vertical deck/keybed ratio at 3.0951 overall aspect ratio.
- Six ordered sections in one continuous horizontal deck:
  1. **Performance (14%)**: Exposed red chassis, wooden pitch stick, ribbed metal mod wheel, `nord stage 4 / HAMMER ACTION 73` branding, Master Level knob, Rotary Speaker block.
  2. **Organ (20%)**: Dark inset plate (`#3c424d`) with light slate header, A/B faders with green LED ladders, Organ Model / Vib-Chorus / B3 Percussion groups, 9 physical drawbars (B-B-W-W-B-W-B-B-W) with 9 red 8-segment LED ladders.
  3. **Piano (8.5%)**: Dark inset plate, A/B faders with green LED ladders, Timbre, Acoustics, Unison, KB Touch, Dyn Comp, Piano Select 6-LED matrix + Model dial.
  4. **Program & Morph (12.5%)**: Red/dark central band, Morph Assign (Wheel/A.T./CtrlPed), Split, Master Clock, Transpose, Store, Preset Library, Program Dial, Page/Cat, **Primary Program OLED** (truthfully displaying Phase 1 basic grand status), Solo/Edit/Copy rail, Live Mode, Layer Scene II, 8 Program buttons (1–8), Shift/Exit.
  5. **Synth (25%)**: Dark inset plate, A/B/C faders with green LED ladders, KB Hold / Arp Run, **Single narrow Synth OLED** (<30% section width, truthfully reporting decorative Phase 1 state), 3 OLED encoders, Mode, Arpeggiator/Gate, Voice, Vibrato, and distinct light-slate LFO / Oscillators / Filter / Amp / Unison sub-modules.
  6. **Layer Effects (20%)**: Left FX Focus strip + dark inset plate split by a clear vertical divider into Group 1 (`MOD 1`, `MOD 2`, `AMP SIM/EQ`) and Group 2 (`DELAY`, `COMP`, `REVERB`).
- Interactive 73-key E1–E7 hammer-action keybed with pointer/multi-touch capture, glissando/independent touch support, keyboard accessibility, and pressed visual feedback.
- Compact, unobtrusive product-study status/credits strip below the instrument (never a marketing hero above it) displaying truthful audio engine status (`loading`/`ready`/`fallback`/`error`), MIDI status, sustain indicator, keyboard shortcut legend, and CC-BY-3.0 sample attribution modal/disclosure.
- Responsive presentation: fills 88–97% viewport width at 1440x900 with zero vertical scroll; cleanly inspectable at 390x844 via horizontal scroll container without clipping or broken aspect ratio.

### 4. Verification & Evidence
- `tests/feature-matrix.json`: Maps all 11 Phase 1 required feature IDs to Vitest suites covering geometry, control inventory, key interaction, decorative controls, accessibility, note lifecycle, multi-input/MIDI, sustain/polyphony, status/cleanup, audible DSP output, and responsive chassis checks.
- Canonical captures via `node ../inputs/harness/capture-evidence.mjs --phase 1` producing `evidence/stage1-desktop.png`, `evidence/stage1-narrow.png`, and `evidence/stage1-capture.json`, plus `evidence/stage1-visual-audit.md`.
- Four package gates verified cleanly: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
