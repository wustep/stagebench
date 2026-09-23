# Phase 3 implementation plan — Nord Stage 4 73

Assigned variant: `stage-4-73` (73-key hammer action, E1–E7).

Specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`, `specs/nord-stage-4.programs.json`, `specs/nord-stage-4.organ.json`, `specs/nord-stage-4.synth.json`.

Phase 3 turns the Organ, Synth, and Program sections on and keeps the Phase 2 piano and effect graph. The visual spec still fixes the silhouette, the 54/46 deck/keybed split, and the section fractions (performance 0.14, organ 0.20, piano 0.085, program 0.125, synth 0.25, effects 0.20).

## Hard gates

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

Phase 2 hard gates still hold:

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

Organ (one shared chain for both layers) and Synth A/B/C use the same ordered inserts on extra buses that sum into the same master and the same rotary. `destinationFeedCount` stays 1. There is no second AudioContext.

## Programs

32 slots (4 pages × 8 buttons) plus 8 Live slots. The program dial steps slots. Shift+dial opens the numeric list. Store writes the current document; Shift+Store names it (dial edits a character, page buttons delete or insert) and then picks a destination. A dirty program shows `E` and is discarded on the next program change; Undo restores that edit. Live auto-stores and is never dirty. Master Level and the live positions of the pitch stick, mod wheel, sustain pedal, and control pedal are performance state and are not stored. Ten factory programs ship in the first slots (Grand Piano matches the boot patch so the instrument is not dirty at startup).

Splits: three points, each one of C2 F2 C3 F3 C4 F4 C5 F5 C6 F6 C7, crossfade Off / ±6 / ±12. The split note belongs to the upper zone. Each layer picks a zone span. Enabled points light split LEDs on those keys. Panel buttons nudge each point, cycle the mid crossfade, and step Piano/Organ/Synth A zones.

Layer Scene I/II stores enable masks only. Sound parameters stay put.

Morph: Wheel and Control Pedal (panel slider and MIDI CC11). Assign by selecting the source and moving a destination; Shift+source clears. Wheel and pedal can drive the same control. While assigning, the source does not apply. Rotary speed is morphable and ramps.

Master Clock is 30–300 BPM by tap (four taps) or by holding Tap and turning the program dial. Arp and LFO follow the clock by default. Delay and Mod 1 do not, so the Phase 2 delay-time formula stays; Shift+Tap opts those in. Transpose is ±6. Shift+Transpose is Panic (notes off, pedals and wheels centered).

## Organ

Two layers, one effect chain. Models: B3 (sine drawbars), Vox (square odd partials), Farf (on/off square ranks plus a shaper), Pipe 1 (slow sine attack and chiff), Pipe 2 (brighter pipe). B3 Bass reuses B3 on 16' and 8' and is not on the panel cycle. Nine drawbars with LED graphs. B3 percussion is single-trigger; key click is a short generated noise burst. Vibrato/chorus is V1 V2 V3 C1 C2 C3. The Organ rotary button sends the organ bus to the shared rotary even when the layer-effect chain is bypassed. All FX Off forces that send off until a section's effects are enabled again. Slow/fast accelerates over about 0.85 s. Stop mode is a very slow rotor.

## Synth

Three layers. Analog waveforms: Pure (sine, triangle, saw, square, pulse 33, pulse 10, noise), Sync, Multi, Super, FM-H. Osc Ctrl does nothing on Pure, sets the sync ratio, detunes Multi/Super, and sets the FM index. Samples mode is bound and silent: there is no sample library, and the OLED says SAMPLES UNSUPPORTED. Filters: LP24 (two lowpasses), LP12, HP, BP, plus resonance, drive, tracking, and an envelope. Osc, filter, and amp envelopes are on the three dials; the env buttons pick which envelope. LFO waveforms are triangle, saw down, saw up, square, and sample & hold, to Osc Pitch, Osc Ctrl (filter Q), or Filter Freq. The third panel LED is labeled Amp in the hardware catalog and selects Osc Ctrl, which is the spec's third destination. Voice modes: poly, mono, legato, low/high/last priority (Shift+Voice), glide, unison, and vibrato (off / delayed / wheel). Arp and gate schedule on the audio clock so offline renders stay deterministic: rate, clock sync, range, direction, hold, and run.

## Control audit

Every hardware control is either bound (`data-decorative="false"`, `data-bound="true"`) or listed in `src/model/unsupported.ts` and on the program panel. Spec-excluded and listed unsupported: morph aftertouch, organ/piano/synth preset libraries, Section Edit, Monitor/Copy, organ preset, delay variation, and per-type piano model variations. The hardware model's own `decorative` flag stays true so the Phase 1 inventory test still sees a complete deck.

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
