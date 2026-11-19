# Stage 1 Visual Audit — Nord Stage 4 73

## Capture Metadata

- **Variant:** Nord Stage 4 73 (`stage-4-73`, hammer action, 73 keys E1–E7)
- **Reference image:** `inputs/reference/nord-stage-4-73.jpg` (measured bounds 9013×2912, aspect ratio `3.0951`)
- **Specs:** `nord-stage-4.visual.json` (v1.5.0), `nord-stage-4.variants.json` (v1.0.0), `nord-stage-4.piano.json` (v2.0.0)
- **Canonical artifacts:**
  - `evidence/stage1-desktop.png` (`1440×900`, 0 console errors, 0 page errors)
  - `evidence/stage1-narrow.png` (`390×844`, 0 console errors, 0 page errors)
  - `evidence/stage1-capture.json`

## Measured Bounds & Ratios (Live Playwright Chromium)

### Desktop Profile (`1440×900`, unscrolled)

| Metric | Target / Spec | Measured | Status |
| --- | --- | --- | --- |
| Viewport scroll (`scrollHeight - innerHeight`) | `0 px` | `0 px` | Pass |
| Horizontal overflow (`scrollWidth - innerWidth`) | `0 px` | `0 px` | Pass |
| Instrument bounding box | — | `x=43, y=202, w=1353.6, h=437.3` | Pass |
| Instrument width fraction | `0.88 – 0.97` | `0.9400` (`94.0%`) | Pass |
| Instrument aspect ratio | `3.0951` | `3.0951` | Pass |
| Control deck vertical fraction (incl. top rail) | `0.54 ± 0.025` | `0.5400` (`54.0%`) | Pass |
| Keybed vertical fraction (incl. bottom rail) | `0.46 ± 0.025` | `0.4600` (`46.0%`) | Pass |
| Total / white / black keys | `73 / 43 / 30` (E1–E7) | `73 / 43 / 30` (MIDI 28–100) | Pass |
| Black key height fraction | `0.61` | `0.6099` | Pass |
| Synth OLED width / Synth section width | `< 0.50` | `0.2553` (`25.5%`) | Pass |
| Minimum drawbar height / width ratio | `>= 3.0` | `4.36` | Pass |
| Interactive elements reachable via `elementFromPoint` | `100%` | `219 / 219` (`0` unreachable) | Pass |

### Horizontal Section Width Fractions (Photo-Measured `nord-stage-4.visual.json`)

| Order | Section | Spec Fraction | Measured Fraction | Surface |
| ---: | --- | ---: | ---: | --- |
| 1 | `performance` | `0.140` | `0.1400` | Exposed red chassis (no inset plate, no OLED) |
| 2 | `organ` | `0.200` | `0.2000` | Dark blue-gray inset plate, 9 drawbars + red LED ladders |
| 3 | `piano` | `0.085` | `0.0850` | Dark blue-gray inset plate, A/B faders + Piano Select |
| 4 | `program` | `0.125` | `0.1250` | Red/dark central band, sole Primary Program OLED + 8 program buttons |
| 5 | `synth` | `0.250` | `0.2500` | Dark blue-gray inset plate, single narrow Synth OLED + grouped modules |
| 6 | `effects` | `0.200` | `0.2000` | Left FX Focus rail + dark plate with 2 vertically separated groups |

### Narrow Profile (`390×844`)

| Metric | Target | Measured | Status |
| --- | --- | --- | --- |
| Document horizontal overflow | `0 px` | `0 px` | Pass |
| Instrument container horizontally scrollable | `true` | `true` (`1180 px` unclipped chassis) | Pass |
| Chassis aspect ratio preserved | `3.0951` | `3.0952` | Pass |
| Status & attribution bar wraps inside `390 px` | Yes | Yes | Pass |

## Landmark & Forbidden-Hardware Verification

1. **Performance:** Exposed red chassis (`#851a25`..`#5a0c13`) with angled wooden Pitch Stick, ribbed metal Modulation Wheel, `nord stage 4 / HAMMER ACTION 73` branding, `MASTER LEVEL` knob, and red-bordered `ROTARY SPEAKER` column (`DRIVE`, `CLOSE MIC`, `STOP MODE`, `SLOW/FAST`, `MORPH`). Zero inset dark plates, zero OLEDs.
2. **Organ:** Dark inset plate (`#3c424d`) with light slate header (`#a8b4c4`), Layer A/B faders with 10-segment green LED ladders, `ORGAN MODEL` (6 LEDs), `VIB/CHORUS` (6 LEDs + ON), `B3 PERCUSSION` (Soft/Fast/Third + ON), and 9 physical drawbars (`16'`..`1'`) with authentic B-B-W-W-B-W-B-B-W caps and 9 numbered 8-segment red LED ladders. Zero OLEDs.
3. **Piano:** Dark inset plate with Layer A/B faders + green LED ladders, `TIMBRE` vertical button + LEDs, `ACOUSTICS`, `UNISON`, `KB TOUCH`, `DYN COMP`, and `PIANO SELECT` 6-LED type grid + `MODEL [LIST]` rotary encoder. Zero OLEDs, zero drawbars.
4. **Program & Morph:** Red/dark central control area with `MORPH ASSIGN` (`WHEEL`/`A.T.`/`CTRLPED`), `SPLIT`, `CLK`, `TRN`, red `STORE` button, `PRESET LIBRARY`, `PROGRAM` encoder + `PAGE` buttons, the sole **Primary Program OLED** (`#program-oled`, truthfully showing Phase 1 basic Grand voice + live note/sustain + `PANEL: DECORATIVE`), `SOLO/EDIT/COPY` rail, `LIVE MODE`, `LAYER SCENE II`, 8 `PROGRAM` bank buttons (`1–8`), and `SHIFT/EXIT`.
5. **Synth:** Dark inset plate with 3 Layer faders (`A/B/C`) + green LED ladders, `KB HOLD` / `ARP RUN`, single narrow **Synth OLED** (`#synth-oled` at `25.5%` section width, truthfully reading `Decorative / AUDIO IN PHASE 3`) connected by vertical alignment ticks to 3 rotary encoders, `MODE`, `ARPEGGIATOR/GATE`, `VOICE`, `VIBRATO`, and 4 distinct light-slate bottom sub-modules (`LFO`, `OSCILLATORS`, `FILTER`, `AMP` + `UNISON`).
6. **Layer Effects:** Left red `FX FOCUS` strip (`ORGAN`, `PIANO`, `SYNTH`, `SHIFT`), dark plate cleanly bisected by a vertical divider into Group 1 (`MOD 1`, `MOD 2`, `AMP SIM/EQ` with 3-band EQ row) and Group 2 (`DELAY`, `COMP`, `REVERB`), plus right-edge vertical `HANDMADE IN SWEDEN BY CLAVIA DMI AB` silkscreen. Zero OLEDs.

## Corrections Made After Initial Capture Review

1. Tightened button widths (`12px`) inside Program's `MORPH ASSIGN` top row, `PAGE` controls, and 8-button `PROGRAM` bank (`1–8`) so columns align with balanced inner margins and zero border crowding.
2. Added the 3 vertical white connector ticks linking `#synth-oled` to its 3 rotary encoders and balanced the vertical sizing of Synth's upper OLED and lower light-slate sub-modules (`LFO`, `OSCILLATORS`, `FILTER`, `AMP`) to remove the horizontal dead band visible in the first capture.
3. Added the `LIST` sub-label under Piano's `MODEL` encoder, adjusted Effects unit padding/knob diameter (`16px`) for clean bottom legend clearance on `BASS / MID / TREB / WET`, and added the right-margin vertical `HANDMADE IN SWEDEN BY CLAVIA DMI AB` silkscreen.

## Known Deviations & Phase 1 Scope Notes

- **Micro-silkscreen density:** At `1440×900` (`1353.6×437.3 px` chassis), ultra-small secondary shift sub-legends (e.g., `SYSTEM/SOUND/ORGANIZE/AUX KB/OUTPUT/PEDAL/MIDI/EXTERN` printed below Program buttons 1–8 and secondary shift annotations under knobs) are simplified to their primary printed legends for legibility while retaining full descriptive text in accessible `aria-label`s.
- **Horizontal section proportions:** Implemented using the photo-measured fractions in `nord-stage-4.visual.json` v1.5.0 (`14% / 20% / 8.5% / 12.5% / 25% / 20%`) rather than the superseded coarse figures (`13% / 21% / 15% / 9% / 21% / 21%`), following spec precedence.
- **Phase 1 functional boundary:** Per Phase 1 scope, only the 73-key keybed, mapped computer keyboard, sustain input (`Space` / CC64 / footer toggle), and Web MIDI note/velocity/CC64 drive the basic Salamander Grand piano voice. All panel controls update presentation state only and both OLEDs truthfully report this boundary.
