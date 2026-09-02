# Implementation plan — Nord Stage 4 73 (Stagebench)

Variant: `stage-4-73` from `specs/nord-stage-4.variants.json` (73 keys, E1–E7 = MIDI 28–100, 43 white / 30 black,
hammer action, aspect ratio 3.0951). Reference photo: `reference/nord-stage-4-73.jpg`.
Manual: `reference/manual.pdf` (edition N, OS 1.6x) is the authority where a spec is ambiguous.

Phase 1 (sealed, inherited unchanged in behaviour) is summarised at the end of this file. Everything above that
summary is the Phase 2 plan.

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
