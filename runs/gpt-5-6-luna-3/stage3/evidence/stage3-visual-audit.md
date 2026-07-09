# Stage 3 visual audit — Stage 4 73

## Surface and geometry

- Variant: Stage 4 73, hammer action, E-to-E, 73 modeled keys (43 white / 30 black).
- The control deck remains a six-section row in the required order: Performance, Organ, Piano, Program, Synth, Effects.
- The deck/keybed allocation remains 54% / 46%; the desktop shell is sized for the canonical 1440×900 capture and the narrow media query preserves the full surface at 390×844.
- Program and Synth are the only primary OLED-style displays. Performance remains exposed red chassis; Organ, Piano, Synth, and Effects retain dark inset panels.
- Organ drawbars, LED ladders, layer faders, program buttons/pages, morph row, Synth layer controls, and effect columns remain dense hardware-style landmarks rather than a generic equal-width dashboard.

## Exercised Phase 3 flows

1. Selected B3 and Vox, moved a drawbar, toggled percussion/key click/vibrato/rotary, and verified bound controls update state.
2. Selected Synth categories Pure, Sync, Multi, Super, and FM-H; waveform options change with category; filter, envelope, LFO, voice, unison, vibrato, arp/gate, range, direction, hold, and run controls are bound.
3. Edited split points at the documented position list, changed Off/6/12 crossfade, toggled SPLIT, switched Scene I/II, and assigned/cleared Wheel and Control Pedal morphs.
4. Edited a program and observed the E dirty indicator; Store/Store As naming controls, page/program navigation, list affordance, and Live Mode are present. Live edits auto-store to the selected Live slot.
5. Tapped/adjusted Master Clock, transposed within ±6, and used Panic to clear held notes and reset morph input values.
6. Re-ran inherited pointer key lifecycle, computer-key repeat suppression, sustain, MIDI boundary, Piano library, layer, and effects tests.

## Honesty boundary and known deviations

Controls excluded by the assigned specs are disclosed in the UI: preset libraries, banks beyond 32, Extern/Aux KB, aftertouch morph, Num Pad, pattern editing, MIDI-out, Shift menus, Organize swap, pedal tap, and undocumented hardware behavior. The candidate does not claim recorded sample provenance when no redistributable recordings are present in the supplied artifact. Parent-controlled benchmark captures remain the canonical screenshot evidence; this audit records the implementation-side measurements and exercised behavior.
