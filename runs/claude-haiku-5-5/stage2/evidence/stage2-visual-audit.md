# Phase 2 visual audit — Nord Stage 4 73 (stage-4-73)

Captures: `stage2-desktop.png` (1440x900), `stage2-narrow.png` (390x844). Measurements: `stage2-capture.json`.
Reference: `inputs/reference/nord-stage-4-73.jpg`. Baseline for regression: `stage1-desktop.png`, `stage1-narrow.png`, `stage1-visual-audit.md`.
Provenance: self-captures in this workspace. The parent capture harness was not present, so these are not parent-harness outputs.

## Chassis: unchanged from Phase 1

| Item | Phase 1 | Phase 2 | Spec |
| --- | --- | --- | --- |
| Instrument width / viewport | 94.0% | 94.0% | 88–97% |
| Instrument aspect | 3.098 | 3.095 | 3.0951 |
| Deck share of instrument height | 54.0% | 54% | 54% ±2.5% |
| Keys, white / black | 73, 43 / 30 | 73, 43 / 30 | 73, 43 / 30 |
| Section widths | 184 / 259 / 118 / 167 / 321 / 259 px | identical | documented fractions |
| Document scroll at 1440x900 | none | none | none |
| OLEDs | 2 (Program, Synth) | 2 (Program, Synth) | Program and Synth only |

The keybed, the six section fractions, the rails, and the red and blue-grey surfaces are the same as Phase 1.

## Deliberate surface changes (declared)

1. **Layer Effects gained controls.** Each unit now has its type selector, On switch, or both: Mod 1 and Mod 2 type plus On, Amp type and On, Delay filter, Compressor fast, Reverb type, and the Effect focus group (Piano group, Layer effects on). The effect group count stays at five; the groups grew (Mod now holds both Mod units).
2. **Section zoom and gaps in Layer Effects.** The effects section zoom went from 0.88 to 0.78, with gaps of 0.15cqw and legends capped at 3.8cqw. Without this the eight-control groups overflowed the chassis to the right (measured: Mod 2 on at x≈1397, past the deck edge). The fix was measured in the browser before it was applied.
3. **Legends now say what the control does.** Amp tone is "Amp mid freq", Amp level is "Amp output", the EQ knobs read "EQ bass", "EQ mid gain or res", and "EQ treble", Delay level is "Delay mix", and Reverb tone is "Reverb bright" with "Reverb mix" for the level.
4. **Starting values.** KB touch starts at Medium, SUSTPED starts on, Reverb type starts at Room.
5. **Status text.** Two status lines were added under the pedal (engine and piano), so the instrument sits about 20 px higher than in Phase 1 at 1440x900. The chassis itself is unchanged.
6. **OLED text** reads "NOT ACTIVE IN PHASE 2" on the Program and Synth displays, which stay decorative.

## Legibility

- Layer Effects legends are about 6px at 1440 wide, the same size class as Phase 1's small legends. They are the most cramped text on the surface.
- The Piano section legends overlap slightly at their Phase 1 positions (Layer A/B focus and level, Timbre, Dyn comp). Those overlaps were present in Phase 1 and were not changed.

## Narrow (390x844)

Same approach as Phase 1: the instrument keeps its designed width inside a horizontal scroll region. The status text wraps. No change in behaviour.

## Console and errors

Zero page errors and zero console errors on load, Layer B, Mod 1, Shift+Delay On, keybed press, and sustain pedal. One browser warning about blocked MIDI SysEx permission comes from the environment, not the app.
