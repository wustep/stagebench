# Phase 1 visual audit — Nord Stage 4 73

Variant: `stage-4-73`. Reference: `reference/nord-stage-4-73.jpg` (11600 x 3866 source canvas;
instrument bounds x 1292, y 410, w 9013, h 2912, aspect 3.0951).
Specs: `specs/nord-stage-4.visual.json` v1.2.0 and `specs/nord-stage-4.piano.json` v2.0.0.
Manual pages read: 23–26 (Piano section).

Everything below is either a number I measured off the reference render, a number I measured off
the running app in a browser, or a deviation I am declaring. Nothing here describes behaviour that
is not implemented.

---

## 1. How the reference was measured

I scanned the reference JPEG directly rather than eyeballing it. Two passes:

- **Horizontal band scan** at y = 700, 760, 1000, 1400 and 1800, classifying each pixel as white
  background / light plate, red chassis, or dark inset panel.
- **Vertical column scan** at x = 2000 and x = 5600, and a black-key-row scan at y = 2400.

### Section boundaries found (source pixels, deck extent x 1300–10290)

| Section | Plate/tab extent measured | Width | Fraction of deck |
| --- | --- | ---: | ---: |
| performance | 1300–2510 (bare red) | 1210 | 0.134 |
| organ | 2516–4215 | 1699 | 0.189 |
| piano | 4228–4949 | 721 | 0.080 |
| program | 4950–6065 (red, sub-plates) | 1115 | 0.124 |
| synth | 6068–8215 | 2147 | 0.239 |
| effects | 8233–9882 | 1649 | 0.183 |

Those measured fractions sum to 0.949 because red gutters sit between the plates. Dividing through
by 0.949 gives 0.141 / 0.199 / 0.084 / 0.131 / 0.252 / 0.193, which is the spec's corrected
v1.2.0 table (0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20) to within a percentage point. **The
implementation uses the spec fractions exactly** and insets each section's plate by 2% a side so
the red gutters reappear.

> **Correction against the prompt.** `prompts/stage1.md` quotes the older coarse values
> (Performance 13%, Organ 21%, Piano 15%, Program 9%, Synth 21%, Effects 21%).
> `specs/nord-stage-4.visual.json` carries an explicit note dated 2026-07-04 saying those values
> contradict the photo and were superseded, and the spec is named as the source of truth for
> layout fidelity. My own band scan agrees with the spec, not the prompt — Piano is by far the
> *narrowest* section on the reference (8%), not a 15% one. I implemented the spec values and am
> flagging the discrepancy here rather than silently picking one.

### Vertical structure (source pixels, instrument y 410–3322, height 2912)

| Feature | Measured y | Fraction of instrument |
| --- | ---: | ---: |
| Top rail (jacks + legends) | 410–697 | 0 – 0.099 |
| Section header tab plates | 697–793 | 0.099 – 0.132 |
| Section inset plates | 793–1900 | 0.132 – 0.512 |
| Deck / keybed boundary (spec 0.54) | 1982 | 0.540 |
| White keys | 2007–3234 | 0.548 – 0.969 |
| Bottom rail / shadow | 3234–3322 | 0.969 – 1.0 |

Inside the deck (0–54% of the instrument) that becomes: rail 0–18.3%, header tab 18.3–24.4%,
inset plate 24.4–94.8%. Those are the exact numbers used in `styles.css`.

The header tabs are **partial width** on Organ, Synth and Layer Effects: the light plate stops at
x = 3221 / 6958 / 8977 and bare red carries on to its right. Only the narrow Piano section runs its
tab the full section width. This is reproduced (42% / 42% / 48% / 100%).

### Keybed (source pixels)

| Measurement | Reference | Implemented |
| --- | ---: | ---: |
| White key span | x 1569–10032 (8463px) | left inset 3.07%, right inset 3.03% |
| White key pitch | 196.8px (8463 / 43) | 1/43 of the keybed width |
| Black key width | 128px | 0.65 x white width |
| Black / white width ratio | 0.650 | 0.6501 (measured in browser) |
| Black key length | ~0.61 of white (spec `blackKeyHeightFraction`) | 0.61 (measured in browser) |
| Black key centres | on the white-key boundary within ±6px at 9013px scale | exactly on the boundary |

---

## 2. What the running app measures

Measured in the browser with `getBoundingClientRect`, viewport 1280 x 720:

```
instrument      1216.0 x 392.9   aspect 3.0951   width = 0.9500 of viewport
deck fraction   0.5400           keybed fraction 0.4600
sections        performance 0.14  organ 0.20  piano 0.085
                program 0.125     synth 0.25   effects 0.20
white keys      43 (pitch 26.55px, no gaps)     black keys 30
black/white     width 0.6501     length 0.6100
keybed insets   left 0.0307      right 0.0303
document scroll height 720 = viewport height  → no vertical scroll
```

At the canonical 1440 x 900 desktop viewport the same measurement gives **1368px wide = 0.950 of
the viewport** (inside the required 0.88–0.97 band) with `scrollHeight === innerHeight === 900`,
so the instrument and the status strip both fit with no vertical scroll.

At 390 x 844 the sizing rule falls back to `width: 100%`, so the whole chassis renders unclipped at
roughly 377 x 122 and nothing overflows horizontally. Because the panel legends are then sub-pixel,
a Zoom control (1x–4x) appears under the instrument at viewports ≤720px; the enlarged instrument
scrolls horizontally inside its own container so the page itself never overflows.

Every section was also checked programmatically for children escaping its own bounding box; all six
report zero horizontal overflow.

---

## 3. Section landmarks against the spec

| Section | Required landmarks | Present | Forbidden hardware avoided |
| --- | --- | --- | --- |
| performance | master level knob, pitch stick, mod wheel, branding | yes — plus the Rotary Speaker sub-panel (drive knob, source / stop mode / speed buttons, ON, ORGAN, CLOSE MIC, ANGLE, SLOW, FAST, MORPH LEDs) | no inset plate, no OLED — it sits on bare red chassis |
| organ | nine drawbars, level LED ladders, model switches, percussion, rotary controls | yes — 9 drawbars each with its own 8-step red LED ladder and footage legend, 2 green fader ladders, Organ Model 6-way, Vib/Chorus 6-way + On, B3 Percussion volume/decay/harmonic/On | no wide OLED, no equal-width grid |
| piano | layer level controls, type selectors, model selector, timbre, detail switches | yes — 2 faders + ladders, Piano Select 6-way + INFO, MODEL dial, Timbre 6-way, Acoustics, Unison, KB Touch, Dyn Comp | no OLED, no drawbars |
| program | primary OLED, large dial, eight program buttons, page nav, Live Mode, Layer Scene, Store, Split, three morph assign buttons | yes, all of them | only one primary display in the section |
| synth | single OLED, layer levels, oscillator, filter, envelope, LFO and arpeggiator controls | yes — 3 faders + ladders, Mode, three oscillator dials, LFO, Oscillators, Filter, Amp, Unison, Arpeggiator/Gate, Voice, Vibrato | one OLED, not a section-spanning display; groups are differentiated, not a uniform knob matrix |
| effects | two effect groups, amp sim and EQ, delay, compressor, reverb, layer focus | yes — Mod 1, Mod 2, Amp Sim/EQ, Delay, Comp, Reverb, plus the FX Focus column (Organ A/B, Piano A/B, Synth A/B/C) | no OLED; six separately outlined groups |

Program and Synth carry `data-oled="program"` / `data-oled="synth"`; a test asserts those are the
only two `[data-oled]` elements in the document.

---

## 4. Flows exercised by hand in a browser

Run against the dev build at 1280 x 720 in Chrome. The browser console contained **no errors,
warnings or unhandled rejections** during the whole pass.

1. **Pointer note.** Pressed C4 near the front lip of the key: `aria-pressed` went to `true`, audio
   status moved `idle → starting → ready`, sound was produced (verified by the audio graph gaining
   voice nodes). Releasing the pointer anywhere on the page cleared the key.
2. **Chord from the computer keyboard.** `A` + `D` + `G` held together produced three held keys
   (C4, E4, G4) with `aria-pressed="true"` and status `ready`.
3. **Sustain.** With the chord held, `Space` latched the sustain button (`aria-pressed="true"`).
   Releasing all three keys cleared their pressed state while the pedal kept the voices ringing;
   releasing `Space` unlatched the button.
4. **Blur cleanup.** Pressed `F`, then fired a window blur: every held key returned to
   `aria-pressed="false"`.
5. **Decorative controls.** Clicked Piano Type (`Grand → Upright`, accessible name updated to
   "Piano Type: Upright"); arrow-keyed Mod 1 Rate (3.6 → 3.7); arrow-keyed drawbar 3 (8 → 7);
   nudged the pitch stick with `ArrowRight` (0 → 0.05) and confirmed it springs back to 0 on
   pointer release. None of these changed anything audible.
6. **Displays.** The Program OLED tracked the real audio and MIDI state
   (`STAGE 1 · STAGE 4 73 / AUDIO READY / PANEL CONTROLS: DECORATIVE / PIANO: GENERATED VOICE /
   VOICES 00 · MIDI DENIED`). MIDI was genuinely denied in this browser session and the app said so
   rather than pretending a device was attached.

---

## 5. Corrections made during the build

- Rescaled every control twice after comparing against the reference: knobs from 2.1% to 1.45% of
  instrument width (reference 1.3–1.9%), buttons from 2.1 x 1.1% to 1.4 x 0.72% (reference
  ~1.4 x 0.7%), LEDs from 0.5% to 0.3% (reference 0.31%), legends from 0.42% to 0.30–0.33% per em
  (reference cap height ~0.35%).
- Discovered the header tabs are partial width on Organ / Synth / Effects (they had been full
  width) and cut them back to the measured extents.
- Moved the keybed top inset from 3.5% to 1.9% of the keybed zone to match the measured y = 2007.
- Removed `perf.rotary.on` and `fx.mod{1,2}.variation` / `fx.amp.variation` from the control
  inventory once the crops showed they are printed shift-labels and indicator LEDs, not separate
  physical buttons. Their LEDs remain drawn (unlit) and their labels remain printed.

---

## 6. Known deviations from the reference

Ordered roughly by how visible they are.

1. **Legend legibility.** Panel text is drawn at true proportional scale (~0.30% of instrument
   width per em), which at a 1368px-wide desktop instrument is roughly 4px. It reads as the correct
   density of grey micro-text rather than as readable words. This is a deliberate choice in favour
   of proportional fidelity; the accessible names carry the real text for assistive technology.
2. **Typeface.** Nord's condensed grotesque is not bundled. The panel uses a system sans stack
   (`Helvetica Neue`/`Segoe UI`/`system-ui`) with tightened letter-spacing, and the OLEDs use a
   monospace stack rather than the instrument's dot-matrix font.
3. **Black key spacing.** Black keys are centred exactly on the white-key boundaries. The reference
   render measures within ±6px of that at 9013px scale, so this is faithful to the photo, but it is
   *not* the offset spacing of a real hammer action.
4. **Material micro-detail.** Chassis texture grain, panel screw heads, the moulded relief on knob
   and button caps, and the wood grain of the pitch stick are approximated with CSS gradients. No
   photographic textures are used.
5. **Top rail jacks.** The 17 rear-panel legends are present and in the correct left-to-right order,
   but their sockets are evenly distributed across the rail rather than placed at their individually
   measured x positions.
6. **Two SHIFT/EXIT plates.** The reference render shows a SHIFT/EXIT plate both at the right of
   the Program area (x ≈ 5907–6024) and at the foot of the Layer Effects FX Focus column
   (x ≈ 8269–8360). Both are reproduced because the photo is authoritative for layout, even though
   a physical Stage 4 has a single Shift button.
7. **Program OLED content.** It does not show a program number, name or the three layer sounds,
   because no program system exists in Phase 1 and inventing one would be fabricated state. It
   shows the variant identity and the live, real status of the engine, the panel and MIDI.
8. **Synth OLED content.** It says the synth engine is not implemented in Phase 1 rather than
   showing an oscillator name that nothing would play.
9. **Rotary Speaker ON LED** is drawn unlit and is not in the control inventory, because the
   reference panel has no dedicated button for it.
10. **Shift-function labels** (`VARIATION`, `GROUP ▽`, `SENS`, `PED ▽`, `GLOBAL ▽`, `MST CLK`,
    `ALL FX OFF`, `SET KEY`, `PANIC`, `PASTE ▾`, …) are printed as silk-screen text with unlit
    indicator LEDs. They are second functions of the buttons above or below them on the real panel,
    so they get no separate control.
11. **Narrow viewport.** At 390px the instrument is complete and unclipped but tiny; inspection
    depends on the Zoom control in the status strip below it.
12. **Status strip.** The strip below the instrument is not part of the hardware. It exists so the
    audio and MIDI state can be reported truthfully and the sustain pedal has an on-screen control.
    It is deliberately below the instrument, is plain text and controls, and is not a marketing hero.

---

## 7. Unimplemented controls (the full honest list)

**All 146 panel controls are decorative in Phase 1.** Every one moves or presses, exposes its role,
name and value to assistive technology, updates its indicator LEDs, and changes nothing else — no
audio, no program or effect state, no display claiming a feature works. Each carries
`data-functional="false"` in the DOM, and a test operates every control in the inventory and shows
the audio graph is untouched and the rendered output stays at digital silence.

Counts by section: performance 7, organ 24, piano 14, program 28, synth 40, effects 33.

The only functional inputs in this phase are:

- the 73-key keybed (pointer, independent multi-touch, glissando, mapped computer keys, focused-key
  Space/Enter, Web MIDI note on/off with velocity), and
- the sustain input (on-screen pedal button, `Space`, MIDI CC64), plus MIDI CC120/123 all-notes-off.

Deliberately not implemented in Phase 1, and not claimed anywhere: the six piano types and their
models, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, the two piano layers, octave
shift, master level, the Organ engine, the Synth engine, all six effect units and Rotary, programs,
splits, scenes, morphs, the master clock, transpose and Panic. Pedal noise, half-pedalling, Nord
Triple Pedal modelling, piano size classes, the INFO view and the preset library are excluded from
the benchmark entirely and will stay decorative in every phase.

---

## 8. Gate status at the time of writing

`pnpm test` 113 passed · `pnpm typecheck` clean · `pnpm lint` clean · `pnpm build` produces
`dist/index.html`.
