# Phase 1 implementation plan

Variant: `stage-4-73` (default)

Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.variants.json`

## Hard gates (verbatim)

- The selected variant's exact keybed is modeled: count, range, and action per specs/nord-stage-4.variants.json (default Stage 4 73 = 73 keys, 43 white and 30 black, E-to-E hammer action).
- Program and Synth are the only primary OLED locations.
- The red chassis is continuous around the deck and keybed.
- Two measured desktop comparison-and-repair passes are complete.

## Measured geometry

- Source chassis bounds: 9013 × 2912 at x=1292, y=410 on 11600 × 3866; aspect ratio 3.0951.
- Control deck including top rail: 54%; keybed including bottom rail: 46% (±2.5%).
- Horizontal sections: Performance 13%, Organ 21%, Piano 15%, Program/Morph 9%, Synth 21%, Layer Effects 21%.
- Keyboard model: E-to-E, 43 white keys and 30 black keys; black key height 61% of white key height.

## Landmarks and model

Performance is exposed red metal with master level, pitch stick, modulation wheel, and Nord branding; it has no OLED. Organ has a dark inset plate, nine drawbars, LEDs, model/percussion/rotary controls, and no OLED. Piano has layer controls, type/model/timbre/detail controls and no OLED. Program/Morph has the sole program OLED, encoder, navigation, five live buttons, and morph controls. Synth has the sole synth OLED plus oscillator/filter/envelope/LFO/arp clusters. Effects has two effect groups, amp/EQ, delay, compressor, reverb and focus controls with no OLED.

Controls are data-driven with stable IDs (`section.control`) and shared normalized state. Large encoders/faders outrank secondary knobs, then switches/LEDs.

## Repair loop

Two desktop passes compare 1440×900 captures cropped to the instrument bounds in this order: forbidden landmarks/section boundaries, density/placement, chassis/key geometry, materials, typography. Largest five discrepancies and corrections are recorded in `evidence/stage1-visual-audit.md`; a 390×844 capture follows the second pass.
