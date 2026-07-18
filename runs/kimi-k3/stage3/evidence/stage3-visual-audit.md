# Phase 3 visual audit — Nord Stage 4 73

Captures: `stage3-desktop.png` (1440×900), `stage3-narrow.png` (390×844),
metrics + interaction record in `stage3-capture.json`. Phase 1–2 audits
(`stage1-visual-audit.md`, `stage2-visual-audit.md`) remain valid; this file
covers what changed visually in Phase 3.

## Desktop (1440×900)

- One continuous red chassis, six sections left→right at the documented
  fractions: Performance (14%), Organ (20%), Piano (8.5%), Program (12.5%),
  Synth (25%), Layer Effects (20%). 54/46 deck/keybed split preserved.
- **Organ**: section ON + model selector with the focused layer's live model
  readout (`A: VOX` after the interaction pass), rotary route/speed/drive
  group, vibrato/chorus + percussion button row, nine drawbars each with an
  8-step LED graph above its cap (Phase 3: LED graphs track drawbar value),
  layer A/B, octave, SUSTPED/PSTICK, level fader.
- **Program**: the primary OLED shows `2.2 Arp Pad` after the navigation
  pass (page right + program 2), the clock/transpose/scene line, and a
  truthful dirty `E` when edited. Eight program buttons, page buttons, the
  dial, LIVE MODE / LAYER SCENE / STORE / MST CLK row, SPLIT + LOW/MID/HIGH
  split points + KB ZONE row, morph assign row (WHEEL, A.TOUCH, CTRL PED),
  PANIC, SHIFT.
- **Synth**: the second primary OLED shows the focused layer's waveform,
  Osc Ctrl value, filter type/freq/res, envelope values, LFO wave +
  destination, and arp state. Layer C button added; voice mode + priority
  buttons beside the layer column; the full oscillator/filter/envelope/
  LFO/arp control grid is populated.
- **Split strip** above the keybed: LOW/MID/HIGH split-point LEDs (MID lit
  red after the interaction pass) and four zone keys (Z1–Z4) for KB ZONE
  assignment.
- **Performance**: pitch stick, mod wheel, the new virtual CTRL PEDAL wheel,
  and MASTER LEVEL.
- **Morph LEDs**: small green LEDs appear under morph-assigned
  knobs/faders/drawbars (assigned during the interaction pass: synth filter
  cutoff).
- Green morph LEDs and drawbar LED graphs are visible at this scale; focus
  rings remain visible on keyboard focus.

## Narrow (390×844)

- The chassis scales to 96vw with the same layout; sections stay in order,
  controls remain legible and operable, no vertical scroll, no clipped
  chassis, no detached rails. The split strip and both OLEDs remain visible.

## Interaction pass (recorded in stage3-capture.json)

Organ on → model → rotary route → played C3; synth on → wave → arp run →
played C4; split + split point; scene toggle; morph assign (wheel → synth
filter cutoff) + wheel sweep; Live Mode on/off; four master-clock taps;
page right + program button 2 (landing on `2.2 Arp Pad`); PANIC. Zero
console errors in both viewports.

## Honesty notes

- A.TOUCH morph button, both PANEL A/B select pairs, piano MODEL knob, and
  synth MIX knob are spec-excluded: they move accessibly and do nothing, and
  the status bar lists them as unsupported.
- Both OLEDs are truthful: every value shown is canonical engine state
  (program position/name/E, BPM, transpose, scene, waveform, filter, LFO,
  arp).
