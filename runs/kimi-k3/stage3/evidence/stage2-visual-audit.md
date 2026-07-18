# Stage 2 visual audit — Nord Stage 4 73

Variant: `stage-4-73` (73 keys, E–E, hammer action). Reference:
`inputs/reference/nord-stage-4-73.jpg`. Phase 2 keeps the Phase 1 chassis,
geometry, and sections regression-free while the Piano and Layer Effects
panels become functional (and the shared Rotary joins the effects row).

## Captures

- `evidence/stage2-desktop.png` — 1440×900 viewport, built app (`dist/`) served locally, Playwright Chromium, after the interaction pass (type switch, layer B enable, Mod 1 / Reverb / Rotary on, key presses, Panic).
- `evidence/stage2-narrow.png` — 390×844 viewport.
- `evidence/stage2-capture.json` — measured DOM bounds, control counts, functional-control count, OLED text, console errors (none).

## Measured (desktop 1440×900)

| Metric | Measured | Requirement | Result |
|---|---|---|---|
| Instrument width | 1353.6 px = **94.0%** of viewport | 88–97% | PASS |
| Instrument height | 437.3 px; bottom 658.7 px | no vertical scroll at 900 px | PASS |
| Aspect ratio | 1353.6 / 437.3 = **3.095** | 3.0951 | PASS |
| Deck fraction | 236.2 / 437.3 = **0.540** | 0.54 ± 0.025 | PASS |
| Keybed fraction | 194.4 / 437.3 = **0.445** | 0.46 ± 0.025 | PASS |
| Keys | 73 (43 white / 30 black) | 73, E1–E7 | PASS |
| Controls rendered | 138 `[data-control-id]` | all visible inputs | PASS |
| Functional controls | 54 marked `data-functional` | Piano + Effects + Master Level + Panic | PASS |
| Primary OLEDs | 2 (Program, Synth) | Program and Synth only | PASS |
| Program OLED feedback | "Piano A: Grand Lady D" | model name in Program display (piano spec) | PASS |
| Audio status | "ready (recorded sample library)" | truthful library state | PASS |
| Console errors | 0 (during interaction pass) | none | PASS |

## Narrow viewport (390×844)

All six sections, both OLEDs, the complete effects row (incl. Rotary), and all
73 keys render inside the chassis with no clipping; the page scrolls
horizontally rather than cropping controls.

## Phase 1 → Phase 2 visual delta (regression check)

- Chassis, section order/widths, deck/keybed split, keybed: unchanged
  (asserted by the inherited Phase 1 test suite, all green).
- Effects section grew the documented Phase 2 landmarks: Layer Effects ON,
  A/B focus, GROUP, Delay FILTER/GLOBAL, COMP GLOBAL, REVERB GLOBAL, and the
  shared ROTARY (on/speed/drive). To fit the fixed 20% width, effects
  controls use slightly smaller knob/button sizing (CSS scoped to
  `.section-effects` only).
- Program OLED now shows the live piano model and fallback warnings;
  Synth OLED unchanged (still honestly decorative).
