# Phase 3 implementation plan — Nord Stage 4 73

Variant: **Stage 4 73** (`stage-4-73`, hammer action, 73 keys E1–E7).

Assigned specs (all six read in full, with the manual pages they cite, before any code changed):

- `specs/nord-stage-4.visual.json` (v1.4.0) — the surface; unchanged since Phase 1 and must not regress.
- `specs/nord-stage-4.piano.json` (v2.0.0) — the Piano section (Phase 2; must not regress).
- `specs/nord-stage-4.effects.json` (v2.0.0) — the effect units, now for six chains instead of two.
- `specs/nord-stage-4.programs.json` (v2.0.0) — programs, Live Mode, splits, scenes, morphs, clock, transpose, Panic.
- `specs/nord-stage-4.organ.json` (v2.0.0) — the Organ section.
- `specs/nord-stage-4.synth.json` (v2.0.0) — the Synth section.

Supporting material: `specs/benchmark-phases.json` (Phase 3 contract), `specs/nord-stage-4.variants.json`,
`reference/manual.pdf` (pp. 13–22, 27–45, 48–53), `reference/nord-stage-4-73.jpg`, `TASK.md`, `prompts/stage3.md`.

## Phase 3 hard gates (copied from `specs/benchmark-phases.json`)

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

Each box was ticked only after its tests and the real-browser pass were green. Where the evidence is:

| Gate | Tests | Browser evidence (`evidence/stage3-browser-pass.json`) |
| --- | --- | --- |
| Program round-trip, 32 + 8 | `programs.roundtrip`, `programs.store-live`, `programs.undo-cancel`, `programs.navigation` | `programs`, `store and live` (including a page reload) |
| Splits, crossfades, scenes, morphs, routing | `splits.zones`, `scenes.switching`, `morph.assignments`, `layers.routing` | `split and zones`, `scenes`, `morphs` |
| Distinct organ engines and synth sources | `organ.models-drawbars`, `organ.engine`, `organ.rotary`, `synth.sources`, `synth.filter-envelopes`, `synth.voice-modes`, `synth.arp-gate` | `organ`, `synth` |
| One graph, one context | `system.integration`, `effects.graph` | `first note`, `still one context` |
| Nothing inherited regressed | all 21 inherited suites, `regression.phase1`, `regression.phase2` | `evidence/stage3-visual-audit.md` |

## Canonical state schema

One plain object, `StageState` (`src/state/model.ts`). The **program** is the eleven keys in
`PROGRAM_KEYS`; `extractProgram` copies exactly those, and that copy is what a slot stores.

```
StageState
├─ program (stored) ─────────────────────────────────────────────────────────────
│  name        string, at most 16 characters
│  organ       { on, sustPed, pStick, focus, vibType,
│                layers[2]: { on, level, octave, zone[lo,hi], model, drawbars[9], vibOn,
│                             perc{ on, soft, fast, third } } }
│  piano       { on, sustPed, pStick, focus,
│                layers[2]: { on, level, octave, zone, type, models[6], timbre, kbTouch,
│                             dynComp, unison, softRelease, stringRes } }
│  synth       { on, sustPed, pStick, focus, hold,
│                layers[3]: { on, level, octave, zone, wave, ctrl, coarse, fine,
│                             oscEnv{ attack, decay, release, amount, velocity, toPitch },
│                             filter{ on, type, freq, res, envAmt, track, drive },
│                             filterEnv{ attack, decay, release, velocity },
│                             ampEnv{ attack, decay, release, velocity },
│                             lfo{ wave, dest, rate, amount, sync },
│                             voice{ mode, priority, glide, unison, vibrato, vibRate, vibAmount },
│                             arp{ run, mode, rate, range, direction, sync, kbSync } } }
│  fx          { on, focus (chain 0..5), pianoGroup, synthGroup, global{ delay, comp, reverb },
│                chains[6]: { mod1{ on, type, rate, amount, sync }, mod2{ on, type, rate, amount },
│                             delay{ on, tempo, seconds, feedback, mix, filter, pingPong, sync },
│                             amp{ on, type, drive, bass, mid, freq, treble },
│                             comp{ on, amount, fast }, reverb{ on, type, tone, mix } } }
│                chains: Piano A, Piano B, Organ (shared by its two layers), Synth A, B, C
│  rotary      { fast, stopMode, drive, organ }
│  split       { on, points[3 = Low, Mid, High]: { on, note (one of 11), xfade (0 | 6 | 12) } }
│  scene       { active (0 | 1), other: the on/off switches of the scene that is not active }
│  morph       { wheel: [{ path, to }], pedal: [{ path, to }] }
│  clock       { bpm (30..300), kbSync }
│  transpose   { on, semitones (-6..6) }
├─ performance (not stored) ─────────────────────────────────────────────────────
│  master, pitchStick, wheel, pedal, notice
└─ navigation and editing (not stored) ──────────────────────────────────────────
   nav         { live, slot, program, liveSlot, dirty }
   ui          { mode: play | list | store | name | split | clock | transpose, section,
                 synthPage, listCursor, store{ dest, name, cursor, naming }, audition, split, morphAssign }
```

Rules that follow from it:

- **Values are in panel units** (knobs 0–10, faders 0–100, drawbars 0–8, envelope dial steps 0–40).
  `deriveSound` turns the state into the `SoundState` the kernel plays (seconds, Hz, gains).
- **Dirty is a comparison.** After every edit the store compares the program part of the state with
  what the loaded slot holds. That comparison is the E indicator, so it cannot be wrong; in Live
  Mode the same comparison triggers the automatic store.
- **A scene holds switches only.** The live `on` flags are the active scene; `scene.other` holds the
  inactive scene's flags. Switching swaps them. There is one set of sound parameters.
- **A morph never edits the program.** An assignment names a parameter by its path and gives the
  value at the top of the source's travel; `applyMorphs` returns a moved copy for the kernel and
  for the LED graphs. The stored value is where the morph starts.
- **Storage is validated.** `ProgramBank` keeps only slots the user stored to (key
  `stage4.programs.v1`); `conformProgram` rebuilds anything read back, field by field, against the
  factory shape.

## Signal graph

Still one `AudioContext`, one `AudioWorkletNode` (or one `ScriptProcessorNode`), one connection to
`destination`. Everything below runs inside that node, in `src/audio/dsp/stage.ts`:

```
 keys ─► zone gain (split, crossfade) ─► transpose ─► the layers that take the key
                                                                                 one shared rotor
 Piano A voices ─ timbre ─┐                                                            │
 Piano B voices ─ timbre ─┤                                                            ▼
 Organ A ─ level ─┐       ├─ each bus: Mod 1 ─ Mod 2 ─ Delay ─ Amp/EQ ─ Comp ─ Reverb ─ [Rotary] ─ level ─┐
 Organ B ─ level ─┴───────┤                                                                               ▼
 Synth A voices ──────────┤                                              sum ─ master gain ─ soft limiter ─ out
 Synth B voices ──────────┤
 Synth C voices ──────────┘
```

- Six buses. The two Organ layers share one, so their faders come before the shared chain.
- `[Rotary]` is in a bus's path while its Amp Sim/EQ is on To Rotary, or — for the Organ — while the
  Rotary Speaker's Organ button is on. One rotor: one speed, one acceleration, for everything routed.
- The Organ (`organ.ts`) is a bank of per-semitone oscillators shared by the keys, read from
  band-limited wavetables; the model decides the waves, the drawbar law, the buses, and the extras.
- The Synth (`synth.ts`) is per-voice oscillators → drive → state-variable filter → amplifier, with
  the LFO, vibrato, voice modes, and the arpeggiator/gate counted in samples inside the kernel.

## Control-binding audit plan

1. `src/hardware/functional.ts` is the single list. Every one of the 146 controls is in exactly one
   of `FUNCTIONAL_BUTTON_IDS`, `FUNCTIONAL_RANGE_IDS`, or `UNSUPPORTED_CONTROLS` (with the spec
   exclusion that justifies it). `UNSUPPORTED_FUNCTIONS` lists Shift functions that only report.
2. `src/state/binding.ts` maps each functional control to one `StageStore` action, and redraws the
   whole panel from the canonical state after every change, so no control can be left showing a
   position the state does not have. A functional ID with no case would report "No binding for …" on
   the display rather than do nothing; the audit test below shows there is none.
3. `tests/hardware.bindings.test.tsx` does the audit by doing: it operates each of the 135
   functional controls on a fresh instrument and requires the canonical state to change (115 of
   them must also change what the kernel is told to play; the other 20 are page, program, focus,
   and assignment controls, named in the test); it operates the 11 unsupported controls and
   requires that the store is never even called.
4. The same lists are shown on the page (**Unsupported controls**), carried by each control's
   accessible description, and written into `IMPLEMENTATION_DETAILS.json` by
   `scripts/write-details.mjs`, which reads them out of `functional.ts`.

Result: **135 functional, 11 unsupported**: Morph Assign A.T., Prog View, the three Preset Library
buttons, Solo, Section Edit, Mon/Copy, Organ Preset, Synth Mode, Delay Effects.

## Decisions that need saying out loud

1. **The instrument starts on factory program 1.1, a plain grand piano** — exactly the Phase 2
   start-up state, so every inherited test and habit still holds. Organ and Synth start off, so
   their On LEDs, and the LEDs of Organ B and Synth B/C, start dark where the photo shows them lit;
   there is no split, so the Split LED is dark and all KB Zone LEDs are lit.
   `evidence/stage3-visual-audit.md` lists every LED that changed.
2. **Hold gestures work, and each has a single-pointer way in**, because one mouse pointer or a
   screen reader cannot hold one control and move another. Holding Split, Mst Clk, or Transp for
   half a second opens its page, and holding a Morph Assign button while moving a control assigns
   (two fingers on a touch screen). The alternatives: Shift + Split opens the split page; a plain
   press of Mst Clk opens the tempo page (and counts as a tap); a plain press of Transp switches it
   on and opens its page; a plain press of a Morph Assign button latches it.
3. **While a Morph Assign is latched, a destination shows that source's end value**, so it can be
   nudged from there with the keyboard; unlatched it shows the stored value again.
4. **Store auditions the destination**: while a destination is chosen the keys play the program
   stored there; the edit buffer is untouched underneath.
5. **The E indicator clears when an edit is undone by hand.** It reports "differs from what is
   stored", which is the truthful reading; the instrument's stays lit until store or reload.
6. **No undo.** Optional in the programs spec; not implemented, not claimed. Solo (whose Shift
   function is UNDO) is listed as unsupported.
7. **Organ models are synthesis and say so**; B3 Bass and Pipe 2 reuse engines as the spec allows
   and are labelled as reuses. The organ's wavetables are computed in memory at start-up and are
   declared as generated buffers.
8. **The Organ's rotary routing does not depend on Layer Effects On.** It is the speaker.
9. **Factory content is this project's own** — 16 hand-made programs and 16 "Init" programs. No Nord
   program names or data.

## Inherited tests: what was touched, and why

All 21 inherited suites are present and green (366 tests then, the same 366 now). Edits:

- `tests/interaction.decorative-controls.test.tsx` — narrowed again, as in Phase 2: "still
  decorative" is now the 11 unsupported controls. The aria-pressed example uses Solo (and Organ On)
  instead of a decorative Organ On; the OLED test checks that the displays tell the truth about the
  loaded program and the Synth instead of checking that they claim none; "Phase 2" became "Phase 3".
- `tests/accessibility.controls.test.tsx` — the decorative selector example is Delay Effects (FX
  Focus Synth is functional now); the slider count allows for the on-screen Control Pedal.
- `tests/regression.phase1.test.ts` — the assertion that Organ, Synth, and Program had no functional
  controls (the Phase 2 contract) became: every section has some, and what is left out is exactly
  the unsupported list.
- `tests/piano.instrument-library.test.tsx` — `details.phase` is 3.
- `tests/feature-matrix.test.ts` / `.json` — stage 3 and the 18 Phase 3 feature IDs.
- `tests/support/panel.ts` — the `oled` helper accepts two more line names. New: `tests/support/rig.ts`.

No inherited test was deleted, skipped, or loosened in what it measures.

## Order of work (as done)

1. This plan (hard gates, schema, audit plan), then the sound-state types.
2. Organ and Synth engines in the kernel, six buses, zones and transpose; inherited suites green.
3. Canonical state, program bank, factory programs; Store / Store As / Live and the dirty comparison.
4. Splits, zones, crossfades, scenes, morphs, clock, transpose, Panic; the binder for all 135 controls.
5. Displays, console, unsupported list; 18 new suites with rendered-audio tests; fixes they forced
   (gate start, split dial skipping disallowed positions, organ sleep, organ rotary drive level).
6. Real-browser pass, captures, visual audit, `IMPLEMENTATION_DETAILS.json`, README.

## Status

`pnpm test` (39 files, 639 tests), `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
The real-browser pass (Chromium, production build) is recorded in `evidence/stage3-browser-pass.json`
and summarised in `evidence/stage3-capture.json`: no console messages, no page errors, one
AudioContext and one destination connection throughout.

The parent capture harness named in `prompts/stage3.md` is outside the workspace and was not
reachable; `scripts/capture-stage3.js` produced the captures instead.

## Not done, on purpose

- Optional and not implemented: list sorting and categories, Solo, Prog View modes, undo; percussion
  poly; Synth Samples mode, LP M / LP+HP filters, extra oscillator categories, FM Inharmonic,
  aftertouch vibrato; piano model list, soft and sostenuto pedals.
- Excluded by the specs: see `IMPLEMENTATION_DETAILS.json` → `unsupported`.

---

# Phase 2 plan (kept for reference)

Variant: **Stage 4 73** (`stage-4-73`, hammer action, 73 keys E1–E7).

Assigned specs (all three read in full, with manual pp. 23–26 and 48–53, before any code changed):

- `specs/nord-stage-4.visual.json` (v1.4.0) — the surface; unchanged from Phase 1 and must not regress.
- `specs/nord-stage-4.piano.json` (v2.0.0) — the Piano section: `scope.required`, `optional`, `excluded`.
- `specs/nord-stage-4.effects.json` (v2.0.0) — the Layer Effects section for the two Piano layers.

Supporting material: `specs/benchmark-phases.json` (Phase 2 contract), `specs/nord-stage-4.variants.json`,
`reference/manual.pdf`, `reference/nord-stage-4-73.jpg`, `TASK.md`, `prompts/stage2.md`.

## Phase 2 hard gates (copied from `specs/benchmark-phases.json`)

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

Each box was ticked only after its tests and the real-browser pass were green. Where the evidence is:

| Gate | Tests | Browser evidence |
| --- | --- | --- |
| Recorded sets | `tests/piano.instrument-library.test.tsx`, `tests/piano.fallback.test.tsx` | `evidence/stage2-capture.json` → `first note`, `six types`, `fallback` |
| Controls change audio and agree with the panel | `tests/piano.layers…`, `piano.velocity-controls…`, `piano.pedals…`, `effects.routing…` | `layers`, `piano controls`, `effects` |
| Units and types process audio | `tests/effects.processing.test.ts` | `effects` |
| One context, ordered graph, master, one destination | `tests/effects.graph.test.tsx` | `still one context` |
| Phase 1 regression-free | all twelve Phase 1 suites + `tests/regression.phase1.test.ts` | `evidence/stage2-visual-audit.md` |

## Sample provenance plan

The workspace contains no audio, so the three recorded instruments were fetched once, at build
time, from pinned commits of public repositories with clear licences, and committed to
`public/samples/`. The app, the tests, and `pnpm build` never touch the network.

| Type | Source | Instrument | Licence | Upstream → bundled |
| --- | --- | --- | --- | --- |
| Grand | Salamander Grand Piano V3, Alexander Holm — `sfzinstruments/SalamanderGrandPiano` @ `3382bf9` | Yamaha C5 grand | CC BY 3.0 | 30 roots (every minor third, A0–C8) × 3 of 16 velocity layers = 90 files |
| Upright | Upright Piano KW, FreePats (Gonzalo and Roberto) — `freepats/upright-piano-KW` @ `570f6c6` | Kawai upright | CC0 1.0 | all 66 recordings, both velocity layers, upstream key map |
| Electric | Wurlitzer EP200 v1.1, Greg Sullivan — `sfzinstruments/GregSullivan.E-Pianos` @ `8c3e581` | Wurlitzer EP200 (reed) | CC BY 3.0 | all 42 recordings, four velocity layers, upstream key map |

- **One reproducible recipe.** `scripts/build-samples.mjs` downloads, downmixes to mono, resamples to
  32 kHz, trims leading silence, caps the length by register (2–6 s) with a fade, peak-normalises,
  and writes 16-bit FLAC: 198 files, 12.3 MB. It also writes `src/audio/library/manifest.json`
  (key zones, velocity layers, gains, SHA-256 of every file, and a fingerprint of its PCM).
- **Truthful declaration.** `scripts/write-details.mjs` generates the `sampleSources` block of
  `IMPLEMENTATION_DETAILS.json` from that manifest: every file with its upstream file, root note,
  velocity layers, length, and whether it was truncated. A test compares the declaration, the
  manifest, and the files on disk.
- **Licences travel with the files**: `public/samples/<set>/LICENSE.txt`, and a *Sample credits*
  panel in the page.
- **Own decoder.** FLAC is decoded by `src/audio/library/flac.ts` rather than `decodeAudioData`, so
  the browser, the ScriptProcessor fallback, and the tests all get identical samples; a test checks
  every file decodes bit-exactly to what the build script encoded.
- **Rejected source:** jRhodes3d (a Rhodes) is licensed CC BY-NC for redistribution; the CC BY
  Wurlitzer set was chosen instead.
- Clav, Digital, and Misc are honest live synthesis (`src/audio/dsp/recipes.ts`) and are labelled
  "Synth …" in the model name, on the display, in the console, and in the details file.

## Signal graph

One `AudioContext`, one `AudioWorkletNode` (or one `ScriptProcessorNode` when the worklet cannot
load), one connection to `destination`. Everything below runs inside that node, in
`src/audio/dsp/stage.ts`:

```
 keys / MIDI / pedal ──► NoteLifecycle ──► PianoEngine ──► message port
                                                               │
 ┌─────────────────────────────── StageKernel ─────────────────▼───────────────────────────────┐
 │                                                                                             │
 │  Layer A bus                                                                                │
 │  voices ─► Timbre ─► Mod 1 ─► Mod 2 ─► Delay ─► Amp Sim/EQ ─► Comp ─► Reverb ─► [Rotary] ─► level ─┐
 │  (samples or                  ▲    │    or LP24/HP24                            ▲           │      │
 │   partials,                   └────┘ feedback through                           │           │      │
 │   + string resonance)          the LP/BP/HP filter                       shared rotor       │      ▼
 │                                                                         (speed, drive)      │     sum ─► master gain ─► soft limiter ─► out
 │  Layer B bus                                                                    │           │      ▲   (Master Level)
 │  voices ─► Timbre ─► Mod 1 ─► Mod 2 ─► Delay ─► Amp Sim/EQ ─► Comp ─► Reverb ─► [Rotary] ─► level ─┘
 │                                                                                             │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                      one node ─► AudioContext.destination
```

- `[Rotary]` is in the path only while that layer's Amp Sim/EQ unit is on and set to **To Rotary**.
  Reverb has already run by then.
- **Layer Effects On** off bypasses every unit and the Rotary on both layers at once.
- Every unit switches in and out with a 12 ms crossfade against its own dry input; continuous
  parameters glide in about 15 ms; delay-time changes crossfade between two read taps.
- A layer with no voices and no audible tail goes to sleep and its effect memory is cleared;
  *All notes off* fades the voices, ducks the output, and clears every tail.

## State architecture

```
 panel hardware (positions, LEDs)          src/hardware/store.ts   — presentation only, imports nothing
        ▲  │
        │  ▼
 PanelBinder                               src/state/binding.ts    — only the IDs in src/hardware/functional.ts
        ▲  │
        │  ▼
 StageStore (canonical state + actions)    src/state/store.ts, model.ts
        │
        ▼ deriveSound()
 SoundState ─► PianoEngine.setSound ─► { type: 'state' } ─► StageKernel.setState
```

- A press or a turn becomes one named action (`pressLayer`, `nextType`, `toggleGlobal`, …).
- After every change the binder rewrites the functional controls from the canonical state: knob
  positions for the *focused* layer's chain, selector LEDs, blinking focus LED, value texts.
  The panel cannot drift from the sound.
- Decorative controls still end in the hardware store. Nothing reads them.

## Decisions that need saying out loud

1. **Start-up state differs from the photo in three places**, so the panel never shows something
   that is not happening and the instrument starts as a plain piano: Layer B starts off; every
   effect unit starts off; LEDs for excluded features (Variation, Chorale, Ped Noise, Delay feedback
   effects) and for the Synth FX focus start dark. Knob, fader, and selector positions are the
   photo's. `evidence/stage2-visual-audit.md` lists every LED that changed.
2. **Layer buttons are press-only.** Off → on and focused; on → focused; focused → off (the last
   layer stays on). The instrument's "press both" and "hold" gestures cannot be done with one
   pointer or a screen reader.
3. **Shift** is either panel Shift button held, the computer's Shift key, or a click on a panel
   Shift button, which latches it for the next control.
4. **Rotary: one rotor, per-layer signal path.** Speed, acceleration, angles, and drive setting are
   shared; each routed layer has its own crossover and delay lines so its level fader can follow
   the Rotary, as the documented order requires.
5. **Group and Global share settings, not a bus.** Entering either copies the focused chain's
   settings to the others; edits then reach every chain in the group.
6. **Fallback is never "Ready".** A recorded model whose files are missing, corrupt, truncated, or
   20 s late plays the Phase 1 synthesized voice as "Fallback Synth Piano"; the type LED flashes;
   the audio status reads Fallback with the reason.
7. **Excluded Shift combinations report and do nothing** (Info, Ped Noise, KB Zone, Variation,
   Analog, stop Angle, List): the display says "not available".

## Phase 1 tests: what was touched, and why

Every Phase 1 suite is still present and green (183 tests then, the same 183 now).
`tests/regression.phase1.test.ts` pins their presence and size. Four files were edited:

- `tests/interaction.decorative-controls.test.tsx` — narrowed as its own hand-off note asked. Tests
  about *moving and pressing* still run over all 146 controls. Tests about *doing nothing else* run
  over the 96 controls that are still decorative. The OLED test now expects the real piano model
  name instead of "Basic Piano" (and still forbids any program, organ, or factory-sound name); the
  decorative note reads "Phase 2"; functional controls must *not* be described as decorative.
- `tests/accessibility.controls.test.tsx` — one assertion: the piano Type selector no longer calls
  itself decorative; a decorative selector is checked in its place.
- `tests/feature-matrix.test.ts` — expects stage 2 and the Phase 1 + Phase 2 feature IDs.
- `tests/support/` — `app.tsx` looks elements up inside its own app (so two apps can be compared
  side by side); `fakes.ts` gained the sample-file loader and lets more microtasks run in `flush`.

No Phase 1 test was deleted, skipped, or loosened.

## Order of work (as done)

1. This plan.
2. Sample sources, the build script, the manifest, the FLAC decoder (verified bit-exact).
3. `StageKernel`: layer voices (samples and partials), buses, master. Phase 1 suites green against it
   before anything else was wired.
4. Canonical state, actions, and the panel binder; the session wiring; the OLED and console.
5. Effect units in signal order, then focus / group / global / bypass, then the Rotary.
6. Rendered-audio tests for all nine Phase 2 feature IDs; fixes they forced (glide start-up,
   reverb all-pass gain, held-string tracking, panic tails, wake-up snapping).
7. Real-browser pass, captures, visual audit, `IMPLEMENTATION_DETAILS.json`.

## Status

`pnpm test` (21 files, 366 tests), `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
The real-browser pass (Chromium, production build) is recorded in `evidence/stage2-capture.json`:
AudioWorklet ready, 90 Grand files fetched from the build and nothing from anywhere else, all six
types sounding, layers, piano controls, every effect unit, tap tempo, To Rotary, Group, Global,
Master Level to silence, panic, one context with one destination connection throughout, and the
labelled fallback with one sample set blocked. The only console errors are the 66 requests that
step blocks on purpose.

The parent capture harness named in `prompts/stage2.md` is outside the workspace and was not
reachable; `scripts/capture-stage2.js` produced the captures instead.

## Not done, on purpose

- Optional: model List view; soft and sostenuto pedals; pedal-down resonance samples.
- Excluded by the specs: see `IMPLEMENTATION_DETAILS.json` → `unsupported.excludedBySpec`.
- Phase 3: Organ, Synth, Programs, splits and KB zones, scenes, morphs, master clock (so no MST CLK
  sync for Mod 1 or Delay yet), transpose; FX Focus Organ/Synth and the Rotary Organ button.

## Hand-off notes for Phase 3

- **More chains.** `StageKernel` builds `LAYER_COUNT` layer units; `FxChain` and `RotaryPath` are
  per layer and the `Rotor` is already shared. Organ and Synth layers need a source that renders
  into a layer bus and an entry in `SoundState.layers`.
- **Focus.** `StageState.fx.focus` is a Piano layer index today; it becomes (section, layer). Group
  and Global already work through `fxTargets()`, the one place that decides which chains an edit reaches.
- **Functional control list.** `src/hardware/functional.ts` is the single list; move IDs out of
  `UNSUPPORTED_IN_FUNCTIONAL_SECTIONS` as they come alive, and narrow the decorative suite again.
- **Programs** should serialise `StageState` (it is plain data) and replace it through `StageStore`.
- **Master clock**: Mod 1 and Delay take rates in knob units; add a synced-rate path in `deriveSound`.
- **Zones and transpose** belong before `StageKernel.noteOn` fans a key out to the layers.

---

# Phase 1 plan (kept for reference)

Phase 1 delivered the complete surface for the 73-key variant and one synthesized piano voice,
with every panel control decorative. Its hard gates were all met (183 tests, browser pass,
captures, visual audit — see `evidence/stage1-*`). Decisions that still stand:

1. **Section widths follow the visual spec** (14 / 20 / 8.5 / 12.5 / 25 / 20 %), which matches the photo.
2. **Photo-measured layout**: every control, LED, legend, and plate is positioned from pixel
   coordinates read off the reference photo.
3. **One DSP kernel, two hosts**: AudioWorklet, or ScriptProcessor when the worklet cannot load.
   Tests render the real kernel offline.
4. **Decorative means decorative**: the hardware store has no reference to audio, input, or platform code.
5. **OLEDs tell the truth**: no fake program names.

The Phase 1 voice (`src/audio/dsp/kernel.ts`) is unchanged and still covered by its suites. The
Phase 2 fallback voice is that recipe ported to the layer voice engine (`basic` in `recipes.ts`).
