# Stage 1 visual audit — Nord Stage 4 73

Measurements below were taken from the production build (`vite build`, `base: './'`, served by
`vite preview`) in Chromium at the two canonical viewports. The raw numbers are also in
`evidence/stage1-capture.json`; this document interprets them and records what is still short of
the reference photograph.

Reference: `inputs/reference/nord-stage-4-73.jpg` (11600 × 3866), instrument bounds measured at
x 1292, y 410, w 9013, h 2912 → aspect **3.0951** (`specs/nord-stage-4.variants.json`).

---

## 1. Instrument bounds and viewport occupancy

| Measurement | Value | Requirement | Result |
| --- | --- | --- | --- |
| Viewport | 1440 × 900 | canonical desktop | — |
| Instrument width | 1365.13 px | — | — |
| Instrument height | 441.05 px | — | — |
| Width fraction of viewport | **0.948** | 0.88 – 0.97 | pass |
| Aspect ratio | **3.0952** | 3.0951 | pass (Δ 0.0001) |
| Horizontal centring | left 37.44 px, right 37.43 px | centred | pass |
| Page scroll height | 900 px | ≤ 900, no vertical scroll | pass |
| Page scroll width | 1440 px | no horizontal overflow | pass |

No marketing hero, heading, or copy exists above the instrument: `main`'s first element child is the
chassis, there is no `h1`/`h2` anywhere, and the reference photograph is not used as any background
(no `<img>` elements at all; the chassis surface is CSS gradients only).

## 2. Deck / keybed split

| Band | Height | Share of instrument | Required | Result |
| --- | --- | --- | --- | --- |
| Control deck (incl. rear rail) | 238.16 px | **0.5400** | 0.54 ± 0.025 | pass |
| Keybed (incl. front rail) | 202.89 px | **0.4600** | 0.46 ± 0.025 | pass |

The two bands are siblings inside one chassis element, so the chassis is continuous. The keybed
itself measures 189.7 px between the deck and the front rail, i.e. **0.430 of the instrument
height** — the reference photograph's keybed occupies roughly 0.42–0.44, so the playable area is
proportionally correct rather than squeezed by the rail.

## 3. Section widths

The assigned spec (`specs/nord-stage-4.visual.json`) states 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20
and records in `horizontalSectionsNote` that the earlier coarse reading (0.15 / 0.09 / 0.21) was
corrected on 2026‑07‑04 because it contradicted the photograph. This build uses the corrected
values, and the correction was independently re-verified against the assigned image before
implementation.

Re-measuring the photograph (band scan at y ≈ 706–786 of the source, deck extent x ≈ 1300–10300):

| Section | Spec fraction | Spec boundary (of instrument) | Measured boundary | Δ |
| --- | --- | --- | --- | --- |
| performance | 0.14 | 0.000 – 0.133 | 0.000 – 0.136 | +0.003 |
| organ | 0.20 | 0.133 – 0.323 | 0.136 – 0.325 | +0.003 |
| piano | 0.085 | 0.323 – 0.404 | 0.325 – 0.406 | +0.002 |
| program | 0.125 | 0.404 – 0.523 | 0.406 – 0.530 | +0.007 |
| synth | 0.25 | 0.523 – 0.761 | 0.530 – 0.767 | +0.007 |
| effects | 0.20 | 0.761 – 0.951 | 0.767 – 0.951 | 0.000 |

Every spec boundary lands within 0.7% of the measured seam, which is inside the width of the red
gutter between plates (≈ 0.5–1.0% of the instrument). The spec is accepted as correct; the
prose summary in the phase prompt (13 / 21 / 15 / 9 / 21 / 21) is the superseded set and was not
used.

Rendered widths match the declared fractions exactly (the deck is a 6-column grid with no padding,
so fractions survive to the pixel):

| Section | Rendered width | Rendered fraction | Declared |
| --- | --- | --- | --- |
| performance | 191.11 px | 0.1400 | 0.14 |
| organ | 273.02 px | 0.2000 | 0.20 |
| piano | 116.03 px | 0.0850 | 0.085 |
| program | 170.64 px | 0.1250 | 0.125 |
| synth | 341.28 px | 0.2500 | 0.25 |
| effects | 273.02 px | 0.2000 | 0.20 |

## 4. Keybed

| Measurement | Value | Requirement | Result |
| --- | --- | --- | --- |
| Total keys | **73** | 73 | pass |
| White keys | **43** | 43 | pass |
| Black keys | **30** | 30 | pass |
| Range | MIDI 28–100, **E1–E7** | E to E | pass |
| Contiguity | 72 semitones, no gap | chromatic run | pass |
| White key width | 31.734 px | uniform | pass |
| Black key width | 19.672 px (0.62 × white) | — | pass |
| Black key height | 114.27 px | 0.61 × white | pass |
| Measured black/white height ratio | **0.6024** | 0.61 | pass |
| Keys outside the keybed box | 0 | 0 | pass |

The pattern is derived from the MIDI range rather than hand-listed, so the white/black counts, the
seam positions and the black-key offsets are checked by `assertKeybed` at build time and again in
`src/tests/visual-key-count.test.ts`.

## 5. Landmarks

| Section | Required landmarks | Present |
| --- | --- | --- |
| performance | master level, rotary speaker, pitch stick, mod wheel, Nord Stage 4 branding | all five; band is exposed chassis with **no inset plate and no display** |
| organ | nine physical drawbars, level LED ladders, organ model switches, percussion controls | 9 drawbars each with an 8-dot ladder, 6 model positions, 4 percussion toggles |
| piano | layer level controls, six type selectors, model selector, timbre controls, detail switches | 2 level faders, 6 type positions, model dial, 5-position timbre, 3 detail toggles |
| program | primary OLED, large dial, eight program buttons, page navigation, Live Mode, Layer Scene, Store, Split, three morph assigns | all present; exactly **one** display element |
| synth | single OLED, three layer levels, oscillator, filter, envelope, LFO, arpeggiator | all present; OLED is **0.40 of the section width** |
| effects | two effect groups, amp sim + EQ, delay, compressor, reverb, layer focus | Mod 1, Mod 2, Amp Sim/EQ, Delay, Comp, Reverb, Focus |

Control inventory: **167** addressable controls, all with stable dotted IDs and section-qualified
accessible names. Per section: performance 11, organ 33, piano 23, program 26, synth 35,
effects 39.

## 6. Forbidden hardware

Counted with the rules from `forbiddenDetection` in the visual spec, at 1440 × 900, unscrolled:

| Rule | Count | Result |
| --- | --- | --- |
| `OLED display` in performance | 0 | pass |
| `OLED display` in effects | 0 | pass |
| `wide OLED display` (≥ 0.5 section width) in piano / organ / synth / effects | 0 | pass (synth OLED is 0.40) |
| `multiple primary displays` in program | 0 | pass (1 display) |
| `drawbar bank` in piano (≥ 6 controls ≥ 3× taller than wide) | 0 | pass (0 tall controls in the piano band) |
| `full dark inset plate` covering ≥ 0.8 of performance | 0 | pass (performance has no plate) |
| `generic equal-width control grid` in organ | not triggered | pass (9 drawbar-shaped controls present) |
| `uniform repeated knob matrix` in synth | 0 | pass (row/column pitches fail the 5% regularity test) |
| `single undifferentiated control grid` in effects | 0 | pass (7 separately labelled groups) |

The organ band contains 9 controls whose body is ≥ 3× taller than wide, which is what the rule
requires to distinguish drawbars from a uniform grid. Only the organ band has any: every other
section reports 0.

Grid-pitch regularity was measured explicitly rather than assumed. For each section, controls whose
widths and heights both fall within 5% of their medians were grouped into rows, and consecutive row
and column pitches compared against their medians. No section is regular on both axes (for example
the program band has a perfectly regular 53/53/53/53 px column pitch inside the eight program
buttons but irregular row pitches of 22.7/15.7/8.9/4.7/17.8/13.5 px across the band), so neither
the knob-matrix nor the undifferentiated-grid rule can trigger.

The DOM was also cleaned so the displayElement rule is unambiguous: only the two display roots carry
`oled`/`display` markers, and the three synth waveform dials were renamed from "Display dial" to
"Osc waveform dial" so their accessible names do not read as displays. The literal rule now counts
exactly 1 displayElement in the program band and 1 in the synth band, and 0 in the other four.

## 7. Layout integrity

| Check | Result |
| --- | --- |
| Controls overflowing their section | 0 of 167 |
| Overlapping control pairs | 0 |
| Sections with clipped content (`scrollHeight` > box) | 0 of 6 |
| Zero-sized or hidden controls | 0 |
| Keybed content clipped | 0 |

## 8. Narrow profile — 390 × 844

The deck is presented as a vertical stack of the same six sections in the documented order, then
the keybed. The surface stays inspectable rather than being cropped or scaled to illegibility.

| Measurement | Value |
| --- | --- |
| Viewport | 390 × 844 |
| Page scroll width | **390 px** (no horizontal overflow) |
| Page scroll height | 4049 px (vertical scrolling by design) |
| Section width | 350 px each |
| Sections with clipped content | 0 of 6 |
| Controls invisible or outside the viewport width | 0 of 167 |
| Keybed | 366 × 150 px, 73 keys, white key 8.5 px |
| Program display | 330 × 109 px |
| Synth display | 140 × 111 px |
| Front rail | 63 px (wraps to two rows so nothing overflows) |

At 390 px the six sections cannot all fit side by side at readable sizes: the piano band alone would
be 33 px wide. Stacking preserves every landmark and every accessible control, which is what the
narrow requirement asks for ("remains inspectable without clipping"). This is a deliberate
deviation from the reference's single-row silhouette and is called out below.

## 9. Corrections made during implementation

1. **Section fractions.** Initially followed the phase prompt's 13 / 21 / 15 / 9 / 21 / 21; replaced
   with the spec's photo-measured 14 / 20 / 8.5 / 12.5 / 25 / 20 after re-measuring the reference.
   The spec explicitly records the other values as superseded.
2. **Deck padding removed.** A 0.5% horizontal pad on the deck made rendered fractions drift to
   0.1386 / 0.1980 / … ; removing it makes them exact.
3. **Synth OLED narrowed.** First render put the synth display at 0.91 of its section width, which
   trips the "wide display spanning the section" rule. Set to 0.40 and left-aligned.
4. **Organ band restructured.** The layer faders and drawbars shared a row, collapsing drawbars to
   26 px tall (ratio 5.6 but far too short to read). Split into a two-row band with the fader
   column spanning both rows; drawbars now fill their block.
5. **Piano and synth overlap fixes.** In the 8.5%-wide piano band the switch cluster overlapped the
   acoustics block; the band was rebuilt as a tight single column with a 4-column switch grid. In
   the filter block the 4-position type selector overlapped the voice block; it now spans its own row.
6. **Display claims that implied unimplemented state.** The first render printed `A:11` in the
   program display's slot area, which reads as a loaded program that Phase 1 does not have. It now
   prints `PHASE 1`, and a test asserts the display contains no bank:slot readout and no invented
   preset name.
7. **Audio adapter defect.** The Web Audio adapter passed its own wrapper into `AudioNode.connect`,
   which threw `Overload resolution failed` in a real browser. Wrappers now carry a private
   reference to the native node. This was caught by the browser pass and is covered by
   `piano-status-cleanup.test.ts` plus a manual re-check.
8. **MIDI request that never settled.** In a browser with Web MIDI present but no answer from the
   platform, the display stayed on "MIDI…" indefinitely. The bridge now times out after 6 s and
   reports "No MIDI answer from the browser" rather than a permanently pending state.
9. **Panic stranded the keyboard's held-key set.** After a panic, a key still physically down was
   never re-struck because the listener's held set was stale. Panic now broadcasts a reset, and the
   held-set check — not the browser's `repeat` flag — is the repeat-suppression mechanism, so a
   still-held key recovers without needing a release first.

## 10. Known deviations

These are honest gaps against the photograph; none of them is a missing required landmark.

1. **Narrow silhouette.** At 390 px the instrument is taller than it is wide instead of keeping
   3.0951. Keeping the aspect ratio at that width would make the deck about 118 px tall with 8 px
   legends — unreadable and unoperable. Stacking was chosen so the narrow profile meets its actual
   requirement (inspectable, unclipped, accessible).
2. **Type sizes below 6 px in the desktop deck.** 167 controls in a 1365 × 238 px band means legends
   are 4–5 px. They are legible at 100% zoom on a retina display but not comfortable at 1440 × 900
   on a low-DPI screen. The photograph's own legends are proportionally about the same size.
3. **No rear-panel detail.** The spec's landmarks are all on the deck; the rear rail is a printed
   label strip rather than modelled connector hardware.
4. **Section-printed legends are simplified.** The band prints `ORGAN SECTION`, `PIANO SECTION`,
   `PROGRAM`, `SYNTH SECTION`, `EFFECTS`. The photograph also prints secondary sub-legends
   (e.g. "SINGLE LAYER" under the preset buttons) which are not reproduced.
5. **Knob and button bezels are CSS approximations.** No bitmaps, no shadows sampled from the photo.
   Materials are matched by hue and gradient, not by texture.
6. **Drawbar caps** use the correct white/brown/black sequence and the printed footages, but the
   physical cap cross-section and the exact LED ladder pitch differ from the photograph.
7. **No effects-band "ON" grouping header.** Each effect group carries its own ON control, as on the
   instrument, but the photograph's outer EFFECTS bracket is not drawn.

## 11. Canonical captures

- `evidence/stage1-desktop.png` — 1440 × 900, viewport screenshot.
- `evidence/stage1-narrow.png` — 390 × 844 viewport, full-page screenshot (390 × 4049 px).
- `evidence/stage1-capture.json` — every number quoted above, machine-readable, with the interaction
  pass result and console-error count.
