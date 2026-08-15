# Stage 2 — Visual audit (Nord Stage 4 73)

Phase 2 keeps the complete Phase 1 surface and adds *functional* behavior to
the Piano and Layer Effects sections. This audit confirms the surface is
regression-free and the Phase 2 additions are visibly present and allowed by
the visual spec (no forbidden hardware introduced).

Reference: `nord-stage-4.visual.json`, variant `stage-4-73`
(`reference/nord-stage-4-73.jpg`).

## Surface regression (Phase 1 preserved)

- **Chassis / silhouette**: a single continuous red chassis, one `.chassis`
  element, no detached rails, no marketing hero above the instrument, no
  overflow. Desktop instrument fills ~0.88–0.97 of the 1440×900 viewport;
  narrow (390×844) keeps the proportional (fraction) layout, so nothing is
  clipped.
- **Keybed**: exactly 73 keys (43 white / 30 black), range E1..E7, continuous
  tiled white keys with black keys centered on seams. Munition counted in the
  rendered DOM: 73 present.
- **Deck sections**: six ordered sections at the documented fractions
  (0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20), 54/46 deck:keybed split.
- **OLEDs**: only Program and Synth are primary OLED locations (two total).

## Phase 2 additions — allowed landmarks

- **Piano section** gains per-layer **enable** buttons and **octave** knobs
  (layer A/B). These are added to the piano-detail control cluster; the section
  surface remains a dark inset plate with red perimeter and contains **no wide
  OLED and no drawbar bank** (allowed).
- **Layer Effects section** gains **group mode**, **all-effects / Layer Effects
  ON**, **To Rotary (A/B)**, **global** toggles for Delay/Compressor/Reverb, a
  **delay feedback filter** knob, and **amp/EQ type + mid controls**. These live
  in the existing two-effect-group / amp / delay / compressor / reverb / focus
  clusters. The section still has **no OLED** and is not an undifferentiated
  grid (allowed: it preserves the two-group structure).
- **Master Level** (performance section) is functional and drives the master
  path; it remains the exposed-chassis performance cluster knob.

## Materials & colors

Reference palette unchanged: `#851a25` chassis mid, `#5a0c13` chassis dark,
`#3c424d` panel blue-gray, `#0b0b0b` keys-black, `#dcdcdc` keys-white.

## Console / interaction pass

The built app loads with **no console or page errors** at desktop (1440×900)
and narrow (390×844). (A single benign `ScriptProcessorNode` deprecation
*warning* appears during audio runtime — not an error; the graph realizes one
AudioContext with per-layer buses, ordered effects, Master Level, limiter, and
one destination, and disposes cleanly.)

## Captures

- `evidence/stage2-desktop.png` (1440×900)
- `evidence/stage2-narrow.png` (390×844)
- `evidence/stage2-capture.json` (browser profile + console)

## Conclusion

The Phase 1 surface, keybed, and input behavior are regression-free; the Phase
2 Piano and Layer Effects functionality is present and visually consistent
with the reference, with no structural or inventory regressions.