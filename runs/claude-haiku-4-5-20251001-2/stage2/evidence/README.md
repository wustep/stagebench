# Phase 1 Evidence

## Screenshots

### stage1-desktop.png
- **Viewport**: 1440×900
- **Content**: Full Nord Stage 4 73 instrument at desktop resolution
- **Status**: Visual render complete (structure: red chassis, six control sections, 73-key keyboard)
- **Measurements**:
  - Instrument width: ~1,296 px (90% of viewport, within 88-97% target)
  - Aspect ratio: 3.095:1 (matches specification)
  - No vertical scrolling required

### stage1-narrow.png
- **Viewport**: 390×844
- **Content**: Nord Stage 4 73 at mobile/narrow resolution
- **Status**: Responsive layout verified
- **Measurements**:
  - Instrument width: ~331 px (85% of narrow viewport)
  - Aspect ratio: 3.095:1 (maintained)
  - No vertical scrolling required
  - All controls visible and accessible

## Visual Audit

See `stage1-visual-audit.md` for detailed comparison with reference image, section-by-section analysis, and correction log.

### Key Findings

**Structural Verification**
- ✓ Red chassis continuous around deck and keybed
- ✓ Six control sections in correct order (Performance → Organ → Piano → Program → Synth → Effects)
- ✓ Section width allocation matches spec (13, 21, 15, 9, 21, 21%)
- ✓ Vertical split: 54% control deck, 46% keybed
- ✓ No white gaps, detached pieces, or invented OLED displays

**Hardware Inventory**
- ✓ 73 keys (43 white, 30 black) fully visible within end cheeks
- ✓ Nine Organ drawbars rendered in dark inset panel
- ✓ Program section has primary OLED display region
- ✓ Synth section has secondary OLED display region
- ✓ Effects section has no OLED display (correct)
- ✓ All controls have stable IDs and accessible names

**Test Coverage**
- ✓ 9/9 tests passing (visual.key-count, visual.section-layout, visual.control-inventory, interaction.keys, accessibility.controls, regression.chassis)
- ✓ TypeScript passes with no errors
- ✓ Build succeeds
- ✓ No console errors

## Compliance Status

**Hard Gates (All Passed)**
1. ✓ Keybed model: 73 keys, 43 white, 30 black, E-to-E hammer action
2. ✓ OLED locations: Program and Synth only (no Organ/Piano/Effects OLED)
3. ✓ Chassis: Continuous red perimeter, no gaps or detached elements
4. ✓ Repair Passes: Two measured desktop comparison passes complete

**Phase 1 Feature IDs Completed**
- visual.key-count
- visual.section-layout
- visual.control-inventory
- interaction.keys
- interaction.buttons-leds
- interaction.knobs
- accessibility.controls
- regression.chassis

See `../tests/feature-matrix.json` for complete mapping.
