# Stage 1 visual audit — Nord Stage 4 73

Sources: `inputs/reference/nord-stage-4-73.jpg` (11600×3866, instrument bounds x1292 y410 9013×2912),
`specs/nord-stage-4.visual.json`, `specs/nord-stage-4.variants.json`.
Captures: `stage1-desktop.png` (1440×900), `stage1-narrow.png` (390×844), measurements in `stage1-capture.json`
(produced by `scripts/capture.mjs`, headless Chromium, no scrolling, no zoom).

## Measured bounds and ratios

| Item | Target | Measured |
| --- | --- | --- |
| Instrument aspect ratio | 3.0951 | 3.0951 (desktop), 3.0953 (narrow) |
| Desktop: instrument width / viewport | 0.88–0.97 | **0.940** (1353.6 px of 1440), x 43.2, y 186.0, 437.3 px tall |
| Desktop: page scroll | none | scrollHeight 900 = viewport, no horizontal overflow |
| Narrow: instrument width / viewport | inspectable, unclipped | 0.940 (366.6 of 390), fully inside viewport, no overflow (page zoom or the "Zoom in" button enlarges it 3× in a sideways-scrolling stage) |
| Deck (incl. top rail) / instrument height | 0.54 ±0.025 | 0.5400 |
| Keybed (incl. bottom rail) / instrument height | 0.46 ±0.025 | 0.4600 |
| Keys | 73: 43 white, 30 black, E1–E7 | 73 / 43 / 30 (DOM), MIDI 28–100 |
| Black key height | 0.61 of white | 0.61 (style height 61 %) |
| Key span | 0.0297–0.9713 of width (photo) | 29.7u–971.3u |

### Sections (fraction of instrument width)

| Section | visual.json | measured (desktop px) |
| --- | --- | --- |
| Performance | 0.140 | 189.5 px = 0.1400 |
| Organ | 0.200 | 270.7 px = 0.2000 |
| Piano | 0.085 | 115.0 px = 0.0850 |
| Program / Morph | 0.125 | 169.2 px = 0.1250 |
| Synth | 0.250 | 338.4 px = 0.2500 |
| Layer Effects | 0.200 | 270.7 px = 0.2000 |

### OLEDs

Exactly two: `#program-oled` in Program (75.5×38.8 px, 0.446 of the section width) and `#synth-oled` in Synth
(77.5×37.5 px, 0.229 of the section width). Neither reaches 0.5 of its section. No `oled`/`display`/`screen`
class, id or label exists in Performance, Organ, Piano or Layer Effects (asserted in `src/app.test.tsx`).

### Controls

182 controls with stable ids: performance 8, organ 27 (incl. 9 drawbars with red LED ladders, 2 faders with green
ladders), piano 19, program 29, synth 56, effects 43. Reachability check (element at each control's centre is the control): 0 unreachable at
1440×900 and 0 at 390×844.

## Corrections made during the browser pass

- Section fractions: the task prompt lists 13/21/15/9/21/21 %; `visual.json` (v1.4.0) states those coarse numbers were
  corrected to 14/20/8.5/12.5/25/20 % against the photograph. The spec file and the photo win, so the corrected values are used.
- Synth plate bottom was mapped to the wrong crop (plate ended halfway down); fixed.
- Light group frames (Oscillators, Filter, Amp, LFO, Mode) had their titles colliding with LED legends; titles now sit on the frame edge like the photo.
- Knob numeral rings were ~40 % too wide and collided with neighbouring legends; radius reduced.
- Arpeggiator range ring was a full loop; now a 210° arc behind the numerals.
- Layer Effects title overlapped its ON button; shrunk. FX-focus column got its light header tab.
- Tag buttons (LED + legend toggles) overlapped neighbours; hit areas shortened.
- Brand lettering letter-spacing collapsed the glyphs; fixed.

## Known deviations from the photograph

- Everything is CSS-drawn; no photographic textures. Red chassis is a gradient with faint grain, knobs are gradient-drawn (no ridged geometry), legends use a system condensed sans instead of the Nord typeface.
- Section content is horizontally re-fitted (≈±6 %) from the photo's plate extents into the exact spec section widths, so a few controls sit up to ~6u away from their photographed position.
- Legend text is 2–3 instrument units high, i.e. ≈3 px on a 1440-wide screen and <1 px at 390 wide; at 390×844 the whole instrument is visible but panel legends are only readable after zoom (button or pinch).
- Small LED indicators whose function is out of scope (AUX KB, KB ZONE, FX FOCUS, NUM PAD, MIDI/EXTERN, …) are drawn **unlit and inert**; the photograph shows some lit. This is deliberate (honesty contract).
- Initial positions of knobs, faders and drawbars approximate the photograph. Button LEDs start off.
- The wheels are drawn top-down as slot + roller; the modulation wheel's amber roller and the chrome pitch stick are simplified shapes.
- The synth OLED and program OLED show honest status text, not the photographed program/waveform screens (those features do not exist in Phase 1).
- The capture harness is `scripts/capture.mjs` (the parent harness was not present in this workspace).
- Audible output could not be verified through speakers in the headless capture environment; audio behaviour is verified through injectable fakes and the pure DSP renderer in the test suite.
