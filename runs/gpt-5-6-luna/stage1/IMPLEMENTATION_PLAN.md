# Phase 1 Implementation Plan

## Scope and source of truth

- Assigned domain spec: `specs/nord-stage-4.visual.json`
- Selected variant: `stage-4-88`
- Reference image: `reference/nord-stage-4.jpg` (11,600 × 3,866)
- Measured visible chassis bounds: approximately x=390, y=475, width=10,820, height=2,917; aspect ratio ≈ 3.71:1. The source has a white product-study margin, so the app will use the cropped instrument silhouette while preserving the photographed proportions.
- Vertical allocation: control deck including top rail 54%; keybed including bottom rail 46%.
- Horizontal allocation: Performance 13%, Organ 21%, Piano 15%, Program/Morph 9%, Synth 21%, Layer Effects 21%.
- Selected key model: 88 total keys; 52 white and 36 black; A-to-C range; hammer action; black keys are 61% of white-key height.

## Phase 1 hard gates

- The selected variant's exact keybed is modeled: count, range, and action per specs/nord-stage-4.variants.json (default Stage 4 73 = 73 keys, 43 white and 30 black, E-to-E hammer action).
- Program and Synth are the only primary OLED locations.
- The red chassis is continuous around the deck and keybed.
- Two measured desktop comparison-and-repair passes are complete.

## Build order

1. Define a normalized hardware model with stable section and control IDs, including section-specific groups and exact key geometry.
2. Add the continuous red chassis, top rail, bottom lip, end cheeks, section rails, dark inset panels, and the 54/46 deck/keybed silhouette.
3. Add the photograph-specific landmarks: exposed red Performance bay, Organ drawbars/LED ladders, Piano selectors and faders, central Program OLED/keypad/morph controls, Synth OLED and dense synthesis groups, and the Layer Effects matrix.
4. Add normalized interaction state: pointer/keyboard knob adjustment, toggle LEDs/display state, key depression, focus-visible treatment, and accessible names for every visible control.
5. Add red-green-refactor tests for key counts/pattern, section proportions, control inventory/OLED rules, keyboard/button/knob state, accessibility, and continuous chassis.
6. Run two 1440×900 measurement-and-repair passes, recording the five largest discrepancies and correcting at least the three largest structural discrepancies; then capture 390×844 evidence.

## Component/data model

- `hardware.ts`: immutable `sections`, `controls`, and `keyboardModel` with stable IDs, section ownership, kind, labels, and normalized geometry.
- `App.tsx`: normalized hardware state and event handlers; no isolated component-only state for hardware controls.
- `HardwarePanel.tsx`: renders each section from data and delegates control rendering.
- `Keyboard.tsx`: renders 52 white keys and 36 black keys from the selected A–C model, with stable note IDs and pressed state.
- `HardwareControl.tsx`: shared accessible button/knob/fader/LED primitives, preserving per-control visual hierarchy.
- `styles.css`: product-study surface, continuous red chassis, deck material layers, exact section ratios, responsive narrow overflow treatment, and hardware-like typography/materials.

## Visual and interaction acceptance checklist

- No hero or marketing region above the instrument; at 1440×900 the instrument is the dominant 88–97% viewport-width content and visible without vertical scrolling.
- Performance is exposed red metal and has master level, pitch stick, modulation wheel, and Nord Stage 4 branding; it has no OLED.
- Organ/Piano/Effects have no primary OLED; Program and Synth have exactly one each.
- Organ contains nine drawbars, LED ladders, model switches, percussion, and rotary controls.
- Piano contains layer level controls, type/model selectors, timbre controls, and detail switches.
- Program contains an OLED, encoder, navigation, five Live buttons, and morph controls.
- Synth contains one OLED, level controls, oscillator/filter/envelope/LFO/arpeggiator groups.
- Effects contains two effect groups, amp/EQ, delay, compressor, reverb, and layer focus controls.
- All visible controls have stable accessible names, deliberate state, keyboard input, and focus-visible feedback.

## Evidence and verification

- `evidence/stage1-desktop.png`: second measured desktop pass at 1440×900.
- `evidence/stage1-narrow.png`: responsive 390×844 pass.
- `evidence/stage1-visual-audit.md`: both desktop passes, bounds/ratios, exact counts, forbidden landmarks, console state, corrections, and remaining deviations.
- `IMPLEMENTATION_DETAILS.json`: phase 1 with `None (visual-only phase)` audio strategy and no sample provenance.
- Required commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
