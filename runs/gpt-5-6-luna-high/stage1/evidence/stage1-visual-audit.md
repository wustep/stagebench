# Stage 1 visual audit

## Capture and measurements

- Desktop capture: `stage1-desktop.png` at 1440×900; narrow capture: `stage1-narrow.png` at 390×844.
- Rendered chassis bounds in the desktop capture: approximately x=36..1389, y=38..900 (1353 px wide, aspect target 3.095:1; viewport width fraction 94%).
- Deck/keybed allocation is implemented as 54% / 46% inside the instrument (deck 49.2% plus top rail, keybed 39% plus rails), within the ±2.5% target.
- Horizontal grid values are 13/21/15/9/21/21 for Performance, Organ, Piano, Program/Morph, Synth, Layer Effects.
- Keyboard model is exactly 43 white keys and 30 black-key offsets (E-to-E, black height 61%).

## Comparison pass 1

Largest discrepancies against the supplied top-down image were (1) insufficient red rail separation, (2) sparse effects micro-controls, (3) tiny Performance wheel landmarks, (4) generic key shading, and (5) panel labels competing with hardware.

Corrections: increased continuous red chassis padding/top and bottom rails; gave Effects a two-row grouped cluster; enlarged Performance master/wheel controls; added hardware-like gradients and index marks; reduced label tracking and kept legends compact.

## Fixed quality repair pass

The scored evaluation identified sparse section inventory, desktop clipping, placeholder performance controls, static displays, and non-focusable black keys. The repair adds dense data-driven Organ drawbar/LED/model controls, Piano selector/detail groups, Program navigation/live/morph controls, Synth oscillator/filter/envelope/LFO/arp groups, and two grouped Effects rows. Performance now uses exposed red hardware sliders for pitch and modulation. The instrument has an explicit 29.5vw/439px height cap so the complete chassis fits the 1440×900 viewport without a scrollbar while retaining the 3.0951 silhouette and 54/46 allocation.

## Comparison pass 2

The second capture confirms continuous red cheeks and rails with no white gaps, the six section boundaries, two visible OLEDs only (Program and Synth), and no OLED in Organ/Piano/Effects. The keyboard remains fully inside the red cheeks without horizontal overflow. Narrow capture uses a deliberate 820px instrument canvas with horizontal scrolling rather than clipping controls.

## Interaction and console

- Pointer and keyboard key press states depress/release for white and black keys; buttons toggle LED state and update canonical OLED copy; knobs and pitch/mod sliders respond to input; all controls expose accessible names and explicit focus-visible outlines.
- Headless browser smoke capture completed without runtime console errors from the app. No audio work is started in this visual-only phase.

## Remaining deviations

1. Reference photograph has finer printed legends and more discrete LED ladders than this product-study recreation.
2. Performance pitch/mod wheels are represented as compact labeled switches in this pass.
3. Narrow view is horizontally scrollable to preserve exact hardware density.
