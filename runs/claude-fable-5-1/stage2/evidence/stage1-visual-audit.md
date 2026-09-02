# Stage 1 visual audit — Nord Stage 4 73

Captures (all in `evidence/`): `stage1-desktop.png` (1440×900), `stage1-narrow.png` (390×844), measurements and the browser
interaction pass in `stage1-capture.json`. Produced by `scripts/capture.mjs` (playwright-core 1.62 driving the
locally installed Google Chrome 151, `pnpm build` output served over a local HTTP port). The parent capture
harness named in the phase prompt was not present in this workspace, so this script reproduces its outputs.

## Reference measurements (photo `reference/nord-stage-4-73.jpg`, 11600×3866)

Measured with a band scan of the variant bounds (x 1292, y 410, 9013×2912, aspect 3.0951):

| Feature | Photo measurement (fraction of instrument width W or height H) |
| --- | --- |
| Organ inset panel | x 0.136–0.3235 W |
| Piano inset panel | x 0.3259–0.4057 W |
| Program area (red) | x 0.4057–0.530 W |
| Synth inset panel | x 0.530–0.7677 W |
| Layer Effects inset panel | x 0.7702–0.9531 W, red chassis to 0.977 W, cheek to 1.0 W |
| Light section header strips | y 0.103–0.128 H; dark panels y 0.130–0.491 H |
| Chassis top edge / jack row | chassis edge at 0.031 H, jacks above it |
| Keys | white keys begin ≈0.52 H, black keys span 0.535–0.819 H (≈0.63 of the visible white length; spec value 0.61) |
| Side cheeks | ≈0.023 W each |
| White keys | 43 keys, pitch ≈200 px ≈ 0.0222 W; black key top face ≈40 px |

The visual spec (v1.4.0) documents the six section widths as 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20. The photo's
panel edges differ from those band-scan fractions by up to 0.02 W (organ panel 0.19 W wide including its gap, synth 0.24 W,
effects 0.23 W including the right chassis margin). The rendered sections use the documented fractions; each inset panel
is placed inside its section box, so the piano panel sits ≈0.014 W right of the photo's, the synth panel starts ≈0.02 W
right of it and the effects panel is 0.176 W wide instead of 0.183 W. The phase prompt's prose widths
(13/21/15/9/21/21 %) are the older values that the spec's own note marks as contradicted by the photo; the spec values
were used.

## Rendered measurements (`stage1-capture.json`)

Desktop 1440×900:

| Measure | Value |
| --- | --- |
| Instrument box | x 43.2, y 34.5, 1353.6 × 437.3 px |
| Width fraction of viewport | 0.940 (required 0.88–0.97) |
| Aspect ratio | 3.095 (reference 3.0951) |
| Document scroll height | 900 px = viewport (no vertical scroll); instrument bottom at 471.8 px |
| Deck (incl. top rail and jacks) | 236.2 px = 0.540 of instrument height |
| Keybed (incl. bottom lip) | 201.2 px = 0.460 |
| Section widths measured / documented | performance 0.140/0.140, organ 0.200/0.200, piano 0.085/0.085, program 0.125/0.125, synth 0.250/0.250, effects 0.200/0.200 |
| Keys | 73 total, 43 white, 30 black, E1 (MIDI 28) to E7 (MIDI 100) |
| White key box | 30.03 × 184.1 px; black key 17.41 × 112.3 px → black/white length 0.610 |
| Controls with stable ids | 146 (performance 7, organ 24, piano 14, program 28, synth 40, effects 33); 0 missing names, 0 duplicate ids |
| Displays | `program.oled` 75.3 px wide = 0.445 of its section (the only primary display there); `synth.oled` 79.5 px = 0.235 of its section; none in performance, organ, piano or effects |
| Forbidden-hardware rules (spec `forbiddenDetection`) | OLED in performance/effects 0; wide displays 0; multiple primary displays 0; drawbar-like controls in piano 2 (its two faders, below the 6 threshold); organ carries 9 drawbars + 2 faders |
| Console errors / page errors | 0 / 0 during load and the interaction pass |

Narrow 390×844 (mobile emulation, touch):

| Measure | Value |
| --- | --- |
| Instrument box | x 8, y 63.6, 374 × 120.8 px (0.96 of viewport width), aspect 3.095 |
| Document scroll width | 390 px (no horizontal page scroll; nothing clipped) |
| Inspection | the whole chassis is visible; `2×` / `3×` buttons under the instrument enlarge it inside a horizontally scrollable stage for inspection |

Interaction pass (desktop): mouse press on C4 depressed and released the key; the audio context was created on that gesture
and reported `ready` with the generated bank; a computer-keyboard chord with Shift held sustained and then released;
two-finger touch on E4 and G4 registered independently; a knob moved with ArrowUp (6 → 6.2); a drawbar and a fader moved
with mouse drags (8 → 3, 45 → 95); a toggle lit, a selector cycled, a momentary button held only while pressed; Tab focus
showed a solid outline; panel operation left the engine with zero voices; window blur released everything. MIDI reports
`denied` in headless Chrome, which is the truthful state of that environment.

## Corrections made during the audit

1. Deck and keybed were first measured against the chassis body (0.523 / 0.446 because the jack row sat outside it); both were
   re-parented to the instrument box so the documented 0.54 / 0.46 split is measured directly (now 0.540 / 0.460).
2. Legends, LEDs, buttons and knobs were rescaled from the photo (legend ≈0.36 % of W, dark button 1.5 × 0.62 % of W,
   small knob body 1.05 % / scale ring 1.9 % of W, gray tall button 0.75 × 1.2 % of W, drawbar cap 1 × 1.8 % of W); the first
   pass had them 30–40 % too large and blocks overlapped.
3. The keyboard range was corrected to E1–E7 (MIDI 28–100): 73 keys from E to E span six octaves plus one key.
4. The effects header strip was widened so "LAYER EFFECTS" and its ON button do not collide; the delay filter LEDs were
   stacked like the photo; the logo was moved clear of the left cheek.

## Known deviations

- Legends render at ≈4.9 px on the 1354 px desktop capture; the photo-equivalent size is ≈3.3 px. Some neighbouring legends
  therefore touch or overlap at desktop scale (piano left column, program dial legends, delay and reverb right columns). All
  controls remain reachable and correctly placed; the density and grouping match the photo.
- Knob scale numerals are ≈2 px at desktop scale (as unreadable as in the photo at this size). Fonts are system sans
  (Liberation Sans); the Nord wordmark is approximated with weight and letter-spacing, not the real typeface.
- The two OLEDs show truthful Phase 1 text (basic generated piano; synth decorative) instead of the photo's program names.
- The rear-panel jack row, the wooden cheeks, the split-point LED/screw row and the rear labels are stylised.
- The performance section's Rotary Speaker block sits on exposed red chassis below Master Level as in the photo; its ON LED
  is a static indicator (no control), matching the photograph.
- Colours follow the spec's reference values (chassis #851a25 / #5a0c13, panel #3c424d, keys #dcdcdc / #0b0b0b) with gradients
  for the metal, rubber and lacquer finishes; no photograph is used as a rendered background.
