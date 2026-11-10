# Phase 2 implementation plan — Nord Stage 4 73

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
