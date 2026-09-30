# Phase 2 visual audit — Stage 4 73

Sources: `inputs/reference/nord-stage-4-73.jpg`; `inputs/specs/nord-stage-4.visual.json`; functional feedback from `inputs/specs/nord-stage-4.piano.json` and `inputs/specs/nord-stage-4.effects.json`. Compared the product photo, retained Phase 1 desktop evidence, and local Phase 2 desktop/narrow browser screenshots visually. Chromium 153.0.8010.12.

Canonical PNG/JSON captures belong to the **parent capture harness during operator seal**, per the operator's explicit clarification. `stage2-local-desktop.png`, `stage2-local-narrow.png`, and `stage2-local-check.json` are local validation only; they are not substituted for canonical evidence. No parent harness or seal command was invented or run. All inherited Phase 1 images/JSON/audit remain present.

## Geometry and regression

| Measurement | 1440 × 900 | 390 × 844 |
| --- | --- | --- |
| Chassis origin | 43.20, 165.00 | 11.70, 130.00 |
| Chassis size | 1353.59 × 437.33 | 366.59 × 118.44 |
| Width coverage | 94.00% | 94.00% |
| Deck / chassis height | 54.00% | 54.00% |
| Black / white key height | 60.99% | 60.99% |
| Page scroll dimensions, settings closed | 1440 × 900 | 390 × 844 |

Chassis, deck, keybed, all six section bounds, key inventory and OLED locations are numerically identical to the inherited local `stage1-capture.json` at both viewports. Six section fractions remain 14 / 20 / 8.5 / 12.5 / 25 / 20. Exactly 73 E1–E7 keys, 43 white / 30 black, remain separately playable. The fitted narrow view shows the complete chassis without overflow; 4× Inspect scroll reaches E7 and Fit restores the overview. Desktop chassis bottom remains y=602.33.

## Surface comparison and changed feedback

The continuous red chassis, attached top/bottom rails, red performance band, nine Organ drawbars, narrow Piano band, central Program OLED, narrow Synth OLED and separated effect groups retain their Phase 1 positions/materials. Program and Synth are still the only physical OLED locations. No reference image is used as a rendered background; no new physical display or control grid was introduced.

Phase 2 feedback now reflects the canonical state: initial Piano A is enabled, B disabled; SUSTPED/PSTICK are routed; Master Level and effect knobs reflect their actual values. The type LEDs follow the focused layer. Program OLED reports the selected piano model and layer while explicitly retaining “Programs inactive.” Sample failures flash the type indicator and display a fallback message. Organ/Synth/Program controls and the excluded Rotary stop/source controls remain labeled decorative and visibly move/press without enabling an engine.

Supplemental **Piano & effects settings** is closed by default beneath the instrument. It exposes explicit layer focus, the six type choices, octave, performance values, every effect parameter, group/global modes and shared Rotary routing. This retains the inherited compact photo panel while making omitted parameters accessible with readable labels. Its controls bind to the same canonical state as the physical panel. Opening it intentionally adds page height; it does not change chassis geometry. Sample attribution is linked below it.

The local inherited browser runner verifies 140 reachable physical control centers, keyboard operation of 54 still-decorative buttons and 36 still-decorative ranges, knob/fader dragging, computer and focused-key input, independent native touch ownership, cancellation, blur cleanup, sustain, and narrow inspection. Newly functional panel feedback and native audio activation are checked by `src/rendered-audio.test.ts`. Both browser passes report zero console/page errors.

## Audio and evidence validation

`pnpm test` passes 34 tests in five files, including all inherited cases and the nine Phase 2 feature mappings. Production streaming DSP is tested using deterministic audio for every listed Mod 1/Mod 2/Amp/Reverb type, all units, bypass, wet/dry, primary parameters, progressive feedback filtering, compressor recovery, reverb tails and shared Rotary. Native OfflineAudioContext tests decode the bundled recordings and render the actual AudioWorklet graph, timbre, stereo unison, releases, per-layer SUSTPED from UI/keyboard/MIDI, playable fallback, layer levels and master. With master zero, both layers and routed effects produce exact silence. Disposal returns owned voices and graph handles to baseline.

All 183 recording files are checked against their pinned-source SHA256 hashes. `IMPLEMENTATION_DETAILS.json`, `public/samples/manifest.json`, attribution and publisher license files distinguish recorded sources from synthesis and documented DSP approximations.

## Retained deviations

The inherited micro-legends, selector artwork, tick marks and some secondary control geometry remain compact CSS approximations of the photograph. There is no perspective or exact manufacturer print reproduction. At narrow fit scale the physical legends are tiny; Inspect and the readable settings area provide access. These are inherited visual limitations, not newly introduced hardware. Audio uses the documented open libraries and original DSP, not Nord samples or claims of Nord hardware fidelity.

Operator action remaining: run `pnpm bench seal gpt-6-1-sol` from the Stagebench repository root to import, capture canonically, verify and seal.

Final candidate gates passed: `pnpm test` (34 tests), `pnpm typecheck`, `pnpm lint`, and `pnpm build` (`dist/index.html` present). Local browser audit also passed with zero console/page errors.
