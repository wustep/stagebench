# Stage 3 visual audit — Nord Stage 4 73

Captures (all in `evidence/`): `stage3-desktop.png` (1440×900), `stage3-narrow.png` (390×844), measurements, the browser
interaction pass and an in-browser DSP proof in `stage3-capture.json`. Produced by `scripts/capture.mjs --stage stage3`
(playwright-core 1.62 driving the locally installed Google Chrome 151, `pnpm build` output served over a local HTTP port).
The parent capture harness named in the phase prompt is not present in this workspace (as in Phase 2), so the script
reproduces its outputs: `stage3-capture.json` carries the parent shape (`profiles[]` with viewport, file, bytes, console
messages, page errors) alongside the local measurements. The Phase 1 and Phase 2 evidence (`stage1-*`, `stage2-*`) is kept
untouched next to it.

## Visual regression against Phase 2

The control surface is the Phase 1 surface; Phase 3 changed only what the state now drives. Measured at 1440×900:

| Measure | Phase 2 | Phase 3 |
| --- | --- | --- |
| Instrument box | 1354 × 437 px, 0.940 of the viewport, aspect 3.095 | 1354 × 437 px, 0.940, aspect 3.095 |
| Document scroll height | 900 px (no vertical scroll) | 900 px |
| Deck / keybed split | 0.540 / 0.460 | 0.540 / 0.460 |
| Section widths (measured = documented) | 0.140 / 0.200 / 0.085 / 0.125 / 0.250 / 0.200 | same |
| Keys | 73 (43 white / 30 black), E1–E7, black/white length 0.610 | same |
| Controls with stable ids | 146, 0 missing names, 0 duplicate ids | 146, 0, 0 (no control added or removed; the LFO destination selector gained the documented "off" position and `program.morph.wheel` / `program.split` no longer start lit — they follow the program) |
| Displays | `program.oled` and `synth.oled` only; none in performance / organ / piano / effects | same |
| Forbidden-hardware rules | all zero (drawbar-like controls: organ 11, piano 2, synth 3) | same |
| Console / page errors | 0 / 0 | 0 / 0 |

Narrow 390×844: instrument 374 × 121 px (0.96 of the viewport width), document scroll width 390 px, no clipping, 0 console
errors — unchanged from Phase 2.

Deliberate visual differences (all state-driven, none structural):

- The Program OLED is the program display: `1.1 Init Grand` (page.button, the E edit indicator, the name), the focused
  section's sound (`Piano A: Grand · Salamander C5`, or the organ model and drawbars, or the synth waveform), the
  Split / Scene / Transpose / Master Clock summary (or the last parameter hint), and the truthful Audio / MIDI / FX line.
  Its pages (numeric list, Store Program To, Store Program As naming, Keyboard Split, Master Clock, Transpose, Undo) replace
  the lower rows while open.
- The Synth OLED shows the focused layer's page — by default the waveform page `SYNTH A · OSC WAVEFORM / Saw / Analog ·
  Pure · Osc Ctrl: No effect` with the `TYPE CAT WAVE` dial labels; the red-framed buttons open the pitch, envelope,
  filter, LFO, arpeggiator and vibrato pages.
- The synth section ON LED is off in program 1.1 (the program decides; Phase 2 lit it from the panel default). Organ,
  piano and synth LEDs, drawbar graphs, selector LEDs, SUSTPED / PSTICK, KB ZONE (four green LEDs per section), LO / HI
  priority, VELOCITY, ENV TO PITCH, KB SYNC, MST CLK legends, FX FOCUS A/B/C, GLOBAL / FAST and the Rotary ON / MORPH
  LEDs all follow the canonical state.
- Program section: the MST CLK TAP/SET LED beats at the Master Clock tempo, the STORE LED blinks while a Store is
  pending, the WHEEL / CTRLPED LEDs light when a morph is assigned or armed, the SPLIT group's L / M / H LEDs show the
  active split points, and a strip of eleven green LEDs above the keys (C2 … C7) marks the active split positions.
- Knobs carry a small green morph LED at their top-right corner (lit once a morph source is assigned); fader and
  drawbar LED graphs show the morphed value while a morph is performed.
- Status strip: adds a `Program` group (slot, E, name, scene, split, transpose, BPM, morph sources), `Organ` and `Synth`
  pills that name the live-synthesis engines and their held notes, an on-screen `Control pedal` slider (the second
  morph source, mirrored by MIDI CC11) and a `Panic` button. The page header says Phase 3.

## Interaction pass (desktop, `stage3-capture.json` → `interaction.steps`, 28 steps, all ok)

- The Phase 2 steps are repeated unchanged: library ready before any gesture, mouse / keyboard / multi-touch keys,
  cycling the six piano types (each set decoded and reported `recorded-samples`), two piano layers, effects edits,
  Shift latch (Global, Group, To Rotary), knob by keyboard, drawbar and fader drags, focus ring, blur release.
- Program navigation: buttons, page ▶, the dial and the numeric list view (Shift + dial) load factory programs and the
  display shows `page.button name`; page ◀ and button 1 return to 1.1.
- Edit → E: a reverb edit marks `1.1 E`; Store As renames it (`Jnit Grand`) and stores it to 4.8; reloading 4.8 shows the
  stored program without E and with the stored reverb value.
- Live Mode: Live 2 (`Wurli Tremolo`), an edit stored automatically (never E) and persisted to localStorage.
- Organ: program 1.3 (B3 Soulful, ORGAN → rotary) plays a key through the organ AudioWorklet (both layers, two voices
  reported by the processor meter; percussion level visible); a drawbar and the model selector change its parameters.
- Synth: program 1.7 (Super Saw Pad) plays through the synth A AudioWorklet (one voice, LFO meter moving); the filter knob,
  waveform dial and ARP RUN respond (two arpeggiated voices while held).
- Split 2.1: key 48 sounds only the synth bass, key 72 only the electric piano (Piano B, zone gain 1), the split LED above
  C4 is lit; holding SPLIT opens the Keyboard Split page.
- Scenes 2.4: Layer Scene II adds the organ section (`["I",false]` → `["II",true]`) and back.
- Morph: tapping WHEEL latches the assign mode; moving the Piano A fader to 0 records `90 → 0`; the mod wheel at 50 %
  makes the fader's LED graph show 45 (5 LEDs) while the fader itself shows the stored 90; the fader carries the morph mark.
- Master Clock tap ×4 (134 BPM at the mouse's tap rate), Transpose hold + dial (+2: key 60 plays 62), PANIC (Shift +
  Transpose) empties the held keys and every engine's notes.
- In-browser DSP proof (the built worklet in an `OfflineAudioContext`): the organ processor renders a B3 note at rms
  0.113 and a Vox note with a different spectrum (silence without a note); the synth processor renders a Saw (second
  difference 0.0029) and a Sine (0.00016) — audible and distinct; reverb / delay tails, bit-transparent bypass, stereo rotary
  and the ≤ 1.0 limiter peak as in Phase 2.
- One AudioContext after the whole pass (`contexts: 1`, effects host `worklet`), blur releases everything.

## Known deviations (unchanged from Phase 1–2 unless noted)

- Legends render at ≈4.9 px at desktop scale; neighbouring legends touch in the dense piano left column and the delay /
  reverb right columns. Knob scale numerals are ≈2 px. Fonts are system sans.
- The rear-panel jack row, wooden cheeks, screw row and rear labels are stylised; no photograph is used as a background.
- The Program OLED is 75 px wide at desktop scale, so its rows are ellipsised; the full text is in the DOM, the display's
  `data-*` attributes and the status strip.
- The split-position LED strip is drawn at the top edge of the keybed (the photo's LEDs sit between the panel and the
  keys); its eleven LEDs are unlit on the default program.
- With a single mouse the two-finger "hold a Morph Assign button and move a control" gesture is not possible; the
  documented latch (tap the button, move controls, tap again or Exit) is the single-pointer path and is what the capture
  exercises. Two-finger holds work with touch (pointer capture keeps the button pressed while another control is moved).
- MIDI reports `denied` in headless Chrome, which is the truthful state of that environment.
