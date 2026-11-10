# Nord Stage 4 73 — Stagebench Phase 3

An interactive Nord Stage 4 73 in the browser. Every section is functional: **Organ**, **Piano**,
**Synth**, **Layer Effects**, the **Rotary Speaker**, and the **Program** section with 32 programs,
8 Live slots, splits, Layer Scenes, morphs, Master Clock, transpose, and Panic. Eleven controls that
the benchmark specs exclude move or press and do nothing else; they are listed on the page under
**Unsupported controls**.

```sh
pnpm install
pnpm dev        # develop
pnpm test       # 39 test files, 639 tests, deterministic, no devices or network
pnpm typecheck
pnpm lint
pnpm build      # writes dist/index.html and dist/samples/
pnpm preview    # serve the build (audio and samples need http://, not file://)
```

## Playing

- Mouse or touch on the keys. Striking nearer the front edge is harder. Slide for a glissando.
- Computer keys `A W S E D F T G Y H U J K O L P ; '` (C4 upward). `Z` / `X` shift the octave.
- `Space` is the sustain pedal unless a control has focus; there is also an on-screen pedal.
- MIDI keyboard: press **Enable MIDI**. Notes, velocity, sustain (CC64), modulation wheel (CC1),
  and control pedal (CC11) are supported.
- **Control pedal** (below the instrument) and the panel's **modulation wheel** are the two morph sources.

**Shift** means: hold a panel Shift button (touch or keyboard), or hold the computer's Shift key,
or click a panel Shift button once to latch it for the next control. On an editing page of the
Program display, a press of Shift is **Exit**.

## Programs

- **Program 1–8** and **Page ◀ ▶** select one of 32 programs (4 pages of 8). The **Program dial**
  steps through them. **Shift + dial** opens a numbered list of all 32. The display shows
  `page.button name`, for example `1.3 Saw Lead`.
- An unsaved edit shows **E** beside the number. Selecting another program discards it.
- **Store**: press once (the destination flashes; choose another with the dial, Page, or Program
  buttons — the keys play what is stored there), press again to store. Shift cancels.
- **Store As** (Shift + Store): the dial picks the character at the cursor, Page moves the cursor,
  Program 1 inserts a space, Program 2 deletes. Store goes on to the destination.
- **Live Mode**: the eight Program buttons become eight Live slots whose edits are stored as they are
  made. Press Live Mode during a Store to store into (or out of) a Live slot.
- Stored programs and Live slots are kept in the browser's local storage and survive a reload.
- 16 factory programs show the instrument (1.1–2.8); the other 16 are "Init" programs to overwrite.

## Splits, scenes, morphs, clock

- **Split** splits the keyboard at C4. Holding it (or **Shift + Split**) opens the Keyboard Split page: Program 1
  switches between the Note and xFade rows, Program 2–4 select Low / Mid / High (pressing the selected
  point again switches it off), the dial sets the note (11 positions, C2–C7) or the crossfade (–, ±6, ±12).
- **KB Zone** is **Shift + Octave Shift** in each section: it steps the focused layer through the
  zones the split offers. Four zone LEDs per section show the result.
- **Layer Scene II** switches between two sets of section/layer on/off switches. Sounds are shared.
- **Morph**: press **Wheel** or **Ctrl Ped** (its LED flashes), move knobs, faders, or drawbars to
  where the morph should end (or press Rotary Slow/Fast), press the button again. On a touch screen
  you can instead hold the button with one finger while moving the control with another. Then move the wheel
  or the Control pedal. Shift + the button clears that source. Moving a control back to its stored
  value while latched removes just that one.
- **Mst Clk** opens the tempo page (dial: 30–300 BPM; Program 1: Keyboard Sync); four or more taps
  set the tempo. **Shift + turn** a Rate or Tempo knob (Arp, LFO, Mod 1, Delay) clockwise to lock
  it to the clock — it then selects 1/2, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T — anticlockwise to free it.
- **Transp** switches transpose on and opens its page (dial: −6…+6). **Shift + Transp** is Panic.

## Organ

Two layers sharing one effect chain. **Organ Model** steps B3, Vox, Farf, Pipe 1, Pipe 2, B3 Bass
for the focused layer; the nine drawbars (LED graphs beside them) set its spectrum — harmonic
footages on the B3, footages, mixtures and a flute/reed mix on the Vox, on/off tabs on the Farf
(past half is on), ranks on the pipes. **B3 Percussion** (On, Volume Soft, Decay Fast, Harmonic
Third), key click, and **Vib/Chorus** (V1–V3, C1–C3, On per layer) are there. The **Organ** button in
the Rotary Speaker group sends the organ through the rotary (Slow/Fast, Stop Mode, Drive).
Everything in the Organ is synthesis; B3 Bass and Pipe 2 reuse the B3 and Pipe engines.

## Synth

Three layers, each with its own effect chain. The display's three dials select the waveform
(whole list / category / waveform within it): **Pure** Sine, Triangle, Saw, Square, Pulse 33,
Pulse 10, White Noise · **Sync** Saw, Square · **Multi** Saw, Saw 8ve · **Super** Saw, Square ·
**FM-H** 2-op. **Osc Ctrl** does what the category needs (nothing / sync pitch / detune / detune
and width / FM amount). Buttons put other pages on the dials: **Pitch**, the three **Envelope**s
(attack / decay / release; decay at maximum is sustain), **Filter Type** (LP12, LP24, HP, BP, KB
track, drive), **LFO Waveform**, the **Arpeggiator Menu** (direction), the **Vibrato Menu**.
Voice modes Poly / Mono / Legato with Lo/Hi priority (Shift + Voice mode), Glide, Unison, Vibrato,
and the arpeggiator / gate (Arp Run, KB Hold, Shift + Arp Run for KB Sync) all work.
Shift + Waveform is Sound Init.

## Piano and Layer Effects

As in Phase 2: six piano types (Grand, Upright, Electric are bundled recordings; Clav, Digital,
Misc are labelled synthesis), two layers, KB Touch, Dyn Comp, Timbre, Unison, Acoustics. Each of
the six effect chains (Piano A, Piano B, Organ, Synth A, B, C) runs Mod 1 → Mod 2 → Delay →
Amp Sim/EQ → Compressor → Reverb → (Rotary) → level. The **FX Focus** buttons choose the chain the
effect controls edit; focus also follows the layer buttons. Shift + FX Focus Piano / Synth is Group;
Shift + On on Delay, Compressor, or Reverb is Global.

## Samples and licences

Grand, Upright, and Electric are recordings bundled in `public/samples/` (198 FLAC files, 12 MB):

| Type | Source | Licence |
| --- | --- | --- |
| Grand | Salamander Grand Piano V3 (Yamaha C5), Alexander Holm | CC BY 3.0 |
| Upright | Upright Piano KW (Kawai), FreePats — Gonzalo and Roberto | CC0 1.0 |
| Electric | Wurlitzer EP200 Electric Piano v1.1, Greg Sullivan | CC BY 3.0 |

Each folder carries its `LICENSE.txt`. `scripts/build-samples.mjs` is the exact recipe that produced
the files from pinned upstream commits; `IMPLEMENTATION_DETAILS.json` lists every file. Everything
else — Clav, Digital, Misc, the fallback piano, every Organ model, the Synth — is synthesized by this
app and is not a recording.

## Where things are

| Path | What |
| --- | --- |
| `IMPLEMENTATION_PLAN.md` | Plan, hard-gate checklist, canonical state schema, signal graph, control-binding audit, decisions |
| `IMPLEMENTATION_DETAILS.json` | Truthful audio source, scope, and control-audit declaration (generated by `scripts/write-details.mjs`) |
| `src/hardware/` | Typed panel data and the presentation store; `functional.ts` lists functional and unsupported controls |
| `src/state/` | Canonical state (`model.ts`), its actions (`store.ts`), morphs, display text, and the binder between panel and state |
| `src/programs/` | Program bank (storage, validation) and the factory programs |
| `src/piano/`, `src/organ/`, `src/synth/` | Catalogs: piano models, organ models, synth waveforms |
| `src/audio/dsp/` | `stage.ts` (kernel: buses, zones, master), `voices.ts` (piano), `organ.ts`, `synth.ts`, `effects.ts`, `params.ts` |
| `src/audio/library/` | FLAC decoder, sample loader, manifest |
| `src/audio/engine.ts` | The one AudioContext, the one node, sample delivery, status |
| `src/input/`, `src/platform/` | Note lifecycle, keyboard, MIDI; injectable browser boundaries |
| `src/ui/` | Instrument, controls, keybed, the two displays, status console |
| `tests/` | One suite per required feature ID; `tests/feature-matrix.json` maps them |
| `evidence/` | Phase 1–3 captures, browser-pass records, visual audits |
| `scripts/` | Sample build, details generator, capture snippets |
