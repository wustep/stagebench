# Phase 1 Implementation Plan - Nord Stage 4 88

## Spec Assignment

- **Spec filename:** `specs/nord-stage-4.visual.json`
- **Selected variant:** `stage-4-88`
- **Variant label:** Nord Stage 4 88
- **Reference image:** `/Users/wustep/Documents/Projects/stagebench/reference/nord-stage-4.jpg`

## Hard Gates Checklist (from benchmark-phases.json Phase 1)

- [ ] The selected variant's exact keybed is modeled: 88 keys, 52 white and 36 black, A-to-C hammer action
- [ ] Program and Synth are the only primary OLED locations
- [ ] The red chassis is continuous around the deck and keybed
- [ ] Two measured desktop comparison-and-repair passes are complete

## Measured Specifications

### Instrument Bounds and Aspect Ratio

**Stage 4 88 Reference Image Analysis:**
- Reference image dimensions: ~3400px × ~1000px (estimated from visual proportions)
- Instrument occupies approximately 92% of reference image width
- Aspect ratio (width:height): **3.40:1** (estimated from 88-key keybed vs 73-key baseline of 3.095:1)
  - Calculation: Stage 4 73 = 3.095:1 with 73 keys; Stage 4 88 = 88 keys = +20.5% width = approximately 3.40:1
- Tolerance: ±2.5% (per BENCHMARK.md)
- Full-size flagship variant

### Vertical Allocation

Per `nord-stage-4.visual.json`:
- Control deck (including top rail): **54%** of total height
- Keybed (including bottom rail): **46%** of total height

### Horizontal Section Widths (relative to total width)

1. **Performance:** 13% (master level, pitch stick, modulation wheel, branding)
2. **Organ:** 21% (nine drawbars, LEDs, model switches, percussion, rotary)
3. **Piano:** 15% (layer level, type/model selectors, timbre, switches)
4. **Program/Morph:** 9% (OLED, large encoder, navigation, five program buttons)
5. **Synth:** 21% (OLED, layer levels, oscillator, filter, envelope, LFO, arpeggiator)
6. **Effects:** 21% (two effect groups, amp/EQ, delay, compressor, reverb, layer focus)

### Keybed Model

**Stage 4 88 exact specification:**
- **Total keys:** 88
- **White keys:** 52
- **Black keys:** 36
- **Key range:** A to C
- **Key action:** Hammer action
- **Black key height fraction:** 0.61 (61% of white key height)

### Section Landmarks and Control Inventory

#### Performance Section (13%)
- **Surface:** Exposed red chassis (NO dark inset plate)
- **Required controls:**
  - Master level knob
  - Pitch stick (vertical expression control)
  - Modulation wheel (horizontal expression control)
  - Nord Stage 4 branding/logo
- **Forbidden:** Full dark inset plate, OLED display
- **Materials:** Black knobs with white index marks, red exposed metal, white legends

#### Organ Section (21%)
- **Surface:** Dark inset plate with red perimeter
- **Required controls:**
  - Nine physical drawbars (vertical sliders)
  - Level LED ladders (green LEDs next to drawbars)
  - Organ model switches (B3, B3 Bass, Vox, Farf, Pipe 1, Pipe 2)
  - Percussion controls
  - Rotary controls (speed, stop)
- **Forbidden:** Wide OLED display, generic equal-width control grid
- **Materials:** Dark plate background, green level LEDs, switch indicators

#### Piano Section (15%)
- **Surface:** Dark inset plate with red perimeter
- **Required controls:**
  - Layer level controls (faders)
  - Piano type selectors
  - Model selector
  - Timbre controls
  - Piano-detail switches
- **Forbidden:** Wide OLED display, drawbar bank
- **Materials:** Dark plate background, fader caps, switch indicators

#### Program/Morph Section (9%)
- **Surface:** Red and dark central control area
- **Required controls:**
  - Primary program OLED (blue-green display, only one in this section)
  - Large program encoder (main rotary control)
  - Navigation buttons
  - Five live-program buttons (1-5)
  - Morph controls
- **Forbidden:** Multiple primary displays
- **Materials:** Blue-green OLED, silver/gray switches, red accent areas

#### Synth Section (21%)
- **Surface:** Dark inset plate with red perimeter
- **Required controls:**
  - Single synth OLED (blue-green display, only one in this section)
  - Layer level controls
  - Oscillator controls (source, shape)
  - Filter controls (type, cutoff, resonance)
  - Envelope controls (ADSR)
  - LFO and arpeggiator controls
- **Forbidden:** Wide display spanning the section, uniform repeated knob matrix
- **Materials:** Dark plate background, blue-green OLED, knobs with white index marks

#### Effects Section (21%)
- **Surface:** Dark inset plate with red perimeter
- **Required controls:**
  - Two effect groups (separated visually)
  - Amp simulator and EQ controls
  - Delay controls
  - Compressor controls
  - Reverb controls
  - Layer focus controls
- **Forbidden:** OLED display, single undifferentiated control grid
- **Materials:** Dark plate background, knobs, switches

### Viewport and Presentation

- **Desktop viewport:** 1440×900
- **Instrument width at desktop:** 88–97% of viewport width (ideally ~1320–1395px)
- **Vertical scroll requirement:** None; fully visible without scrolling
- **Background:** Neutral light product-study surface (not the reference photograph)
- **Layout:** Instrument is the first and dominant visual element

### Component and Data Model

#### Control ID Structure

All controls will have stable IDs following the pattern: `{section}-{feature}-{index}`

Examples:
- `performance-master-level`
- `performance-pitch-stick`
- `performance-mod-wheel`
- `organ-drawbar-0` through `organ-drawbar-8`
- `organ-model-b3`
- `piano-layer-level`
- `program-oled`
- `program-encoder`
- `synth-oled`
- `synth-oscillator-source`
- `effects-reverb-level`

#### Hardware Map Structure

```typescript
interface ControlSection {
  id: string;
  label: string;
  widthFraction: number;
  surface: 'red' | 'dark-plate';
  controls: Control[];
}

interface Control {
  id: string;
  label: string;
  type: 'knob' | 'button' | 'fader' | 'switch' | 'stick' | 'wheel' | 'drawbar' | 'encoder' | 'oled' | 'led';
  position?: { x: number; y: number };
  value?: number;
}
```

## Implementation Order

### Phase 1: Structural Geometry
1. Create React + Vite project with TypeScript
2. Implement continuous red chassis with rails and end cheeks
3. Create six panel regions with dark inset plates where required
4. Implement exact 88-key keybed (52 white, 36 black, A-to-C)
5. Ensure at 1440×900: instrument occupies 88–97% width, fully visible

### Phase 2: Control Sections
1. Performance section (master level, pitch stick, mod wheel, branding)
2. Organ section (nine drawbars, LEDs, model switches, percussion, rotary)
3. Piano section (layer levels, type/model selectors, timbre controls)
4. Program section (OLED, encoder, navigation, five program buttons, morphs)
5. Synth section (OLED, layer levels, oscillator/filter/envelope/LFO controls)
6. Effects section (two effect groups, amp/EQ, delay, compressor, reverb)

### Phase 3: Interaction and Accessibility
1. Keyboard key press/release animation
2. Button and LED toggle behavior
3. Knob and encoder rotation (pointer and keyboard input)
4. Display illumination
5. Accessible names, roles, focus states for all controls

### Phase 4: Measured Repair Passes
1. First pass: capture 1440×900, compare reference and render, fix three largest discrepancies
2. Second pass: repeat desktop capture, add 390×844 narrow capture
3. Document evidence and remaining deviations

## Testing Strategy

### Feature Matrix Coverage (Phase 1)

- `visual.key-count` — 88-key model, 52 white and 36 black, correct black-key pattern
- `visual.section-layout` — six ordered sections, correct width allocations
- `visual.control-inventory` — landmark control counts, stable IDs, no invented OLEDs
- `interaction.keys` — keyboard key pressed/released state
- `interaction.buttons-leds` — buttons toggle LEDs correctly
- `interaction.knobs` — pointer changes clamped and reflected visually
- `accessibility.controls` — accessible names, roles, focus behavior
- `regression.chassis` — continuous chassis, no marketing region above

### Test Files

- `src/components/Keyboard.test.tsx` — key count, white/black pattern, range
- `src/components/ControlDeck.test.tsx` — section layout, widths, landmarks
- `src/hooks/useKeyboardInput.test.ts` — key press/release handling
- `src/components/Controls.test.tsx` — button, knob, LED interactions
- `src/components/StageBuilder.test.tsx` — continuous chassis, no extra regions

## Hard Gate Tracking

At completion:

1. **Exact keybed:** Verify 88 keys total, 52 white (A–C pattern), 36 black, hammer action ✓
2. **OLED locations:** Assert only Program and Synth have primary OLEDs; Organ, Piano, Effects have none ✓
3. **Continuous chassis:** Verify red chassis unbroken around deck and keybed, no detached pieces ✓
4. **Two repair passes:** Screenshot at 1440×900 twice with fixes between; second pass includes 390×844 ✓

## Success Criteria

- [ ] All hard gates pass
- [ ] No console errors
- [ ] No runtime crashes
- [ ] TypeScript strict mode passes
- [ ] Lint passes (ESLint)
- [ ] Production build succeeds
- [ ] Tests pass (test, typecheck, lint, build)
- [ ] Evidence saved: stage1-desktop.png, stage1-narrow.png, stage1-visual-audit.md
- [ ] Audit includes measured bounds, section ratios, key counts, console state, corrections
