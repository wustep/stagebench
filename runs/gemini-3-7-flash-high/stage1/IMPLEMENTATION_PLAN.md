# Stagebench Phase 1 Implementation Plan

## Assigned Specifications
- `specs/nord-stage-4.visual.json` (version 1.2.0)
- `specs/nord-stage-4.piano.json` (version 2.0.0)
- Variant: `stage-4-73` (Nord Stage 4 73, hammer action, 73 keys, E1 to E7 / MIDI 28–100, 43 white, 30 black, 54/46 deck/keybed vertical allocation)

## Hard Gates Checklist
- [ ] The exact keybed count and range for the assigned variant are modeled and playable.
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Architectural Design

### 1. Hardware Model & Physical State (`src/model/`)
- Normalized types for all hardware elements:
  - Sections: `performance`, `organ`, `piano`, `program`, `synth`, `effects`
  - Controls: Knobs, Encoders, Buttons with LEDs, Sliders / Drawbars with LED ladders, Pitch Stick, Mod Wheel
  - OLED Displays:
    * Program Section OLED (128x64 px graphic display showing Program Name, bank/slot, model feedback)
    * Synth Section OLED (128x64 px graphic display showing Synth engine / oscillator / filter feedback)
    * Forbidden elsewhere (Performance, Organ, Piano, Effects have NO primary OLED displays).
  - Control IDs: Stable canonical IDs for every physical control on the Nord Stage 4 73 panel.
  - Keybed Model: 73 keys from E1 (MIDI 28) to E7 (MIDI 100).
    * White keys: 43 keys.
    * Black keys: 30 keys.
    * Black key height fraction: 0.61.

### 2. Audio Engine (`src/audio/`)
- Web Audio API acoustic piano synthesis voice:
  - Additive harmonic partials with velocity-sensitive hammer strike transient, frequency dispersion, multi-exponential envelope decays (attack, hammer pop, prompt decay, sustain plateau, damping release).
  - Velocity scaling: non-linear hammer velocity mapping adjusting fundamental energy, high harmonic brilliance, and attack steepness.
  - Sustain pedal resonance & damper model: sustain holding holds open strings with extended release; damper-down creates realistic felt damping release (0.15s–0.35s depending on register).
  - Polyphony manager: Deterministic voice management (32 voices) with voice stealing (steals oldest un-sustained voice, or oldest released voice, or lowest amplitude).
  - Clean lifecycle: Note on, note off, all notes off, node disconnection, audio context suspend/close on unmount.
  - Injectable AudioContext and Clock boundaries for deterministic headless testing.

### 3. Input & Interaction (`src/input/`)
- Shared deterministic Note Lifecycle Manager:
  - Pointer & independent Multi-Touch: pointerdown/pointerup/pointercancel/pointerleave/touch tracking on keybed.
  - Computer Keyboard: mapped keys (e.g. `zxcvbnm...` for lower octave, `qwertyui...` for upper octave), repeat event suppression (`event.repeat`), window blur cleanup.
  - Web MIDI Access:
    * Real & Mockable MIDI input handlers.
    * MIDI Note On (with velocity 1–127), Note Off (velocity 0 or 8x), CC64 Sustain Pedal (val >= 64 is down, < 64 is up).
    * Graceful handling of granted, denied, and disconnected MIDI states.
  - Sustain control: UI sustain toggle / pedal button, keyboard mapping (Space bar), MIDI CC64.
  - Cleanup: Window blur, visibility change, MIDI disconnect, and component unmount trigger `allNotesOff()`.

### 4. Visual Presentation & Accessibility (`src/components/`, `src/styles.css`)
- Continuous Nord red metal chassis (`#851a25` mid, `#5a0c13` dark) with dark inset panels (`#3c424d`).
- Exact vertical ratio: 54% control deck / 46% keybed.
- Section layout: Performance (14%), Organ (20%), Piano (8.5%), Program (12.5%), Synth (25%), Layer Effects (20%).
- Dense landmark representation:
  - Performance: Nord branding, Master Level knob, Pitch Stick, Modulation Wheel.
  - Organ: 9 physical drawbars with LED bar ladders, Preset buttons, Percussion switches, Rotary controls.
  - Piano: A/B Layer faders with LED bars, Type buttons & LEDs (Grand, Upright, Electric, Clav, Digital, Misc), Model dial, KB Touch, Timbre, Dyn Comp, Soft Release, String Res.
  - Program: Central 128x64 OLED display, large program dial, 1–8 program buttons, Page buttons, Live Mode, Layer Scene, Morph buttons.
  - Synth: Synth 128x64 OLED display, Layer level faders, Oscillator type/mod, Filter controls, Envelope controls, LFO / Arp.
  - Effects: Effect 1 (Pan, Trem, RM, Wah), Effect 2 (Phaser, Flanger, Chorus, Vibe), Delay, Amp Sim/EQ, Compressor, Reverb, Layer focus selectors.
- Complete Accessibility:
  - `role="button"`, `role="slider"`, `role="switch"`, `role="region"`.
  - `aria-label`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-pressed`.
  - Full keyboard accessibility (Tab focus, Enter/Space for buttons, Arrow keys for knobs/sliders/drawbars).
  - High-visibility focus indicators (`:focus-visible`).
- Responsive presentation:
  - Desktop 1440x900: Instrument occupies ~92% of viewport width without vertical scroll.
  - Narrow 390x844: Instrument scales and stays inspectable without clipping.

### 5. Verification, Evidence & Gates
- Maintain `tests/feature-matrix.json` with all 11 Phase 1 feature IDs mapped to test suites.
- Complete unit and audio tests in `src/`.
- Update `IMPLEMENTATION_DETAILS.json` with truthful declarations.
- Generate `candidate/evidence/stage1-visual-audit.md`.
- Verify all 4 gates pass: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
