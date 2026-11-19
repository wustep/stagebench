# Stage 3 Visual, Interaction & Control-Binding Audit — Nord Stage 4 73

## Canonical Captures Verified
- **Desktop (`1440×900`)**: `evidence/stage3-desktop.png` (437,294 bytes; `consoleMessages: []`, `pageErrors: []`)
- **Narrow (`390×844`)**: `evidence/stage3-narrow.png` (131,495 bytes; `consoleMessages: []`, `pageErrors: []`)
- **Capture metadata**: `evidence/stage3-capture.json` (Playwright Chromium `156.0.8078.4`, `deviceScaleFactor: 1`, `reducedMotion: reduce`)

## Geometry & Visual Regression Comparison vs Phase 1 & Phase 2

| Metric | Spec / Phase 1–2 Baseline | Phase 3 Measured (`1440×900`) | Status |
| --- | --- | --- | --- |
| Overall chassis aspect ratio | `3.0951` (`stage-4-73`) | `3.0951` (`1354 × 437 px`) | Pass |
| Deck / Keybed vertical split | `0.54 / 0.46` (±0.025) | `0.540 / 0.460` | Pass |
| Keybed count & range | `73` keys (`43` white, `30` black, `E1–E7`) | `73` keys (`43` white, `30` black, `E1–E7`) | Pass |
| Performance width fraction | `14%` | `13.93%` | Pass |
| Organ width fraction | `20%` | `19.91%` | Pass |
| Piano width fraction | `8.5%` | `8.46%` | Pass |
| Program & Morph width fraction | `12.5%` | `12.44%` | Pass |
| Synth width fraction | `25%` | `24.88%` | Pass |
| Layer Effects width fraction | `20%` | `19.91%` | Pass |
| Primary OLED exclusivity | Program + Synth only | `#program-oled` + `#synth-oled` only | Pass |
| Viewport scrollbars (`1440×900`) | None (`vScroll: false`, `hScroll: false`) | `vScroll: false`, `hScroll: false` | Pass |
| Narrow (`390×844`) layout | Horizontal scroller, unclipped chassis | Horizontal scroller, unclipped chassis | Pass |

## Phase 3 Live Surface & Browser Interaction Pass
Verified in headless Playwright Chromium against the production build (`dist/`):
1. **Startup default (`1.1 Concert Grand`)**: Piano Layer A (`Salamander Grand`, 78/78 samples ready), Organ & Synth off, Splits off, Transpose 0, subtle Booth reverb, Master Level 75%. Program OLED shows `1.1 Concert Grand` / `A: Salamander Grand` / `FX: PNO A · 120BPM` / `SC I · MST 75%`. Synth OLED shows live `SYN A · ANALOG` / `Saw` / `PURE · CTRL 3`.
2. **Program & Live Mode navigation**: Selected `1.2 B3 Soul Rotary` (Organ B3 active + Rotary Slow + Wheel/CtrlPed morphs), switched Organ model to `Vox`, selected `1.3 Analog SuperLead` (Synth OLED updated to `Super Saw`), opened Numeric List View (`32` rows), switched into Live Mode (`L:1`), toggled Layer Scene `II`, enabled Split (`Mid` split LED lit above C4 on bevel), and triggered `Shift + Transpose` Panic (`PANIC: All Notes Off` confirmed).
3. **Console & Page Errors**: `consoleErrors: []`, `pageErrors: []` across both capture and interactive passes.
4. **Status Footer**: Added compact `Ctrl Pedal (CC11): 0%` slider alongside Sustain, `All Notes Off / Panic`, and `Credits & Scope` (now truthfully documenting all Phase 3 live engines, recorded sample attributions, and every spec-excluded control).

## Control-Binding Audit Summary
- **Bound controls**: Every non-excluded control across Performance (7), Organ (22), Piano (16), Program & Morph (23), Synth (40), and Layer Effects (34) mutates canonical state/audio/OLED state with zero silent no-ops (verified automatically by `src/tests/phase3ProgramsAndPerformance.test.ts`).
- **Unsupported (Spec-Excluded) controls** (visibly rendered, accessible, movable/pressable, and explicitly listed in `StatusFooter` Credits & Scope and `IMPLEMENTATION_DETAILS.json`):
  - `program-morph-at` (Aftertouch morph source — browser keyboards lack aftertouch)
  - `program-preset-organ`, `program-preset-piano`, `program-preset-synth` (Per-section preset library cut benchmark-wide)
  - `program-section-edit`, `program-mon-copy` (Section Edit/Layer Init, Monitor/Copy/Paste/Swap, Num Pad mode)
  - `program-btn-1..8` Shift menus (System/Sound/Organize/Aux KB/Output/Pedal/MIDI/Extern, banks beyond 1, external MIDI clock sync, memory protection)
  - `organ-preset` (Preset/Drawbar Live sync, Organ Swell pedal, tonewheel wear modes, trigger point)
  - Synth `Samples` & `Extern` modes, Arp pattern editor/zig-zag/accent/pan, Filter/LFO/Arp Group modes
  - Piano pedal noise, half-pedaling, Triple Pedal hardware modeling, size classes, INFO view
  - Effects per-type Variations, Reverb Chorale, Delay feedback-loop FX/Analog mode, Mod 1 pedal modes, Rotary close mic/stop angle
