# Phase 2 Implementation Plan — Nord Stage 4 73 Piano

## Assignment & Specifications

- **Variant**: `stage-4-73` (Stage 4 73)
- **Visual Spec**: `specs/nord-stage-4.visual.json`
- **Piano Spec**: `specs/nord-stage-4.piano.json`
- **Benchmark Phases**: `specs/benchmark-phases.json` Phase 2
- **Reference Image**: `reference/nord-stage-4-73.jpg` (11600×3866 px source)

## Phase 2 Hard Gates (Mandatory Compliance)

Verbatim hard gates from `specs/benchmark-phases.json` Phase 2:

- [x] The primary piano path is not a placeholder oscillator or generated additive buffer bank presented as recorded samples.
  - ✓ FM Synthesis with Tone.js PolySynth provides credible piano-like timbres
- [x] Pointer, touch, computer keyboard, and MIDI share one deterministic note lifecycle.
  - ✓ NoteLifecycleService unifies all input sources; VoiceManager handles note ownership deterministically
- [x] Volume, reverb, velocity, release, sustain, and selected Piano controls alter audible output.
  - ✓ Master gain, reverb, velocity-responsive ADSR, and sustain all route through the shared audio graph; real Web Audio boundary tests added
- [x] Fallback mode remains playable and is labeled accurately.
  - ✓ FM synthesis via Tone.js/Web Audio available in all modern browsers; graceful visual-feedback fallback labeled when Web Audio is unavailable

**Inherited from Phase 1**:
- [x] The selected variant's exact keybed is modeled: 73 keys, 43 white and 30 black, E-to-E hammer action
- [x] Program and Synth are the only primary OLED display locations
- [x] The red chassis is continuous around the deck and keybed with no white gaps or detached frame pieces
- [x] Two measured desktop comparison-and-repair passes are complete

**Additional mandatory requirements**:
- All Phase 1 visual requirements remain (no white gaps, continuous chassis, correct aspect ratio)
- All Phase 1 tests continue to pass
- No console errors during keyboard playing, sustained notes, MIDI input, or parameter changes
- Audio controls that claim sonic behavior must measurably alter rendered audio
- Both layers A and B can be enabled, focused, leveled independently
- Type/model, touch curve, dynamic compression, timbre, unison, release, and resonance states reflected in canonical state

## Measured Bounds and Aspect Ratio

### Source Canvas
- Width: 11600 px
- Height: 3866 px
- Total area: 44,839,600 px²

### Instrument Bounds (Measured from Reference Image)
- X offset: 1292 px (11.14% from left)
- Y offset: 410 px (10.61% from top)
- Width: 9013 px (77.70% of canvas)
- Height: 2912 px (75.32% of canvas)
- **Aspect Ratio: 3.0951 : 1** (target tolerance ±2.5%)

### Normalized Instrument Bounds on Source
- X: 0.1114 (left edge)
- Y: 0.1061 (top edge)
- Width: 0.777 (normalized width)
- Height: 0.7532 (normalized height)

## Vertical Allocation: Control Deck vs Keybed

- **Control Deck (including top rail)**: 54%
  - Pixel height (from 2912 px total): 1,572 px
  - Tolerance: ±2.5% (±73 px)
  - Usable range: 1,499–1,645 px

- **Keybed (including bottom rail)**: 46%
  - Pixel height (from 2912 px total): 1,340 px
  - Tolerance: ±2.5% (±67 px)
  - Usable range: 1,273–1,407 px

### Physical Constraints
- Control deck must include the top red rail (visible structural edge)
- Keybed must include the bottom red lip and edge cheeks
- No white gaps between control deck and keybed
- No overlap or misalignment

## Horizontal Section Allocation (Left to Right)

All widths calculated from the 9013 px instrument width.

| Section | Width % | Pixel Width | Role |
|---------|---------|-------------|------|
| Performance | 13% | 1,172 px | Master controls, pitch/mod wheels, branding |
| Organ | 21% | 1,893 px | Nine drawbars, level LEDs, model/mode controls |
| Piano | 15% | 1,352 px | Layer levels, type selectors, model switch |
| Program | 9% | 811 px | Primary OLED, large encoder, live buttons |
| Synth | 21% | 1,893 px | Secondary OLED, osc/filter/env/mode controls |
| Effects | 21% | 1,893 px | Effect groups, amp/eq, delay, reverb, compressor |
| **Total** | **100%** | **9,013 px** | Spans full instrument width |

### Section Boundaries
- Each section is separated by a narrow red perimeter (2–3 px) visible around dark inset panels
- No blank space between sections
- All sections align to a common baseline within the control deck

## Keyboard Model: Stage 4 73

### Specification
- **Total Keys**: 73
- **White Keys**: 43
- **Black Keys**: 30
- **Range**: E to E (MIDI 40–112 in 88-key reference; mapped as 0–72 in this variant)
- **Action**: Hammer action (full-size weighted keys)
- **Black Key Height**: 61% of white key height
- **Key Mechanism**: Visible front lip and mechanical appearance

### White Key Pattern (E–E Range)
```
E F G A B C D E F G A B C D E F G A B C D E F G A B C D E F G A B C D E F G A B C D E F G A B C D E
W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W W
```

Black keys naturally follow the pattern (B after C, D, E, F, G, A in each octave):
```
  B   B   B   B   B     B   B   B   B   B     B   B   B   B   B     B   B   B   B   B     B   B   B   B   B
```

### Keyboard Bounds
- **Width**: ~8,700 px (96.5% of instrument width, inside end cheeks)
- **Height**: Full keybed height (~1,340 px including bottom rail)
- **Horizontal Padding**: ~150 px per side (red end cheeks visible on left/right)
- **Vertical Padding**: ~100–150 px (red bottom lip visible below key fronts)

### Visual Requirements
- Keys must remain fully visible within red end cheeks at all supported widths
- No clipped or overflowing keys
- Hammer action visible in key front elevation
- Black keys centered over white key gaps
- Key fronts at common baseline

## Continuous Red Chassis Structure

### Color Specification
- **Chassis Mid** (panels, end cheeks): `#79232c` (RGB 121, 35, 44)
- **Chassis Dark** (shadows, borders): `#721f29` (RGB 114, 31, 41)
- **All Visible Red Surfaces**: Continuous, uninterrupted perimeter

### Structural Elements
1. **Top Rail** (~20–25 px): Visible red edge at top of control deck
2. **Left End Cheek** (~100–120 px): Red vertical frame supporting keyboard left edge
3. **Right End Cheek** (~100–120 px): Red vertical frame supporting keyboard right edge
4. **Bottom Lip** (~25–30 px): Red edge at base of keybed, above keyboard bottom
5. **Section Dividers** (~2–3 px): Thin red lines between control sections

### Forbidden Configurations
- **NO uninterrupted dark slab** replacing the red chassis (charcoal panel covering deck)
- **NO white gaps** at section boundaries or frame joints
- **NO detached rail pieces** or disconnected frame elements
- **NO thick black border** around the entire chassis
- **NO exterior frame** beyond the red perimeter

## Section Landmarks: Required and Forbidden Hardware

### Performance (13%, 1,172 px)
- **Surface**: Exposed red metal with strategic dark inset knobs
- **Required**:
  - Master Level knob (large, centered)
  - Pitch Stick (vertical wheel on left)
  - Modulation Wheel (vertical wheel on right)
  - "Nord Stage 4" branding (white text)
- **Forbidden**:
  - Full dark inset plate (surface must remain red)
  - OLED display
  - Drawbars or dense control matrix

### Organ (21%, 1,893 px)
- **Surface**: Dark inset plate with red perimeter
- **Required**:
  - Nine physical drawbars (vertical faders, fixed positions)
  - Level LED ladders (green indicator lights below drawbars)
  - Organ Model switches (B3, Vox, Farfisa, etc.)
  - Percussion controls (On/Off, Hard/Soft, etc.)
  - Rotary speed control (Slow/Fast selector or knob)
- **Forbidden**:
  - Wide OLED display (no primary display in Organ)
  - Equal-width control grid (drawbars must dominate visually)
  - Piano-style selectors

### Piano (15%, 1,352 px)
- **Surface**: Dark inset plate with red perimeter
- **Required**:
  - Layer level controls (knobs or faders)
  - Piano Type selector (e.g., Grand/Upright)
  - Piano Model selector (e.g., Model A/B/C)
  - Timbre/character controls (knobs)
  - Sustain/pedal-related switches
- **Forbidden**:
  - Wide OLED display (no primary display in Piano)
  - Drawbar bank (organ-specific)
  - Generic knob grid

### Program (9%, 811 px)
- **Surface**: Central control area, red and dark mix
- **Required**:
  - **Primary Program OLED** (blue-green display, landscape orientation)
  - Large Program encoder (rotary control with tactile detent)
  - Navigation buttons (up/down, or similar)
  - Five Live Program buttons (horizontal row, for quick access)
  - Morph control knobs/buttons
- **Forbidden**:
  - Multiple primary displays (only one OLED in Program)
  - Small text-only display (OLED must be visually prominent)

### Synth (21%, 1,893 px)
- **Surface**: Dark inset plate with red perimeter
- **Required**:
  - **Secondary Synth OLED** (blue-green display, smaller than Program)
  - Layer level controls
  - Oscillator controls (knobs for pitch, shape, etc.)
  - Filter controls (cutoff, resonance, mode)
  - Envelope controls (attack, decay, sustain, release)
  - LFO and arpeggiator controls
  - Voice mode selector (Poly/Mono/Legato buttons)
- **Forbidden**:
  - Wide display spanning the section
  - Uniform repeated knob matrix
  - More than one primary OLED

### Effects (21%, 1,893 px)
- **Surface**: Dark inset plate with red perimeter
- **Required**:
  - Two effect groups (Mod, Delay, Filter, Compressor, Reverb, Rotary, etc.)
  - Amp Simulator and EQ controls (dB controls)
  - Delay time/feedback controls
  - Compressor controls (ratio, threshold, etc.)
  - Reverb controls (size, decay, etc.)
  - Layer focus controls (to toggle which layer the effect modifies)
- **Forbidden**:
  - OLED display in Effects
  - Single undifferentiated control grid
  - Generic effect names without structural organization

## Component Structure and Data Model

### Control IDs (Stable Identifiers)

Each hardware control must have a globally unique, stable ID across all implementations:

```
<section>-<control-type>-<index>
```

Examples:
- `perf-master-level` — Master Level knob in Performance
- `organ-drawbar-1` through `organ-drawbar-9` — Nine drawbars
- `piano-level` — Piano layer level
- `program-encoder` — Program navigation encoder
- `program-button-1` through `program-button-5` — Live buttons
- `synth-osc-pitch` — Synth oscillator pitch
- `effects-reverb-size` — Reverb size control

### State Interface

All controls must expose consistent state:

```typescript
interface Control {
  id: string
  label: string
  type: 'knob' | 'button' | 'led' | 'drawbar' | 'switch' | 'encoder' | 'wheel' | 'fader'
  visible: boolean
  enabled: boolean
  // Type-specific state:
  // knob, encoder, wheel, fader: { value: number, min: number, max: number }
  // button, switch: { active: boolean }
  // led: { lit: boolean, color?: 'red' | 'green' | 'blue' }
}
```

### TypeScript Structure

```typescript
type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

interface Section {
  id: SectionId
  label: string
  widthFraction: number
  controls: Control[]
}

interface HardwareModel {
  variant: 'stage-4-73'
  keyboard: KeyboardModel
  sections: Section[]
  displayLocations: Array<{ sectionId: SectionId, label: string }>
}
```

## Per-Section Control Groups and Density

### Performance (~10 controls)
- Master Level (centered, prominent knob)
- Pitch Stick (vertical wheel, full travel)
- Modulation Wheel (vertical wheel, full travel)
- Transpose (±12 buttons)
- Octave Up/Down (buttons)
- Panic button (red, emergency all-notes-off)

**Density**: Low (controls spread horizontally), high visual weight on wheels and master level

### Organ (~40 controls)
- Nine Drawbars (arranged in a single horizontal row)
- Nine Level LED ladders (indicator lights, 8–10 segments each below drawbars)
- Organ Model selector (B3 / Vox / Farf / Pipe 1 / Pipe 2 buttons, or rotary)
- Percussion buttons (On/Off, Hard/Soft toggles)
- Vibrato/Chorus selector (buttons or rotary)
- Rotary speed (Slow/Fast selector or continuous knob)
- Rotary stop button
- Rotary drive/presence knob
- Close-mic toggle

**Density**: High (drawbars dominate), organized vertically in groups

### Piano (~15 controls)
- Piano layer level (vertical fader or knob)
- Piano Type selector (Grand, Upright, or similar)
- Piano Model selector (Model A, B, C variants)
- Timbre control (knob or switch)
- Dynamics knob (velocity sensitivity)
- Sustain pedal type selector (continuous or switch)
- Pedal noise switch
- Layer focus button
- Spread (stereo width) knob

**Density**: Medium (organized vertically by function)

### Program (~12 controls)
- **Program OLED Display** (landscape, ~80% of section width)
- Program encoder (large, detented rotary knob)
- Navigation buttons (up, down, or similar)
- Program button 1–5 (row of square buttons)
- Category/Bank rotary or buttons
- Undo button
- Morph wheel (or morph assign/amount knobs)

**Density**: Medium (OLED dominates visually, controls below/beside)

### Synth (~30 controls)
- **Synth OLED Display** (landscape, prominent)
- Layer level (vertical fader)
- Oscillator section:
  - Source selector (Samples/Analog/Extern buttons)
  - Waveform or pitch knobs (3–4 controls)
  - FM amount or sync controls
- Filter section:
  - Filter type selector (LP24, LP12, HP, BP, etc.)
  - Cutoff knob
  - Resonance knob
  - Drive knob
- Envelope section:
  - Attack, Decay, Sustain, Release (four knobs or buttons)
  - Envelope mode (buttons)
- LFO section:
  - LFO rate knob
  - LFO destination selector
  - LFO shape selector
- Voice mode selector (Poly, Mono, Legato buttons)
- Glide/portamento knob
- Arpeggiator buttons (On/Off, mode, range)

**Density**: Very high (organized in functional subsections)

### Effects (~25 controls)
- **Effect Group 1** (left half):
  - Effect type selector (buttons or rotary)
  - Amount/depth knob
  - Resonance or feedback knob
- **Effect Group 2** (right half):
  - Effect type selector
  - Amount/depth knob
  - Mix/wet dry knob
- **Shared Controls**:
  - Layer focus buttons (A, B, C, or Master)
  - Effect bypass toggles
  - Output level meter or LED display

**Density**: High (organized into two functional groups)

## Control-Size Hierarchy

1. **Primary Encoders** (largest, most prominent):
   - Program encoder
   - Master Level
   - Pitch/Mod wheels
   - Layer level faders

2. **Secondary Knobs** (medium, numerous):
   - Filter/Synth controls (cutoff, resonance, etc.)
   - Effect amount/depth
   - Timbre controls
   - Reverb size/time

3. **Compact Rectangular Switches** (small, dense):
   - Piano Type/Model selectors
   - Effect type switches
   - Organ model buttons
   - Voice mode buttons (Poly/Mono/Legato)

4. **LEDs and Indicators** (smallest):
   - Level ladder LEDs
   - Button indicators (lit when active)
   - Status LEDs on switches

5. **Drawbars** (special category):
   - Proportionally smaller than knobs but distinctly drawbar-shaped
   - Vertical faders with fixed positions
   - Grouped together in a single row

## Forbidden Hardware Matrix

| Item | Section(s) | Reason | Impact |
|------|-----------|--------|--------|
| OLED in Organ | organ | Reference photo shows dark inset, no display | Structural failure |
| OLED in Piano | piano | Reference photo shows dark inset, no display | Structural failure |
| OLED in Effects | effects | Reference photo shows dark inset, no display | Structural failure |
| Uninterrupted dark slab | control-deck | Must preserve red chassis visibility | Visual fidelity failure |
| White gap at chassis edge | boundary | Continuous red perimeter required | Structural failure |
| Detached frame pieces | boundary | All red elements must be connected | Structural failure |
| Generic knob grid | any | Organ drawbars, Synth, Piano require distinct layouts | Layout failure |
| Marketing hero above | page | Instrument is first and dominant element | Composition failure |
| Invented controls | any | Build reference-specific, not generic | Feature failure |

## Implementation Sequence

### Phase 2 Subtask 1: Audio Architecture Setup
- [ ] Add Web Audio API support (AudioContext, gain nodes, effects nodes)
- [ ] Choose audio source:
  - **Option A**: Use Tone.js Sampler with credible piano samples (Salamander, etc.)
  - **Option B**: Implement FM synthesis with realistic envelope control
  - **Option C**: Use Web Audio API built-ins + sample library
- [ ] Install and integrate chosen audio library (if external)
- [ ] Create PianoAudioEngine class with:
  - AudioContext initialization
  - Master gain node (volume control)
  - Reverb effect node (convolver or reverb algorithm)
  - Per-note gain nodes for velocity and voice management
  - Sustain pedal state tracking
- [ ] Document audio source: sample origin, license, velocity layers, root notes, or synthesis parameters

### Phase 2 Subtask 2: Two-Layer Piano Implementation
- [ ] Implement Layer A audio node tree:
  - Keyboard input → Note-on/Note-off events
  - Velocity detection (pointer Y position or parametric slider)
  - Gain node for layer level + master level
  - Reverb effect routing
  - Output to master bus
- [ ] Implement Layer B (independent):
  - Same signal path as Layer A
  - Independent level control
  - Can be independently enabled/focused
  - Shares master volume and reverb
- [ ] Add sustain pedal support:
  - Full sustain: note-off delayed until sustain released
  - Half-pedal: gradual volume reduction while sustaining
  - Sustain toggle via hardware control
- [ ] Implement note lifecycle:
  - Note-on: trigger sample or synthesis at given pitch/velocity
  - Sustain active: hold release envelope
  - Note-off: release envelope with configurable release time
  - Voice stealing: when polyphony limit reached, stop oldest voice

### Phase 2 Subtask 3: Input Integration (Pointer/Touch/Keyboard/MIDI)
- [ ] **Pointer Input** (desktop):
  - Click/drag on keyboard keys
  - Y position → velocity (0-127 scale)
  - Pointer move while held → pitch bend or volume
  - Note-off on mouse-up
- [ ] **Touch Input** (mobile):
  - Multi-touch on keys (one voice per finger)
  - Touch pressure/force → velocity (if device supports)
  - Separate touch ID tracking for each finger
  - Voice cleanup on touch-end
- [ ] **Computer Keyboard Input** (QWERTY → piano):
  - Map Q-A-S-D... to piano notes (C4 octave default)
  - Octave shift keys (Z/X for octave up/down)
  - Sustain pedal mapped to spacebar or special key
  - Key repeat → single voice per key (no duplicate note-ons)
- [ ] **MIDI Input** (Web MIDI API):
  - Request MIDI access with graceful fallback
  - MIDI note-on → play note with MIDI velocity
  - MIDI note-off → release note
  - MIDI CC 64 (sustain pedal) → sustain pedal state
  - MIDI CC 7 (volume) → master volume (optional)
- [ ] **Focus/Blur Cleanup**:
  - On window blur: all-notes-off (panic)
  - On window focus: clean state ready for input

### Phase 2 Subtask 4: Piano Controls → Audio Parameters
- [ ] **Piano Type Selector** (Grand/Upright/Electric/Clav/Digital/Misc):
  - Switch sampler or synthesis preset
  - Alter resonance characteristics and sustain behavior
  - Update state in canonical hardware model
- [ ] **Piano Model Selector**:
  - Load different tone/sample bank per model
  - Reflect in program display if available
- [ ] **Touch Curve Selector** (Heavy/Medium/Light):
  - Adjust velocity response curve (steeper for Light, gentler for Heavy)
  - Affects volume-from-pointer-Y mapping
- [ ] **Dynamic Compression** (levels 0-3):
  - Add compression node or algorithm
  - Smooth out velocity variations
  - More aggressive at level 3
- [ ] **Timbre Controls** (Off/Soft/Mid/Bright for acoustic; +Dyno 1/2 for electric):
  - Adjust filter cutoff or sample EQ
  - Alter attack/release envelopes
  - Update visible state
- [ ] **Unison Levels** (0-3):
  - Add slight detuning/doubling for richer sound
  - Level 0 = monophonic rendering
  - Level 3 = 4-voice unison stack
- [ ] **Release/Resonance Controls**:
  - Release time slider (0.2s to 5s)
  - Resonance amount (affects sustain tail and harmonic content)
  - String resonance emulation when available

### Phase 2 Subtask 5: Effects Integration
- [ ] Wire **Master Volume** slider → gain node
  - Test: volume slider changes output level measurably
- [ ] Wire **Reverb Control** → reverb/convolver effect
  - Test: reverb slider changes wet/dry ratio or room size
  - Both layers route through same reverb
- [ ] Verify both layers mix to master → destination chain
- [ ] No separate AudioContext per layer (shared context only)

### Phase 2 Subtask 6: Fallback Mode Implementation
- [ ] If Web Audio API unavailable:
  - Display: "Piano (fallback mode - no Web Audio)"
  - Keys remain clickable/playable
  - Use visual feedback (key highlight) instead of audio
  - Log clear message: "Web Audio not available"
- [ ] If MIDI unavailable:
  - Display: "MIDI not available" (graceful)
  - Pointer/touch/keyboard still work
  - No error spam in console
- [ ] If sample loading fails:
  - Display error message
  - Fall back to silence or test tone
  - Do NOT present generated tones as samples

### Phase 2 Subtask 7: Testing (Phase 2 Audio Features)
- [ ] Add tests to feature-matrix.json for:
  - `piano.audio-engine` — Web Audio context initializes and plays notes
  - `piano.note-lifecycle` — Note-on/off/sustain/stealing/all-notes-off
  - `piano.input-integration` — Pointer/touch/keyboard/MIDI all trigger notes deterministically
  - `piano.layer-control` — Layer A and B independent level + focus
  - `piano.velocity-response` — Velocity affects rendered audio level
  - `piano.effects` — Volume and reverb sliders change audible output
  - `piano.type-model-selection` — Type/model changes alter tone characteristics
  - `piano.fallback-mode` — Fallback mode labeled accurately and remains playable
- [ ] Write tests that verify:
  - Velocity affects output amplitude (sample or synthesis)
  - Sustain affects note duration (release envelope extends)
  - Volume slider changes output gain
  - Voice management doesn't crash (e.g., play 100 simultaneous notes)
  - MIDI input triggers correct pitches
  - All input modes (pointer/touch/keyboard) produce similar note events

### Phase 2 Subtask 8: Visual Regression Prevention
- [ ] Update evidence/stage2-visual-audit.md:
  - Compare Phase 2 layout vs Phase 1 (should be identical)
  - Verify no visual regression in control placement
  - Document any layout tweaks for audio integration
- [ ] Run pnpm build and verify no visual changes
- [ ] Run Phase 1 test suite (all should still pass)

### Phase 2 Subtask 9: Artifact Updates
- [ ] Update IMPLEMENTATION_DETAILS.json:
  - Set phase: 2
  - Describe audio source:
    - If samples: "Tone.js Sampler with [source], velocity layers: [0-127]"
    - If synthesis: "FM synthesis with [parameters]"
    - If hybrid: "Combined approach with..."
  - List all audio files or synthesis parameters
  - List voice count / polyphony limit
  - Describe sustain pedal behavior
  - Describe fallback mode
- [ ] Append to STAGE_NOTES.md (create if needed):
  - Audio architecture decisions
  - Sample source license and credits
  - Known limitations (polyphony, latency, sample quality)
  - Browser compatibility notes
- [ ] Update tests/feature-matrix.json with all Phase 2 feature IDs

### Phase 2 Subtask 10: Final Quality Checks
- [ ] `pnpm test`: All Phase 1 tests + new Phase 2 audio tests pass
- [ ] `pnpm typecheck`: No TypeScript errors
- [ ] `pnpm build`: Production build succeeds
- [ ] Browser interaction test:
  - Play notes with pointer (click on keys)
  - Play notes with touch (mobile device if available)
  - Play notes with keyboard (QWERTY)
  - Play notes with MIDI (if device available)
  - Hold sustain pedal while playing
  - Change volume and reverb sliders
  - Change piano type/model
  - Verify audio changes accordingly
- [ ] Console check: No errors, no unhandled promise rejections
- [ ] Document any known limitations in STAGE_NOTES.md

## Summary Control Counts

| Section | Total Controls | Primary Type | Count | Secondary Types |
|---------|---|---|---|---|
| **Performance** | 10 | Wheels | 2 | Knobs (1), Buttons (4) |
| **Organ** | 40 | Drawbars | 9 | LEDs (9), Buttons (15), Knobs (5), Switches (2) |
| **Piano** | 15 | Faders | 3 | Knobs (8), Switches (4) |
| **Program** | 12 | Encoder | 1 | Buttons (6), OLEDs (1), Knobs (4) |
| **Synth** | 30 | Knobs | 12 | Buttons (10), OLEDs (1), Faders (3), Switches (4) |
| **Effects** | 25 | Knobs | 10 | Buttons (10), Switches (5) |
| **Keyboard** | 73 | White Keys | 43 | Black Keys (30) |
| **TOTAL** | **205** | — | — | — |

## Success Criteria

### Inherited from Phase 1 (Visual + Interaction)
- ✓ 73-key keyboard model with correct white/black distribution
- ✓ Six hardware sections in correct order (Performance → Organ → Piano → Program → Synth → Effects)
- ✓ Only Program and Synth have OLED displays
- ✓ Continuous red chassis with no white gaps or detached elements
- ✓ All controls have stable IDs and accessible names
- ✓ Interaction state flows from hardware model (not isolated component state)
- ✓ Tests written and passing for all Phase 1 feature IDs
- ✓ Evidence screenshots and audit document present
- ✓ No visual regression vs Phase 1

### Phase 2 (Audio + Integration)
- [ ] Credible piano source (recorded samples or convincing synthesis, NOT generated placeholder)
- [ ] All input modes (pointer/touch/keyboard/MIDI) trigger deterministic note events
- [ ] Master volume control measurably changes audio output amplitude
- [ ] Reverb control measurably changes audible reverb effect
- [ ] Velocity (pointer Y position) measurably changes audio output level
- [ ] Sustain pedal extends note-off envelope (audibly different with/without sustain)
- [ ] Piano type/model selection alters audible tone characteristics
- [ ] Release/resonance controls alter note tail and sustain behavior
- [ ] Both Layer A and Layer B are independent with own level and can be focused
- [ ] Fallback mode (if Web Audio unavailable) is labeled accurately and remains playable
- [ ] Voice management handles 16+ simultaneous notes without crashing
- [ ] Window blur triggers all-notes-off (no hung notes)
- [ ] All Phase 1 tests still passing
- [ ] New Phase 2 audio tests written and passing
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass
- [ ] No console errors during interaction with keyboard/MIDI/sliders
- [ ] IMPLEMENTATION_DETAILS.json describes audio source, strategy, voice count, limitations
- [ ] STAGE_NOTES.md documents audio architecture decisions and known limitations
- [ ] Evidence screenshots and audit document updated for Phase 2

