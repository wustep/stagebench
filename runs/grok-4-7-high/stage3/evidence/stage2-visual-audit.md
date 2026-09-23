# Stage 2 visual audit — Stage 4 73

Variant: `stage-4-73`. Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`.

Captures: `evidence/stage2-desktop.png` (1440×900), `evidence/stage2-narrow.png` (390×844), `evidence/stage2-capture.json`.
Browser: Playwright Chromium against the production `dist/` build, device scale 1, reduced motion, light scheme. Console errors: none. Page errors: none.

## Measured geometry (desktop 1440×900)

Instrument border box **1353.59 × 437.33** at x=43.2, y=231.3.

- Width fraction of the viewport: **0.940** (spec band 0.88–0.97).
- Aspect width/height: **3.095** (spec 3.0951).
- `documentElement.scrollHeight` = `clientHeight` = 900. No vertical scroll. `scrollWidth` = `clientWidth` = 1440.
- Deck box / chassis height: **0.523**. Keybed box / chassis height: **0.446**. Spec targets 0.54 and 0.46 with tolerance 0.025. Both sit inside that band. The red rails are chassis padding, so the inner boxes sit slightly under the nominal split.
- Black-key height / keybed row: **0.610** (spec 0.61).
- Keys: **73** playing keys, **43** white, **30** black, E1–E7. One extra `data-midi` attribute is the program OLED's MIDI status, not a key.

Section border boxes as a fraction of the control deck (1334.66 px):

| Section | Spec | Measured |
| --- | ---: | ---: |
| Performance | 0.14 | 0.140 |
| Organ | 0.20 | 0.200 |
| Piano | 0.085 | 0.085 |
| Program | 0.125 | 0.125 |
| Synth | 0.25 | 0.250 |
| Effects | 0.20 | 0.200 |

OLEDs: one in Program and one in Synth. Performance, Organ, Piano, and Effects have no `.oled` element.

Layer Effects Compressor bottom is **376.1** and Reverb bottom is **376.1**. The keybed band starts at **467.6**. Both units are inside `.section-effects` and `.fx-bottom`, and neither is inside the keybed. Delay sits in the same row. The effects plate's overflow stays inside the deck.

## Measured geometry (narrow 390×844)

Instrument **374.39 × 120.95**, width fraction **0.960**, fully inside the viewport (`scrollWidth` = `clientWidth` = 390, `scrollHeight` = `clientHeight` = 844). Same 73/43/30 keybed. Section fractions match the desktop ratios. Compressor and Reverb bottoms are **402.2**; the keybed band starts at **426.9**. They remain above the keys.

## Browser pass

- The production build preloaded the offline sample library. After a pointer click on C4 the program OLED was `data-status="ready"` and read **Salamander Grand**.
- Clicking Piano Type Select advanced `data-cycle` from 0 to 1 and the OLED changed to **VS Upright**, the recorded upright set, not a decorative label.
- Clicking Layer Effects On, Mod 1 On, and Compressor On set each `aria-pressed` to true.
- Organ, Synth, and Program were not exercised as sound sources. They stay decorative.
- No marketing hero. The only heading is a visually hidden "Nord Stage 4 73".
