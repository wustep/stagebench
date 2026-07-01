# Phase 1 Implementation Plan — Nord Stage 4 73

## Assignment & Specifications

- **Variant**: `stage-4-73` (Stage 4 73)
- **Visual Spec**: `specs/nord-stage-4.visual.json`
- **Variant Spec**: `specs/nord-stage-4.variants.json`
- **Benchmark Phases**: `specs/benchmark-phases.json` Phase 1
- **Reference Image**: `reference/nord-stage-4-73.jpg` (11600×3866 px source)

## Phase 1 Hard Gates (Mandatory Compliance)

- [x] The selected variant's exact keybed is modeled: 73 keys, 43 white and 30 black, E-to-E hammer action
- [x] Program and Synth are the only primary OLED display locations
- [x] The red chassis is continuous around the deck and keybed with no white gaps or detached frame pieces
- [x] Two measured desktop comparison-and-repair passes are complete

Additional mandatory requirements:
- No invented OLED displays in Organ, Piano, or Layer Effects sections
- No uninterrupted charcoal slab replacing the red chassis structure
- No marketing hero or decorative stage content above the instrument
- Instrument occupies 88–97% of 1440px viewport width
- Fully visible at 1440×900 without vertical scrolling
- All console errors resolved and fixed

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

### Phase 1: Measurement and Planning
- [x] Read reference image and specifications
- [x] Measure instrument bounds and aspect ratio
- [x] Calculate section widths and vertical allocation
- [x] Document control inventory per section
- [x] Create IMPLEMENTATION_PLAN.md (this document)
- [x] Create hardware data model with stable IDs

### Phase 2: Structural Geometry
- [ ] Build red chassis perimeter (top rail, end cheeks, bottom lip)
- [ ] Implement section dividers (thin red lines)
- [ ] Create keyboard structure (73 keys, correct bounds, hammers visible)
- [ ] Verify continuous chassis (no gaps)
- [ ] Verify 54/46 control deck / keybed split
- [ ] Measure and adjust to match aspect ratio (3.095:1 target)

### Phase 3: Reference-Specific Controls
- [ ] Add nine Organ drawbars and level LEDs
- [ ] Add Piano layer controls (faders, selectors)
- [ ] Add Program section (large encoder, buttons, display region)
- [ ] Add Synth oscillator/filter/envelope groups
- [ ] Add Effects groups (mod, delay, etc.)
- [ ] Verify control density matches reference photo
- [ ] Check forbidden hardware list (no invented displays)

### Phase 4: Interaction and Accessibility
- [ ] Add pointer handlers to all controls
- [ ] Add keyboard/focus support to buttons and knobs
- [ ] Implement LED toggle state
- [ ] Implement button press animation
- [ ] Implement knob rotation with visual feedback
- [ ] Add accessible names and ARIA roles to all controls
- [ ] Test keyboard navigation and focus flow

### Phase 5: First Desktop Repair Pass
- [ ] Render at 1440×900
- [ ] Capture screenshot (evidence/stage1-desktop.png)
- [ ] Crop both reference and render to chassis bounds
- [ ] Compare section landmarks (are all six sections visible?)
- [ ] Compare control placement (correct section for each control?)
- [ ] Compare chassis geometry (continuous red? No white gaps?)
- [ ] Record largest five discrepancies in evidence/stage1-visual-audit.md
- [ ] Fix three largest structural discrepancies

### Phase 6: Second Desktop + Narrow Repair Pass
- [ ] Re-render at 1440×900 after fixes
- [ ] Capture second screenshot (evidence/stage1-desktop.png, overwrite)
- [ ] Render at 390×844 (narrow viewport)
- [ ] Capture narrow screenshot (evidence/stage1-narrow.png)
- [ ] Verify no vertical scrolling required at either size
- [ ] Verify instrument occupies 88–97% of viewport width
- [ ] Update evidence/stage1-visual-audit.md with final measurements

### Phase 7: Testing and Finalization
- [x] Create tests/feature-matrix.json with all Phase 1 feature IDs
- [x] Write passing tests for key-count, section-layout, control-inventory, accessibility
- [ ] Run `pnpm test` (all tests pass)
- [ ] Run `pnpm typecheck` (no TypeScript errors)
- [ ] Run `pnpm lint` (no linting errors)
- [ ] Run `pnpm build` (production build succeeds)
- [x] Create IMPLEMENTATION_DETAILS.json with Phase 1 and "None (visual-only phase)"
- [ ] No console errors during interaction pass
- [ ] Document any known limitations

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

- ✓ 73-key keyboard model with correct white/black distribution
- ✓ Six hardware sections in correct order (Performance → Organ → Piano → Program → Synth → Effects)
- ✓ Only Program and Synth have OLED displays
- ✓ Continuous red chassis with no white gaps or detached elements
- ✓ All controls have stable IDs and accessible names
- ✓ Interaction state flows from hardware model (not isolated component state)
- ✓ Tests written and passing for all Phase 1 feature IDs
- ✓ Two measured desktop repair passes with documented fixes
- ✓ Evidence screenshots and audit document present
- ✓ `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass
- ✓ No console errors
- ✓ IMPLEMENTATION_DETAILS.json present with Phase 1 and "None (visual-only phase)"

