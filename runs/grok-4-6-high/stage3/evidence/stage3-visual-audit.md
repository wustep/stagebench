# Stage 3 visual audit — Stage 4 73

Variant: `stage-4-73`. Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`, `specs/nord-stage-4.programs.json`, `specs/nord-stage-4.organ.json`, `specs/nord-stage-4.synth.json`.

Canonical PNG captures (`stage3-desktop.png`, `stage3-narrow.png`, `stage3-capture.json`) are produced by the parent capture harness on seal. Phase 1–2 captures remain in `evidence/`.

## Designed geometry

Unchanged from Phase 1. Instrument aspect ratio **3.0951**. Vertical split **54% deck / 46% keybed**.

| Section | Fraction | Phase 3 notes |
| --- | ---: | --- |
| Performance | 0.14 | Master Level, pitch stick, mod wheel (morph source), control pedal. |
| Organ | 0.20 | Two layers, models, drawbars, percussion, vibrato/chorus, rotary, KB zones live. |
| Piano | 0.085 | Inherited library plus KB zone LEDs. No OLED. |
| Program | 0.125 | OLED shows `page.button` / Live / Store / list / dirty `E`. 32 slots, scenes, splits, morph, clock, transpose, Panic. |
| Synth | 0.25 | OLED shows waveform + filter/voice. Three layers, osc/filter/env/LFO/arp live. |
| Effects | 0.20 | Inherited units; ORGAN rotary route; focus A/B/C = organ/piano/synth. |

Primary OLED locations remain **Program** and **Synth** only.

Keybed: **73** keys, **43** white / **30** black, MIDI **28–100** (E1–E7). Split-point LEDs sit above active C2–C7 positions.

## Viewport fit

Same CSS fit as Phase 1 (`min(94vw, 96vh * aspect)`, `max-width: 97vw`). No marketing hero, one continuous chassis.

| Viewport | Expected |
| --- | --- |
| 1440×900 | Full chassis in view, no overflow. |
| 390×844 | Full 73-key silhouette remains in view; type is small. |

## Panel feedback

- Program OLED: slot location + name, `E` when dirty, `STORE` / `STORE AS` naming, numeric list on Shift+dial.
- Synth OLED: selected waveform and filter/voice mode.
- Drawbar and layer LED graphs follow live values (including morph range on assigned dests).
- Layer Scene II LED = `program-layer-scene` on.
- Split LEDs mark enabled Low/Mid/High points.

## Unsupported (spec-excluded)

These controls exist, move/press, and do not change sounding or program state:

- `program-morph-at` — aftertouch morph source (no aftertouch)
- `organ-preset-1`, `organ-preset-2` — Organ preset / Drawbar Live library (cut)

Also excluded and not present as extra invented hardware: banks beyond 32, Extern/Aux KB, aftertouch, arp pattern editor, Num Pad, Monitor/Copy/Paste/Swap, Section Edit, Layer Init, Shift menus.

## Known deviations

- Control placement is landmark-accurate, not photogrammetry-traced.
- Extra Phase 3 buttons (clock, transpose, Panic, zones, arp extras) live inside existing section landmarks rather than a second deck row.
- A web Sustain pedal remains below the chassis; Control Pedal is a performance knob (MIDI CC11 also drives it).
- Wooden cheeks are simplified.
- Rotary DSP is instantiated per graph but shares panel speed/drive; ORGAN route is `rotary-organ`.
- B3 Bass is not a separate model button (optional); Pipe 2 reuses the B3 additive path as allowed.
