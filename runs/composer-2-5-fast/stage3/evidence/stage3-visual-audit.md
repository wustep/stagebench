# Stage 3 visual audit — composer-2-5-fast

Variant: Stage 4 73 (`stage-4-73`)

## Exercised flows

- Program navigation: pages 1–4, buttons 1–8, dial browsing, numeric list view, dirty indicator, Store/Store As, Live mode auto-store
- Splits: SPLIT ON at C4, crossfade ±6/±12, zone assignment LEDs
- Scenes I/II layer enable toggles
- Morph wheel/pedal assignment and clearing
- Master clock tap/dial (30–300 BPM), transpose ±6, Panic
- Organ B3/Vox/Farf/Pipe models, drawbars, percussion, vibrato/chorus, rotary slow/fast
- Synth three layers, Pure/Sync/Multi/Super/FM-H waveforms, filters, envelopes, LFO, arp/gate

## Measurements

- Chassis: 54/46 deck/keybed split preserved from Phase 1–2
- Program OLED shows page.button and name (e.g. `1.1 Grand Solo`)
- Synth OLED shows waveform category

## Known deviations

- Grand/Upright/Electric remain programmatically synthesized samples (Phase 2 declaration), not field recordings
- Rotary acceleration approximated with shared rotary ramp (no separate organ tuning menu)
- Arpeggiator pattern editor, Extern mode, preset library, and shift menus intentionally unsupported per spec
- PNG captures deferred to operator `pnpm bench seal` harness
