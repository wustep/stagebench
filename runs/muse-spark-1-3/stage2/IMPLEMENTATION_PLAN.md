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
