# Stage 1 visual audit — Stage 4 73

Variant: `stage-4-73`. Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.variants.json`.
Canonical PNG captures (`stage1-desktop.png`, `stage1-narrow.png`, `stage1-capture.json`) are produced by the parent capture harness on seal.

## Designed geometry

Instrument aspect ratio **3.0951**. Vertical split **54% deck / 46% keybed** (tolerance 0.025).

Horizontal section fractions (photo-measured values from the visual spec, not the older coarse prompt numbers):

| Section | Fraction | Landmarks present |
| --- | ---: | --- |
| Performance | 0.14 | Master Level, pitch stick, mod wheel, Nord Stage 4 branding. Exposed red chassis; no OLED; no full dark inset plate. |
| Organ | 0.20 | Nine drawbars with LED ladders, model switches, percussion, rotary. Dark inset plate. |
| Piano | 0.085 | Layer levels, type selectors, model encoder, timbre/detail switches. No OLED, no drawbar bank. |
| Program | 0.125 | Primary program OLED, program dial, eight program buttons, page/Live/Scene/store/split, three morph assigns. |
| Synth | 0.25 | Single synth OLED, three layer strips, oscillator / filter / envelope / LFO groups (not a uniform knob matrix). |
| Effects | 0.20 | FX1, FX2, Amp/EQ, Delay, Comp, Reverb, rotary, layer focus. No OLED. |

Primary OLED locations: **Program** and **Synth** only (`program-oled`, `synth-oled`).

Keybed: **73** keys, **43** white / **30** black, MIDI **28–100** (E1–E7), black-key height **0.61** of keybed.

## Viewport fit

CSS: `width: min(94vw, 96vh * aspect)`, `max-width: 97vw`, `max-height: 96vh`, `overflow: hidden` on `html/body`. No marketing hero.

| Viewport | Expected instrument width | Height from aspect | Notes |
| --- | --- | --- | --- |
| 1440×900 | ~94% of 1440 ≈ 1354px (inside 88–97%) | ≈ 437px | Fits without vertical scroll. |
| 390×844 | ~94% of 390 ≈ 367px | ≈ 118px | Entire chassis remains in view; no clipping, no overflow. |

## Colors / materials

Chassis `#851a25` / `#5a0c13`, inset panels `#3c424d`, keys `#dcdcdc` / `#0b0b0b`, OLEDs blue-green on black, black indexed knobs, LED graphs on drawbars/faders.

## Corrections during implementation

Used the visual-spec section fractions (piano 0.085, program 0.125, synth 0.25) rather than the superseded 15/9/21 split noted in the spec.

## Known deviations

- Control placement is landmark-accurate and dense, not photogrammetry-traced from a pixel grid (no coordinate inventory in the visual spec).
- OLED idle copy is honestly decorative (`decorative` / `OSC idle`) and does not fake a loaded program.
- A web Sustain pedal sits **below** the chassis so it is not invented deck hardware.
- Wooden cheeks are simplified.
- Narrow viewport is inspectable but type is very small by necessity of fitting the full 73-key silhouette.
