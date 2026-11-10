# Stage 2 visual audit — regression against Phase 1

Variant: Stage 4 73. Captures: `stage2-desktop.png` (1440 × 900, untouched start-up state),
`stage2-effects-on.png` (1440 × 900, after the browser pass has switched layers and effects on),
`stage2-narrow.png` (390 × 844). Measurements and the browser-pass record: `stage2-capture.json`.

How they were made: `scripts/capture-stage2.js`, run in Playwright Chromium 157 against
`vite preview` of the production build. The parent capture harness named in the phase prompt is
outside the workspace and was not reachable. The Phase 1 captures in this folder
(`stage1-*.png`, `stage1-capture.json`) are the ones the Phase 1 seal left here (Chromium 156);
they were not regenerated.

Phase 2 changes no geometry. This audit shows that, and lists every pixel-level difference that
does exist and why.

## Geometry: unchanged

Every number is read from the live DOM (`stage2-capture.json` → `geometry`); the Phase 1 column is
from `stage1-visual-audit.md`.

| Measure | Spec | Phase 1 | Phase 2 |
| --- | --- | --- | --- |
| Instrument box at 1440 × 900 (x, y, w, h) | — | 43.2, 137.6, 1353.6, 437.3 | 43.2, 137.6, 1353.6, 437.3 |
| Width fraction of viewport | 0.88–0.97 | 0.94 | 0.94 |
| Aspect ratio | 3.0951 | 3.095 | 3.095 |
| Deck share of height | 0.54 ± 0.025 | 0.54 | 0.54 |
| Section widths | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 | same | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 |
| Keys | 73 | 73 | 73 |
| Panel controls | — | 146 | 146 (50 functional, 96 decorative) |
| LEDs | — | 231 | 231 |
| Display elements (spec rule) | Program and Synth only | `program-oled`, `synth-oled` | `program-oled`, `synth-oled` |
| Page scroll at 1440 × 900 | none | 1440 × 900 | 1440 × 900 |
| Horizontal overflow at 390 × 844 | none | 0 | 0 |
| Instrument box at 390 × 844 (x, y, w, h) | — | 11.7, 134.9, 366.6, 118.4 | 11.7, 54.5, 366.6, 118.4 |

The one moved number is the last: on the narrow viewport the instrument sits 80 px higher,
because the status console under it is taller (a third status chip and the Shift help). Its size,
shape, and contents are the same. On the desktop viewport the console was laid out to be exactly
as tall as in Phase 1 (191.5 px), so the instrument did not move at all.

## Image comparison

SSIM between the Phase 1 and Phase 2 captures (ffmpeg `ssim`, all channels):

| Region | SSIM |
| --- | --- |
| Desktop, whole page | 0.942 |
| Desktop, instrument box only | 0.987 |
| Desktop, keybed half of the instrument (nothing in it changed) | 0.984 |
| Narrow, instrument box only (each cropped at its own position) | 0.982 |
| Narrow, whole page | 0.454 — the 80 px shift above, plus the taller console |

The keybed row is the noise floor: no pixel of the keybed is drawn differently in Phase 2, yet it
scores 0.984, because the two sets of captures come from different Chromium builds (156 and 157)
with slightly different text and edge antialiasing. The instrument as a whole scores the same as
that floor. A difference image of the two desktop captures shows only the items listed below.

## Every intended difference on the instrument

Nothing was added, removed, moved, or resized. What differs is which LEDs are lit at start-up and
what the Program display says. Knob, fader, drawbar, and selector positions are still the photo's.

**Program OLED** — Phase 1 showed "Basic Piano" and three status rows. Phase 2 shows the Piano layer
summary, the focused layer's model name ("Salamander Grand"), the source line ("RECORDED SAMPLES"
/ "SYNTHESIZED, NOT RECORDED" / "PIANO NOT FOUND - FALLBACK"), the same three status rows in a
slightly smaller face, and the last panel action. Same window, same size, still no program name.

**Synth OLED** — the words "PHASE 1" became "PHASE 2".

**LEDs that start in a different state (18 of 231)**, each because a lit LED would now be a claim:

| LED | Photo / Phase 1 | Phase 2 | Why |
| --- | --- | --- | --- |
| Piano Layer B ON | lit | dark | Layer B starts off, so one key strikes one voice and the default sound is one piano |
| Piano FX FOCUS | dark | lit | Effect focus really is on the Piano (the only section with effects in this phase) |
| FX Focus Piano A | dark | lit | Same: the focused chain is Piano Layer A |
| FX Focus Synth A, B, C (3) | lit | dark | There are no Synth effects yet; the button is decorative and starts on None |
| Mod 1, Mod 2, Amp Sim/EQ, Delay, Reverb ON (5) | lit | dark | Every effect unit starts off: the instrument starts as a plain piano |
| Amp Sim Drive ON | lit | dark | Lit only while overdrive is actually applied |
| Rotary Speaker ON | lit | dark | Lit only while a layer is actually routed To Rotary |
| Delay Effects: VIBE, ENS (2) | lit | dark | Delay feedback effects are excluded by the effects spec |
| Mod 2 VARIATION | lit | dark | Variations are excluded |
| Reverb CHORALE | lit | dark | Chorale is excluded |
| Piano PED NOISE | lit | dark | Pedal noise is excluded |

48 LEDs are lit at start-up. All of them belong either to a functional control whose state they
show truthfully, or to a decorative Organ / Synth / Program control in its photo position.

**Selector positions added** (data only, no new hardware): the Amp Sim/EQ selector has a seventh
position, "EQ only", with no model LED lit (manual p. 51); the FX Focus Piano selector has a
"Group A B" position that lights both of its LEDs.

**New visual states that appear only in use**: a blinking LED (the focused layer when both are on;
a piano type whose samples are missing), and a yellow outline on a latched Shift button. With
`prefers-reduced-motion` the blink is replaced by a dashed outline.

## Differences outside the instrument

The status console under the instrument: a third chip (Piano: recorded samples / synthesis /
fallback / loading, with the model and its credit), a *Sample credits* button that opens a panel
above the tools row, a one-line Phase 2 note, and a one-line Shift help. On wide screens each chip
is held to one line (the full sentence is in its tooltip and in the accessibility tree).

## Spec landmarks and forbidden hardware

Unchanged from Phase 1 and still enforced by the Phase 1 suites
(`tests/visual.control-inventory.test.tsx`, `tests/visual.section-layout.test.tsx`,
`tests/regression.chassis.test.tsx`), which run unmodified: all required landmarks present in
their own sections; no display element outside the Program and Synth windows; no drawbar bank in
the Piano section; the effects band is still two visibly separate groups; the performance band is
still exposed red chassis.

## What the browser pass saw

From `stage2-capture.json`, production build, real AudioWorklet, real sample files:

- Start-up: audio Idle, display "Salamander Grand / RECORDED SAMPLES - STANDBY".
- First key: Ready in an AudioWorklet; 90 sample requests, all to the page's own origin; signal
  measured at the node's output; one AudioContext, one connection to its destination.
- All six types: Ready, named on the display, each with signal. Grand, Upright, Electric read
  "RECORDED SAMPLES"; Clav, Digital, Misc read "SYNTHESIZED, NOT RECORDED".
- Layers: B on → two voices per key, B's LED blinking as the focused layer; Shift + Layer A toggled
  SUSTPED off and on with the real Shift key.
- Piano controls and each effect unit: LED and display follow, signal present.
- Tap tempo: two real clicks about 0.4 s apart set "416 ms"; the knob's value text agreed.
- To Rotary + Fast: Rotary ON LED lit. Group and Global: LEDs lit.
- Master Level to zero with a note held: measured output exactly 0. All notes off: output 0, 0 voices.
- Still one context and one destination connection at the end.
- With the Upright files blocked: status Fallback with the reason, display "Fallback Synth Piano /
  PIANO NOT FOUND - FALLBACK", Upright LED blinking, and the keybed still sounding; Electric then
  loaded normally and the status returned to Ready.
- Console: no errors or warnings in any step before the fallback step; in the fallback step, one
  `net::ERR_FAILED` per blocked Upright file (66), which is that step doing its job. No page errors.

## Known limits of this audit

- The Phase 1 and Phase 2 captures come from different Chromium builds, so SSIM cannot reach 1.0
  even for untouched regions; the keybed row is given as the floor.
- Blinking LEDs are captured wherever the blink happened to be.
- Audio levels in the capture file are single 170 ms snapshots from an AnalyserNode the capture
  script adds for measuring; they show that signal flows, not how it sounds. The measured audio
  behaviour is in the test suites.
