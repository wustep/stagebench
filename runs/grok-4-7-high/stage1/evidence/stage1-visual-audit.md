# Stage 1 visual audit — Stage 4 73

Variant: `stage-4-73`. Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.variants.json`, `specs/nord-stage-4.piano.json`.

Captures: `evidence/stage1-desktop.png` (1440×900), `evidence/stage1-narrow.png` (390×844), `evidence/stage1-capture.json`.
Browser: Playwright Chromium against the production `dist/` build, device scale 1, reduced motion, light scheme. Console errors: none. Page errors: none.

## Measured geometry (desktop 1440×900)

Instrument border box **1353.59 × 437.33** at x=43.2, y=231.3.

- Width fraction of the viewport: **0.940** (spec band 0.88–0.97).
- Aspect width/height: **3.095** (spec 3.0951).
- `documentElement.scrollHeight` = `clientHeight` = 900. No vertical scroll. `scrollWidth` = `clientWidth` = 1440.
- Deck box / chassis height: **0.523**. Keybed box / chassis height: **0.446**. Spec targets 0.54 and 0.46 with tolerance 0.025. Both sit inside that band. The red top and bottom rails are chassis padding, so the inner deck and keybed boxes are slightly under the nominal split.
- Black-key height / keybed row: **0.610** (spec 0.61).
- Keys: **73** total, **43** white, **30** black, ids `key-28` (E1) through `key-100` (E7).

Section border boxes as a fraction of the control deck (1334.66 px):

| Section | Spec | Measured |
| --- | ---: | ---: |
| Performance | 0.14 | 0.140 |
| Organ | 0.20 | 0.200 |
| Piano | 0.085 | 0.085 |
| Program | 0.125 | 0.125 |
| Synth | 0.25 | 0.250 |
| Effects | 0.20 | 0.200 |

OLEDs: one in Program (the section's primary readout) and one in Synth at **0.198** of the synth section width (under the 0.5 wide-display threshold). Performance, Organ, Piano, and Effects have no `.oled` element.

## Measured geometry (narrow 390×844)

Instrument **374.39 × 120.95**, width fraction **0.960**, fully inside the viewport (`scrollWidth` = `clientWidth` = 390, `scrollHeight` = `clientHeight` = 844). Same 73/43/30 keybed. Black-key height fraction **0.610**. Section fractions match the desktop ratios. Nothing is clipped by overflow.

## Browser pass

- Pointer click on C4 set the program OLED to `data-status="ready"` (additive piano actually started).
- Keyboard ArrowUp on Master Level moved `aria-valuenow` from 100 to 104 and left the engine status at `ready` (the knob is presentation-only).
- No marketing hero. The only heading is a visually hidden "Nord Stage 4 73".

## Corrections

Section widths follow `nord-stage-4.visual.json` (piano 0.085, program 0.125, synth 0.25). The phase prompt's older 15% / 9% / 21% split is the pre-correction coarse values called out in `horizontalSectionsNote`.

## Known deviations

- Control placement is landmark-dense, not a pixel trace of the product photo. The visual spec has no per-control coordinate inventory.
- The program OLED reports piano-engine status (`IDLE` / `LOADING` / `READY` / `ERROR` / `FALLBACK`). It does not show a fake program name. The synth OLED reads "SYNTH / OFF / decorative".
- Drawbar and knob positions are schematic within each section rather than photo-registered.
- At 390×844 the whole chassis is on screen and unclipped, and the legends are very small because the 3.095:1 silhouette is scaled to the viewport width.
