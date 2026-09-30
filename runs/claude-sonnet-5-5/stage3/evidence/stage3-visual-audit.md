# Stage 3 visual audit — Nord Stage 4 73

Captures: `stage3-desktop.png` (1440×900), `stage3-narrow.png` (390×844); detail crops `stage3-organ-zoom.png` (Organ with B3 Drawbar Jam loaded), `stage3-synth-zoom.png` (Synth display on the filter-envelope page), `stage3-program-zoom.png` (Program section with the *Four Zones* program and the Wheel morph button held), `stage3-split-leds.png` (the eleven split LEDs on the rail above the keys, three lit).
Measurements and a real-browser interaction pass: `stage3-capture.json` (`scripts/capture3.mjs`, Chrome for Testing 154, `dist/index.html` over `file://`). Pixel comparison with the Phase 2 capture: `stage3-visual-regression.json` and the two diff images (`scripts/visual-regression3.py`).

## Chassis and geometry (inherited, re-measured)

| Item | Target | Measured |
| --- | --- | --- |
| Desktop instrument width / viewport | 0.88–0.97 | 0.940, inside the viewport, no scroll (scrollHeight 900) |
| Narrow instrument width / viewport | inspectable, unclipped | 0.940, no horizontal overflow (scrollWidth 390) |
| Aspect ratio | 3.0951 | 3.0951 |
| Deck / keybed height | 0.54 / 0.46 | 0.5400 / 0.4600 |
| Section widths | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 | identical |
| Keys | 73 (43 white, 30 black) | 73 / 43 / 30 |
| Primary OLEDs | Program and Synth only | `#program-oled`, `#synth-oled`, neither clipped |
| Controls | 182, all reachable | 182; 0 unreachable at 1440×900; 5 of 182 unreachable at 390×844 (see below) |

## Phase 3 visual changes (all state-driven, no invented hardware)

- Organ: drawbar LED ladders show the selected model's registration (Farfisa switches light all eight rows or none; B3 Bass unused drawbars stay dark); model, vibrato/chorus, percussion and rotary LEDs follow state; the four KB ZONE LEDs show the focused layer's zone range.
- Synth: the OLED shows the selected waveform with a one-cycle drawing, or an envelope curve, or the filter / LFO / vibrato / arpeggiator page with the names of the three dials below it; the amplifier velocity button lights two LEDs in four combinations (Off, 1, 2, both); LFO destination and Effect-focus-Synth gained the Off / None / Group states.
- Program: the OLED shows `page.button name` with an **E** flag when the program is edited, the numeric list, the Store / Store As screens, the split editor and transient clock lines; the program-button LED shows the selected slot and blinks while edited or while choosing a store destination; STORE blinks during the flow; morph, split, scene, transpose and Live LEDs follow state.
- Morph: assigned knobs light a green LED, assigned faders and drawbars colour their LED graph across the morph range (`.is-morph`), and the Rotary MORPH indicator lights.
- Eleven split-point LEDs sit on the red rail above the keys at C2 F2 C3 F3 C4 F4 C5 F5 C6 F6 C7 (`stage3-split-leds.png`); unlit ones are deliberately faint.
- Status bar (app chrome, not the instrument): a Control pedal slider (the Control Pedal morph source; MIDI CC11 drives the same one) and a collapsible list of the 21 unsupported controls with their reasons.
- Text still fits the two displays; long lines are clipped by design (the Program display has room for about 28 characters per row).

## Real-browser pass (from `stage3-capture.json`)

- Console errors: none; warnings: none. One AudioContext (`contexts: 1`). The app reported "ready" for the recorded Grand, so the bundled samples loaded through the XHR shim.
- Measured at the destination through an analyser tap (peak of a 4096-sample window; values vary a little from run to run): recorded Grand 0.067; B3 0.16, Vox 0.03, Farfisa 0.03, Pipe 0.04; Synth Saw 0.053, with the filter closed 0.012; FM 0.026; the arpeggio keeps sounding after the keys are lifted with KB Hold (0.0016) and is silent after Panic (9e-6); the split program sounds for a low key (0.067) and a high key (0.114); scene II of the scene program sounds (0.043) with a different spectral centroid than scene I (641 vs 795 Hz); the Wheel morph raises the Morph Swell level from 0.008 to 0.062; Panic with a held chord and sustain stops everything (3e-6, "Voices 0/24 · Sustain off").
- Program browsing, Live Mode, the split editor with SET KEY (the split LED moved from C3 to F4), master-clock taps (130 BPM from four taps) and the E indicator (shown after an edit, gone after choosing another program) were exercised through real DOM events in Chrome.

## Known deviations

- Same CSS-drawn look as before (no photographic textures, system condensed sans instead of the Nord typeface); the OLED text is small at the default size (legible with "Zoom in").
- The pixel comparison with Phase 2 reports 40 % changed pixels on desktop. That is not a measure of layout change: the sealed Phase 2 capture was rendered by Playwright Chromium 149 and this one by Chrome for Testing 154, so text and antialiasing differ everywhere. The layout itself is unchanged (section fractions, deck/keybed split, key geometry are identical above); treat the diff as an upper bound.
- At 390×844 five tiny controls (1.2 px-high tags and LED labels: Piano SOFT REL, Synth KEEP EDITS, Arp MENU, Vibrato MENU, Reverb BRIGHT) are covered at their centre by a neighbour. The Phase 2 capture measured 0 with a different browser; this is inherited geometry at sub-pixel scale and was not changed. "Zoom in" makes them usable.
