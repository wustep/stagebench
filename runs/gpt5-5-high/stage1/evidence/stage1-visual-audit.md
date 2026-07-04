# Stage 1 Visual Audit

Target variant: Stage 4 73 (`stage-4-73`).

## Source Measurements

- Reference canvas: 11600 x 3866.
- Measured instrument bounds from `nord-stage-4.variants.json`: x 1292, y 410, width 9013, height 2912.
- Reference aspect ratio: 3.0951.
- Variant keybed: 73 total keys, 43 white keys, 30 black keys, E1 to E7, hammer action.

## Rendered Geometry

- The rendered instrument uses CSS `aspect-ratio: 3.0951`.
- Local Playwright pass at 1440 x 900 measured the instrument at 1324.8 x 428.0 px, 92% of viewport width and inside the required 88-97% range.
- Local Playwright pass at 390 x 844 measured the instrument at 374.4 x 121.0 px, 96% of viewport width, with no vertical scroll or horizontal overflow.
- The control deck is positioned as the upper visible instrument deck with the top rail/front lip included in the visual deck mass. The explicit section data uses the documented 13%, 21%, 15%, 9%, 21%, and 21% section fractions.
- The keybed is generated from MIDI note 28 to MIDI note 100, matching E1 to E7. White and black keys are rendered as separate button layers; black keys use the specified 0.61 height fraction.
- Local capture metrics: 43 white keys, 30 black keys, 2 primary OLEDs, no console errors.

## Surface Inventory

- Performance: master level, pitch stick, modulation wheel, section buttons, and Nord Stage 4 branding on exposed red chassis.
- Organ: dark inset plate with nine drawbars, LED-style ladders, model buttons, percussion, vibrato/chorus, and rotary controls.
- Piano: layer faders, type selectors, model dial, layer buttons, SUSTPED/PSTICK, and piano detail controls.
- Program/Morph: one primary OLED, large program dial, eight program buttons, page/store/split/live/scene controls, and three morph buttons.
- Synth: one primary OLED, three layer faders, oscillator/filter/envelope groups, source buttons, LFO/arp controls.
- Layer Effects: focus buttons, two mod groups, delay, amp/EQ, compressor/reverb/rotary controls.

## Corrections Made

- Replaced the starter page with a single product-study instrument surface, not a marketing hero.
- Used generated typed hardware data so key count, key range, section order, and stable control IDs are testable.
- Kept Program and Synth as the only primary OLED locations.
- Kept all panel controls decorative in Phase 1 while preserving visible movement and accessible names/values.

## Interaction Pass

- Pointer down/up/cancel on keys changes visual key depression and routes through the generated piano lifecycle.
- Computer keyboard mapping suppresses repeat events and blur cleanup stops owned voices.
- MIDI enable reports unsupported, denied, connected, and disconnected states without requiring a physical MIDI device in tests.
- Decorative controls respond to pointer, Enter/Space, and arrow keys with presentation-only state changes.

## Known Deviations

- The Phase 1 piano voice is generated synthesis, not a recorded Nord piano sample. This is declared in `IMPLEMENTATION_DETAILS.json`.
- Panel controls beyond keybed note input and sustain do not alter audio or canonical instrument behavior in Phase 1.
- Local `stage1-desktop.png`, `stage1-narrow.png`, and `stage1-capture.json` were produced from the built `dist/` for this pass. The parent `pnpm bench seal gpt5-5-high` capture harness will regenerate canonical versions after import/build.
