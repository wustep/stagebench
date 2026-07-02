# Stage 2 visual & flow audit — Nord Stage 4 73 (candidate)

Candidate-captured evidence (the canonical `stage2-desktop.png` / `stage2-narrow.png` /
`stage2-capture.json` are produced by the parent capture harness against the sealed build):

- `evidence/candidate-stage2-desktop.png` — 1440×900, Chromium headless (playwright-core, locally cached browser).
- `evidence/candidate-stage2-narrow.png` — 390×844.
- Stage 1 evidence (`stage1-*.png`, `stage1-visual-audit.md`, `stage1-capture.json`) retained untouched for comparison.

## Visual comparison against Phase 1 evidence (drift check)

Compared `candidate-stage2-desktop.png` against the canonical `stage1-desktop.png`
and `candidate-stage2-narrow.png` against `stage1-narrow.png`:

- Chassis, six-section layout (13/21/15/9/21/21), 54/46 deck/keybed split,
  73-key E–E keybed geometry, colors and materials are unchanged — no drift.
- Intentional Phase 2 changes only:
  - Delay group gains the reference-faithful **FILTER** button with HP/BP/LP
    legend tokens (present on the real hardware; Phase 1 had only the printed
    legend). Delay group control count is now 8 (was 7); documented in
    `src/model/hardware.test.ts`.
  - Effect type selector legends now highlight the ACTIVE type token
    (Mod 1/Mod 2/Amp/Delay/Reverb), and GLOBAL tags light when a unit is in
    Global mode — LED-style state that was static in Phase 1.
  - Piano Select type LEDs, Timbre/KB Touch/Dyn Comp/Unison/Acoustics LEDs,
    FX Focus LEDs, rotary SLOW/FAST/STOP LEDs and layer-focus letters now
    reflect canonical state instead of fixed decoration.
  - Program OLED bottom three lines now show the real piano selection,
    engine status, and a truthful last-edit readout.
  - Status strip: added the pedal state line and updated the honesty note to
    the Phase 2 functional/decorative split.
- No marketing hero, no reference-photo overlay, no new primary displays, no
  drawbars outside Organ, chassis continuous, nothing clipped at either
  viewport, instrument fully visible without vertical scroll at 1440×900.

One interaction repair found during the browser pass: decorative group-box
titles could intercept clicks aimed at nearby controls (Playwright strict
click caught it on the Delay ON button); fixed with `pointer-events: none`
on `.group-box-title` (visual appearance unchanged).

## Browser interaction pass (scripts/verify-browser.mjs, 26/26 pass)

Run against the production build (`vite preview`) in headless Chromium with an
AnalyserNode tapped on the real master gain — audible signal-path verification,
not source presence. Exercised flows:

1. Lazy engine start on first key gesture → `ready` with recorded-sample truth.
2. All three Piano selections (Grand/Upright/Electric) audible through the
   panel Piano Select button, display feedback correct, spectral centroid
   spread 1.35× (audibly distinct in-browser).
3. Clav (unpopulated) → "Piano not found" on the Program display, flashing
   type LED, silent (no pretend voice); recovery by re-selection.
4. Two layers: B enable adds signal; B level fader mutes it; per-layer octave
   shift with display feedback; focus follows layer enable (hardware behavior).
5. Pedals: Space sustain holds and damps; continuous CC64 half-pedal level,
   soft (Z/CC67) and sostenuto (X/CC66) paths verified; pedal status strip.
6. Every effect family measurably changed the live signal: Mod 1 tremolo
   amplitude fluctuation 13.7× vs 6.4× decay baseline; Mod 2 chorus engaged;
   Delay repeats sounding after release; Amp drive; Compressor; Reverb tail
   above the dry tail; Rotary routed via Amp "To Rotary" with fast/slow
   fluctuation, all with click-free On/bypass through the real panel buttons.
7. FX focus cycling A → B → Group with LEDs; Shift+On Global; All FX Off
   bypass and restore.
8. Rapid play: 30 fast notes — voices return to zero, output settles, no errors.
9. Panic: immediate silence + display feedback; master volume knob from mute
   to full.
10. Asset failure (fetch blocked on samples/): labeled synthesized FALLBACK
    status, still playable, never reported ready.

Console: **zero errors** across the whole pass (fail-fast assertion in the
script); the sample-blocking fallback scenario runs in a separate page so its
deliberate fetch rejections cannot pollute the main pass.

## Known deviations (unchanged from Phase 1 unless noted)

- Eight numbered Program buttons (reference/manual) vs "five live-program
  buttons" in the visual spec — reference wins, documented in Phase 1.
- Micro-detail: printed legend typography and some LED placements are
  approximate at small sizes.
- The Synth FX-focus button remains decorative (no Synth engine until
  Phase 3); everything else in the Layer Effects and Piano sections is
  functional.
- Rotary CLOSE MIC / MORPH buttons and the mod wheel remain decorative
  (morph assignment is Phase 3 scope).
