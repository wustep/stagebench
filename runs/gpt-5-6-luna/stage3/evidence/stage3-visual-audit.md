# Phase 3 visual and browser audit

## Capture contract

- Selected variant: Stage 4 88 (`stage-4-88`), 88 keys, A–C, hammer action.
- Desktop capture: `stage3-desktop.png`, requested viewport 1440×900.
- Narrow capture: `stage3-narrow.png`, requested viewport 390×844.
- Reference: `reference/nord-stage-4.jpg`.
- Inherited comparison: `evidence/stage2-desktop.png` and `evidence/stage2-narrow.png`.

## Measured checks

- The rendered DOM exposes 88 total keys: 52 white and 36 black, with the inherited A–C range and hammer-action data attributes.
- The control deck retains the six ordered sections and normalized ratios 0.13 / 0.21 / 0.15 / 0.09 / 0.21 / 0.21.
- Only Program and Synth expose primary OLED status regions; Performance, Organ, Piano, and Layer Effects do not.
- Desktop viewport was 1440×900; narrow viewport was 390×844. Narrow layout uses the inherited horizontally scrollable control-deck treatment so the 88-key model remains inside the red chassis.

## Browser interaction and console

- Desktop smoke exercised Live program 1, A1 pointer key interaction, and Reverb control interaction.
- Narrow smoke reloaded the built artifact and confirmed the keybed remained rendered.
- Browser console error and warning logs: none observed.
- The real browser environment reports `MIDI DENIED` when permission is unavailable; this is displayed as status and does not prevent Piano interaction.

## Shared audio evidence

- The source graph describes one AudioContext with Piano A/B layer buses, ordered Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb → Rotary chains, master bus, limiter, and one destination.
- Unit tests cover the graph topology and deterministic representative processing. Physical output and hardware MIDI were not available for this smoke pass.

## Three most visible remaining deviations

1. The inherited compact hardware surface remains visually closer to the Phase 2 implementation than to the full-resolution 88-key product photograph; micro-control placement and material detail are simplified.
2. The new canonical Program/effect modules are present in source and tests but are not yet surfaced as a complete rendered Program editor on the hardware surface.
3. The browser capture confirms inherited Piano/Live/Reverb interaction, but does not establish audible measurement of every Phase 3 effect family in a physical output device.
