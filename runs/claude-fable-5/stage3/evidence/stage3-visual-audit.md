# Stage 3 visual & flow audit — Nord Stage 4 73 (candidate)

Candidate-captured evidence (the canonical `stage3-desktop.png` / `stage3-narrow.png` /
`stage3-capture.json` are produced by the parent capture harness against the sealed build):

- `evidence/candidate-stage3-desktop.png` — 1440×900, Chromium headless (playwright-core, locally cached browser).
- `evidence/candidate-stage3-narrow.png` — 390×844.
- Stage 1 and Stage 2 evidence retained untouched for comparison.

## Visual comparison against Phase 1/2 evidence (drift check)

Compared `candidate-stage3-desktop.png` against `candidate-stage2-desktop.png`
(and the canonical `stage2-desktop.png`):

- Chassis, six-section layout (13/21/15/9/21/21 column ratios per
  `nord-stage-4.visual.json`), 54/46 deck/keybed split, 73-key E–E keybed
  geometry, colors and materials are unchanged — no drift.
- Intentional Phase 3 changes only (all reflect canonical state that was
  static decoration in Phase 2):
  - **Organ section**: drawbar LED ladders track canonical (and morphed)
    drawbar values per focused layer; model/preset/vib-chorus/percussion LEDs
    live; layer A/B enable + level meters live.
  - **Synth section**: OLED shows the focused layer's waveform, category and
    active menu (oscillator/filter/envelope/LFO/arp readouts); layer A/B/C
    enable + level meters, voice/vibrato/arp/KB Hold LEDs live.
  - **Program section**: OLED program line shows bank.slot, name and an `E`
    (edited) flag; perf line shows `♩<BPM> · Transp · Split · Scene`; program
    page indicator (`data-testid="program-page"`), Live LED, numeric List
    view, Store/Store As naming flow with cursor, morph source indicators.
  - **Split LED strip** above the keybed (`data-testid="split-led-strip"`):
    green LEDs at the 11 canonical split positions (C2–C7) light per active
    split points, matching hardware placement.
  - Status strip now reports the full functional set and the honest
    visual-only list (aftertouch morph, preset libraries, Section Edit /
    Layer Init / Monitor-Copy menus, Samples/Extern synth modes).
- No marketing hero, no reference-photo overlay, no new primary displays, no
  drawbars outside Organ, chassis continuous, nothing clipped at either
  viewport, instrument fully visible without vertical scroll at 1440×900.

## Browser interaction pass — Phase 3 (scripts/verify-browser-stage3.mjs, 21/21 pass)

Run against the production build (`vite preview`) in headless Chromium with an
AnalyserNode (smoothing 0) tapped on the real master gain — audible
signal-path verification, not source presence. Exercised flows:

1. **Organ audible on its own** (piano off, organ layer A on): B3 max
   RMS 0.060.
2. **Organ models audibly distinct** through the panel Model button:
   spectral centroid B3 11.2 / Vox 13.0 / Farf 130.5 (spread 11.7×).
3. **Drawbars audibly live**: pulling the 1′ drawbar (2093 Hz partial on C4)
   raised the >1.8 kHz spectral-power share from 0.000 to 0.250.
4. **Percussion + vibrato/chorus** write canonical state with LED feedback.
5. **Synth audible on its own** (Pure sine, RMS 0.028); **categories audibly
   distinct** via the panel Waveform button: high-band power share
   Pure 0.151 / Super 0.158 / FM-H 0.001 (spread 130×, FM-H default patch is
   dark as configured).
6. **Filter audibly darkens**: closing Freq on a Super Saw dropped the
   >1.2 kHz power share from 0.158 to 0.000.
7. **Arpeggiator + KB Hold**: stepped notes keep sounding after key release
   (RMS 0.057 during the held-arp window); Panic stops the arp.
8. **Programs**: editing a fader shows the `E` dirty flag; STORE →
   Program 3 → STORE stores and lands on 1.3 clean; selecting 1.1 then 1.3
   round-trips the stored edit (level 96 restored).
9. **Live Mode**: edits auto-store into the active Live slot.
10. **Split audibly gates**: with Split on and piano A restricted to the low
    zone, a note below the split sounds (RMS 0.0027) and a note above is
    silent (0.0000).
11. **Scenes**: II presents a fresh enable set, I restores layer B, sound
    parameters untouched.
12. **Morphs**: Wheel capture + drawbar move records one assignment; moving
    the mod wheel morphs the live organ tone (>1.8 kHz power share 0.000 →
    0.250); Shift+Wheel clears assignments.
13. **Transpose** set-mode via Shift+Transpose, dial = ±6 (on, +3 verified);
    **Master Clock** tap tempo lands 143 BPM from ~400 ms taps, shown on the
    perf OLED line.
14. **Panic** silences immediately (RMS 0.0000).
15. **Console: zero errors** across the whole pass (fail-fast assertion).

## Browser regression pass — Phase 2 script (scripts/verify-browser.mjs, 26/26 pass)

The full Phase 2 interaction pass (pianos, layers, pedals, all six effect
families, rotary, focus/bypass, rapid play, panic, master volume, asset-failure
fallback) still passes 26/26 against the Phase 3 build with zero console
errors — no earlier-phase regression.

## Known deviations

- Eight numbered Program buttons (reference/manual) vs "five live-program
  buttons" in the visual spec — reference wins, documented since Phase 1.
- Micro-detail: printed legend typography and some LED placements are
  approximate at small sizes.
- Visual-only controls remaining in Phase 3 (declared in the status strip,
  `IMPLEMENTATION_DETAILS.json` and `hardware.ts` `UNSUPPORTED_CONTROL_IDS`):
  aftertouch morph source, piano/organ/synth preset-library browsing,
  Section Edit / Layer Init / Monitor-Copy menus, and the Samples/Extern
  synth oscillator sources (no sample library is shipped for them — honesty
  contract). They render and depress but visibly do nothing.
- Organ/Synth audio is synthesized (oscillator-built), truthfully declared in
  `IMPLEMENTATION_DETAILS.json`; pianos remain recorded samples with the
  labeled synthesized fallback.
- Master Clock tap averages the last taps within a 3 s window; extremely slow
  taps (>3 s apart) restart the average rather than extending it.
