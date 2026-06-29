# Phase 2 visual audit

## Capture conditions

- Desktop capture: 1440×900, current build at `http://127.0.0.1:5174/`.
- Narrow capture: 390×844, current build at the same local URL.
- Comparison inputs: inherited `stage1-desktop.png` / `stage1-narrow.png` and assigned Stage 4 88 reference image.

## Measured checks

- Rendered desktop key count: 88 total, 52 white, 36 black; A-to-C hammer-action model preserved.
- Rendered narrow key count: 88 total, 52 white, 36 black.
- Control-deck grid fractions remain `0.13 / 0.21 / 0.15 / 0.09 / 0.21 / 0.21`.
- Desktop instrument remains a single continuous red chassis with the inherited top rail, deck, keybed, and bottom rail.
- Primary OLED count remains two: Program and Synth only.
- Narrow layout keeps the instrument at 370px wide and exposes the control deck through horizontal overflow.

## Interaction and console pass

- Pointer key click exercised on A1; Live program 1 exercised; computer-key `A` exercised through the shared keyboard handler.
- Sample status rendered as `SAMPLED PIANO` with bundled local assets.
- Browser console error and warning logs: none observed in desktop or narrow passes.

## Three visible remaining deviations

1. The control deck is a compact CSS study rather than a pixel-level recreation of every photographed label and micro-control.
2. Narrow mode uses horizontal scrolling for the dense control deck, so not all sections are visible simultaneously.
3. The bundled primary bank uses seven recorded A-root samples and one recorded velocity layer; velocity variation is shaped in the audio graph rather than supplied by multiple recorded layers.
