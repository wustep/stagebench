# Stage 3 visual audit — Stage 4 73

## Scope and evidence

This is a source and DOM audit of the inherited Stage 4 73 surface after adding Phase 3 controls. The inherited Phase 1 and Phase 2 screenshots and audit files remain in `candidate/evidence/`. No Phase 3 screenshot was captured; the operator seal step will capture the final desktop and narrow views.

## Surface review

- The inherited chassis, 73-key E2–E8 keybed, six sections, and their measured horizontal proportions remain in place. The keybed model continues to expose 43 white and 30 black keys.
- Program and Synth remain the only primary OLED locations. Program state, Store feedback, numeric list, and the split/zone/morph editor use the existing Program OLED; the Synth OLED presents the selected source and filter values.
- The Organ inset retains nine drawbars with LED ladders and model/percussion switches. Phase 3 layer, rotary-route, sustain, and vibrato controls are bound to the Organ state.
- The Synth inset groups layer, oscillator, filter, envelope, LFO, voice, and arpeggiator controls. The controls share the existing panel and display hierarchy rather than adding another primary display.
- Program split edits now show numbered split markers above the corresponding keybed positions. Crossfade widths and layer zone ranges remain visible in the Program editor.
- The unsupported note explicitly lists spec-excluded Program, Piano, Effects, Organ, and Synth features. The aftertouch morph button remains presentation-only as required by the Program spec.

The unsupported controls are: Program banks beyond one 32-slot bank, the 512-program layout, Organize move/swap, Organ/Piano/Synth preset libraries, aftertouch morph, Num Pad, Monitor/Copy/Paste/Swap, Section Edit, Layer Init, Aux KB, Extern, memory protection, Shift menus, external MIDI clock, and pedal tap; piano pedal noise, half-pedaling, Triple Pedal configuration, size classes, INFO, and Sound Manager downloads; effect variations, Reverb Chorale, delay feedback-loop modes, Analog delay, Pump/Wah pedal modes, rotary close mic/stop angle, and post-rotary global reverb; Organ Drawbar Live/sync, swell pedal, tonewheel wear, trigger point, and rotary tuning menus; Synth MIDI-out, pattern editing, zig-zag, accent, pan, per-layer KB Hold, Group modes, and sample downloads.

## Checks and capture handoff

The existing structure and control-inventory tests still cover section order, key count, primary displays, accessible controls, and the full hardware ID inventory. Phase 3 interaction tests cover named program storage, Live edits, morph assignment and clearing, and split/zone editing. The final viewport appearance, small-label legibility, and narrow-layout clipping require the seal capture and are not claimed as visually verified here.
