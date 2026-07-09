# Phase 1 visual audit — Stage 4 73

## Measurement basis

- Variant: `stage-4-73`, hammer action, E-to-E.
- Reference geometry is taken from `inputs/specs/nord-stage-4.variants.json`: 73 total keys, 43 white, 30 black, source aspect ratio `3.0951`.
- Desktop CSS instrument width is `min(92vw, 1450px)`. At the required 1440px viewport this resolves to `1324.8px`, or `92.0%` of the viewport, inside the required `88–97%` range. Aspect-ratio height is approximately `427.9px` before the 1px border.
- The shell grid assigns `4.2% + 49.8% = 54.0%` to the deck including its top rail and `41.7% + 4.3% = 46.0%` to the keybed including its bottom rail.
- The desktop control-deck grid is `0.14fr 0.20fr 0.085fr 0.125fr 0.25fr 0.20fr`, matching the six ordered visual-spec fractions: Performance, Organ, Piano, Program/Morph, Synth, Layer Effects.
- At 390px the shell switches to a 3×2 section grid, retains both OLED locations and all 73 key buttons, and uses a 790px minimum shell height so controls are inspectable without horizontal clipping.

## Implemented landmarks checked

- Continuous red chassis with dark inset Organ, Piano, Synth, and Effects plates.
- Performance: Nord Stage 4 branding, master level, pitch stick, modulation wheel, and sustain input.
- Organ: four model switches, nine individually identified drawbars with LED ladders, percussion, vibrato/chorus, and rotary controls.
- Piano: two layer rows, level faders, six type selectors, model and timbre controls, SUSTPED/PSTICK, and detail switches.
- Program: one primary blue-green OLED, program dial, eight program buttons, page buttons, Live/Scene/Store/Split controls, and three morph assignment controls.
- Synth: one primary blue-green OLED, two layer rows, waveform controls, filter, envelope, LFO, and arpeggiator controls.
- Effects: two layer-focus controls, four dense effect groups, amp/EQ, delay, compressor/reverb, rotary routing, and bypass.
- No primary OLED is rendered in Performance, Organ, Piano, or Effects.

## Interaction/evidence pass

- `src/App.test.tsx` exercises exact key inventory, ordered sections, OLED count, pointer key press/release, mapped computer-key repeat suppression, sustain/blur cleanup, accessible knob/button state, and the MIDI availability boundary.
- Pointer and touch use pointer IDs as independent source IDs. Keyboard input suppresses repeats and clears on blur. MIDI note/velocity, note-off, CC64, denied, and disconnected states share the same note lifecycle.
- Panel controls write only the normalized `hardware` presentation map. Program and Synth displays explicitly say `DECORATIVE`; no panel action claims unimplemented Phase 1 behavior.
- Audio is a generated three-partial piano fallback. `IMPLEMENTATION_DETAILS.json` contains no recorded-sample claim and the UI reports `generated piano` truthfully.

## Known deviations

- The reference image is parent-harness input and is not redistributed into `candidate/`; canonical `stage1-desktop.png`, `stage1-narrow.png`, and `stage1-capture.json` are produced by the parent capture step.
- The compact mobile arrangement changes the six-section row into a 3×2 inspection grid to preserve all controls at 390px; the desktop geometry remains the measured six-column layout.
- The piano is generated synthesis rather than a bundled recorded sample set, which is allowed by the Phase 1 basic-voice scope and explicitly declared above.

