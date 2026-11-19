# Stage 2 Visual & Regression Audit — Nord Stage 4 73

## Canonical Captures Verified
- **Desktop (`1440×900`)**: `evidence/stage2-desktop.png` (434,910 bytes; `consoleMessages: []`, `pageErrors: []`)
- **Narrow (`390×844`)**: `evidence/stage2-narrow.png` (131,605 bytes; `consoleMessages: []`, `pageErrors: []`)
- **Capture metadata**: `evidence/stage2-capture.json` (Playwright Chromium, `deviceScaleFactor: 1`, `reducedMotion: reduce`)

## Geometry & Visual Regression Comparison vs Phase 1 (`stage1-desktop.png` / `stage1-narrow.png`)

| Metric | Spec / Phase 1 Baseline | Phase 2 Measured (`1440×900`) | Status |
| --- | --- | --- | --- |
| Overall chassis aspect ratio | `3.0951` (`stage-4-73`) | `3.095` (`1354 × 437 px`) | Pass |
| Deck / Keybed vertical split | `0.54 / 0.46` (±0.025) | `0.540 / 0.460` | Pass |
| Keybed count & range | `73` keys (`43` white, `30` black, `E1–E7`) | `73` keys (`43` white, `30` black, `E1–E7`) | Pass |
| Performance width fraction | `14%` | `13.93%` | Pass |
| Organ width fraction | `20%` | `19.91%` | Pass |
| Piano width fraction | `8.5%` | `8.46%` | Pass |
| Program & Morph width fraction | `12.5%` | `12.44%` | Pass |
| Synth width fraction | `25%` | `24.88%` | Pass |
| Layer Effects width fraction | `20%` | `19.91%` | Pass |
| Primary OLED exclusivity | Program + Synth only | `#program-oled` + `#synth-oled` only | Pass |
| Viewport scrollbars (`1440×900`) | None (`vScroll: false`, `hScroll: false`) | `vScroll: false`, `hScroll: false` | Pass |
| Narrow (`390×844`) layout | Horizontal scroller, unclipped chassis | Horizontal scroller, unclipped chassis | Pass |

## Phase 2 Functional Surface Changes Observed
1. **Piano Section**: Layer A focus outline highlights the focused fader cleanly without altering section width; `SUST` (`piano-sustped`) and `PSTK` (`piano-pstick`) micro-toggles with red LEDs sit cleanly in the Phase 1 legend positions; Piano Select LEDs accurately reflect active type (`GR` lit by default).
2. **Program OLED (`#program-oled`)**: Truthfully displays focused layer & model (`A: Salamander Grand`), live FX focus & Master Level (`FX: PNO A  MST 75%`), and honest scope notice (`PIANO+FX LIVE · PROG DECOR`).
3. **Layer Effects Section**: FX Focus amber LEDs accurately default to Piano A (`focusFollowsLayerFocus`), individual effect LEDs match clean initial Piano A defaults (Mod 1/Mod 2/Delay/Amp/Comp off; Reverb Booth on at subtle 10% wet), and `COMP` includes the compact `FAST` button + LED with zero overflow.
4. **Status Footer**: Displays live sample readiness (`Salamander Grand ready (78/78 samples)`), Web MIDI status, active voice counter, Sustain toggle, All Notes Off, and `Credits & Scope` disclosure covering all four recorded sample pack attributions plus live synthesis disclosure.
5. **Defects Found & Resolved During Visual Inspection**:
   - Caught unstyled `MORPH ASSIGN` classes on the initial Phase 2 screenshot (`ns4-morph-card` vs `ns4-morph-box`); restored exact Phase 1 classes in `ProgramSection.tsx` and re-captured to verify pixel-accurate alignment.
   - Caught Chrome suspended-AudioContext autoplay console warnings caused by starting effect LFO oscillators before user gesture; updated LFO units to start lazily on first unlock/note-on for suspended browser contexts (while starting immediately on `OfflineAudioContext`), yielding `consoleMessages: []` in `stage2-capture.json`.
