# Phase 2 implementation plan — Nord Stage 4 73

Assigned variant: `stage-4-73` (73-key hammer action, E1–E7).

Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`.

Phase 2 turns the Piano section and the Layer Effects section on, and connects Master Level. Organ, Synth, and Program stay decorative. The visual spec still fixes the silhouette, the 54/46 deck/keybed split, and the section fractions (performance 0.14, organ 0.20, piano 0.085, program 0.125, synth 0.25, effects 0.20).

## Hard gates

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

Phase 1 hard gates still hold: the 73-key E1–E7 keybed, the six-section chassis with Program and Synth as the only primary OLEDs, pointer/touch/keyboard/MIDI input, and a written visual audit.

## Signal graph

One `AudioContext`. Each piano layer owns a bus. The shared rotary sits after both layers. The limiter is the only node connected to the destination.

```
layer source (sample or synthesis, unison, octave, pitch stick)
  → timbre
  → effects bypass  OR  Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb
  → layer level
  → direct mix  OR  shared Rotary (when Amp type is Rotary and the unit is on)
  → master gain
  → limiter
  → destination
```

Layer level is before the direct/rotary split. A shared rotary summed first cannot scale layer A and layer B independently, so each layer's level scales that layer into both the dry sum and the rotary send. Reverb still precedes rotary. Delay feedback filtering is inside the feedback loop (the dry tap is unfiltered; repeats pass the LP/HP/BP). Parameter moves use short gain ramps. Voices, oscillators, and timers disconnect on release, layer disable, all-notes-off, and dispose.

Organ and Synth effect slots exist in state so focus and global copy have somewhere to land. They do not produce audio.

## Piano

Six types. Grand, Upright, and Electric play the bundled MP3 library (nearest root, two velocity layers, `playbackRate` for the sounding note and unison detune). Clav, Digital, and Misc are live synthesis and stay synthesis when the library is ready. With no library installed, Grand keeps the Phase 1 additive voice so the Phase 1 renders stay on that signal; Upright and Electric use their own synthesis. A failed fetch or decode sets status `fallback` with the detail `sample library failed — synthesized fallback` and does not report `ready`. The type LEDs flash in that state.

Two layers. Enable, focus, level, and octave (±12, clamped, applied at note-on). Layer button: off → enable and focus, unfocused on → focus, focused on → off. SUSTPED defaults on for both layers (Shift+Layer A toggles A, Shift+Layer B toggles B's PSTICK, matching the manual's shifted layer buttons as implemented: SUSTPED on A, PSTICK on B). Sustain comes from the keybed pedal button, Space, and MIDI CC64, and holds only layers whose SUSTPED is on. PSTICK bends ±2 semitones. KB Touch is Heavy/Medium/Light (Medium at rest). Dyn Comp is Off/1/2/3. Timbre, Unison (detuned copies inside one voice), Soft Release, and String Res (a quiet octave sine plus looped noise while the pedal or another note is held — not resonance samples) all change the rendered buffer.

## Layer effects

Per piano layer: Mod 1 (A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump), Mod 2 (Chorus, Flanger, Phaser, Vibe, Ensemble, Spin), Delay (tempo, feedback, mix, LP/HP/BP on the repeats, tap), Amp Sim/EQ (EQ, Twin, JC, Small, LP24, HP24, Rotary), Compressor (amount; fast when amount ≥ 110), Reverb (Booth, Room, Spring, Stage, Hall, Cathedral; bright/dark). Reverb impulses are generated buffers, declared as such, not room recordings.

Focus follows the focused piano layer. Organ / Piano / Synth focus buttons are radio selects. Shift+Piano focus toggles piano group mode and copies A's chain onto B. Shift+On on Delay, Compressor, or Reverb toggles global mode and copies that unit onto both piano chains. Each unit has its own bypass. Layer Effects On bypasses the whole chain. All FX Off forces that bypass.

The effects plate is a two-column group row plus a three-column bottom row (Delay, Compressor, Reverb) inside the section, above the keybed. Compressor and Reverb are not painted behind the keys.

## Sample provenance

Files live under `public/samples/` and are listed in `public/samples/manifest.json` and `IMPLEMENTATION_DETAILS.json`.

- Grand — Salamander Grand Piano V3, Alexander Holm, CC BY 3.0, npm `@audio-samples/piano-mp3-velocity4` and `piano-mp3-velocity13` @1.0.5 (layers 4 and 13). 26 roots A0–C7, two velocity layers. License text: `public/samples/SALAMANDER-LICENSE.txt`.
- Upright — Versilian Community Sample Library Yamaha upright, CC0 1.0, commit `sgossner/VCSL@c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`. 13 notes, two layers. C6 has no vl1; the soft slot reuses vl2. `rootMidi` is the sounding pitch.
- Electric — jRhodes3d, Jeff Learman, CC BY-NC 4.0, commit `sfzinstruments/jlearman.jRhodes3d@6b9fbd0dbbdafbf4e46e891ba22154d11131ee9d`. 15 roots, soft and hard takes. Non-commercial, with attribution.

All three sets are trimmed to 2.4 s mono 22050 Hz MP3 and play with no network.

## Honesty

These controls move and do nothing else: Organ, Synth, Program, and every spec-excluded piano or effect behavior (pedal noise, half-pedaling, Triple Pedal, piano size classes, preset library, per-type Variations, Reverb Chorale, delay Chor/Vibe/Ens/Flam/Space and Analog, Pump/Wah pedal modes, rotary close mic and stop angle, post-rotary reverb). Soft and sostenuto are not claimed. The program OLED reports the real engine status and the loaded voice name. It does not name a program.

## Order of work

1. Keep the Phase 1 chassis, tests, and additive Grand path.
2. Add the sample library, two layer voices, and the piano performance controls.
3. Add per-layer effect chains, shared rotary, and Master Level, with the effects grid kept above the keybed.
4. Fix Web MIDI map iteration (`MIDIInputMap` yields `[id, port]`).
5. Extend `tests/feature-matrix.json` to stage 2 and render audio for every new feature id.
6. Capture `evidence/stage2-desktop.png`, `evidence/stage2-narrow.png`, the visual audit, and the capture log.
