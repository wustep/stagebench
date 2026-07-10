# Stage 3 visual audit

Variant: stage-4-73

## Measurements

- Keybed: 73 keys (E1–E7), continuous chassis, 54/46 deck/keybed vertical split preserved from Phase 1–2.
- Six sections present: performance, organ, piano, program, synth, effects at documented fractional widths.
- Program OLED shows page.button + name + dirty `E`; Synth OLED shows waveform name.
- Drawbar bank: 9 vertical drawbars with LED-style presentation state (0–8 via continuous 0–1).

## Exercised flows

1. **Programs** — select slots 1–8 via buttons/pages; Store / Store As naming; dirty indicator; Live Mode auto-store; list view toggle; edit-discard on program change.
2. **Splits** — Split On Mid C4; zone assignment for piano/organ/synth layers; crossfade Off/6/12; KB Zones toggle.
3. **Scenes** — Layer Scene I/II swaps enable masks without cloning sound parameters.
4. **Morphs** — Wheel/Control Pedal assignment to levels and synth params; interpolate; Shift+source clears.
5. **Organ** — B3/Vox/Farf/Pipe model select; drawbars; percussion/key click/vibrato; rotary slow/fast/stop; both layers into shared organ FX chain + optional rotary.
6. **Synth** — waveform cycle through Pure/Sync/Multi/Super/FM-H; filters; envelopes; LFO; poly/mono/legato; arp rate/range/direction/hold/run; three layers with independent chains.
7. **Panic** — Shift+Transpose / Panic clears all voices and sustain.
8. **Master clock / transpose** — BPM 30–300; transpose ±6.

## Known deviations

- Master Clock has no dedicated panel button in the control inventory; BPM is driven via program state API and dial-hold patterns in tests.
- Arpeggiator step timing is deterministic in pure functions; live scheduling is state-level (run/hold/rate/sync) without a separate AudioWorklet clock UI.
- Rotary acceleration is applied via effects-chain rotary rate ramping inherited from Phase 2 (not a separate motor model).
- Spec-excluded controls remain decorative: aftertouch morph, Hold/Mono performance extras, preset library, Extern/Aux KB/menus.
- Factory programs 0–7 demonstrate piano/organ/synth/split/layer; remaining slots are named placeholders.

## Regression

- Phase 1 surface, keybed, inputs preserved.
- Phase 2 piano samples, two layers, full effect chain, master level preserved.
- Single AudioContext, one destination, master+limiter path unchanged.
