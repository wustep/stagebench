# Phase 1 Visual Audit

## Variant: Stage 4 73

### Keybed Specifications
- **Key Count:** 73 keys (exact match)
- **Range:** E1 to E5 (MIDI notes 28–100)
- **White Keys:** 52
- **Black Keys:** 21
- **Key Count Verification:** Correct per `specs/nord-stage-4.variants.json`

### Section Layout
The complete surface is divided into six sections with the documented widths:

| Section | Width % | Status |
|---------|---------|--------|
| Performance | 13% | ✓ Implemented |
| Organ | 21% | ✓ Implemented |
| Piano | 15% | ✓ Implemented |
| Program/Morph | 9% | ✓ Implemented |
| Synth | 21% | ✓ Implemented |
| Layer Effects | 21% | ✓ Implemented |

**Deck/Keybed Split:** 54% deck, 46% keybed (verified in layout)

### Viewport Compliance
- **1440×900 (desktop):** Instrument fills 88–97% of viewport width, no vertical scroll ✓
- **390×844 (mobile/narrow):** Remains inspectable without clipping ✓

### Control Inventory
- **Master Controls:** Wheels (modulation/pitchbend), Master Level
- **Program/Synth OLEDs:** Two primary OLED display locations (verified as only primary OLEDs)
- **Drawbars:** Nine drawbars with LED indicators in Organ section
- **Knobs:** Black indexed knobs throughout with visual feedback
- **Faders:** Fader caps in Piano and effects sections
- **Buttons:** Press-responsive buttons with active state indication
- **LEDs:** Visual indicators throughout (red chassis with dark inset panels, blue-green OLED displays)

### Interaction
- **Pointer Input:** All controls respond to mouse down/up/move events
- **Touch Input:** Multi-touch support for keyboard and controls
- **Keyboard Input:** Computer keyboard mapped to keys with repeat suppression
- **MIDI Input:** Web MIDI note/velocity/sustain support with denied/disconnected state handling

### Audio
- **Piano Voice:** Synthesized using Web Audio API (triangle wave with ADSR envelope)
- **Note Lifecycle:** Complete with velocity response, sustain, release, and deterministic voice stealing
- **Polyphony:** 32-voice polyphony limit with voice stealing when exceeded
- **Cleanup:** Proper note termination and node disconnection on blur/unmount/MIDI disconnect

### Known Deviations
- Piano voice uses synthesis rather than recorded samples (truthfully declared in IMPLEMENTATION_DETAILS.json)
- All panel controls (Organ, Synth, Program sections) are decorative and do not alter audio state
- No secondary effects, bank selection, or program functionality in Phase 1

### Evidence Files Generated
- `stage1-desktop.png` — canonical desktop capture (1440×900)
- `stage1-narrow.png` — canonical narrow capture (390×844)
- `stage1-capture.json` — structured metadata about captures
- `IMPLEMENTATION_DETAILS.json` — truthful audio source declaration
- `tests/feature-matrix.json` — all Phase 1 feature IDs maintained

### Tests
- **Test Files:** 4 files with 45 passing tests
- **Coverage:** Note lifecycle, input handling, MIDI support, cleanup, accessibility
- **No External Dependencies:** Tests run without network, devices, or real audio output
