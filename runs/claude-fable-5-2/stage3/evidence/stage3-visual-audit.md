# Stage 3 visual audit — regression against Phases 1 and 2

Variant: Stage 4 73. Captures: `stage3-desktop.png` (1440 × 900, untouched start-up state),
`stage3-organ-synth-on.png` (1440 × 900, part-way through the browser pass, with the Organ and
Synth switched on and edited), `stage3-narrow.png` (390 × 844). The record of every step of the
browser pass is `stage3-browser-pass.json`; `stage3-capture.json` summarises it and lists the captures.

How they were made: `scripts/capture-stage3.js`, run in Playwright Chromium 157 against
`vite preview` of the production build. The parent capture harness named in the phase prompt is
outside the workspace and was not reachable. The snippet has no file-system access, so the
screenshots were written by Playwright and the report it returned was saved by hand, unedited
apart from formatting. The Phase 1 and Phase 2 captures in this folder are the ones those phases'
seals left here; they were not regenerated.

Phase 3 changes no geometry and adds no hardware. This audit shows that, and lists every
difference that does exist and why.

## Geometry: unchanged

Every number is read from the live DOM (`stage3-capture.json` → `geometry`); the earlier columns are
from `stage2-visual-audit.md`.

| Measure | Spec | Phase 1 | Phase 2 | Phase 3 |
| --- | --- | --- | --- | --- |
| Instrument box at 1440 × 900 (x, y, w, h) | — | 43.2, 137.6, 1353.6, 437.3 | 43.2, 137.6, 1353.6, 437.3 | 43.2, 86.3, 1353.6, 437.3 |
| Width fraction of viewport | 0.88–0.97 | 0.94 | 0.94 | 0.94 |
| Aspect ratio | 3.0951 | 3.095 | 3.095 | 3.095 |
| Deck share of height | 0.54 ± 0.025 | 0.54 | 0.54 | 0.54 |
| Section widths | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 | same | same | 0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20 |
| Keys | 73 | 73 | 73 | 73 |
| Panel controls | — | 146 | 146 (50 functional) | 146 (135 functional, 11 unsupported) |
| LEDs | — | 231 | 231 | 231 |
| Display elements (spec rule) | Program and Synth only | `program-oled`, `synth-oled` | same | `program-oled`, `synth-oled` |
| Page scroll at 1440 × 900 | none | 1440 × 900 | 1440 × 900 | 1440 × 900 |
| Horizontal overflow at 390 × 844 | none | 0 | 0 | 0 |
| Instrument box at 390 × 844 (x, y, w, h) | — | 11.7, 134.9, 366.6, 118.4 | 11.7, 54.5, 366.6, 118.4 | 4.2, 28.0, 366.6, 118.4 |

What moved: the instrument's *position on the page*, not the instrument. The status console under
it is taller in Phase 3 (a Program chip, a Control Pedal slider, an Unsupported-controls button,
and one more line of help), and the page centres the instrument and console together, so at
1440 × 900 the instrument sits 51 px higher than in Phase 2. It is still fully visible without
scrolling, still 94 % of the viewport width, and exactly the same size and shape. On the narrow
viewport the page now starts with the instrument at the top (the console below it scrolls).

## Image comparison

Phase 2 and Phase 3 desktop captures, each cropped to its own instrument box, compared pixel by
pixel (a pixel counts as changed when any channel differs by more than 24 of 255):

| Region | Pixels changed |
| --- | --- |
| Whole instrument | 0.7 % |
| Keybed half (nothing in it is drawn differently) | 0.3 % |
| Performance band | 0.1 % |
| Organ section | 0.5 % |
| Piano section | 0.1 % |
| Program section | 3.6 % |
| Synth section | 1.9 % |
| Layer Effects section | 0.1 % |

The keybed row is the noise floor: the two crops sit at different sub-pixel offsets (y = 137.6 and
86.3), which moves antialiased edges by a fraction of a pixel. Performance, Piano, and Layer Effects
are at that floor. Organ, Program, and Synth are above it only because of the display contents and
LEDs listed next.

## Every intended difference on the instrument

Nothing was added, removed, moved, or resized. Knob, fader, drawbar, and selector positions are
still the photo's. What differs is what the two displays say and which LEDs are lit at start-up.

**Program OLED** — Phase 2 showed the Piano layers, the model, the source, and status rows, and no
program. Phase 3 adds a bar across the top with the loaded program (`1.1 Grand Piano`, an **E**
when it has unsaved edits, **LIVE** in Live Mode) and, to make room, puts the audio/voices and
MIDI/sustain status on two rows instead of three. On an editing page (Store, naming, list, split,
clock, transpose) the same window shows that page. Same window, same size.

**Synth OLED** — Phase 2 said "Not active". Phase 3 shows the focused layer and its waveform
(`A Saw (OFF)` at start-up, because the Synth section starts off), the name of the page its three
dials are on, and the three dial values; on the envelope pages it draws the envelope. Same window,
same size, still narrow (0.23 of the section's width).

**LEDs that start in a different state than in Phase 2 (13 of 231)**, each because a lit LED would
now be a claim about the sound:

| LED | Photo / Phase 2 | Phase 3 | Why |
| --- | --- | --- | --- |
| Organ section ON | lit | dark | The Organ now really is on or off, and program 1.1 is a piano |
| Organ Layer B ON | lit | dark | Organ Layer B starts off; switching the Organ on gives one layer |
| Organ KB ZONE 1, 2 | dark | lit | With no split the layer plays every zone, so all four are lit |
| Synth section ON | lit | dark | As for the Organ |
| Synth Layer B, Layer C ON (2) | lit | dark | They start off |
| Synth KB ZONE 1, 2 | dark | lit | As for the Organ |
| Synth FX FOCUS | lit | dark | Effect focus is on the Piano at start-up, and this LED now says where it is |
| Synth KEEP EDITS | lit | dark | Belongs to the sample browser, which is not implemented |
| Split ON, and the C3 split-point LED above the keys | lit | dark | Program 1.1 has no split; the LEDs above the keys now show the real split points (C4 when Split is pressed) |
| Morph Assign WHEEL | lit | dark | Nothing is assigned to the wheel in program 1.1 |

42 LEDs are lit at start-up (48 in Phase 2). Every one of them now shows the state of a functional
control, except those of the 11 unsupported controls, which keep their photo positions.

**Morph LEDs are green** (20 of them, all dark at start-up). The inventory had them red; the
programs spec and the manual say green, and they are now lit by real assignments.

**New visual states that appear only in use**: a flashing Store LED and destination Program button
during a Store; a flashing Morph Assign LED while latched; level-fader ladders and drawbar LED
graphs that show a morphed value while the fader cap or drawbar stays where it is; split-point
LEDs at any of the 11 positions; an envelope curve on the Synth display.

## Differences outside the instrument

The status console: a fourth chip (Program: slot, name, and whether it is edited or in Live Mode),
a **Control pedal** slider (the second morph source), an **Unsupported controls** button that opens
the list of the 11 controls and the unsupported Shift functions with their reasons, a Phase 3
note, a longer Shift help line, and a Programs/Morph help line. On wide screens each chip is still
held to one line with the full sentence in its tooltip.

## Spec landmarks and forbidden hardware

Unchanged, and still enforced by the Phase 1 suites, which run unmodified
(`tests/visual.control-inventory.test.tsx`, `tests/visual.section-layout.test.tsx`,
`tests/regression.chassis.test.tsx`): all required landmarks present in their own sections; the only
display elements by the spec's rule are `program-oled` and `synth-oled`; no display in the
performance or effects bands; no drawbar bank in the Piano section; the effects band is still two
visibly separate groups; the performance band is still exposed red chassis. The new lines inside
the two displays are plain spans with `data-line` attributes; none of them matches the spec's
display-element rule, so the Program section still has exactly one display.

## What the browser pass saw

From `stage3-browser-pass.json`, production build, real AudioWorklet, real sample files:

- Start-up: audio Idle, program bar `1.1 Grand Piano`, display "Salamander Grand".
- First key: Ready in an AudioWorklet; signal at the node's output; one AudioContext, one connection
  to its destination; no request to any other origin.
- Programs: buttons 2, 3, 5, 7 loaded Tonewheel B3, Saw Lead, Piano + Pad, Vox Combo, each named on
  the display with its section's layers and each with signal; Page Next kept the button
  (`2.7 Two Scenes`); the dial stepped on to `3.2`; Shift + dial showed the numbered list; Shift left it.
- Store and Live: an edit lit the E; Shift + Store opened naming and one dial detent turned "Farf"
  into "Garf"; the Store LED flashed over destination 4.4; Store wrote it (`STORED TO 4.4 GARF
  COMPACT`, E gone, one entry in local storage). Live slot 5 took an edit with no E and one Live
  entry in storage. **After a page reload** the instrument started on 1.1, Live 5 still had its
  second layer, and 4.4 was still "Garf Compact", unedited. (Its Reverb LED reads off because the
  edit that was stored was switching the Farf program's reverb off.)
- Organ: all six models named and sounding; pushing drawbar 1 in emptied its LED graph and pulling
  it out filled all eight; percussion, Organ to Rotary, and Fast lit their LEDs, the Rotary ON LED
  with them.
- Synth: Saw, Sync Saw, Multi Saw, Super Saw, and FM 2-op each named on the Synth display with what
  Osc Ctrl does for it, each with signal; the Amp Envelope page showed its three dials and its
  curve; the arpeggiator produced signal on three held keys.
- Split and zones: Split lit its LED and the C4 LED above the keys; Piano took zones 1–2 and Synth
  3–4, shown on the zone LEDs; a low key sounded one voice; the split page showed and set a ±6 crossfade.
- Scenes: Layer Scene II lit its LED and switched the section LEDs; pressing it again switched back.
- Morphs: latching Wheel flashed its LED; two destinations were assigned; with the wheel up the
  Synth A ladder read 0 while the fader still read 100, and the knob's value text read "morph from
  10: Wheel to 0; now 0"; the Control Pedal slider did the same for a piano fader; Shift cleared both.
- Clock and transpose: the tempo page showed 120 BPM and ten detents made it 130; transpose read
  "+2 semitones" with its LED lit.
- Panic: two keys held, four voices, level 0.065; after Shift + Transp: 0 voices, 0 keys held, level
  exactly 0, display "PANIC: ALL NOTES OFF".
- Still one context and one destination connection at the end; 11 unsupported controls listed.
- Console: no errors, no warnings, no page errors, in any step.

## Known limits of this audit

- The Phase 1, 2, and 3 captures come from different Chromium builds and sit at different
  sub-pixel offsets, so even untouched regions are not pixel-identical; the keybed row is given as
  the floor.
- Blinking LEDs are captured wherever the blink happened to be.
- Audio levels in the record are single 170 ms snapshots from an AnalyserNode the capture script
  taps onto the output; they show that there is signal, not how it sounds. The 39 test suites
  measure the sound itself.
- The browser pass does not block a sample set this time; the labelled fallback is unchanged since
  Phase 2 and is covered by `tests/piano.fallback.test.tsx` and the Phase 2 record.
- The pass uses real mouse clicks and keyboard keys; the press-and-hold and two-finger gestures
  are covered by tests only.
