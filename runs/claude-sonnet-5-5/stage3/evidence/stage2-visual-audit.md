# Stage 2 visual audit — Nord Stage 4 73

Captures: `stage2-desktop.png` (1440×900), `stage2-narrow.png` (390×844), measurements + a real-browser interaction pass in
`stage2-capture.json` (`scripts/capture2.mjs`, headless Chrome for Testing). Detail crops: `stage2-piano-zoom.png` (Piano section with layer B added, FX focus on B) and
`stage2-effects-zoom.png` (Layer Effects with several units on). Regression against Phase 1: `stage2-visual-regression.json` and the two diff images
(`scripts/visual-regression.py`).

## Chassis and geometry (unchanged from Phase 1)

| Item | Target | Measured |
| --- | --- | --- |
| Desktop instrument width / viewport | 0.88–0.97 | 0.940, fully inside the viewport, no scroll (scrollHeight 900) |
| Narrow instrument width / viewport | inspectable, unclipped | 0.940, no horizontal overflow |
| Aspect ratio | 3.0951 | 3.0951 |
| Deck / keybed height | 0.54 / 0.46 ±0.025 | 0.5400 / 0.4600 |
| Keys | 73 (43 white, 30 black) | 73 / 43 / 30 |
| Primary OLEDs | Program and Synth only | `#program-oled` (program), `#synth-oled` (synth) |
| Unreachable controls | 0 | 0 at 1440×900 and 390×844 |

## Phase 2 visual changes (all state-driven, none invented hardware)

- Piano: section ON LED, layer A ON/OFF LED, SUSTPED and PSTICK LEDs, FX FOCUS LED now light from real state; the focused layer’s LED blinks while both layers are on.
- Layer Effects: the piano A/B FX-focus LEDs, unit ON LEDs, type selector LEDs (Amp/Delay selectors gained the spec’s "EQ only" and filter "Off" states with no LED lit), the GLOBAL/FAST/BRIGHT/DARK tags follow state; ROTARY ON LED lights when a layer is routed.
- Program OLED shows layer type · model, audio status, voices and sustain; failure shows "PIANO NOT FOUND (fallback)" and the type LED flashes. Text still fits the display.
- Status-bar hint was reworded to stay on one line so the centred layout did not move (an early two-line version shifted the whole instrument 8 px).
- Nothing else moved: pixel comparison with the Phase 1 capture (instrument region) changed 0.16 % of pixels on desktop (0.19 % narrow); Organ, Synth and the keybed are 0.0 %.

## Real-browser pass (from `stage2-capture.json`)

- Recorded Grand, Upright and Electric sets decode and play in Chrome from `dist` (0 failed sample requests, no console errors or warnings); peak output measured at the destination 0.16 (Grand), 0.19 (Upright), 0.12 (Wurlitzer), 0.22 (Clav).
- Reverb tail still audible after key release (0.047) and gone after switching the reverb off; Master Level at zero measures 0; two layers give 2 voices; a single AudioContext.
- With the Grand files blocked at the network level the app reports "Piano not found … Fallback voice", the type LED flashes and the fallback voice still sounds (rms 0.012).
- Bug found by this pass and fixed: a `#` in file names (`D#1vL.ogg`) made real browsers request the wrong URL, so Grand and Upright fell back although the Node tests passed; files are now URL-safe and a test guards the naming.

## Known deviations

- Same CSS-drawn look as Phase 1 (no photographic textures, system condensed sans instead of the Nord typeface).
- OLED text is small at the default size (it is legible with the "Zoom in" button).
