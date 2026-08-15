# Stage 3 — Visual audit (Nord Stage 4 73)

Phase 3 completes the instrument: the whole Phase 1+2 surface is preserved and
regression-free, and the Phase 3 additions — the Program section (32 slots +
8 Live, Store/Store As, splits/crossfades/scenes/morphs, Master Clock,
Transpose, Panic) and the now-functional Organ and Synth sections — are
visibly present and conform to the visual spec (no forbidden hardware
introduced).

Reference: `nord-stage-4.visual.json`, variant `stage-4-73`
(`reference/nord-stage-4-73.jpg`).

## Surface regression (Phase 1 + Phase 2 preserved)

- **Chassis / silhouette**: a single continuous red chassis, one `.chassis`
  element, no detached rails, no marketing hero above the instrument, no
  overflow. Desktop instrument fills ~0.88–0.97 of the 1440×900 viewport;
  narrow (390×844) keeps the proportional (fraction) layout, so nothing is
  clipped.
- **Keybed**: exactly 73 keys (43 white / 30 black), range E1..E7, continuous
  tiled white keys with black keys centered on the seams. Counted in the
  rendered DOM: 73 present.
- **Deck sections**: six ordered sections at the documented fractions
  (0.14 / 0.20 / 0.085 / 0.125 / 0.25 / 0.20), 54/46 deck:keybed split.
- **OLEDs**: only Program and Synth are primary OLED locations (two total).
  Both now show live readouts (program name `P{p}.{b}` / synth category) set
  through the OLED controls — no extra OLED locations were added.
- **Piano + Layer Effects**: the Phase 2 functional surface (six piano types,
  two layers, performance controls, the six-unit effect chain + shared Rotary,
  Master Level) is unchanged and still rendered.

## Phase 3 additions — allowed landmarks

- **Program section** now drives the 32 regular slots (4 pages × 8 program
  buttons) plus the 8 Live slots via LIVE MODE, with two-stage **STORE**,
  **STORE AS** naming, a truthful dirty (**E**) indicator, **SPLIT ON/SET**,
  **Layer Scene I/II**, and the three **morph assign** buttons. It remains the
  primary chassis-cluster program unit with its large dial, eight buttons,
  page buttons and OLED — no new physical deck controls were added. Master
  Clock tap / Transpose / Panic are driven from the status strip (an
  accessible control strip outside the physical deck, consistent with the
  Phase 2 sustain-pedal strip), so the modeled surface geometry is unchanged.
- **Split points / zones / crossfades**: up to 4 zones editable across the 11
  documented split positions (C2..C7), Off/±6/±12 crossfades, per-layer zone
  assignment. Split is engaged and notes audibly route low/high per zone in
  the exercised flow below.
- **Scenes / morphs**: Layer Scenes I/II toggle per-layer enable state (sound
  params shared); Wheel and Control Pedal morphs assign, interpolate, light
  their morph indicators and clear. Exercised in the interaction flow below.
- **Organ section** is functional and unchanged visually: nine drawbars with
  their LED graphs, B3/Vox/Farf/Pipe model switches, percussion + key click,
  vibrato/chorus C1-C3/V1-V3, and the shared Rotary (slow/fast/stop + drive).
  Drawbar LED ladders track the live 0–8 positions.
- **Synth section** is functional and unchanged visually: single OLED, three
  layer level faders, oscillator controls (wave/category + Osc Ctrl), filter
  controls (LP12/LP24/HP/BP), envelope knobs, LFO, voice mode, glide/unison/
  vibrato, and arp/gate — all within the existing synth control clusters.

## Materials & colors

Reference palette unchanged: `#851a25` chassis mid, `#5a0c13` chassis dark,
`#3c424d` panel blue-gray, `#0b0b0b` keys-black, `#dcdcdc` keys-white.

## Exercised flows (measured)

- **Program browse / store**: dial + program buttons select programs across
  pages; STORE→STORE confirms a save and the dirty `E` clears; LIVE MODE
  switches the 8 buttons to auto-storing Live slots. Program OLED shows the
  active `P{page}.{button}` with a `E` suffix while dirty.
- **Split / scenes / morphs**: a split program routes a low note (e.g. C3) to
  the low-zone layer and a high note to the high-zone layer (asserted in
  `tests/splits.test.ts`); Layer Scene II disables a layer region without
  duplicating sound params; holding a morph source and moving a control lights
  its green morph indicator and the assignment survives a program round-trip.
- **Organ / Synth**: representative B3 drawbar and pipe registrations, and a
  Super-saw synth patch, are audible and sample-distinct from one another
  (rendered-PCM assertions in `tests/organ.test.ts` / `tests/synth.test.ts`),
  not renamed copies.
- **Panic**: Shift+Transpose-style Panic silences every engine and resets held
  inputs; the console shows no errors during the pass.

## Console / interaction pass

The built app loads with **no console or page errors** at desktop (1440×900)
and narrow (390×844). (A single benign `ScriptProcessorNode` deprecation
*warning* appears during audio runtime — not an error; the graph realizes one
AudioContext with the shared Rotary, per-section effect chains, Master Level,
the limiter, and one destination, and disposes cleanly.) No forbidden hardware
(preset library, Extern/Aux KB, banks beyond one, aftertouch morph) is added —
those remain spec-excluded and are listed as unsupported.

## Captures

- `evidence/stage3-desktop.png` (1440×900)
- `evidence/stage3-narrow.png` (390×844)
- `evidence/stage3-capture.json` (browser profile + console)

## Conclusion

The Phase 1 surface, keybed, and input behavior and the Phase 2 Piano/effects
functionality are regression-free; the Phase 3 Program system, Organ and Synth
engines are present and visually consistent with the reference, with no
structural, inventory, or material regressions.
