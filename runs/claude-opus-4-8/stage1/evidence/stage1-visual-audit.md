# Phase 1 Visual Audit — Nord Stage 4 (variant stage-4-73)

Compared the canonical captures (`evidence/stage1-desktop.png` at 1440×900 and
`evidence/stage1-narrow.png` at 390×844) against `reference/nord-stage-4-73.jpg` and the
geometry in `specs/nord-stage-4.visual.json`. Both captures render without console errors.
The keybed plays one synthesized piano voice; every other panel control is honestly
decorative, as declared in the status bar and `IMPLEMENTATION_DETAILS.json`.

## Desktop (1440×900)

Overall structure matches the reference well: deep-red chassis, dark control decks, white
keybed at the bottom, and the correct left-to-right section order —
**Master Level + Pitch/Mod wheels + Rotary Speaker** (far-left red area) →
**Organ** → **Piano** → central **Program / performance** block with the primary OLED →
**Synth** (second OLED) → **Layer Effects** (far right). Program and Synth are the only two
primary OLED locations, satisfying that hard gate.

Section-by-section:

- **Far-left chassis** — Master Level knob top-left, then the Pitch and Mod wheels (amber
  pitch / black mod), with the Rotary Speaker group (Drive, On, Stop Mode Angle/Slow, Source
  Organ/Close Mic, Morph) below. Placement and grouping match the reference. The pitch wheel
  is rendered as an upright paddle; the reference's is slightly more recessed, but proportions
  are close.
- **Organ** — A/B on-off, Vib/Chorus with V1–C3 modes, Organ Model list (B3/Vox/Farf/
  Pipe1/Pipe2/B3 Bass), B3 Percussion (Soft/Fast/Third/On), Preset, and the nine drawbars
  rendered as vertical faders with red LED ladders and the correct footage labels
  (16′ 5⅓′ 8′ 4′ 2⅔′ 2′ 1³⁄₅′ 1¹⁄₃′ 1′). Strong match to the reference layout.
- **Piano** — Acoustics (Soft Rel / String Res / Ped Noise), A/B on-off, Sustped/Pstick,
  Unison, KB Touch (Heavy/Medium/Light), Dyn Comp, Timbre (Soft/Mid/Bright/Dyno), Piano
  Select model list, Octave shift, and Info. Groupings align with the reference; the model
  list and Timbre column read clearly.
- **Center Program block** — primary OLED showing `A:11 / Nord Stage 4 / B3 Soulful /
  White Grand / Vista Pad`, plus Store / Store As, Program, Page ◄ ► / Live Mode, Num Pad,
  Layer Scene, Split / Transp, Panic, and the Program menu row (System/Sound/Organize/Extra,
  Output/Pedal/MIDI/Extra). Matches the reference's central navigation cluster.
- **Synth** — second OLED (`OSC WAVEFORM / Super Saw / Detune 3.4`), A/B/C on-off,
  Sustped/Pstick, KB Hold, Arp Run, Octave, Mode (Poly/Mono/Legato + Samples/Analog),
  Arp/Gate with Range, Voice, Vibrato, LFO, Oscillators (Pitch/Semi, Osc Ctrl, Env Amt),
  Filter (Type/Freq/Res/Env Amt + Filter On), Envelope, Amp (Amp Env, Unison). Dense but
  faithful to the reference's synth deck.
- **Layer Effects** — FX Focus source list (Organ A/B, Piano A/B, Synth A/B/C, All FX Off),
  Mod 1, Mod 2, Amp Sim/EQ, Delay, Comp, and Reverb blocks with their rate/amount/type
  controls. Layout and vertical stacking match the reference's effects column.
- **Keybed** — full-width white/black keybed for the 73-key E–E variant, playable and
  producing the synthesized piano voice. Key spacing is even and legible.
- **Status bar** — `Piano ready (synthesized voice) · MIDI denied · 0 voices · Phase 1:
  keybed + one piano voice are live. All panel controls are decorative.` This is the honesty
  contract stated explicitly to the user.

## Narrow (390×844)

The panel keeps its true proportions and becomes horizontally scrollable rather than
reflowing, so at 390px the viewport shows the far-left chassis, the Organ section, and the
left of the keybed, with the honest status bar pinned below. This preserves fidelity of the
hardware at the cost of showing the whole surface at once — a deliberate, honest trade rather
than a faked responsive collapse. Controls remain accessible and the keybed remains playable.

## Known deviations (stated honestly, not overclaimed)

- **Chassis hue** is a slightly more muted maroon than the reference's brighter, more
  saturated Nord red.
- **Rear/top rail not modeled** — the reference photo's top edge (Monitor, Headphones,
  Out 1–4, pedal jacks, MIDI, USB, power) is a rear-panel strip and is out of scope for the
  playable front surface; the render begins at the control deck.
- **Layer Effects naming** — the render labels the two modulation blocks Mod 1 / Mod 2 where
  the reference silk-screen reads Effect 1 / Effect 2; the control inventory underneath is
  equivalent.
- **Keybed detail** — white keys are rendered as clean rectangles without the subtle front
  lip / bevel shading visible on the reference keys.
- **Narrow layout** relies on horizontal scroll (above), so the full width is not visible in
  a single 390px frame.

None of these deviations misrepresent functionality: only the keybed piano voice is live, and
every other control is visibly present, operable/accessible, and truthfully inert this phase.
