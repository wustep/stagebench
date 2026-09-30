# Phase 1 visual audit — Stage 4 73

Reference: `inputs/reference/nord-stage-4-73.jpg`; geometry and landmarks: `inputs/specs/nord-stage-4.visual.json`; keyboard: the assigned entry in `nord-stage-4.variants.json`. Inspected the source photo and both saved browser captures visually. Measured DOM bounds in Chromium 153.0.8010.12; full measurements are in `stage1-capture.json`.

## Measured geometry

| Measurement | 1440 × 900 | 390 × 844 |
| --- | --- | --- |
| Chassis origin | 43.20, 165.00 | 11.70, 130.00 |
| Chassis width × height | 1353.59 × 437.33 | 366.59 × 118.44 |
| Viewport width coverage | 94.00% | 94.00% |
| Aspect ratio | 3.0951 | 3.0953 (subpixel rounding) |
| Deck height / chassis | 54.00% | 54.00% |
| Keybed including bottom rail | 46.00% | 46.00% |
| Black / white key height | 60.99% | 60.99% |
| Page scroll dimensions | 1440 × 900 | 390 × 844 |

The rendered keybed rectangle is 44% high; the bottom chassis rail supplies the remaining 2% of the required 46% keybed allocation. The chassis ends at y=602.33 on desktop and y=248.44 on narrow. There is no horizontal page overflow or vertical scrolling at either canonical viewport.

The six deck bands, ordered left to right, measure 181.92 / 259.89 / 110.45 / 162.42 / 324.86 / 259.89 px on desktop. These are 14 / 20 / 8.5 / 12.5 / 25 / 20 percent of the 1299.47 px deck. This intentionally follows the corrected visual spec and photo rather than the stale fractions in the phase prompt.

## Inventory and reference comparison

- Exactly 73 sequential E1–E7 keys: 43 white and 30 black. White positions follow a continuous 43-key spacing; black keys follow the E-start chromatic pattern and end before the final E. Every key is a separate playable accessible button.
- One continuous red metal-style chassis with inset deck and attached keybed, full red end cheeks, top rail, bottom rail, indexed black knobs, sliding caps, LED ladders, white legends and blue-green OLEDs. No reference image is rendered as UI.
- Performance remains exposed red: master level, pitch stick, modulation wheel, branding, and rotary controls. Organ contains nine drawbars plus layer ladders, model, percussion, vibrato and routing switches.
- Piano is the narrow band containing A/B level controls, type/model selection and detail switches. Program carries its sole primary OLED, dial, eight numbered buttons, page, live, scene, store, split and morph inputs. Synth has one narrow OLED and distinct oscillator, filter, envelope, LFO and arpeggiator groups. Layer Effects has separate modulation, amp/EQ, delay, compressor and reverb groups plus focus controls.
- Only Program and Synth have OLEDs. OLED text explicitly identifies inactive panel functionality. The active audio status sits outside the physical surface.
- 140 modeled panel controls: 85 buttons and 55 ranges (knobs, faders, drawbars, wheel and stick). Browser checks verified all 140 center points are reachable, all buttons operate with Space/Enter, and all ranges operate with arrow keys. Pointer dragging was checked on a knob and fader; native multi-touch owners, individual cancellation, pointer release, focus-key input and blur were checked on the keybed.

## Corrections during inspection

Reduced the panel top padding to align the inset plates with the reference top rail. Separated overlapping EQ controls and lower synth envelope controls. Corrected fraction-derived IDs to prevent duplicate organ drawbar IDs. Preserved button Space behavior while retaining the computer sustain mapping. Sustain feedback now reflects all pedal owners. Physical key depression is independent from voice stealing and the natural end of the generated audio buffer.

## Narrow inspection

The narrow capture is the complete fitted overview. Printed hardware micro-legends are necessarily tiny at this scale. The Inspect slider enlarges the whole instrument up to 4× within its own horizontally scrollable viewport. Browser checks enlarged to 1466 px, scrolled to the last E7 key, and restored Fit without introducing page overflow. All six sections and the full keybed remain available for inspection.

## Known deviations and evidence gap

The controls and materials are a CSS reconstruction. Some micro-legends, tick markings, selectors and secondary groups are compact approximations of the photo, and there is no perspective rendering or exact reproduction of the manufacturer's print artwork. No sonic fidelity to Nord samples is claimed: the sole voice is original piano-like synthesis.

The parent capture harness was not supplied in this isolated workspace. `stage1-desktop.png`, `stage1-narrow.png`, and `stage1-capture.json` were produced by `tests/browser-check.mjs` at the required viewports; they are explicitly candidate-runner evidence, not parent-harness output. No external workspace or other run was consulted. The operator can rerun the canonical harness when available.
