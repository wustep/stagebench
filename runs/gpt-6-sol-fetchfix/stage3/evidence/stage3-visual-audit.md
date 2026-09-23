# Stage 3 visual audit

Reference: `inputs/reference/nord-stage-4-73.jpg`. Phase 1 and 2 captures and their audits remain under `candidate/evidence/`.

## Source and control audit

- The inherited continuous chassis, six deck sections, 73 E1–E7 keys, nine Organ drawbars, and the Program and Synth OLED locations remain. Split LEDs now appear above the keybed when split points are active.
- The Program OLED and status strip show the selected program or Live slot, name, edit indicator, scene, and tempo. The Synth OLED shows the focused layer and waveform. Sound status remains in the status strip.
- Hardware controls now feed program navigation, Organ, Synth, rotary, morph, and effects state where implemented. The settings region below the chassis exposes the full 32-slot list, Store As naming, eight Live slots, three editable split points and fades, layer zones, clock, transpose, Panic, Organ parameters, and Synth parameters. Focus and enabled states use accessible buttons; values use labeled inputs.
- The explicit unsupported list in the interface is: `performance.rotary-select`, `organ.organ-preset-1`, `organ.organ-preset-2`, `piano.piano-model`, `program.morph-assign-aftertouch`, `synth.mode-sample`, `synth.mode-wave`, and `synth.synth-preset`. These correspond to excluded preset and aftertouch behavior or optional oscillator modes not claimed here. Their physical controls still move or press.
- The settings region is an accessible extension below the photo-matched chassis. It wraps at narrow widths. The inherited keybed and section geometry remain under the same horizontal scroll region.

## Verification and operator capture

Phase 3 unit and interaction tests cover program storage and dirty state, split gains, morph interpolation, scene selection, Organ/Synth controls, deterministic arp steps, shared audio graph topology, and Panic cleanup. The inherited Phase 1–2 test mappings and evidence are preserved. `IMPLEMENTATION_DETAILS.json` records three instrument sample sets with set-level name, source, and license, plus generated/live sources.

Phase 3 screenshots and the Chrome interaction/console audit are left for the operator seal step as requested. No Stage 3 browser capture or console result is claimed here. The operator should capture 1440 × 900 and 390 × 844 views, check horizontal panning and chassis clipping, and exercise Program/Live, splits, scenes, morphs, Organ, Synth, and Panic in the browser.
