# stage3-visual-audit.md — Phase 3 visual audit (Stage 4 73)

Source measurements: `stage3-capture.json` (headless Chrome, dist build),
`stage3-desktop.png` (1440×900), `stage3-narrow.png` (390×844). Reference:
`inputs/reference/nord-stage-4-73.jpg`. Spec: `specs/nord-stage-4.visual.json`.

## Measured bounds

| Check | Spec / gate | Measured | Verdict |
| --- | --- | --- | --- |
| Desktop instrument width / viewport | 88–97% | 1440-profile: **0.960** | Pass |
| Desktop vertical scroll | none (`bodyScrollHeight ≤ 900`) | **900 = 900** | Pass |
| Desktop horizontal overflow | none | body/doc `scrollWidth` = 1440 | Pass |
| Narrow page overflow | inspectable, no page clip | body/doc `scrollWidth` = 390 (instrument rides the 560px inner rail) | Pass |
| Narrow vertical fit | inspectable without clipping | body height = 844 = viewport | Pass |
| Key count / split | 73 = 43 white + 30 black, E1–E7 | 73 / 43 / 30 at both widths, DOM order E1→E7 | Pass |
| Section order | performance, organ, piano, program, synth, effects | matches | Pass |
| Section widths | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 | 0.1388 / 0.1946 / 0.0878 / 0.1249 / 0.2410 / 0.1946 (max Δ 0.009, flex gaps) | Pass |
| Console errors during capture | none | `consoleErrors: []` | Pass |
| Primary OLEDs | Program + Synth only | exactly 2 `[data-primary-oled="true"]`; performance/effects have none; program page readout is auxiliary | Pass |
| Organ drawbars | 9 tall sliders, no uniform grid | 9 `organ-drawbar-N` in one `.drawbank` row + mixed switches; Phase 3 adds per-layer `p3-organ-*-drawbar-*` sliders with LED graphs | Pass |
| Synth layout | grouped, no uniform matrix | labeled sub-groups preserved; Phase 3 adds per-layer wave/filter/env/LFO/voice/arp rows | Pass |
| Effects layout | two separated groups | preserved; Phase 3 adds the unsupported-notes strip (no new OLED) | Pass |
| Piano bank | selectors, no drawbar bank | 2 faders + selectors preserved | Pass |
| Phase 3 strips | additive `p3-*` subtrees after Phase 1–2 nodes | every Phase 1–2 DOM ID in place (controls test); strips scroll internally inside deck bands | Pass |
| Sample library live | Grand/Upright/Electric bundled, offline | capture `stageStatus: ready`, `programModel: A:11 Studio Concert` over the real fetch path | Pass |

## Deck/keybed split

Unchanged from Phase 2: instrument height = top rail + deck (400) + keybed
(300) + status rail + chassis padding. Phase 3 strips scroll internally
(`.p2-panel` overflow-y) so the deck geometry, section widths, and every
Phase 1–2 node above them are untouched.

## Deltas vs the variant photo (authoritative for layout/materials)

No new deltas: the chassis, brand block, keybed, and section geometry are
byte-identical in structure to Phase 2. Functional strips live inside the
inherited dark inset plates (performance stays exposed red); no new OLEDs,
no marketing hero, no detached rails.

## Provenance check

`pnpm samples` generator deterministic (seeded LCG, no clock/random);
`public/samples/manifest.json` lists tool, seeds, roots, layers, license
(CC0-1.0 original synthetic-studio work), and origin. No acoustic recordings
claimed anywhere (UI copy, IMPLEMENTATION_DETAILS.json, tests).
