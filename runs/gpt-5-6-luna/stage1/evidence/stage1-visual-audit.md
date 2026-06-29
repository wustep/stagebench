# Phase 1 visual audit

## Reference and measured target

- Selected variant: `stage-4-88`; reference: `reference/nord-stage-4.jpg` at 11,600 × 3,866 px.
- ImageMagick white-margin trim measurement: approximately x=390, y=475, width=10,820, height=2,917; target silhouette ratio ≈ 3.71:1.
- The final browser instrument bounds at 1440 × 900 were x=57.60, y=276.85, width=1,324.80, height=357.09; measured ratio 3.710:1. This is within the measured 88-key reference silhouette.
- Final instrument width is 91.99% of the 1440px viewport, within the 88–97% contract.
- Control deck including the top rail: 53.7% of instrument height. Keybed including the bottom rail: 46.0%. This is within the 54/46 allocation tolerance.
- Final section widths from the rendered deck: Performance 151.05px (13%), Organ 244.02px (21%), Piano 174.30px (15%), Program 104.59px (9%), Synth 244.02px (21%), Layer Effects 244.02px (21%).

## Exact key and landmark checks

- Rendered key count: 52 white keys and 36 black keys, 88 total.
- Key model: A-to-C range, hammer action, black keys at 61% of white-key height.
- Primary displays: exactly 2 — one Program OLED and one Synth OLED.
- Forbidden display check: 0 OLEDs in Performance, Organ, Piano, or Layer Effects.
- Performance: exposed red metal, Master level, pitch stick, modulation wheel, Nord Stage 4 branding; no full dark inset plate and no OLED.
- Organ: nine drawbars, LED ladder, model switches, percussion, vibrato, rotary controls; no wide OLED or uniform equal-width grid.
- Piano: layer level, type/model selectors, timbre and detail controls; no OLED and no drawbar bank.
- Program: primary OLED, encoder, navigation buttons, five Live buttons, morph buttons, keypad.
- Synth: single OLED, level, oscillator, filter, envelope, LFO, and arpeggiator groups; no display spanning the whole section.
- Layer Effects: focus controls, two modulation controls, amp/EQ, delay, compressor, and reverb; no OLED and no undifferentiated grid.

## Measured desktop repair pass 1

Evidence: `evidence/stage1-desktop-pass1.png`.

Largest discrepancies against the selected reference, in comparison order:

1. The brand mark sat on top of the rightmost Layer Effects panel instead of on the red right cheek.
2. The control deck ran nearly to the right edge, leaving no continuous end-cheek area for the brand.
3. The section controls were visually too dense at the boundary between the Synth/Effects panels while the right silhouette landmark was missing.
4. The first desktop capture did not reserve an explicit red end-cheek width for the 88-key silhouette.
5. Narrow behavior had not yet been exercised, so the desktop brand placement had no responsive rule.

Corrections made:

- Reserved a 9% red right-cheek rail by constraining the control deck width while keeping the six normalized section fractions unchanged.
- Repositioned the brand within that continuous red rail and aligned it to the deck/keybed silhouette.
- Added a narrow breakpoint that removes the off-canvas end-cheek brand from the cropped mobile view, preventing it from crossing panel boundaries.
- Rechecked the section/keybed geometry, exact key counts, and forbidden hardware after the repair.

## Measured desktop repair pass 2

Evidence: `evidence/stage1-desktop.png`.

- Browser viewport: 1440 × 900.
- Instrument remained fully visible without vertical scrolling.
- Final bounds and section ratios are listed above; all hard-gate geometry checks pass.
- Browser smoke interactions: clicked Live program 1 (state became `aria-pressed=true` and Program OLED changed to `Live 1 · Stage 4`), clicked A1 white key (pointer lifecycle completed), and incremented Master level by keyboard (68% → 73%).
- Console state after reload and interaction: no error or warning entries.

## Narrow evidence

Evidence: `evidence/stage1-narrow.png`.

- Browser viewport: 390 × 844.
- Instrument remains the dominant content, with a vertically usable control deck and full visible keybed.
- The six-panel deck becomes a horizontally scrollable surface inside the instrument without body-level horizontal overflow (`body.scrollWidth=390`, deck scroll width 687).
- Console state after narrow reload: no error or warning entries.

## Remaining deviations

- This is a CSS/data-driven product study rather than a pixel trace of every photographed label and switch; some micro-labels and small control clusters are simplified.
- The reference’s photographed key fronts have more nuanced perspective and shadows than the flat responsive CSS keybed.
- Some controls are interaction-ready visual stand-ins and do not implement Nord audio or program semantics; Phase 1 explicitly has no audio requirement.
