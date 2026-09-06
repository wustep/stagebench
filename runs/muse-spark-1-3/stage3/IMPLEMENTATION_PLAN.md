# IMPLEMENTATION_PLAN.md — Phase 1: Complete surface and basic piano

Specs read (workspace `inputs/`):
- `specs/nord-stage-4.visual.json` (v1.4.0) — control-deck geometry, section landmarks, forbidden-hardware rules, presentation gates.
- `specs/nord-stage-4.piano.json` (v2.0.0) — piano behavior; only the Phase 1 subset applies (one dependable basic voice).
- `specs/nord-stage-4.variants.json` — assigned variant **stage-4-73** (73 keys, 43 white / 30 black, E–E, MIDI 28–100).
- `specs/benchmark-phases.json` (protocol v2.0.0) — Phase 1 outcome, exclusions, hard gates.
- Reference photo `reference/nord-stage-4-73.jpg` (authoritative for visible layout/materials).

## Phase 1 hard gates (checklist)

- [ ] The exact keybed count and range for the assigned variant are modeled and playable. (73 keys, E1–E7, MIDI 28–100.)
- [ ] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [ ] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [ ] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [ ] Canonical desktop and narrow captures are complete with a written visual audit.

## Geometry decisions (photo wins on conflict)

- Section fractions from `nord-stage-4.visual.json` (photo-measured 2026-07-04 correction):
  performance 0.14 / organ 0.20 / piano 0.085 / program 0.125 / synth 0.25 / effects 0.20.
  The `prompts/stage1.md` percentages (13/21/15/9/21/21) are the superseded coarse values
  the visual spec explicitly corrects — deviation recorded in `stage1-visual-audit.md`.
- Vertical deck/keybed split 54/46 (±0.025 tolerance).
- Desktop 1440×900: instrument 88–97% viewport width, no vertical scroll, no page overflow.
  Narrow 390×844: instrument keeps a minimum usable width inside a page-safe horizontal
  scroller (body never overflows) so it stays inspectable without clipping.
- Forbidden-hardware rules implemented structurally: no display element in performance or
  effects; no wide (≥0.5 section) display in organ/piano/synth; program has exactly one
  primary OLED (any secondary readout < 0.5 of its area); organ keeps 9 tall drawbars
  (never a uniform grid); synth uses varied control sizes + grouped sub-panels; effects is
  two visibly separated groups. Piano band has only 2 tall faders (no drawbar bank).

## Work order

1. Normalized typed hardware/key data with stable IDs (`src/hardware/keys.ts`,
   `src/hardware/sections.ts`): keybed E1–E7, six sections, full control inventory.
2. Chassis, sections, exact keybed (`src/components/*`, `src/App.tsx`, `src/styles.css`):
   one continuous red chassis, dark inset plates (performance stays exposed red),
   decorative accessible controls backed by a normalized presentation-only hardware store
   (`src/state/stage.tsx`) that changes no audio/system state.
3. Injectable audio/MIDI/timing boundaries, then note lifecycle, then piano voice:
   - `src/audio/dsp.ts` — pure deterministic DSP (midi→freq, velocity→gain, additive
     piano-note renderer, RMS/tail helpers, deterministic steal-victim selection).
   - `src/audio/engine.ts` — `PianoEngine` over an injected `AudioContextLike`
     (master gain → destination; per-note buffer source + gain; sustain hold; stealing;
     status idle/loading/ready/error/silent-fallback). `src/audio/fakes.ts` test doubles.
   - `src/audio/lifecycle.ts` — `NoteManager` (per-source refcount, retrigger,
     sustain-aware release, all-notes-off).
   - `src/midi/midi.ts` — `MidiManager` (pending/connected/denied/disconnected/
     unavailable/error; note on/off, velocity, CC64 sustain; injectable access).
   - Computer-key map (C4-based, repeat suppression, blur cleanup) + Space-as-sustain
     only when the event target is the page body.
4. Honesty: one synthesized basic piano voice, declared as live synthesis + generated
   buffers in `IMPLEMENTATION_DETAILS.json` (`sampleSources: []` — no recordings claimed).
   Panel OLEDs show static text that never reports unimplemented features as working.
5. Tests (`src/*.test.*`, mapped in `tests/feature-matrix.json`, one or more real files
   per required feature ID) with deterministic fakes — no network, devices, or audio out.
6. Evidence: `stage1-desktop.png`, `stage1-narrow.png`, `stage1-capture.json`,
   `stage1-visual-audit.md`; truthful `IMPLEMENTATION_DETAILS.json`; final
   `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Phase 1 scope discipline

Functional: keybed notes + sustain input (UI, computer key, MIDI CC64) through one
lifecycle into one piano voice with loading/ready/error/fallback status. Everything else
(keys depress, buttons light, knobs turn, faders/drawbars slide) is presentation state
only: no audio, no fake program/effect state. Phase 2+ behavior (piano types/models,
effects, organ, synth, programs) stays decorative.

---

# Phase 2: Piano library and working effects (Stage 4 73)

Specs read (workspace `inputs/`):
- `specs/nord-stage-4.visual.json` — unchanged surface contract; Phase 2 adds a
  functional strip inside Piano / Layer Effects / Performance bands. Every Phase 1
  control ID keeps its exact DOM position, role, and decorative behavior
  (regression: `regression.phase1`).
- `specs/nord-stage-4.piano.json` (v2.0.0) — six types, two layers, recorded
  Grand/Upright/Electric sets, KB Touch / Dyn Comp / Timbre / Unison /
  Soft Release / String Res, SUSTPED+PSTICK, sustain, labeled fallback.
- `specs/nord-stage-4.effects.json` (v2.0.0) — Mod 1, Mod 2, Delay, Amp Sim/EQ,
  Compressor, Reverb per piano-layer chain + shared Rotary; focus / group /
  global / bypass; documented signal order; one AudioContext; master limiter.
- `specs/benchmark-phases.json` (protocol v2.0.0) — Phase 2 outcome, exclusions,
  hard gates. Reference photo `reference/nord-stage-4-73.jpg` still authoritative
  for layout/materials. Manual (`reference/manual.pdf`, pp. 23–26, 48–53) is
  authoritative where a spec is ambiguous.

## Phase 2 hard gates (checklist)

- [ ] Grand, Upright, and Electric are bundled recorded sample sets that are
      audibly distinct, work offline, and have complete redistributable provenance.
- [ ] Every functional piano and effect control measurably changes rendered audio
      and agrees with its panel feedback.
- [ ] Each effect unit and type processes real audio with working bypass and dry/wet.
- [ ] One AudioContext feeds layer buses, ordered effects, master gain/limiter,
      and one destination.
- [ ] The Phase 1 surface, keybed, and input behavior remain regression-free.
      (All Phase 1 tests byte-identical and green; all Phase 1 DOM IDs intact.)

## Sample provenance plan

`scripts/generate-samples.mjs` (committed, deterministic seeded LCG — no
`Math.random`, no clock) bounces three offline sample sets into
`public/samples/<set>/` as 16-bit mono WAV at 22050 Hz, plus
`public/samples/manifest.json`:

- 15 root notes per set (MIDI 28,33,…,98 — max pitch-shift ±3 semitones),
  3 velocity layers per root (soft/mid/loud) = 45 files per set, 135 total.
- Grand "Studio Concert": stretched-partial additive stack, long decay, bright.
- Upright "Studio Upright": rolled-off highs, faster decay, ±3-cent double
  course, woody 2nd partial. Audibly distinct recipe from Grand by construction.
- Electric "Stage Tine": tine-bar recipe (strong 1st+2nd, short high "ping"
  transient, long even sustain). Audibly distinct from both acoustics.
- License: CC0-1.0, original synthetic-studio recordings created by the
  generator in this repo — NOT acoustic piano recordings, and never described
  as such. `IMPLEMENTATION_DETAILS.json` lists every set, the generator, the
  seed, root notes, velocity layers, and the license; `sampleSources[]` carries
  the full file list via the manifest.
- Clav / Digital / Misc: honest live synthesis (allowed by the spec), rendered
  per note in `src/audio/render.ts` (offline) and `src/audio/graph.ts` (live):
  Clav = picked-string burst + short decay; Digital = layered bell-ish FM-ish
  stack; Misc = marimba-like sine + 4th-partial mallet transient.
- Missing/undecodable asset → that type falls back to a labeled synth voice,
  the type selector flashes, and the program display reports the failure; the
  primary library is never reported ready in that path.

## Signal graph (live, `src/audio/graph.ts` + `src/audio/stageEngine.ts`)

```text
inputs (pointer / touch / computer-key / MIDI CC64+notes / UI pedal / Space)
  ├─ NoteManager A ─┐  per-layer ownership, refcount, sustain-aware
  └─ NoteManager B ─┘
StageEngine (ONE AudioContext, injected factory)
  voice(layer, midi, vel):
    BufferSource(sample: nearest root × velocity layer | synth buffer)
      rate = 2^((midi-root+octave×12)/12) × pitchBend(SUSTPED/PSTICK-gated)
      gain = vel × KB-Touch curve × DynComp × layerLevel
      × Unison copies (level 1/2/3 → 1/2/3 extra detuned copies ±cents)
    → layerBus[layer]: Mod1 → Mod2 → Delay ⤺(feedback filter in loop)
      → AmpEQ ─┬─→ Comp → Reverb ─┬─→ layerLevel gain ─┐
               └─ToRotary→ Rotary ─┘                    ├─→ masterGain
  masterGain (Master Level, p2-master-level) → limiter → destination
```

- Rotary is a single shared instance AFTER reverb (spec order); layers route via
  AmpEQ "To Rotary" type without muting their other units.
- All bypasses use short `setTargetAtTime` ramps (click-free); dispose stops
  every oscillator/source, disconnects every node, closes the context.
- Offline mirror `src/audio/render.ts` (pure Float32Array DSP, same order and
  parameter semantics) lets tests cross the audio boundary deterministically;
  `src/audio/samples.ts` parses the real bundled WAVs in Node so instrument
  distinctions are proven on shipped bytes.

## Work order

1. Plan (this file) + `package.json` `samples` script.
2. Generator → `public/samples/**` + manifest; verify sizes + determinism.
3. Audio core: extend `types.ts`/`fakes.ts` (filters, delay, comp, shaper,
   panner, oscillator, convolver, decode); `pianoTypes.ts`, `samples.ts`,
   `render.ts`, `graph.ts`, `stageEngine.ts`. `engine.ts`/`dsp.ts`/
   `lifecycle.ts` stay byte-identical.
4. State (`src/state/pianoFx.tsx`: per-layer piano + per-layer chains +
   focus/group/global resolution, pure helpers) and panels
   (`src/components/panels.tsx`, `p2-*` IDs only) + `.p2` CSS; embed strips in
   `sections.tsx` without moving any Phase 1 node; Master Level, pitch bend,
   program-display model text (never "enabled/working/phase 2" wording).
5. Tests (new files only) + `tests/feature-matrix.json` stage 2; all Phase 1
   tests untouched.
6. Evidence: `IMPLEMENTATION_DETAILS.json` (phase 2), `PREFIX=stage2` captures,
   `stage2-visual-audit.md`, provenance check, final
   `pnpm test` + `typecheck` + `lint` + `build`.

## Phase 2 scope discipline

New and functional: two piano layers, six types/models, performance controls,
six effect units + Rotary per the required type lists, focus/group/global,
bypasses, Master Level, pitch bend (PSTICK-gated), sustain (SUSTPED-gated),
labeled fallbacks. Still decorative, permanently: every Phase 1 decorative ID
(including old `fx-*` knobs and `piano-detail-*` buttons), Organ audio, Synth
audio, Programs/splits/scenes/morphs, and everything both specs list under
`excluded` (pedal noise, half-pedaling, size classes/INFO/Downloads, preset
library, per-type Variations, Reverb Chorale, delay loop FX/Analog, Pump/Wah
pedal modes, rotary close mic/stop angle).

## Bridging decisions (no duplicate controls)

- The hardware knobs ARE the controls: `perf-master-level`, `perf-pitch-stick`
  (position 0..10 → bend ±2 st), `perf-rotary-speed` (toggles slow/fast), and
  `perf-rotary-drive` are bridged through `usePianoFxBridge`
  (`src/state/pianoFx.tsx` + `src/components/controls.tsx`) to audible engine
  state. Their DOM position, roles, and Phase 1 presentation behavior outside
  the provider are byte-identical; inside the provider the same movement moves
  both the knob and the sound. The `p2-*` strips carry only genuinely new
  controls (layers, types, chains, tap); pitch/rotary appear there as plain
  readout mirrors, never as second controls. Master Clock sync is out of
  scope (Phase 3 engine): tap tempo is manual, and the panel claims nothing
  about clock.
- Soft Release is live (release-gain fade ~180 ms vs prompt stop) and disabled
  for Clav-type sounds (manual p. 25); String Res arms only while other notes
  or the pedal are held; disabling a layer/section stops its held voices so
  nothing drones under a dark panel; the model dial caps at each type's model
  count (one model per type this phase).

---

# Phase 3: Complete Stage 4 system (Stage 4 73)

Specs read (workspace `inputs/`):
- `specs/nord-stage-4.visual.json` — unchanged surface contract; Phase 3 adds
  functional `p3-*` strips inside Program / Organ / Synth / Performance bands.
  Every Phase 1–2 control ID keeps its exact DOM position, role, and behavior
  (regressions: `regression.phase1`, `regression.phase2`).
- `specs/nord-stage-4.programs.json` (v2.0.0) — 32 slots, Store/Store As/naming,
  dirty E, edit-discard, 8 Live slots, splits/zones/xfade, scenes I/II, Wheel +
  Control Pedal morphs, Master Clock, Transpose ±6, Panic.
- `specs/nord-stage-4.organ.json` (v2.0.0) — 2 layers, shared chain, B3/Vox/
  Farf/Pipe1 distinct (+B3 Bass/Pipe 2 reusing documented engines), 9 drawbars,
  percussion, key click, C1–C3/V1–V3, rotary routing with accel + morph speed.
- `specs/nord-stage-4.synth.json` (v2.0.0) — 3 layers, 14 required waves
  (Pure×7/Sync×2/Multi×2/Super×2/FM-H×1), category-correct Osc Ctrl, LP12/LP24/
  HP/BP + tracking/res/drive, 3 ADR envelopes (decay-max = sustain; amp adds a
  working sustain-level knob as an honest extension), 5-wave/3-dest LFO with
  clock sync, poly/mono/legato + priority + glide + unison + vibrato
  (On/Wheel), deterministic arp (Arp/Poly/Gate, rate+sync, range, direction,
  hold, run).
- `specs/nord-stage-4.effects.json` (v2.0.0) — Phase 3 extends the same units:
  6 chains per program (Piano A/B, Organ shared, Synth A/B/C) + 1 shared
  Rotary; Piano+Synth group modes; Delay/Comp/Reverb global across all
  sections; Mod1/Delay clock sync; Rotary stop (optional, claimed + working).
- `specs/benchmark-phases.json` (protocol v2.0.0) — Phase 3 outcome,
  exclusions, hard gates. Manual ch. 4/6/7 authoritative on ambiguity; variant
  photo authoritative on layout. Reference photo re-checked 2026-09-05.

## Phase 3 hard gates (checklist)

- [x] Program save/load round-trips all supported state across the 32 slots
      and 8 Live slots. (`programs.roundtrip`/`store-live`, 8 factory programs.)
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from
      the panel and observable in audio. (`splits.zones`, `scenes.switching`,
      `morph.assignments`, `layers.routing`.)
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source
      categories are audibly distinct, not renamed copies of one oscillator.
      (`organ.models-drawbars`, `synth.sources` pairwise distinctions.)
- [x] Organ and Synth route through the Phase 2 graph with no separate
      AudioContext. (6 chains + 1 rotary on the one context; `system.integration`.)
- [x] All inherited visual, piano, effects, and input behavior remains
      regression-free. (107 Phase 1–2 tests green, byte-identical;
      `regression.phase2`.)

## Canonical state schema

One serializable `InstrumentProgram` (`src/state/program.ts`, plain JSON):

```text
program = { name, piano, organ, synth, split, scenes, morphs, clock, transpose }
piano = { layers{A,B}: LayerPianoState, layerFocus, chains{A,B}: ChainState,
          fx:{focus,pianoGroup,layer}, sectionOn }
organ = { sectionOn, focus:A|B, layers{A,B}: OrganLayerState, chain: ChainState,
          organRotary: bool }
synth = { sectionOn, focus:A|B|C, group: bool, layers{A,B,C}: SynthLayerState,
          chains{A,B,C}: ChainState }
split = { on, points:{low,mid,high}:{active,pos:SplitPos,xfade:0|6|12},
          zones: per engine-layer {lo,hi} over zones 0..3 }
scenes = { active:I|II, I:EnableMap, II:EnableMap }  // enable-only, shared sound
morphs = { wheel: Assign[], pedal: Assign[] }        // {target,start,end}
clock = { bpm:30..300, kbSync:bool }
transpose = -6..6
```

NOT stored (live performance): Master Level, pitch bend, wheel/pedal values,
rotary speed/drive, all-bypass, solo, UI arm states. `SplitPos` = the 11
documented positions C2..C7 (MIDI 36..96). `EnableMap` covers 3 sections + 7
layers. Slots: 32 programs + 8 Live (auto-store); dirty E flag; stash-based
Store audition (destination audible while browsing, edits restored on cancel);
single-level undo for program-change-from-edited (claimed + tested).

## Control-binding audit plan

Every Phase 1 hardware ID is re-checked: it either drives canonical state
through the extended bridge (`src/components/controls.tsx` `BRIDGED_CONTROLS`,
same movement moves knob + sound, isolated tests keep presentation behavior)
or is listed in `UNSUPPORTED_CONTROLS` (`src/state/program.ts`) with its
spec-excluded reason, rendered in the UI notes strip. Only
`program-morph-3` (Aftertouch, programs-spec excluded) stays decorative.
Notable mappings: drawbars→focused organ layer; program slots/dial→selection;
`program-fn-9` Mono→Solo audition (optional credit, working); transpose
button→transpose arm + dial; synth-fn-5 tap→master-clock tap; `perf-mod-wheel`
→Wheel source; `perf-rotary-stop`→rotary stop; piano/effects hardware→focused
chain params. Full table in `evidence/stage3-binding-audit.md`.

## Work order

1. Plan (this file).
2. `program.ts`: schema, SplitPos/zones/xfade gain math, morph target catalog
   + interpolation, factory programs (≥8), unsupported list.
3. `organTypes.ts` + `organRender.ts`: models/drawbars/perc/click/vib.
4. `synthTypes.ts` + `synthRender.ts`: waves/oscCtrl/filters/envelopes/LFO/
   voice/arp pure logic.
5. `fxTypes.ts` additive: RotarySpeed+stop, delay/mod1 sync flags, focus
   layer C, cross-section globals, clock helpers.
6. `stageEngine.ts`: organ (partial-loop voices, live drawbar/level gains,
   perc/click/vib buses) + synth (rendered voices, mono/legato/priority/glide,
   release envelopes, arp scheduler with injectable timers) + 4 new chains on
   the SAME context/master/rotary + clock + transpose + zones + morph-live.
7. `instrument.tsx`: slots/live/store/store-as/naming/dirty/undo/scenes/
   morph-arm-capture/splits/clock/transpose/solo + piano bridge via onChange.
8. Panels (`stage3panels.tsx`), strips, split LEDs, program/MST-clock UI,
   unsupported notes; bridge + morph LEDs.
9. App routing (7 layer managers, zone/scene/solo/transpose/morph/CC11,
   extended Panic); MIDI CC11; wheel/pedal inputs.
10. Tests (new files only) + `tests/feature-matrix.json` stage 3; Phase 1–2
    tests byte-identical.
11. Evidence: `IMPLEMENTATION_DETAILS.json` (phase 3), binding audit,
    `PREFIX=stage3` captures + `stage3-visual-audit.md`, provenance check,
    final `pnpm test` + `typecheck` + `lint` + `build`.
