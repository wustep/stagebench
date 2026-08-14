# Stage 2 visual audit — Stage 4 73

Variant: `stage-4-73`. Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`.
Canonical PNG captures (`stage2-desktop.png`, `stage2-narrow.png`, `stage2-capture.json`) are produced by the parent capture harness on seal. Phase 1 captures remain in `evidence/`.

## Designed geometry

Unchanged from Phase 1. Instrument aspect ratio **3.0951**. Vertical split **54% deck / 46% keybed**.

| Section | Fraction | Phase 2 notes |
| --- | ---: | --- |
| Performance | 0.14 | Master Level is now functional. Pitch stick bends piano layers when PSTICK is on. |
| Organ | 0.20 | Still decorative aside from visible movement. |
| Piano | 0.085 | Type, layers, octave, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, SUSTPED/PSTICK are live. No OLED. |
| Program | 0.125 | OLED now shows the focused piano model name (or LOAD FAIL). Program buttons stay decorative. |
| Synth | 0.25 | Decorative engine; OLED still the second primary display. |
| Effects | 0.20 | Layer FX on, group, focus, Mod1/2, Delay, Amp/EQ, Comp, Reverb, Rotary are live for piano layers. |

Primary OLED locations remain **Program** and **Synth** only.

Keybed: **73** keys, **43** white / **30** black, MIDI **28–100** (E1–E7).

## Viewport fit

Same CSS fit as Phase 1 (`min(94vw, 96vh * aspect)`, `max-width: 97vw`). No marketing hero, one continuous chassis.

| Viewport | Expected |
| --- | --- |
| 1440×900 | Full chassis in view, no overflow. |
| 390×844 | Full 73-key silhouette remains in view; type is small. |

## Phase 2 panel feedback

- Type LED flashes when the recorded library is in fallback.
- Program OLED: model name + layer, or `LOAD FAIL` / `fallback playable`.
- Layer FX ON dark = all-effects bypass. Per-unit LEDs match processing.
- Added Amp type, mid-freq, delay filter/tap/global, comp fast/global, reverb bright/global, FX group/on without leaving the effects landmark region.

## Known deviations

- Control placement is landmark-accurate, not photogrammetry-traced.
- Extra Phase 2 buttons live inside existing FX fieldsets rather than inventing a second deck row.
- A web Sustain pedal remains below the chassis.
- Wooden cheeks are simplified.
- Rotary is inserted per piano layer when Amp type is To Rotary, sharing one set of rotary controls.
