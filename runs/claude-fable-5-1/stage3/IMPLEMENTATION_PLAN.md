# Implementation plan — Nord Stage 4 73 (Stagebench)

Variant: `stage-4-73` from `specs/nord-stage-4.variants.json` (73 keys, E1–E7 = MIDI 28–100, 43 white / 30 black,
hammer action, aspect ratio 3.0951). Reference photo: `reference/nord-stage-4-73.jpg`.
Manual: `reference/manual.pdf` (edition N, OS 1.6x) is the authority where a spec is ambiguous.

This file holds the Phase 3 plan first, then the sealed Phase 2 plan (unchanged) and the Phase 1 summary.

---

# Phase 3 — Complete Stage 4 system

Assigned specs: `specs/nord-stage-4.visual.json` (v1.4.0, surface geometry — regression only),
`specs/nord-stage-4.piano.json` (v2.0.0, regression: the Piano section keeps its Phase 2 behaviour and joins the
program/zone/scene/morph system), `specs/nord-stage-4.effects.json` (v2.0.0, the same six units now on six chains —
Piano A/B, Organ (shared), Synth A/B/C — plus Master Clock sync for Delay and Mod 1 and the rotary speed morph),
`specs/nord-stage-4.programs.json` (v2.0.0, 32 programs + 8 Live, Store / Store As, dirty state, splits, zones,
crossfades, scenes, morphs, Master Clock, Transpose, Panic), `specs/nord-stage-4.organ.json` (v2.0.0, two layers, B3 /
Vox / Farf / Pipe engines, drawbars, percussion, key click, vibrato/chorus, rotary) and `specs/nord-stage-4.synth.json`
(v2.0.0, three layers, the required waveform list, filters, envelopes, LFO, voice modes, arpeggiator/gate).
Phase contract: `specs/benchmark-phases.json` phase 3. Manual pages used: 13–17, 18–22, 27–37, 38–45, 48–53.

## Phase 3 hard gates (verbatim from `specs/benchmark-phases.json`)

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
  Evidence: `tests/programs.roundtrip.test.tsx`, `tests/programs.store-live.test.tsx` (Store, Store As with naming, Live
  auto-store, reload from the injected storage boundary), `src/state/programState.ts` (`serializeProgram` /
  `programsEqual` drive the E indicator).
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
  Evidence: `tests/splits.zones.test.tsx` (panel editing + zone gains on the rendered organ signal),
  `tests/scenes.switching.test.tsx`, `tests/morph.assignments.test.tsx` (wheel / control pedal / CC11 interpolation on
  the DSP parameters and rendered level), `tests/layers.routing.test.tsx`.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed
  copies of one oscillator.
  Evidence: `tests/organ.models-drawbars.test.ts` and `tests/synth.sources.test.ts` render the production
  `src/dsp/organ.ts` / `src/dsp/synth.ts` classes offline and compare spectra pairwise.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
  Evidence: `tests/organ.engine.test.tsx`, `tests/system.integration.test.tsx` (one fake context, every source path ends
  in the master limiter → destination), `evidence/stage3-capture.json` (one context in Chrome).
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.
  Evidence: every Phase 1–2 test file is kept; `tests/regression.phase2.test.ts` checks files, ids and evidence. Three
  structural Phase 2 assertions were updated for the larger graph (documented under "Inherited tests touched").

## Shared completion gates (verbatim from `specs/benchmark-phases.json`)

- [x] All benchmark-owned and candidate-authored tests pass. `pnpm test`: 250 tests in 40 files (22 inherited files kept,
  18 Phase 3 files added); `pnpm typecheck`, `pnpm lint` (oxlint incl. react-hooks/rules-of-hooks) and `pnpm build` pass.
- [x] The browser console contains no errors during the required interaction pass. `scripts/capture.mjs --stage stage3`
  → `evidence/stage3-capture.json` (0 console errors, 0 page errors).
- [x] Every claimed audio feature is connected to the audible signal graph. Graph tests on the fake context; rendered-audio
  tests on the same `src/dsp` classes the AudioWorklet hosts; an in-browser offline render in the capture.
- [x] The latest phase preserves all inherited tests, visual evidence, and behavior. Phase 1 and 2 evidence kept;
  `evidence/stage3-visual-audit.md` compares the surface with Phase 2.
- [x] IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
  Organ and Synth are live synthesis (`generatedSources`), never recordings.
- [ ] The evaluated source, build, and evidence match the sealed verification digest. Operator step (`pnpm bench seal`).

## Order of work

1. This plan: hard gates, canonical state schema, control-binding audit plan, DSP contracts.
2. Canonical serializable program state (`src/state/programState.ts`), the bank (32 + 8 Live) with an injectable storage
   boundary, factory programs, Store / Store As (naming) / Live auto-store, the truthful E indicator and edit-discard.
3. Splits (three points × 11 positions, Off / ±6 / ±12 crossfades), KB zones, Layer Scenes, Wheel / Control Pedal morphs,
   Master Clock (tap + dial, KB sync), Transpose, Panic — all in `InstrumentController` + `Performer` (note dispatch).
4. Organ engine (`src/dsp/organ.ts` hosted by the `organ` processor) and Synth engine (`src/dsp/synth.ts`, one `synth`
   processor per layer), each wired into the Phase 2 buses / chains / rotary / master as it lands.
5. Binding audit (`tests/hardware.bindings.test.tsx` against `IMPLEMENTATION_DETAILS.json`), regression pass,
   rendered-audio tests, captures, provenance.

## Canonical state schema (`src/state/instrumentState.ts`)

`InstrumentState` keeps the Phase 2 top-level keys (`piano`, `effects`, `rotary`, `master`, `shiftArmed`, `delayTaps`)
and adds the rest of the program plus the non-program runtime. A **program** is the projection `programOf(state)`:

```
Program (serialised by serializeProgram, compared by programsEqual → the E indicator)
  name                      string (≤ 16 chars, Store As naming)
  piano                     { on, sustped, pstick, focus, layers: { A, B: { on, level, octave, modelId, kbTouch, dynComp,
                              timbre, unison, softRelease, stringRes } } }            (Phase 2 shape, unchanged)
  organ                     { on, sustped: {A,B}, pstick, focus, vibratoMode 0..5 (V1 C1 V2 C2 V3 C3),
                              percussion { on, soft, fast, third, poly },
                              layers: { A, B: { on, level, octave, model 0..5, drawbars[9] 0..8, vibrato } } }
  synth                     { on, sustped, pstick, focus, kbHold, layers: { A, B, C: SynthLayer } }
    SynthLayer              { on, level, octave, mode (Analog/Samples/Extern selector position; only Analog sounds),
                              wave { type: Analog|FM-H, category, index, partial }, oscCtrl, pitch { coarse, fine },
                              oscEnv { attack, decay, release, velocity, toPitch, amount }, filter { on, type, tracking,
                              drive, freq, res, envAmount }, filterEnv { attack, decay, release, velocity },
                              ampEnv { attack, decay, release, velocity 0..3 }, lfo { wave, rate, sync, amount,
                              destination 0..3 (3 = off) }, voice { mode, priority, glide }, unison,
                              vibrato { mode, rate, amount, delay }, arp { run, mode, rate, sync, range, direction, kbSync } }
  effects                   { on, focus, pianoGroup, synthGroup, global { delay, comp, reverb },
                              chains: { pianoA, pianoB, organ, synthA, synthB, synthC: ChainSettings } }
    ChainSettings           Phase 2 units + delay.sync, delay.subdivision, mod1.sync (Master Clock)
  rotary                    { speed 0..1 (0 slow, 1 fast; fractional under morph), stop, drive, organ (routing) }
  split                     { on, points: { low, mid, high: { note: 36..96 (11 positions) | null, xfade: 0 | 6 | 12 } } }
  zones                     Record<LayerKey, { from 1..4, to 1..4 }>   LayerKey = organA organB pianoA pianoB synthA synthB synthC
  scenes                    { active: I | II, other: { sections: {organ, piano, synth}, layers: Record<LayerKey, boolean> } }
                            (the live on-flags are the active scene; serialised as explicit I and II)
  morph                     { wheel: Assignment[], pedal: Assignment[] }  Assignment = { path, start, end }
  clock                     { bpm 30..300, kbSync }
  transpose                 { on, semitones −6..6 }
Runtime (not stored in a program)
  master.level, shiftArmed, delayTaps, clockTaps
  bank                      { programs[32], live[8], slot, liveSlot, liveMode, page, storedFrom: which slot is current }
  view                      program | list | store | storeAs | split | clock | transpose | undo (+ per-view cursor state)
  morphSources              { wheel 0..1, pedal 0..1 }, morphArmed { source, latched }, held-button timers
  undo                      the program discarded by the last program change (Shift + Solo restores it)
```

Rules: `loadProgram` replaces every program key at once (edit-discard); `dirty = !programsEqual(programOf(state), slot)`;
Live slots auto-store on every edit (debounced persistence through the storage boundary); Master Level never enters a
program (programs spec `programState.excludes`).

## Signal graph (one `AudioContext`, Phase 2 nodes unchanged and created first)

```
Piano A / B: voice → bus → LayerChain → level ─┐
Organ (A+B rendered in ONE OrganUnit processor: per-layer model, drawbars, level, octave, vibrato; shared
       percussion / key click) → shared LayerChain (chain `organ`) → section gain ─┐   ORGAN button → Rotary
Synth A / B / C: SynthLayerUnit processor (voices, filter, envelopes, LFO, arp) → own LayerChain → level ─┐  To Rotary
                                                                         ▼
                                shared Rotary (speed 0..1 morphable, Stop) → master gain → limiter → destination
```

Note events reach the organ / synth processors as messages (`ProcessorNodeLike.send`) — the same classes run offline in
tests (`src/dsp/offline.ts`), so every "audibly distinct" claim is proven on production DSP code. Zone crossfade gains,
transpose and scene state are applied by `src/audio/performer.ts`, the one NoteSink behind the NoteBus.

## Control-binding audit plan

Every control in `src/hardware/controls.ts` is classified in `IMPLEMENTATION_DETAILS.json` (`controls.functional` /
`controls.unsupported`) and `tests/hardware.bindings.test.tsx` walks the inventory: each functional control must change
canonical state or an engine parameter when operated; each unsupported control must be listed with the spec clause
that excludes it and must change presentation state only. Excluded (decorative, listed): `program.morph.aftertouch`,
`program.preset-library.*`, `program.section-edit`, `program.mon-copy`, `organ.preset` (Preset / Drawbar Live / Sync),
Shift menus (Program 1–8 under Shift), NUM PAD, PEDAL TAP, INFO, BANK, Variation / Chorale, delay feedback effects,
Analog delay, close mic / angle, arpeggiator Pattern / Zig-zag / Exclude, synth Group modes, Extern / Samples modes
(the selector moves and the display says so; only Analog sounds), aftertouch vibrato. Optional features implemented
and claimed: Undo (Shift + Solo) for program change from an edited state, Sound Init, delayed / pedal vibrato,
percussion Poly, rotary Stop mode, B3 Bass and Pipe 2 (documented engine reuse).

## Inherited tests touched (structural assertions only; every inherited test file and describe block is kept)

- `tests/effects.graph.test.tsx`: the graph now carries 6 layer chains and 12 processors (2 → 6, 4 → 12).
- `tests/piano.note-lifecycle.test.ts` / `tests/piano.status-cleanup.test.tsx`: four source level gains (organ section,
  synth A / B / C) are created after the piano nodes, so the gain count is 10 (was 6), the idle live-node baseline is 9
  (was 5) and the voice gain is `gains()[9]` (was `[5]`). Node order, paths and cleanup assertions are unchanged.
- `tests/visual.control-inventory.test.tsx`: the Synth OLED no longer says "Decorative"; it must now show the focused
  layer's waveform page (the honest Phase 3 text) and never a fake preset or sample name.
- `tests/regression.phase1.test.ts`: the feature matrix stage and the details phase are 3.
- `vitest.config.ts` timeouts 30 s → 120 s and the helpers' real-time `waitUntil` 15 s → 60 s: the DSP suites render audio
  on every worker in parallel and the program round-trip / navigation tests load dozens of programs; each of these
  tests finishes in a few seconds alone but timed out under the eight-worker load.
- `tests/interaction.decorative-controls.test.tsx` is untouched and still green: every control moves or presses, and
  operating the whole panel never creates audio nodes or voices.

## Phase 3 summary

- New modules: `src/state/programState.ts` (program schema, scenes, morph paths, zone gains, serialisation),
  `src/state/factoryPrograms.ts` (32 + 8 Live factory programs; 1.1 mirrors the panel defaults, 15 demonstrate piano,
  organ, synth, split, layered, morphed, scene and clock setups), `src/state/bankStorage.ts` (storage boundary,
  debounced Live persistence), `src/state/morphPaths.ts`, `src/audio/performer.ts` (the NoteBus sink: zones, crossfades,
  transpose, scenes, KB sync), `src/dsp/organTypes.ts` + `src/dsp/organ.ts` (OrganUnit), `src/dsp/synthTypes.ts` +
  `src/dsp/synth.ts` (SynthLayerUnit), `src/ui/morph.ts`, `src/ui/ZoneLeds.tsx`, `src/ui/SplitLeds.tsx`.
- Extended: `src/audio/engine.ts` (organ / synth processors, per-layer note gains, source routing, cleanup accounting),
  `src/audio/instrumentController.ts` (every functional control, programs, views, hold gestures, morph capture, clock,
  transpose, Panic), `src/audio/boundaries.ts` (storage, `send` events, organ / synth processor kinds), the DSP host /
  worklet / fake nodes, `src/dsp/rotary.ts` (continuous speed, Stop mode), `src/dsp/mod1.ts` (clock rate), the six
  section components, both OLEDs, the status strip (Control pedal, Panic, engine pills) and `scripts/capture.mjs`.
- Tests: `tests/programs.*.test.tsx` (4), `tests/layers.routing.test.tsx`, `tests/splits.zones.test.tsx`,
  `tests/morph.assignments.test.tsx`, `tests/scenes.switching.test.tsx`, `tests/organ.engine.test.tsx`,
  `tests/organ.models-drawbars.test.ts`, `tests/organ.rotary.test.tsx`, `tests/synth.*.test.ts` (4),
  `tests/system.integration.test.tsx`, `tests/hardware.bindings.test.tsx` (walks the inventory against
  `IMPLEMENTATION_DETAILS.json`), `tests/regression.phase2.test.ts`; `tests/feature-matrix.json` maps every Phase 1–3 id.
- Evidence: `evidence/stage3-desktop.png`, `evidence/stage3-narrow.png`, `evidence/stage3-capture.json` (28 interaction
  steps, in-browser organ / synth worklet renders, 0 console / page errors) and `evidence/stage3-visual-audit.md`.
- `IMPLEMENTATION_DETAILS.json` (regenerated by `scripts/write-implementation-details.py`) declares phase 3, the organ and
  synth engines as live synthesis, the functional / unsupported classification of all 146 controls with spec citations,
  the Shift functions and the caveats (Samples / Extern positions, Aftertouch vibrato, the MST CLK toggle LED).
- Optional features not claimed: Solo, Prog View modes, program categories / alphabetic sorting, Samples mode, LP M /
  LP+HP, the extra oscillator categories, FM inharmonic. Optional features implemented: Undo, Sound Init, delayed and
  pedal vibrato, percussion Poly, rotary Stop mode, B3 Bass and Pipe 2 (engine reuse as the specs allow).


## Decisions worth knowing (Phase 3)

- **Hold gestures.** Split ON/SET, MST CLK TAP/SET and TRANSP ON/SET open their edit page when held ≥ 400 ms (timer
  boundary); a short press keeps its documented single-press meaning (toggle split / tap tempo / toggle transpose). The
  page stays open until Shift/Exit so a single pointer can turn the dial. Layer buttons keep the Phase 2 toggle semantics.
- **Morph capture.** Hold (or click to latch) WHEEL / CTRLPED, then move a control: start = the stored value, end = where
  the control is left; moving it back onto the start value removes that assignment; Shift + source clears the source.
  While armed, controls show the end value; on release they show the stored value and the morph LED lights.
- **Store audition.** During Store the destination program is loaded for auditioning; confirm writes the pending program,
  cancel restores it. Store As names first (dial = character, Page ◀ ▶ = cursor, soft buttons Ins / Del), then stores.
- **Master Clock sync** is entered the manual's way: Shift + turn the Rate / Tempo knob clockwise (counter-clockwise
  turns sync off); synced knobs show subdivisions in the Program display.
- **Vox / Farf vibrato** is shared by both layers (manual p. 20–21); B3 and Pipe are per layer. The Farf drawbar LED graph
  shows LEDs 1–4 for an inactive register and 5–8 for an active one (manual p. 21).
- **Single pointer vs. two fingers.** A tap on WHEEL / CTRLPED latches the assign mode (the manual's double-tap latch,
  simplified to one tap; Exit or another tap leaves it), which is how a mouse user assigns morphs. A held button keeps its
  pressed state while another control takes the focus (pointer capture), so two-finger touch works as on the hardware.
- **Store LED / MST CLK LED.** The STORE toggle's value means "a Store is pending" (first press opens the destination page,
  second confirms); the MST CLK toggle's LED beats at the tempo regardless of its value, and every press counts as a tap.
- **Hold-to-open pages and the E indicator** are pure state: `isDirty` compares the canonical serialisation of the live
  program with the stored slot, so the indicator can never claim a clean program while a value differs.

---

# Phase 2 — Piano library and working effects

Assigned specs: `specs/nord-stage-4.visual.json` (v1.4.0, surface geometry — unchanged, regression only),
`specs/nord-stage-4.piano.json` (v2.0.0, full Phase 2 scope: six types, three recorded sets, two layers, performance
controls, pedals, fallback) and `specs/nord-stage-4.effects.json` (v2.0.0, the Piano layer chains, the shared Rotary,
focus / group / global / bypass routing and the signal contract).

## Phase 2 hard gates (verbatim from `specs/benchmark-phases.json`)

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
  Evidence: `public/samples/*/manifest.json`, `public/samples/LICENSES.md`, `IMPLEMENTATION_DETAILS.json`; the three sets are decoded from disk and proven pairwise distinct on rendered audio in `tests/piano.instrument-library.test.tsx`.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
  Evidence: `tests/piano.velocity-controls.test.ts`, `tests/effects.processing.test.ts`, `tests/effects.routing.test.tsx`, `tests/effects.graph.test.tsx`.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
  Evidence: `tests/effects.processing.test.ts` (every unit and every listed type on rendered audio, on/bypass, dry/wet) and the in-browser offline render recorded in `evidence/stage2-capture.json`.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
  Evidence: `tests/effects.graph.test.tsx` (fake-context graph paths) and `evidence/stage2-capture.json` (one context, `effects: worklet`).
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.
  Evidence: every inherited Phase 1 test file is kept and green; `tests/regression.phase1.test.ts` checks the files, feature ids and Phase 1 evidence.

## Shared completion gates (verbatim from `specs/benchmark-phases.json`)

- [x] All benchmark-owned and candidate-authored tests pass.
  `pnpm test`: 149 tests in 22 files.
- [x] The browser console contains no errors during the required interaction pass.
  `scripts/capture.mjs` → `evidence/stage2-capture.json` (0 console errors, 0 page errors, desktop and narrow).
- [x] Every claimed audio feature is connected to the audible signal graph.
  Graph tests on the fake context plus rendered-audio tests that run the same `src/dsp` classes the AudioWorklet hosts.
- [x] The latest phase preserves all inherited tests, visual evidence, and behavior.
  Phase 1 evidence files are kept; the visual regression is compared in `evidence/stage2-visual-audit.md`.
- [x] IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
  Generated from the manifests by `scripts/write-implementation-details.py`; generated buffers and live synthesis are never called recordings.
- [ ] The evaluated source, build, and evidence match the sealed verification digest.
  Operator step (`pnpm bench seal`), not performed by the candidate.

## Order of work

1. This plan (hard gates, provenance plan, graph diagram, honesty rules).
2. Refactor the Phase 1 voice into the layer / bus / master architecture without changing input behaviour: the NoteBus,
   the computer keyboard, MIDI and pointer paths are untouched; `PianoEngine` keeps its Phase 1 API and its generated
   "basic piano" voice (now the labelled fallback and a Digital-type model) and gains two layers, per-layer buses and the
   master path.
3. Piano types and models (sample library loader, decoder, nearest-root / velocity-layer selection), two-layer state
   (enable, focus, level, octave, SUSTPED, PSTICK), performance controls (KB Touch, Dyn Comp, Timbre, Unison, Soft Release,
   String Res) and the Master Level knob.
4. Effect units in signal order as one pure-TypeScript DSP core (`src/dsp/`) that runs inside an `AudioWorkletNode` in the
   browser and directly on `Float32Array`s in tests; then focus / group / global routing, per-unit and all-effects bypass,
   To Rotary and the panel bindings (knobs, selectors, LEDs, OLED text).
5. Rendered-audio tests, browser pass, visual regression against Phase 1, canonical captures, provenance.

## Signal graph (one `AudioContext`)

```
                    per note (per layer): AudioBufferSourceNode(s) ─► voice GainNode ─┐   unison: +2 detuned sources
                                                                                       │   through StereoPannerNodes L/R
   ┌─────────────── Piano layer A ───────────────┐                                     ▼
   │ layer bus (GainNode, 2ch)                   │◄────────────────────────────────────┘
   │   └─► LayerChain (AudioWorkletNode, src/dsp/chain.ts)                             │
   │         Timbre EQ ─► String Res ─► Mod 1 ─► Mod 2 ─► Delay ─► Amp Sim/EQ ─► Comp ─► Reverb
   │               (each unit has a click-free bypass crossfade; Layer Effects ON bypasses Mod 1 … Reverb at once)
   │   └─► layer level (GainNode, fader with 10 ms ramps)
   │         ├─ not routed ─────────────────────────────────────────────────────────────────┐
   │         └─ To Rotary ─► shared Rotary (AudioWorkletNode: horn + bass rotor, drive) ─┐  │
   └─────────────────────────────────────────────────────────────────────────────────────┼──┼──┐
   Piano layer B: identical chain, its own bus / worklet / level, same rotary send        │  │  │
                                                                                          ▼  ▼  ▼
                                          master (AudioWorkletNode: Master Level gain ─► limiter) ─► ctx.destination
```

- Order per layer follows `signalContract.requiredOrder`: source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ or Filter →
  Compressor → Reverb → Rotary when routed → master gain/limiter → destination. Timbre and String Res are piano-section
  processors and sit before Mod 1. The layer level fader is applied at the end of the layer chain and *before* the shared
  Rotary send: the Rotary is one instance shared by every routed layer, so its input must already carry each layer's level
  (the manual, p. 53, documents that the Rotary drive depends on the processed instrument's level setting). Reverb always
  precedes the Rotary (spec `excluded`: the global-reverb-after-rotary nuance is cut).
- Global mode (Delay, Compressor, Reverb) applies one shared setting and on-state to every layer chain; Group mode makes
  Piano A and B share every effect setting; focus follows the Piano layer focus and the manual FX focus buttons.
- The worklet is loaded from `src/dsp/worklet.ts` (bundled by Vite as a separate script). If `audioWorklet` is unavailable
  the same DSP objects run on the main thread through a `ScriptProcessorNode`; the status strip says which path is live.
- Tests exercise the same `src/dsp` classes offline (`src/dsp/offline.ts`), so every "measurably changes rendered audio"
  claim is proven on the production DSP code, and the graph shape is proven on the fake context (`src/audio/fakeAudio.ts`).

## Sample provenance plan

Recorded, bundled, offline, redistributable sets live in `public/samples/<set-id>/` as mono 44.1 kHz Ogg Vorbis one-shots
with a `manifest.json` (source, author, licence, every file's root note, velocity layer, length and gain) — decoded with
`@wasm-audio-decoders/ogg-vorbis` (MIT, runs in the browser and in Node tests) into `AudioBuffer`s through the injected
audio boundary. `scripts/samples/` holds the reproducible pipeline (download → trim → normalise per set → encode) and
`public/samples/LICENSES.md` reproduces the attribution texts. Every set is declared in `IMPLEMENTATION_DETAILS.json`.

| Type | Model (set id) | Source and licence | Roots / layers |
| --- | --- | --- | --- |
| Grand | Salamander C5 (`grand-salamander`) | Salamander Grand Piano V3, Alexander Holm, Yamaha C5, CC-BY 3.0 (FreePats mirror) | minor thirds D#1–F#7, 4 of the 16 velocity layers |
| Upright | Kawai upright KW (`upright-kw`) | Upright Piano KW, FreePats (Gonzalo, Roberto), CC0 1.0 | minor thirds D#1–F#7, 2 velocity layers |
| Electric | Wurlitzer EP200 (`electric-wurlitzer-200`); Pianet T; CP80 | Greg Sullivan's E-Pianos (sfzinstruments mapping), CC-BY 3.0 | as recorded (pp/mp/f/ff where present) |
| Digital | TX81Z FM Piano (`digital-tx81z-fm`) recorded; Additive piano (`digital-additive`) generated | VCSL, Versilian Studios, CC0 1.0; own code | major thirds, 3 layers; generated per note |
| Clav | Harpsichord (`clav-harpsichord`) recorded | VCSL, CC0 1.0 | as recorded |
| Misc | Marimba (`misc-marimba`) recorded | VCSL, CC0 1.0 | as recorded |

Rules: generated sources are always labelled generated (never "recording"); the fallback voice is the Phase 1 generated
additive piano and is labelled as such in the status strip and Program display; missing / failed sets flash the type LED and
report "Piano not found" while the fallback stays playable.

## Honesty rules applied in Phase 2

- Only the Piano section, the Layer Effects section, Master Level, the Rotary speed/drive (for routed piano layers) and
  the pitch stick (only when PSTICK is on) change audio. Organ, Synth and Program controls stay presentation-only.
- Everything the specs list under `excluded` stays decorative and is listed as unsupported in `IMPLEMENTATION_DETAILS.json`
  (pedal noise, half pedalling, triple pedal / pedal type, piano sizes, INFO view, Sound Manager, preset library, per-type
  Variations / Chorale, delay feedback-loop effects and Analog mode, Mod 1 pedal modes, rotary close mic / stop angle,
  global reverb placement nuance, master clock sync).
- Soft and sostenuto pedals are not claimed; the only pedal is sustain (UI button, Shift key, MIDI CC64) gated by SUSTPED.

## Decisions worth knowing

- **Shift latch.** The panel's SHIFT buttons are momentary. Holding one with a mouse while pressing another button is
  impossible, so pressing SHIFT arms a latch for the next panel press (8 s, shown as "SHIFT" in the Program display and a
  ring on the button). Holding SHIFT with a second finger also works. Shift functions implemented: SUSTPED (Shift + Layer
  A), PSTICK (Shift + Layer B), GROUP (Shift + Piano FX focus), GLOBAL (Shift + Delay/Comp/Reverb ON), FAST (Shift + Comp
  Amount), PING PONG (Shift + Delay Filter). Excluded Shift functions consume the latch and do nothing else.
- **Layer buttons** are on/off toggles (as in Phase 1); turning a layer on focuses it, turning the focused layer off moves
  the focus to the other layer. Pressing the lit Piano FX-focus button again toggles the focus between A and B when both
  are on (the manual's "press the non-active Layer button" focus gesture would conflict with the toggle).
- **Layer level before the shared Rotary** (see the graph): the rotary is one instance, so each layer's level must be
  applied before the send; the manual (p. 53) confirms the rotary drive depends on the instrument's level.
- **Sparse sets.** For a note whose velocity layer has no root within a minor third, the engine prefers the neighbouring
  velocity layer's closer root (`pickSample`): a slightly wrong dynamic layer is far less audible than a pitch shift.
- **Memory.** Only the sets referenced by the two layers stay decoded; switching models evicts the others.
- **Effects host.** The DSP runs in an `AudioWorkletNode` built from `src/dsp/worklet.ts` (`?worker&url`); the object
  returned to the engine is the real node augmented with `setParams`/`dispose`, so native nodes connect to it directly.
  When the worklet cannot load, the same classes run in a `ScriptProcessorNode`; the status strip reports which host is
  live and why one is unavailable (`effectsError`).

## Environment notes

- Node 20.19 on the box; the declared `pnpm@11.7.0` needs Node ≥ 22.13, so pnpm commands here run through
  `corepack pnpm@10.17.1` (same lockfile format 9.0). Chrome 151 is installed for `scripts/capture.mjs`.
- Web MIDI reports `denied` in headless Chrome; the captures record that truthfully.
- `IMPLEMENTATION_DETAILS.json` is generated from the manifests by `scripts/write-implementation-details.py`.

---

# Phase 1 summary (sealed)

Phase 1 delivered the complete 73-key surface, the six sections at the documented fractions (performance 0.14, organ 0.20,
piano 0.085, program 0.125, synth 0.25, effects 0.20), the 54/46 deck/keybed split, 146 controls with stable ids, one shared
note lifecycle (pointer, touch, computer keyboard, Web MIDI) and one generated additive piano voice with velocity, release,
sustain, polyphony with voice stealing and cleanup. Its plan, tests (`tests/*`), evidence (`evidence/stage1-*`) and feature
mappings are preserved; the Phase 2 graph refactor updates only the structural graph assertions of three Phase 1 tests
(voice gain now feeds a layer bus instead of the master gain directly) and the capture reader accepts the parent harness
capture format.
