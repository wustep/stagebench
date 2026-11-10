# Stage 1 visual audit — Nord Stage 4 73

Reference: `reference/nord-stage-4-73.jpg` (11600 × 3866), instrument bounds from
`specs/nord-stage-4.variants.json`: x 1292, y 410, 9013 × 2912, aspect 3.0951.

Captures: `stage1-desktop.png` (1440 × 900), `stage1-narrow.png` (390 × 844), measurements in
`stage1-capture.json`. All three were produced by `scripts/capture-stage1.js` in a Playwright
(Chromium) session against `vite preview` of the production build, on a fresh page load with no
interaction.

**The parent capture harness named in the phase prompt was not reachable from the workspace**
(there is no harness under `inputs/`, and no repository path is given), so these are my own
captures. The Playwright host could not write files from the script, so the script returned the
JSON and it was saved unchanged as `stage1-capture.json`. If the operator's harness is run it
will supersede these files.

Every number below was read from the live DOM (`getBoundingClientRect`, `getComputedStyle`) in
that session, not copied from source data.

## Measured bounds and ratios

| Measure | Target | 1440 × 900 | 390 × 844 |
| --- | --- | --- | --- |
| Instrument box (x, y, w, h) | — | 43.2, 137.6, 1353.6, 437.3 | 11.7, 134.9, 366.6, 118.4 |
| Width ÷ viewport width | 0.88 – 0.97 | **0.940** | **0.940** |
| Aspect ratio (w ÷ h) | 3.0951 | 3.095 | 3.095 |
| Fully inside viewport | yes | yes | yes |
| Document scroll size | = viewport | 1440 × 900, no overflow | 390 × 844, no overflow |
| Visible elements above the instrument | none | none | none |
| Deck ÷ instrument height | 0.54 ± 0.025 | **0.540** (236.2 px) | **0.540** (64.0 px) |
| Keybed ÷ instrument height | 0.46 ± 0.025 | **0.460** (201.2 px) | **0.460** (54.5 px) |
| Gap between deck and keybed | 0 | 0 | 0 |
| Images / canvases on the page | 0 | 0 | 0 |
| Console errors | 0 | 0 | 0 |

## Sections

Rendered widths as a fraction of instrument width, identical at both viewports. Sections are
contiguous (each starts where the previous ends) and tile the full chassis width.

| Section | Spec fraction | Rendered | Controls | LEDs | Display elements | Tall (≥ 3:1) controls | Unreachable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Performance | 0.14 | 0.140 | 7 (2 knobs, 3 buttons, wheel, stick) | 7 | 0 | 0 | 0 |
| Organ | 0.20 | 0.200 | 24 (9 drawbars, 2 faders, 13 buttons) | 31 | 0 | 11 | 0 |
| Piano | 0.085 | 0.085 | 14 (2 faders, 11 buttons, 1 dial) | 30 | 0 | 2 | 0 |
| Program / morph | 0.125 | 0.125 | 28 (27 buttons, 1 dial) | 29 | 1 (`program-oled`, 0.447 of section width) | 0 | 0 |
| Synth | 0.25 | 0.250 | 40 (10 knobs, 3 dials, 3 faders, 24 buttons) | 64 | 1 (`synth-oled`, 0.230 of section width) | 3 | 0 |
| Layer effects | 0.20 | 0.200 | 33 (14 knobs, 19 buttons) | 70 | 0 | 0 | 0 |

Totals: 146 controls (97 buttons, 49 sliders), 0 without an accessible name, 0 unreachable
(the element under each control's centre is that control), 231 panel LEDs plus 11 split-point
LEDs on the deck lip.

Forbidden-hardware rules from the spec's `forbiddenDetection`, evaluated on the same DOM:

| Rule | Result |
| --- | --- |
| Performance: full dark inset plate (≥ 0.8 of band) | dark plate covers 0.000 of the band |
| Performance / Effects: OLED display | 0 display elements in each |
| Organ / Piano: wide OLED display | 0 display elements in each |
| Organ: generic equal-width control grid | not applicable: 9 drawbar-like controls present |
| Piano: drawbar bank (≥ 6 tall controls in a row) | 2 tall controls (the two layer faders) |
| Program: multiple primary displays | 1 display element; none of its children carries a display-like name |
| Synth: wide display spanning the section (≥ 0.5) | 0.230 |
| Synth: uniform repeated knob matrix | knobs sit at photo positions; no shared row/column grid (see `tests/visual.control-inventory.test.tsx`) |
| Effects: single undifferentiated control grid | six framed units in two groups: Mod 1 / Mod 2 / Amp Sim-EQ, and Delay / Comp / Reverb |

## Keys

| Measure | Target | Rendered |
| --- | --- | --- |
| Total / white / black | 73 / 43 / 30 | 73 / 43 / 30 |
| Range | E to E | E1 (MIDI 28) – E7 (MIDI 100) |
| Black key length ÷ white key length | 0.61 | 0.610 |
| Black key width ÷ white key width | (photo ≈ 0.645) | 0.645 |
| Keybed span ÷ instrument width | (photo: 1565 → 10043 = 0.941) | 0.941 |
| White key width | — | 29.61 px at 1440, 8.02 px at 390 |

## Colours

Computed styles contain the spec's reference colours exactly: chassis `rgb(133, 26, 37)`
(#851a25), panel `rgb(60, 66, 77)` (#3c424d), white keys `rgb(220, 220, 220)` (#dcdcdc), black
keys `rgb(11, 11, 11)` (#0b0b0b). The page background is a neutral light `rgb(236, 234, 230)`.

## How the layout was derived

The deck was read off the photo in eight 1300 × 1400 crops at native resolution. Every control,
LED, legend, plate, and both OLED windows is stored as an absolute photo pixel coordinate
(`src/hardware/sections/*.ts`). One affine map per section turns photo x into section x so the
section boxes land exactly on the spec fractions; photo y is used unchanged.

Photo measurements used for that map:

| Feature | Photo x (px) | Fraction of 9013 |
| --- | --- | --- |
| Performance band (left edge → organ plate) | 1292 → 2520 | 0.136 |
| Organ plate | 2512 → 4205 | 0.188 |
| Piano plate | 4228 → 4950 | 0.080 (0.082 with its gaps) |
| Program area | 4958 → 6065 | 0.123 |
| Synth plate | 6068 → 8212 | 0.238 |
| Effects header + plate | 8235 → 9882 | 0.183 |
| Bare chassis + right cheek | 9882 → 10305 | 0.047 |

Resulting horizontal scale per section: performance 1.028, organ 1.063, piano 1.033,
program 1.018, synth 1.045, effects 0.960.

## Spec observations worth reporting

1. **Prompt vs spec widths.** `prompts/stage1.md` asks for 13 / 21 / 15 / 9 / 21 / 21 %.
   `specs/nord-stage-4.visual.json` v1.4.0 gives 14 / 20 / 8.5 / 12.5 / 25 / 20 % and says the
   older piano / program / synth values contradicted the photo. My measurements above agree with
   the spec on those three, so the build uses the spec. The prompt text appears to be stale.
2. **Spec vs photo, smaller residue.** Measured at plate edges, the organ is ≈ 0.188 (spec 0.20),
   the synth ≈ 0.238 (spec 0.25), and effects plus the bare chassis to its right is ≈ 0.230
   (spec 0.20). The spec fractions are honoured exactly; the cost is the per-section scale above.
3. **Black key length.** The photo measures ≈ 0.65 of the white key length (825 of 1270 px);
   the variants spec says 0.61. The photo is a perspective render that foreshortens the white
   key fronts, so 0.61 is used.

## Corrections made during the browser pass

- Legends were ≈ 11 % wider than the photo's condensed face and ran into neighbouring LEDs.
  They are now set at 0.97 size and 0.88 width. Rendered vs photo widths, in photo px:
  "FX FOCUS" 95 vs 96, "PED NOISE ▽" 136 vs 132, "STOP MODE" 116 vs 123.
- The logotype was ≈ 23 % too wide and overlapped the Rotary Speaker block; it now measures
  ≈ 698 px against the photo's 697 px.
- Knob numerals sat on an 83 px radius with a ±135° sweep; the photo measures ≈ 73 px and
  ±130°. They are now at 74 px and ±130°.
- Black keys had a soft horizontal shadow that read as blur at fit scale; replaced with hard
  bevel stops.
- Zooming in made the whole page scroll; the zoomed stage now pans inside its own box and the
  page stays at viewport size.
- The fit used `clientWidth`, so a transient scrollbar at 390 px shrank the instrument to 0.904
  of the viewport; it now uses `innerWidth` and measures 0.940.
- With pointer capture, Chromium still delivers a `click` after a press that was cancelled by
  sliding off the button; that echo used to count as a press. It is now ignored.
- The damper release was too slow (C3 took ≈ 1.2 s to fall 60 dB); time constants are now
  ≈ 125 ms at E1 down to ≈ 38 ms at E7.
- The Enable MIDI button sat inside a live status region; it now sits in the tool row.

## Known deviations from the photo

- **Orthographic, not perspective.** The photo shows rear jacks above the top edge, a bevelled
  rear rail, and key fronts. The render is a flat top view filling the same bounds.
- **Typefaces.** System condensed and extended sans-serifs stand in for Nord's legend and
  heading faces. Letterforms differ; sizes and positions follow the photo.
- **Section scale.** Honouring the spec fractions stretches the organ band 6 % and compresses
  the effects band 4 % horizontally relative to the photo. Control sizes are not scaled, only
  their spacing. The bare chassis right of the effects plate is ≈ 60 px wide instead of ≈ 270 px.
- **Drawbar and fader positions.** On the photo the physical drawbars and fader caps do not
  agree with their LED graphs (the LEDs show program values). Here each cap is placed to match
  its LEDs, so cap positions differ from the photo while the LED graphs match it.
- **OLED contents are deliberately different.** The photo shows a program ("A:11 Nord Stage 4",
  "White Grand", …) and a synth waveform page. Phase 1 has neither, so the Program OLED shows
  the real voice name and live audio / MIDI / sustain status, and the Synth OLED says the
  section is not active. The lines from the Synth OLED to its three dials are simplified to
  straight segments.
- **Piano section ON LED** is lit here and unlit on the photo.
- **Panel LEDs are presentation state.** They start in the photo's state and follow the
  buttons that own them; none reflects audio or program state. The C3 split-point LED follows
  the Split button's indicator.
- **Materials.** The powder-coat texture, knob knurling detail, and wood grain of the pitch
  stick are approximated with gradients. The pitch stick and modulation wheel are simplified.
- **Narrow viewport legibility.** At 390 px the whole instrument is 367 px wide, so legends are
  not readable at fit. The instrument is complete and unclipped, and the zoom control (up to
  4×, panning inside the stage) and native pinch-zoom make every control inspectable.

## Regression checks tied to this audit

`tests/regression.chassis.test.tsx`, `tests/visual.section-layout.test.tsx`,
`tests/visual.key-count.test.tsx`, and `tests/visual.control-inventory.test.tsx` assert the
structural facts above (fractions, split, key counts and geometry, frozen control IDs, OLED
locations, fit at both viewports) so later phases cannot drift from them unnoticed.
