# Phase 2 visual audit

Variant: Stage 4 73. Inherited Phase 1 chassis geometry unchanged.

## Measurements

| Check | Expected | Observed |
| --- | --- | --- |
| Key count | 73 (E–E) | 73 keys in DOM (`data-key-count`) |
| White / black | 43 / 30 | Unchanged from Phase 1 |
| Deck / keybed | 0.54 / 0.46 | CSS vars on `.instrument` |
| Section order | Perf→Organ→Piano→Program→Synth→Effects | Six `data-section` landmarks |
| Section fractions | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 | Flex slots unchanged |
| Primary OLEDs | Program + Synth only | Two `[data-primary-oled]` |
| Samples | Grand/Upright/Electric multi-root | `public/samples/{family}/r*_v*.wav` (9×2 each) |

## Exercised flows

1. Pointer / keyboard / MIDI note on-off with velocity (Phase 1 regression).
2. Sustain via Space, MIDI CC64, engine API; SUSTPED gates layer sustain.
3. Piano type select (6 types); Grand/Upright/Electric sample families; Clav/Digital/Misc synthesis.
4. Layer A/B enable, focus, level faders, octave ±.
5. KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, Master Level — energy tests.
6. Effects: Mod1/Mod2/Delay/Amp/Comp/Reverb types, bypass, all-effects bypass, group, global, To Rotary.
7. Fallback path when `forceFail` sample load — labeled status, still playable.
8. Panic / blur / dispose cleanup.

## Known deviations

- Sample assets are offline-baked PCM multi-samples (not mic recordings of acoustic pianos); declared truthfully in IMPLEMENTATION_DETAILS.json. Playback path is sample-based for Grand/Upright/Electric.
- Reverb uses generated impulse buffers (not recorded IR files).
- Organ / Synth / Program remain decorative; Program OLED shows `Init Program · {Type} {model}` for piano model feedback while keeping Phase 1 “Init Program” text.
- Visual layout not re-photogrammetry-tuned beyond Phase 1; parent harness captures desktop/narrow screenshots at seal.
- Amp Twin/JC/Small are distinct waveshaper/EQ colorations (approximations), not licensed amp models.

## Captures

Parent seal harness produces `evidence/stage2-desktop.png` and `evidence/stage2-narrow.png`. Phase 1 evidence retained under `evidence/stage1-*`.
