# Stage 1 — visual audit (Nord Stage 4, variant 73)

Canonical captures are produced by the parent capture harness at seal time and
stored as `evidence/stage1-desktop.png` (1440x900), `evidence/stage1-narrow.png`
(390x844) and `evidence/stage1-capture.json`. The measured values below were
taken from a Chromium pass over the built artifact at both viewports.

## Measured bounds and ratios (1440x900 desktop)

- Instrument width: **1303px / 90.5%** of the 1440 viewport (within the required 88–97%).
- Instrument height: **600px**; no vertical scroll (`scrollHeight == 900`).
- Deck : keybed vertical split: **0.539 : 0.461** incl top/bottom rails (target 0.54/0.46, tolerance ±0.025). ✓
- Single continuous red chassis with top rail, deck, keybed, and bottom rail; rounded end cheeks.

## Section widths (of deck)

| Section | fraction (spec) | measured | ok |
| --- | --- | --- | --- |
| performance | 0.140 | 0.140 | ✓ |
| organ | 0.200 | 0.200 | ✓ |
| piano | 0.085 | 0.085 | ✓ |
| program | 0.125 | 0.125 | ✓ |
| synth | 0.250 | 0.250 | ✓ |
| effects | 0.200 | 0.200 | ✓ |

Note: the coarse fractions printed in the stage-1 prompt (13/21/15/9/21/21) are
refuted by `nord-stage-4.visual.json`'s own `horizontalSectionsNote` correction;
the machine spec values above were used.

## Keybed

- **73 keys, range E1–E7**, 43 white / 30 black, black-key height 61% of white.
- Keys depress on press (CSS transform + `aria-pressed`), release on lift/cancel.

## OLED locations

Exactly **two** primary displays: Program (large) and Synth (single small). All
other sections have no OLED (confirmed in the DOM/accessibility pass).

## Materials and colors

Reference palette applied: chassis mid `#851a25`, chassis dark `#5a0c13`, panel
blue-gray `#3c424d`, key black `#0b0b0b`, key white `#dcdcdc`; dark inset panels
with red perimeter on Organ/Piano/Synth/Effects, exposed red chassis on
Performance/Program; black indexed knobs, fader caps, drawn drawbars, LED
ladders, blue-green OLED text, white legends.

## Control inventory present

Performance (master level knob, pitch stick, mod wheel, branding letters), Organ
(nine drawbars + nine LED ladders, model switches, percussion, rotary), Piano
(six type selectors, model encoder, layer faders/buttons, timbre + detail
switches), Program (OLED, dial, eight program buttons, page/Live/Scene/Store/
Split/morph), Synth (OLED, three layer faders, osc/filter/env/LFO/vibrato/arp),
Effects (two effect groups, amp/EQ, delay, compressor, reverb, rotary, focus).

## Narrow (390x844) retention

Instrument fills 96% of width, weight ~100%, no horizontal or vertical overflow
(`scrollWidth == 390`, `scrollHeight == 844`), all 73 keys and all six sections
rendered; legends shrink/hide for legibility while every control keeps its
accessible name.

## Corrections made during the pass

- Deck:keybed ratio corrected from an initial 0.584 to 0.539 by using flex-basis
  ratio instead of a percentage height.
- Control density tuned so every section's controls fit without clipping
  (verified `section-controls.scrollHeight <= height` at both viewports).

## Known deviations

- The instrument height (600px) is taller than the photo's 3.095 aspect implies
  (~420px), a deliberate trade so the full control inventory remains visible and
  unclipped while still filling 90.5% width with no vertical scroll. All other
  variant geometry (key count/range, section widths, deck/keybed split) matches.