# Stage 4 73 visual audit

Compared the 1440 × 900 and 390 × 844 canonical captures with the assigned Stage 4 73 product image, cropped to its measured bounds (x 1292, y 410, 9013 × 2912 px). Render measurements are Chromium CSS pixels rounded to two decimals.

| Quantity | Desktop | Narrow |
| --- | ---: | ---: |
| Viewport and document | 1440 × 900 | 390 × 844 |
| Instrument origin (x, y) | (47.52, 213.03) | (9.75, 326.48) |
| Instrument bounds (width × height) | 1344.95 × 434.53 | 370.50 × 119.70 |
| Width as a share of viewport | 93.4% | 95.0% |
| Width-to-height ratio | 3.0952 | 3.0952 |
| Deck including top rail | 234.64 px (54.0%) | 64.63 px (54.0%) |
| Keybed including bottom rail | 199.88 px (46.0%) | 55.06 px (46.0%) |
| Outer bounds of a white key | 29.47 × 188.39 | 8.11 × 51.91 |
| Outer bounds of a black key | 18.56 × 114.91 | 5.11 × 31.66 |
| Black key height as a share of white key height | 61.0% | 61.0% |

The continuous chassis contains 73 keys, from MIDI 28 (E1) to MIDI 100 (E7). The keybed has 43 white keys and 30 black keys, with black key offsets following the repeating groups of two and three. Both default views fit wholly inside the viewport. The narrow view offers a magnified, horizontally scrollable detail view that reaches both ends.

## Sections and control inventory

Widths are shares of the populated control band. It measures 1285.14 px on desktop before the right-hand chassis perimeter.

| Section | Share | Desktop width | Interactive controls | Reference landmarks |
| --- | ---: | ---: | ---: | --- |
| Performance | 14% | 179.92 px | 8 | Wood pitch stick, modulation wheel, master level, rotary speaker block, branding |
| Organ | 20% | 257.03 px | 24 | Nine drawbars with red ladders, two layer faders, model, vibrato and percussion groups |
| Piano | 8.5% | 109.23 px | 14 | Two layer faders, vertical piano type grid, model dial, acoustic and timbre keys |
| Program and Morph | 12.5% | 160.64 px | 28 | Morph row, program OLED and dial, two rows of four program buttons, Live Mode and Layer Scene |
| Synth | 25% | 321.28 px | 40 | Three layer faders, single OLED, oscillator dials, arpeggiator, LFO, filter and amp groups |
| Layer Effects | 20% | 257.03 px | 33 | Layer focus strip, Mod 1 and Mod 2, amp and EQ, delay, compressor and reverb |

All 147 panel controls and 73 keys had a reachable pointer hit point at desktop size. Sliders expose their current values and buttons expose pressed state. Only Program and Synth have OLEDs. Both captures have zero console messages and zero page errors. The separate Chromium interaction pass also exercised keyboard focus, pointer movement, and a virtual MIDI input that produced a measured audio signal.

## Corrections and known deviations

- Used the visual spec’s corrected photo-derived section widths in place of the earlier values in the phase prompt. The biggest difference is the narrower Piano section and wider Synth section.
- Adjusted the drawbar travel after comparing the cap positions to the photo, keeping the handles and their footage legends inside the inset. Softened the chassis texture and matched the black-key height to the measured 61% target.
- Small legends, knob graduations, the wordmark, and the connector silhouettes are drawn approximations. Both OLEDs show a static panel illustration. At 390 px, printed legends are best read in **Inspect controls** mode.
- The surface represents the hammer-action variant. Key travel is visual and touch response uses fixed strike velocity except with a pressure-reporting pen. MIDI supplies its own strike velocity.
- Phase 1 supports one upright voice. Panel controls provide presentation feedback. Piano pedal noise, half-pedaling, Triple Pedal hardware and setup, piano size classes, INFO view, Sound Manager downloads, and the piano preset library are unsupported.
