# Phase 1 Implementation Plan — Nord Stage 4 73-key

## Variant & Specs
- **Variant:** Stage 4 73 (E-E range, hammer action, fully measured)
- **Visual Spec:** `specs/nord-stage-4.visual.json`
- **Piano Spec:** `specs/nord-stage-4.piano.json`
- **Reference Image:** 11600×3866 px source, instrument bounds: 9013×2912 px
- **Instrument Aspect Ratio:** 3.0951

## Phase 1 Hard Gates (from specs/benchmark-phases.json)

✅ The selected variant's exact keybed count and range are modeled and playable.

✅ The complete visible control surface is present; Program and Synth are the only primary OLED locations.

✅ The red chassis is continuous and the measured section geometry matches the assigned reference.

✅ One basic Piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain input, polyphony, and cleanup.

✅ All visible panel knobs, buttons, wheels, faders, encoders, and drawbars move or press but are truthfully non-functional and do not alter audio.

✅ Two measured desktop comparison-and-repair passes and one narrow capture are complete.

## Implementation Details

### Visual & Hardware
- ✅ Normalized hardware model with stable control IDs and accessible names
- ✅ Exact chassis with red continuous top/bottom rails and end cheeks
- ✅ 54/46 control-deck/keybed vertical allocation (±2.5%)
- ✅ Six sections with measured horizontal allocations:
  - Performance: 13% (master level, pitch wheel, modulation wheel)
  - Organ: 21% (9 drawbars, LED ladders, switches)
  - Piano: 15% (layer selectors, type selector, model controls)
  - Program: 9% (OLED, encoder, 5 live buttons)
  - Synth: 21% (OLED, oscillators, filters, envelopes)
  - Effects: 21% (amp/EQ, delay, compressor, reverb, layer focus)
- 73 keys, E-E range, hammer action, black-key height 0.61 of white-key height
- Reference colors: chassis mid (#79232c), dark (#721f29), panel (#3c424d), key black (#0b0b0b), key white (#dcdcdc)
- Only Program and Synth OLED displays; no displays in other sections
- Responsive: 88–97% width at 1440×900, inspectable at 390×844 without key clipping

### Audio & Interaction
- Synthesized sine-wave Piano voice with 8-voice polyphony and voice stealing
- Velocity-to-level response, sustain pedal support, release envelope
- Pointer (mouse/touch) input with independent pointer tracking
- Computer keyboard input with repeat suppression and blur cleanup
- Web MIDI input with graceful disconnect/denied handling
- All inputs feed unified note lifecycle with all-notes-off on unmount/blur/disconnect
- All panel controls move/press with honest decorative behavior (no audio effects)

### Quality & Documentation
- TypeScript strict mode: zero errors
- Comprehensive test suite for layout, hardware model, audio, accessibility
- IMPLEMENTATION_DETAILS.json with truthful synthesized Piano source
- stage1-visual-audit.md with measured bounds and compliance evidence

## Measured Bounds & Ratios
- **Desktop viewport:** 1440×900
- **Narrow viewport:** 390×844
- **Desktop width fraction:** 88–97%
- **Vertical allocation:** 54% control deck, 46% keybed (±2.5% tolerance)
- **Key geometry (73-key E-E):** 43 white, 30 black, black-key height: 61% of white

## Section Inventory
1. **Performance (13%):** Master level knob, pitch stick (±2 semitones), modulation wheel
2. **Organ (21%):** 9 drawbars, LED level ladders, model switches, percussion, rotary controls
3. **Piano (15%):** Layer A/B enable/focus/level controls, type selectors (Grand, Upright, etc.), model selector
4. **Program (9%):** OLED display, large rotary encoder, navigation buttons, 5 live program buttons, morph controls
5. **Synth (21%):** OLED display, layer controls, oscillator controls, filter controls, envelope, LFO, arpeggiator
6. **Effects (21%):** Amp/EQ, delay, compressor, reverb controls, layer focus buttons

## Key Model
- 73 keys, E-E range
- White key width proportional to standard 88-key ratio
- Black keys at measured 61% height
- Hammer action: keys depress slightly on press
- Support all input paths: pointer, multi-touch, keyboard mapping, MIDI

## Audio Source Plan
- **Phase 1:** One basic Piano-like voice using bundled samples or synthesis
- Single polyphonic voice (no layer selection yet; that's Phase 2)
- Velocity-to-level response
- Sustain pedal (CC 64) support
- All-notes-off cleanup (internal, not exposed Panic)
- Truthful loading/ready/error/fallback status
- No real device or network required for tests

## Test Mapping
- Geometry: Instrument bounds, aspect ratio, section widths, key count/range
- Controls: All visible controls accessible, names stable, movement correct
- Piano: Velocity response, release envelope, sustain behavior, polyphony, voice stealing
- Input paths: Pointer (single/multi), keyboard, MIDI (with disconnect)
- Cleanup: All-notes-off on blur, unmount, disconnect
- Decorative: Panel controls do not change audio or fake state
- Responsive: Desktop layout fits 88–97%, narrow layout inspectable without clipping

## Implementation Order
1. ✅ IMPLEMENTATION_PLAN.md (this file)
2. Hardware model: typed control data, IDs, accessible names, state
3. Visual rendering: chassis, sections, exact keybed geometry
4. Input handling: pointer, keyboard, MIDI boundaries
5. Audio subsystem: basic Piano voice, note lifecycle, sustain, polyphony
6. Decorative controls: movement/press feedback, no functional connection
7. Tests: geometry, controls, note paths, input, cleanup
8. Visual repairs: two passes, measure against reference
9. Provenance: IMPLEMENTATION_DETAILS.json, stage1-visual-audit.md

## Success Criteria
- Instrument silhouette matches reference within tolerance
- All six sections present with correct proportions and landmarks
- One audible, playable Piano voice
- All control interactions smooth and accessible
- Note lifecycle complete across all input paths
- Tests pass: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`
- No invented primary hardware, no overlay, no clipped keys at 390×844
