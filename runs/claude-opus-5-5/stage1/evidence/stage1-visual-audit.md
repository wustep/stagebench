# Stage 1 visual audit — Nord Stage 4 73 (`stage-4-73`)

Run `claude-opus-5-5`, Phase 1 (surface + basic piano). Specs: `nord-stage-4.visual.json` v1.4.0,
`nord-stage-4.piano.json` (Phase 1 subset), `nord-stage-4.variants.json` (`stage-4-73`).
Reference: `reference/nord-stage-4-73.jpg` (authoritative for layout and materials).

The canonical captures (`stage1-desktop.png`, `stage1-narrow.png`, `stage1-capture.json`) come from
the parent capture harness at seal time. The numbers below come from my own pass over the production
build (`pnpm build`, `dist/` served statically) in headless Chrome 151 using DevTools device-metrics
emulation at scale factor 1, measured with `getBoundingClientRect()` on the page before any scrolling.

## Measured bounds

| Metric | 1440 × 900 | 390 × 844 | Target |
| --- | --- | --- | --- |
| Instrument box (x, y, w, h), CSS px | 50.4, 167.8, 1339.2, 432.7 | 8, 89, 374, 120.8 | — |
| Instrument width / viewport width | **0.930** | 0.959 | 0.88–0.97 (desktop) |
| Instrument aspect (w / h) | **3.0948** | 3.0948 | 3.0951 (measured variant bounds) |
| Deck / instrument height (top of keybed) | **0.5397** | 0.5397 | 0.54 ± 0.025 |
| Document scroll size | 1440 × 900 | 390 × 844 | no vertical scroll at desktop; no horizontal overflow |
| Instrument fully in viewport | yes (bottom at 600.5) | yes (bottom at 209.8) | yes |
| Clipped left / right | no / no | no / no | no |
| Browser console errors during the pass | 0 | 0 | 0 |

The instrument is drawn in a fixed 1600 × 517 design space and scaled as one unit (`transform: scale`),
so every ratio below is the same at every viewport. The instrument box includes the thin band of rear
handles and jack tops (13 design px) above the red chassis, the same way the variant's measured bounds
include them.

## Section ratios (rendered width / instrument width)

| Section | Rendered | `visual.json` v1.4.0 | Stage prompt (older values) |
| --- | --- | --- | --- |
| Performance | 0.140 | 0.14 | 13 % |
| Organ | 0.200 | 0.20 | 21 % |
| Piano | 0.085 | 0.085 | 15 % |
| Program / Morph | 0.125 | 0.125 | 9 % |
| Synth | 0.250 | 0.25 | 21 % |
| Layer Effects | 0.200 | 0.20 | 21 % |

Order left to right: performance, organ, piano, program, synth, effects. Each is a `<section>` landmark
named "… section" with a `data-fraction` attribute.

## Keys

- 73 rendered keys (`.keybed [data-note]`): **43 white + 30 black**, MIDI 28 (E1) to MIDI 100 (E7),
  E to E, hammer action (per the variant entry).
- White key width 35.07 design px (1508 px of key surface / 43), with equal widths and no gaps. Black keys
  are 61 % of the white key length (`blackKeyHeightFraction` 0.61) and 58 % of its width, offset per pitch
  class the way a real keybed is.
- Every key sits inside the instrument box at both viewports (`keysInside: true`), between the left and
  right keybed cheeks (46 design px each).

## Control inventory

- 146 decorative physical controls, each with a stable `id` (`<section>-<name>`) and an accessible name,
  plus 239 LEDs and 16 LED graphs:

  | Section | Controls |
  | --- | --- |
  | Performance | 2 knobs (master level, rotary drive), pitch stick, mod wheel, 3 rotary buttons, all on exposed red chassis with no inset plate |
  | Organ | 9 drawbars with 8-cell LED graphs, 2 layer-level faders with LED ladders, 13 buttons (model, vib/chorus, percussion ×4, preset, octave, layers) |
  | Piano | 2 layer-level faders with ladders, model dial (encoder), 11 buttons (type selector, timbre, KB touch, dyn comp, unison, acoustics, octave ×2, layers ×2, section on) |
  | Program | program OLED, program dial, 8 program buttons, page ◀/▶, Live Mode, Layer Scene, Store, Split, 3 morph assigns, and the remaining shift/utility buttons (27 buttons) |
  | Synth | narrow synth OLED, 3 layer faders with ladders, 3 encoders, 10 knobs of mixed sizes, 24 buttons across oscillator, filter, envelope, LFO and arpeggiator groups |
  | Layer Effects | two boxed mod groups, amp/EQ, delay, compressor, reverb, focus column: 14 knobs, 19 buttons |

- OLEDs: only `program-oled` (45.6 % of the program section width) and `synth-oled` (23.2 % of the synth
  section width). Neither reaches the 0.5 "wide display" threshold, and there is no display element in the
  performance, organ, piano or effects bands.
- Drawbars appear only in the Organ band. The Piano band has no tall-control bank.

## Materials and colours

The red chassis uses `#851a25` (mid) and `#5a0c13` (dark) with a lighter highlight edge, and the inset
plates use `#3c424d`. Keys are `#dcdcdc` and `#0b0b0b`. There are black knobs with pointer indices,
light fader and drawbar caps, red/green/yellow LEDs, and blue-green OLEDs with white legends. The page
background is a neutral light product-study surface (`#ecebe8`). No reference image is used as a rendered
background, and there is no marketing hero: the only chrome is a 15 px title line and the zoom chips.

## Corrections made against the reference

1. **Section widths:** I used the photo-measured `visual.json` v1.4.0 fractions instead of the older
   percentages in the stage prompt. The spec note records that the old values (piano 15 %, program 9 %,
   synth 21 %) contradicted the photo, and the photo is authoritative for layout.
2. **Control placement:** positions were measured on `nord-stage-4-73.jpg`, converted to design px, and
   then linearly mapped into each spec section box. That keeps landmark order and density true to the
   photo while the section edges match the spec.
3. **Rotary speaker block:** it sits on the exposed red chassis of the Performance band, below Master
   Level, as the spec note and photo show (≈ 0.10–0.13 of instrument width). It is not in the Organ band.
4. **Narrow viewport:** `<meta name="viewport" content="width=device-width">` is present, so the 390 px
   profile lays out at 390 CSS px. The instrument scales to full width minus a 16 px gutter instead of
   reflowing, and the Fit / 2× / 3× chips allow closer inspection through horizontal scrolling inside the
   stage only.

## Interaction pass (production build, 1440 × 900)

- Pointer down on C4 depressed the key (`aria-pressed="true"`, "1 / 24 voices · held: C4"). Pointer up
  released it.
- Clicking **Reverb on** set `aria-pressed="true"` and lit its LED. ArrowUp on **Filter frequency** moved
  the knob from 50 to 54. Neither control changed voices, OLED text or status.
- Audio status truthfully read "Audio suspended by the browser — press a key to resume", because
  synthetic DevTools events are not a user activation. Real clicks or key presses resume it, which is
  covered by tests with a suspended simulated context.

## Known deviations

- **Program dial size:** from the photo measurement, the program dial is 19 design px across, 1 px
  smaller than the three synth encoders (20 px). It is the largest control in the Program section.
- **Program OLED content:** the OLED shows Phase 1 status ("Basic Piano / Synth piano: ready / Panel:
  decorative"), not a program name, because programs are not implemented in Phase 1. The Synth OLED
  reads "Inactive / Not built in Phase 1".
- **Legends:** micro-legends use a condensed system sans (Arial Narrow / Liberation Sans Narrow
  fallback), not Nord's panel typeface. Some of the smallest printed legends are 2.7–3.3 design px and
  are legible only at 2× or 3× zoom.
- **Narrow view:** at 390 × 844 the instrument is 374 × 121 CSS px. It is fully visible and unclipped,
  but individual controls are small. Zoom is provided rather than a reflowed layout, which would break
  the geometry.
- **Audio source:** the piano voice is generated in the browser (additive synthesis into AudioBuffers),
  not recorded samples. See `IMPLEMENTATION_DETAILS.json`.
