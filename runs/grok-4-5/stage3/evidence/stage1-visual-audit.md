# Stage 1 visual audit

Variant: **stage-4-73** (E–E, 73 keys, 43 white / 30 black)

## Spec sources

- `specs/nord-stage-4.visual.json` (section fractions, vertical split, colors, presentation)
- `specs/nord-stage-4.variants.json` (keybed + aspect ratio 3.0951)
- Reference image: `inputs/reference/nord-stage-4-73.jpg` (when available)

## Geometry measurements (model)

| Property | Spec | Implementation |
| --- | --- | --- |
| Deck / keybed | 0.54 / 0.46 | CSS `--deck-frac` / `--keybed-frac` on `.instrument` |
| Performance | 0.14 | flex basis on section slot |
| Organ | 0.20 | flex basis |
| Piano | 0.085 | flex basis |
| Program | 0.125 | flex basis |
| Synth | 0.25 | flex basis |
| Effects | 0.20 | flex basis |
| Aspect ratio | 3.0951 | `aspect-ratio` on instrument |
| Key count | 73 | `data-key-count` + 73 DOM keys |
| Black key height | 0.61 | `.piano-key.black { height: 61% }` |

Desktop presentation target: instrument width 88–97% of 1440 viewport (`width: min(94vw, 97vw)`, max-height 96vh, no marketing hero). Narrow 390×844: horizontal pan allowed via `width: 180vw` so controls remain inspectable without clipping the chassis off-screen permanently.

## Landmarks exercised

- Performance: Master Level knob, pitch stick, mod wheel, Nord Stage 4 branding (exposed red chassis, no OLED).
- Organ: 9 drawbars with LED ladders, model switches, percussion, rotary.
- Piano: type selectors, model knob, layer levels, timbre/detail switches (decorative).
- Program: single primary OLED, program dial, 8 program buttons, page/Live/scene/store/split/morph.
- Synth: single primary OLED, layer levels, osc/filter/env/LFO/arp groups.
- Effects: two groups, mod/delay/amp/comp/reverb, layer focus.

Primary OLEDs only at Program and Synth (`data-primary-oled="true"`).

## Interaction flows exercised in tests

1. Pointer key down/up/cancel and dual-pointer multi-touch.
2. Computer keyboard note map with repeat suppression + blur all-notes-off.
3. MIDI note on/off, velocity, CC64 sustain; denied and disconnected states.
4. Decorative knob/fader/drawbar/button presentation without audio side effects.
5. Polyphony with deterministic voice stealing; sustain hold; dispose/unmount cleanup.
6. Accessible names/roles/values on every control ID.

## Colors / materials

Chassis mid `#851a25`, dark `#5a0c13`; panel `#3c424d`; keys `#dcdcdc` / `#0b0b0b`; OLED blue-green `#7dffd4` on `#0a1a18`; white legends.

## Known deviations

1. **Control micro-layout** is a dense functional approximation, not pixel-matched to the reference photo. Grouping follows section landmarks but individual knob XY positions are simplified flow layout.
2. **Drawbar LED ladders** are simplified 8-segment indicators rather than photo-accurate multi-LED graphs.
3. **Pitch stick** is a horizontal slider approximation of the Nord stick travel.
4. **Narrow viewport** uses horizontal overflow rather than a fully reflowed stacked layout so the continuous chassis remains measurable.
5. **Piano voice** is additive synthesis, not a recorded grand sample (truthfully declared; Phase 2 scope for sample libraries).
6. **Program OLED text** stays at a static “Init Program” label — no fake program navigation state.
7. **section width fractions** follow corrected `visual.json` (not the older coarse 13/21/15/9/21/21 prompt summary).

## Corrections applied during build

- Keybed range set to MIDI 28–100 (E1–E7) for 73 keys.
- Section flex fractions normalized to sum 1.0 from visual.json.
- Starter marketing/placeholder heading removed so only continuous instrument chassis remains.
