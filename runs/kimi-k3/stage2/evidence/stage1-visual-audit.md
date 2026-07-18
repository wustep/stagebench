# Stage 1 visual audit — Nord Stage 4 73

Variant: `stage-4-73` (73 keys, E–E, hammer action). Reference:
`inputs/reference/nord-stage-4-73.jpg`; measured instrument aspect ratio
3.0951 (`specs/nord-stage-4.variants.json`).

## Captures

- `evidence/stage1-desktop.png` — 1440×900 viewport, built app (`dist/`) served locally, captured with Playwright Chromium.
- `evidence/stage1-narrow.png` — 390×844 viewport.
- `evidence/stage1-capture.json` — measured DOM bounds, section widths, key/control counts, console errors (none).

## Measured bounds (desktop 1440×900)

| Metric | Measured | Requirement | Result |
|---|---|---|---|
| Instrument width | 1353.6 px of 1440 = **94.0%** | 88–97% of viewport | PASS |
| Instrument height | 437.3 px; bottom edge 658.7 px | no vertical scroll at 900 px | PASS (`verticalScroll: false`) |
| Aspect ratio | 1353.6 / 437.3 = **3.095** | 3.0951 | PASS |
| Deck height fraction | 236.2 / 437.3 = **0.540** | 0.54 ± 0.025 | PASS |
| Keybed height fraction | 194.4 / 437.3 = **0.445** | 0.46 ± 0.025 | PASS |
| Key count | 73 (43 white / 30 black) | 73 (43/30), E1–E7 | PASS |
| Controls rendered | 131 `[data-control-id]` | all visible inputs | PASS |
| Primary OLEDs | 2 (Program, Synth) | Program and Synth only | PASS |
| Console errors | 0 | none | PASS |

Measured section width fractions (deck, incl. inter-section gaps; within
~0.003 of spec after gap correction):

| Section | Spec | Measured |
|---|---|---|
| Performance | 0.140 | 0.137 |
| Organ | 0.200 | 0.195 |
| Piano | 0.085 | 0.083 |
| Program | 0.125 | 0.124 |
| Synth | 0.250 | 0.244 |
| Effects | 0.200 | 0.195 |

(Deltas are exactly the 0.25% inter-section flex gaps; slot fractions in the
DOM match the spec to 3 decimals — asserted in
`src/__tests__/visual-section-layout.test.tsx`.)

## Narrow viewport (390×844)

Instrument renders at 374 px wide × 121 px tall with all six sections, both
OLEDs, all 73 keys, and no clipped chassis. Controls remain inspectable
(zoomable/scrollable page, no fixed clipping). `verticalScroll: false` for
the document.

## Section landmarks vs reference photo

- **Performance**: pitch stick + mod wheel at far left, MASTER LEVEL knob,
  italic STAGE 4 / NORD branding on exposed red chassis (no inset plate, no
  OLED) — matches photo left block.
- **Organ**: nine drawbars in a single row with LED-lit level fader below,
  model selector (B3/B3 BAS/VOX/FARF/PIPE1/PIPE2), vibrato/chorus and
  percussion buttons, rotary slow/stop/fast + drive — matches photo.
- **Piano**: on/off, layer A/B, level fader with LED graph, octave shift,
  six-LED type selector, model knob, KB Touch/Dyn Comp/Timbre/Unison/Soft
  Rel/String Res, SUST PED/P STICK — matches photo cluster left of Program.
- **Program**: single blue-green OLED, large dial, 8 program buttons, page
  ◀▶, Live/Layer Scene, Store/Split, A/B panel selects, KB Hold, Transpose,
  three morph-assign buttons, Panic, Shift — matches photo center.
- **Synth**: single OLED at left of section, level fader + layers, dense
  oscillator/filter/dual-envelope/LFO-arp knob groups (non-uniform, grouped,
  not a repeated matrix) — matches photo.
- **Effects**: two effect groups with type selectors, Amp/EQ, Delay (rate/
  fdbk/mix/tap/ping-pong), Compressor, Reverb with type selector, layer
  focus A/B — matches photo right block.

## Materials and colors

Red metal chassis (linear gradient `#851a25` → `#5a0c13` from spec
`referenceColors`), dark inset blue-gray panels (`#3c424d`), black indexed
knobs with white index marks, light drawbar caps, red/amber/green LEDs,
blue-green OLEDs (`#123a3a` / `#7de8d8`), white legends. Key colors
`#dcdcdc` / `#0b0b0b` per spec.

## Corrections applied during implementation

- Section fractions follow the corrected 2026-07-04 values in the visual
  spec (piano 0.085 / program 0.125 / synth 0.25), not the older coarse ones.
- Drawbar default set to 0 (fully in) like the hardware photo.

## Known deviations

1. **Micro-typography**: legend text is set in a generic sans at very small
   clamp() sizes; exact Nord typeface and per-label micro-positioning are
   approximate. Landmarks, grouping, and density match; label kerning does
   not.
2. **Wheel/pitch-stick rendering**: the mod wheel is a ribbed rocker and the
   pitch stick a lever, both simplified versus the photo's molded plastic.
3. **OLED content**: Phase 1 displays deliberately show a "decorative"
   placeholder rather than program/synth data (honesty contract), where the
   photo shows live program text.
4. **Knob cap highlights** are CSS gradients, not molded index bumps.
5. The performance section's chassis screws/vents from the photo are not
   modeled.
