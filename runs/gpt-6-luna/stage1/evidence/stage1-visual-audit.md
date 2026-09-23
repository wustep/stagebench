# Stage 1 visual audit — Stage 4 73

## Reference measurements

- Selected reference: `nord-stage-4-73.jpg` (`stage-4-73`).
- Measured reference instrument bounds: x 1292, y 410, width 9013, height 2912 on an 11600×3866 source canvas; aspect ratio 3.0951:1.
- Variant keybed: 73 hammer-action keys, E2–E8, with 43 white and 30 black keys; the black keys are 61% of white-key height.
- Visual spec split: control deck including rails 54%, keybed including the lower rail 46%.
- Visual spec section order and corrected measured widths: Performance 14%, Organ 20%, Piano 8.5%, Program/Morph 12.5%, Synth 25%, Layer Effects 20%.

## Implemented CSS geometry

These are CSS-defined dimensions, not screenshot-derived measurements. The instrument keeps the reference aspect ratio. At 1440×900, its CSS width is 1353.6 px (94% of the viewport) and its height is about 437.0 px. The 54/46 vertical split is defined in the chassis grid. Expected section widths at that viewport are approximately 189.5, 270.7, 115.1, 169.2, 338.4, and 270.7 px, in spec order.

At 390×844, the page's 6 px side padding gives the responsive chassis a 378 px width and an aspect-ratio height of about 122.1 px. Expected section widths are approximately 52.9, 75.6, 32.1, 47.3, 94.5, and 75.6 px. The full keyboard remains in one row and is contained by the chassis; no section uses horizontal scrolling. The deck tracks are 4% top rail, 46% section surface, and 4% front rail; together these make the specified 54% deck.

The normalized key model contains exactly 73 stable key IDs. White keys occupy 1/43 of the keybed width each; black keys overlay their semitone boundaries at 0.65 of a white-key width and 61% of the keybed height.

## Corrections and known deviations

- Used the visual spec's corrected measured section widths. The phase prompt's introductory 13/21/15/9/21/21 summary is superseded by the visual spec's updated photo measurement.
- Removed external font loading so the page and tests do not depend on network access.
- Controls are intentionally dense at narrow widths because the instrument retains its hardware aspect ratio. They remain in the rendered chassis and retain full accessible names.
- Program and Synth are the only primary OLED locations; both are marked decorative for Phase 1. Panel control values only update visual presentation.
- The piano voice is original generated additive synthesis, not a recorded sample set.
- Per direction, `stage1-desktop.png`, `stage1-narrow.png`, and `stage1-capture.json` are left for the operator's seal step. This audit does not claim screenshot-derived measurements or an actual browser-console pass.
