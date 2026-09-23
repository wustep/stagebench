# Stage 3 visual audit — Nord Stage 4 73 (`stage-4-73`)

Run `claude-opus-5-5`, Phase 3 (complete system: Organ, Synth, Programs). Specs: `nord-stage-4.visual.json`,
`nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`,
`nord-stage-4.synth.json`, `nord-stage-4.variants.json` (`stage-4-73`). Reference: `reference/nord-stage-4-73.jpg`.

The canonical captures come from the parent capture harness at seal. The numbers below come from my own pass over the
production build (`pnpm build`, then `vite preview`) in headless Google Chrome 151. `scripts/browser-pass.mjs` drives
Chrome over the DevTools protocol on a pipe, with device-metrics emulation at scale factor 1. I took
`getBoundingClientRect()` before any scrolling. The raw record is `evidence/stage3-browser-pass.json`. The screenshots
from that pass are `evidence/stage3-pass-desktop-initial.png`, `…-desktop-organ.png`, `…-desktop-synth.png` and
`…-narrow.png`.

## Measured bounds (Phase 2 → Phase 3)

| Metric | 1440 × 900 Phase 2 | 1440 × 900 Phase 3 | 390 × 844 Phase 2 | 390 × 844 Phase 3 | Target |
| --- | --- | --- | --- | --- | --- |
| Instrument box (x, y, w, h) | 50.4, 140, 1339.2, 432.7 | 50.4, 79, 1339.2, 432.7 | 8, 89, 374, 120.8 | 8, 104, 374, 120.8 | — |
| Width / viewport | 0.930 | **0.930** | 0.959 | **0.959** | 0.88–0.97 desktop |
| Aspect (w / h) | 3.0948 | **3.0948** | 3.0948 | **3.0948** | 3.0951 |
| Deck / instrument height | 0.5397 | **0.5397** | 0.5397 | **0.5397** | 0.54 ± 0.025 |
| Document scroll size | 1440 × 900 | **1440 × 900** | 390 × 844 | **390 × 854** | no vertical scroll (desktop), no horizontal overflow |
| Rendered keys | 73 | **73** | 73 | **73** | 73 (E1–E7) |
| Console errors / page errors | 0 / 0 | **0 / 0** | 0 / 0 | **0 / 0** | 0 |

The status panel under the instrument gained a Program row (location, name, E badge, scene, tempo, Control Pedal,
Panic) and a collapsed "Unsupported controls" list. It moved the instrument's vertical position only. The desktop page
is still exactly 1440 × 900 with no scroll. The narrow page scrolls 10 px vertically below the instrument, and there is
no horizontal overflow.

## Visual regression against Phase 2

I compared pixels between `stage2-desktop.png` and `stage3-pass-desktop-initial.png` over the instrument box
(1339 × 432, aligned on each box origin). A pixel counts as changed when its channel difference is > 32.

| Section | Changed pixels |
| --- | --- |
| Performance | 0.03 % |
| Organ | 0.10 % — organ LEDs now show state (model B3, layer A, KB zone LEDs off) |
| Piano | 0.03 % |
| Program | 0.47 % — the OLED shows `1.1 Grand Piano`, the program 1 LED, footer `PIANO A` |
| Synth | 0.71 % — the Synth OLED shows the waveform page; the ANALOG mode LED is lit |
| Layer Effects | 0.04 % |
| Keybed | 0.00 % |
| **Whole instrument** | **0.15 %**; narrow profile 0.38 % |

No geometry, chassis, key or control position changed. The one panel-definition change is the Rotary ORGAN button,
which no longer lights the Rotary ON LED as its own presentation state. ON now shows real routing: any layer that
reaches the Rotary. At boot, the default Organ and Synth state uses the drawbar registration, fader levels and knob
positions printed in the reference photo, so the powered-up panel matches the photo.

## Interaction pass (production build, 1440 × 900, autoplay allowed)

All 18 steps ran with **0 console messages and 0 page errors** (`evidence/stage3-browser-pass.json`):

- **Piano:** C4+E4 from the computer keyboard gave "2 / 24 voices … (A 2 · B 0)" and "Audio output running".
- **Organ (1.2 B3 Rock Rotary):** after loading the program, the Program OLED showed `B3 888600000 / Vib C3 · Perc 3rd /
  ORGAN A` and two organ voices sounded. Pulling drawbar 5 lit all 8 cells of its LED graph and brought up the E
  (edited) indicator. I also switched the Rotary to fast.
- **Store:** STORE, program button 7, STORE stored the edit as `1.7 B3 Rock Rotary` and cleared E.
- **Live Mode:** turning it on selected `Live 1 Grand Piano` and lit the LED. An edit auto-stored with no E. Turning it
  off returned to 1.7.
- **Split:** SPLIT on, then Shift+SPLIT, dial ×2, page ▸ and dial set the OLED to `Low Off | Mid C5 ±6 | High Off`.
- **Layer Scene II:** the LED lit and the status read "Scene II".
- **Synth (1.6 Super Saw Lead):** the Synth OLED showed `Super Saw / Category: Super / …`. I latched a Wheel morph onto
  the filter cutoff. Afterwards the morph LEDs were lit and the wheel moved the cutoff.
- **Synth pages:** the filter type and amp envelope pages changed through the OLED dials, and the envelope curve drew.
- **Arpeggiator (2.1 Arp Pluck 110):** I held a three-note chord. With the Master Clock at 110 BPM the arpeggiator
  played one voice at a time.
- **Master Clock tap:** four taps 400 ms apart set 148 BPM (browser timer jitter around the nominal 150).
- **Panic:** Shift+Transpose while holding showed `PANIC: all notes off`. After the keys were released, 0 voices
  remained.
- **Other organ models:** Vox (1.3), Farf (1.4) and Pipe (1.5) loaded and played.

An earlier pass found three problems, and I fixed each one before this pass:

- The Program OLED kept showing the piano section after I loaded an organ program. It now follows the loaded program's
  focus.
- A burst of four taps inside 1 ms was clamped to 300 BPM. Taps faster than 300 BPM are now ignored.
- Panic's message was hidden behind the Master Clock page. Panic now leaves the mode.

The OLED footer had no style, because Phase 2 never used it, and it rendered at body size. It now has its own small
style.

## Panel feedback now driven by canonical state

- **Organ:** the model LEDs, VIB/CHORUS type LEDs, per-layer ON (the focused layer blinks when both are on), SUSTPED,
  PSTICK, percussion, drawbars and their LED graphs (focused layer), level ladders, KB-zone LEDs and FX FOCUS.
- **Synth:**
  - Layer LEDs (the focused layer blinks), the Analog mode LED, MONO/LEGATO and LO/HI priority, the vibrato source,
    ARP mode/RUN/KB SYNC, KB HOLD and unison.
  - The LFO destination and MST CLK.
  - Page LEDs for osc pitch, osc envelope, filter type, filter envelope, amp envelope and LFO waveform, plus the arp and
    vibrato menus.
  - Velocity LEDs, FILTER ON, and the morph LEDs on Osc Ctrl, Filter Freq/Res, LFO Rate/Amount and Arp Rate.
  - The Synth OLED (page title, waveform, the three dial values, the envelope curve, arp rate).
- **Program:**
  - Program button LEDs (a radio group), Live Mode, Layer Scene II and Transpose.
  - The STORE LED flashes in Store/Store As. The Master Clock LED blinks, and is steady while setting.
  - Morph Wheel/CtrlPed: flashing while assigning, lit when assignments exist.
  - Split low/mid/high LEDs, with the edited point flashing. The 11 split-position LEDs above the keybed show every
    active point.
  - Solo. The Program OLED shows the location, name and E, then the section lines or mode pages, the status line and the
    focus footer.
- **Effects:** FX focus LEDs for Organ, Piano A/B and Synth A/B/C (group lights all of a section), and MST CLK for
  Mod 1/Delay. Morph LEDs on Mod 1 Rate/Amount, Mod 2 Amount, Drive, EQ Freq and Delay Tempo/Feedback.
- **Performance:** the Rotary ORGAN routing, Stop mode, ON (real routing) and MORPH (speed morph assigned).

## Unsupported controls (spec-excluded or optional, not implemented)

These controls exist, move or press, and change no sound or program state. Each one says why in its accessible
description, and the UI lists them under "Unsupported controls":

- Organ PRESET (Preset/Drawbar Live and sync): excluded by the organ spec.
- A.T. morph (aftertouch): excluded by the programs spec.
- Preset library ORGAN/PIANO/SYNTH: excluded benchmark-wide.
- PROG VIEW: optional multi-view, not implemented. Shift+Prog View (preset name) is excluded.
- SECTION EDIT / Layer Init and MON/COPY / Paste: excluded by the programs spec.
- Synth MODE: Samples is optional and not implemented, and Extern is excluded. The ANALOG LED stays lit truthfully.
- Delay EFFECTS (feedback-loop effects): excluded by the effects spec.

These Shift functions are ignored rather than faked, and the OLED says why:

- Close Mic, Stop angle and Bank.
- The eight Shift+program-button menus.
- Synth Pan (Shift+Layer C), KB Hold Exclude, and the Arp/LFO/Filter Group modes.
- Delay Ping Pong and the Mod 1 pedal modes/variations.

LEDs of excluded features never light: Aux KB, PERC POLY, PEDAL TAP, NUM PAD, MIDI, EXTERN, KEEP EDITS, EXCLUDE, PATTERN,
the GROUP LEDs, PED NOISE and CLOSE MIC.

## Documented interaction deviations

The panel is operated with a pointer or keyboard, so press-and-hold gestures that need two hands have single-pointer
equivalents:

- **Morph assign:** clicking a source button latches it, like the manual's double-tap latch.
- **Split editing:** Shift+SPLIT opens it (the SET KEY legend).
- **Master Clock set:** press MST CLK, then turn the dial.
- **Transpose set:** press TRANSP, then turn the dial.
- **Exit:** Shift pressed and released alone.

Every one of these is covered by `src/__tests__/system.test.tsx` and `src/__tests__/programs.test.tsx`.
