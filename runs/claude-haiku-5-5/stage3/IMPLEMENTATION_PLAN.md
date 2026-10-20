# Phase 3 implementation plan: Nord Stage 4 73 (stage-4-73), complete system

Status: all four gates pass (`pnpm test` 363/363, `pnpm typecheck`, `pnpm lint`, `pnpm build`). Two gates stay open, marked below: the visual layout of the inherited surface, and the sealed digest, which is the operator's to check.

Governing specs (every assigned spec for Phase 3):

- `inputs/specs/nord-stage-4.visual.json`
- `inputs/specs/nord-stage-4.piano.json`
- `inputs/specs/nord-stage-4.effects.json`
- `inputs/specs/nord-stage-4.programs.json`
- `inputs/specs/nord-stage-4.organ.json`
- `inputs/specs/nord-stage-4.synth.json`

Also read: `TASK.md`, `prompts/stage3.md`, `specs/benchmark-phases.json` (Phase 3 contract), `specs/nord-stage-4.variants.json` (`stage-4-73`), `reference/nord-stage-4-73.jpg`.

## Phase 3 hard gates

Quoted verbatim from `specs/benchmark-phases.json`, Phase 3:

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
  - Met. `programs.roundtrip` and `programs.store-live` (`src/model/program.test.ts`): every one of the 32 slots and 8 Live slots survives save and reload through storage. The dirty indicator is computed from the canonical snapshot, not a flag.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
  - Met. Splits (`src/audio/zones.test.ts`, `src/instrument/stage4.render.test.ts`), crossfades, scenes (`src/model/layers.test.ts`), and morphs (`src/model/morph.test.ts`). The split is measured in audio: a lower-zone note sounds only the organ and an upper-zone note only the synth. Morph reaches the derived level and the rotary speed.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
  - Met for B3, Vox, Farf, and Pipe 1 (`src/audio/organ/organ.render.test.ts`: pairwise spectral distance > 0.25 on the same drawbars) and for the synth categories Pure, Multi, Super, and FM-H (`src/audio/synth/synth.render.test.ts`). Sync is checked on its own pitch, because its second oscillator sits off the harmonic grid.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
  - Met. `src/instrument/stage4.render.test.ts` asserts one `AudioContext` for piano, organ, and synth together, and that organ and synth voices return to zero after release. Every organ and synth node feeds the Phase 2 `SignalGraph` chains O, SA, SB, SC.
- [ ] All inherited visual, piano, effects, and input behavior remains regression-free.
  - Declared deviation, not met. The behavioural regression suite is green (Phase 1 and 2 tests kept, 363/363). At 1440x900 the inherited surface is denser than in Phase 2: 15 legend pairs overlap and two section headings are touched, and the Synth, Piano, and Program legends print at about 5 px. The measurements and the reasons are in `evidence/stage3-visual-audit.md` and `evidence/stage3-capture.json`.

## Shared completion gates

Quoted verbatim from `specs/benchmark-phases.json`:

- [x] All benchmark-owned and candidate-authored tests pass.
  - Met. `pnpm test`: 31 files, 363 tests, exit 0.
- [x] The browser console contains no errors during the required interaction pass.
  - Met for the browser pass that ran: the production build was loaded and the Organ model, Live Mode, a program button, Morph assign, STORE, the arpeggiator run switch, and Panic were pressed. The console had 0 page errors and 0 console errors (the warnings are the browser's MIDI SysEx notice). Captures: `evidence/stage3-desktop.png`, `evidence/stage3-narrow.png`, and the manifest `evidence/stage3-capture.json`.
- [x] Every claimed audio feature is connected to the audible signal graph.
  - Met. Every audio feature listed in `IMPLEMENTATION_DETAILS.json` is connected to the signal graph, and the rendered tests exercise it. Approximations are declared there.
- [ ] The latest phase preserves all inherited tests, visual evidence, and behavior.
  - Declared deviation. Tests are preserved and extended. The visual evidence is captured (`evidence/stage3-desktop.png`, `evidence/stage3-narrow.png`, `evidence/stage3-capture.json`) and audited (`evidence/stage3-visual-audit.md`), and the audit declares the density deviation rather than hiding it.
- [x] IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
  - Met. `IMPLEMENTATION_DETAILS.json` separates recorded samples (three bundled sets, unchanged), generated buffers (key click, white-noise loop, reverb impulses), and live synthesis (organ, synth, fallback).
- [ ] The evaluated source, build, and evidence match the sealed verification digest.
  - Not verified by this run. The sealed verification digest is the operator's to check with `pnpm bench seal claude-haiku-5-5`.

Workspace requirements (`WORKSPACE.md`): `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` inside `candidate/`. Each exits 0.

## Feature IDs (`tests/feature-matrix.json`)

Phase 3 IDs, mapped to real test files (`src/featureMatrix.test.ts` checks each one):

- `programs.roundtrip`: `src/model/program.test.ts`
- `programs.store-live`: `src/model/program.test.ts`
- `programs.undo-cancel`: `src/model/program.test.ts`
- `programs.navigation`: `src/model/program.test.ts`
- `layers.routing`: `src/model/layers.test.ts`, `src/instrument/stage4.render.test.ts`
- `splits.zones`: `src/audio/zones.test.ts`, `src/instrument/stage4.render.test.ts`, `src/model/layers.test.ts`
- `morph.assignments`: `src/model/morph.test.ts`
- `scenes.switching`: `src/model/layers.test.ts`
- `organ.engine`: `src/audio/organ/organ.render.test.ts`, `src/instrument/stage4.render.test.ts`
- `organ.models-drawbars`: `src/audio/organ/models.test.ts`, `src/audio/organ/organ.render.test.ts`
- `organ.rotary`: `src/audio/organ/organ.render.test.ts`
- `synth.sources`: `src/audio/synth/synth.render.test.ts`
- `synth.filter-envelopes`: `src/audio/synth/synth.render.test.ts`
- `synth.voice-modes`: `src/audio/synth/synth.render.test.ts`
- `synth.arp-gate`: `src/audio/synth/arp.test.ts`, `src/instrument/stage4.render.test.ts`
- `system.integration`: `src/instrument/stage4.render.test.ts`, `src/model/displays.test.ts`
- `hardware.bindings`: `src/model/bindings.test.ts`
- `regression.phase2`: `src/audio/effects/graph.test.ts`, `src/audio/effects/processing.render.test.ts`, `src/audio/instruments.render.test.ts`, `src/instrument/fallback.test.ts`, `src/audio/pedals.render.test.ts`

Phase 1 and 2 IDs stay mapped to their tests, and `regression.phase1` and `regression.phase2` keep the earlier suites green.

## Canonical state schema

One serializable program is `{ name, values, morphs }`:

- `values`: every presentation key that belongs to a program (`src/model/program.ts`, `isProgramKey`). It excludes Master Level, the performance wheel, pitch stick, control pedal, rotary brake, the bank's own selection, and transient controls (Store, Tap, Panic, Live Mode, page, morph buttons).
- `morphs`: per source (`wheel`, `pedal`), the list of `{ key, start, end }`. Keys are presentation keys, so layer-scoped destinations are addressed directly.
- Splits, zone assignments, scenes (`scene.I.*` and `scene.II.*` records), master clock tempo, and transpose are presentation keys, so the same JSON restores them.

The bank holds 32 regular slots (4 pages of 8) and 8 Live slots. Persistence goes through an injected `ProgramStorage`. The browser uses `localStorage` behind a guard, so a blocked or missing store leaves the instrument working in memory.

## Control-binding audit

`src/model/bindings.ts` classifies every control as `bound` or `unsupported`, with the spec clause for each unsupported one. `src/model/bindings.test.ts` checks four things: every control is classified; unsupported entries exist; every bound control changes the instrument state when operated (radio sets are checked through their other member); and Tap and Panic have their own effects. Two controls are unsupported: `program.morph-3` (aftertouch, excluded) and `piano.model` (optional, one model per type).

## Architecture

- **One graph.** The Phase 2 `SignalGraph` now has six chains: piano A and B, the shared organ chain O, and synth SA, SB, SC. Each has the six effect units, its level gate, and To Rotary. All feed one master gain, one limiter, and one destination on one `AudioContext`.
- **Engines.** `src/audio/organ/` (partial tables per model, the voice with vibrato, chorus, percussion, and key click) and `src/audio/synth/` (source recipes, the voice with filter, envelopes, LFO, and vibrato, and the arpeggiator sequencer). Each engine is a voice sink behind the existing `NoteController`. `src/engine/organLayerSink.ts` and `src/engine/synthLayerSink.ts` hold the voice allocation: poly with stealing, mono and legato with priority and glide.
- **Zones.** `src/audio/zones.ts` turns split points and crossfades into a weight per zone. A layer's gain for a note is the sum of the weights in its zone range. Weights are normalized, so a note keeps its level across a crossfade.
- **Hub.** `src/instrument/stage4Instrument.ts` composes the piano (unchanged Phase 2 path), the organ and synth controllers, zone gains, transpose, sustain routing, MIDI, the arpeggiator queue, and Panic. MIDI reaches every engine, and CC11 drives the Control Pedal.
- **State.** `src/model/instrument.ts` is the one reducer over panel values, morphs, and the bank. Panel values are still written only by `presentationReducer` in `hardware.ts`. Morphs are applied to a copy of the state before `deriveAudioSettings`, so the audio reads the morphed value and the panel keeps the player's value.

## Declared gaps

**Audio and engines** (also in `IMPLEMENTATION_DETAILS.json`):

- Organ: B3 Bass is not offered (optional, and the panel has no switch). Pipe 2 reuses the Pipe 1 engine with a brighter slope. Vibrato and chorus on/off is shared by both layers, not per layer. The Vox mix drawbar is an approximation that dulls partials at ratio 4 and up. The swell pedal, rotary stop mode, and preset and drawbar-live modes are excluded.
- Synth: Samples mode, LP M, LP+HP, Sub Osc, Shape, Misc, Wave, FM inharmonic, Sound Init, the pattern editor, zig-zag, accent, pan, and KB Hold are not implemented (optional or excluded). Hard sync is a detuned pair, not a reset. The Sample and Hold LFO is a fixed periodic wave. The LFO's Osc Ctrl destination scales the stack's detune. Vibrato in Wheel mode reads the wheel at note-on.
- Synth envelopes have no sustain knob. A finite decay settles at 0.7 of peak (amplitude) or 0.5 (filter and oscillator). A maximum decay holds at the peak.
- Arpeggiator: gate length is fixed at half a step. Gate mode does not repurpose the range knob. Poly sounds every held note on each step.
- Master clock: Mod 1 syncs for A-Pan and Tremolo only. Delay syncs to beat divisions when the clock sync switch is on, and it has no separate tap control. Tap needs four presses within 2.5 s windows.
- Rotary speed is continuous (Slow at 0, Fast at 1), so it can be morphed. The Slow/Fast switch is the end positions of that control.
- Sustain follows the piano's SUSTPED switch for all engines, with no per-section SUSTPED.

**Programs and surface behaviour:**

- While STORE is armed, the program buttons choose the destination without auditioning it, so the edits being stored are kept. This departs from the manual, which says the destination becomes audible.
- Banks beyond one, Organize, categories, sorting, Solo, Prog View, and single-level undo are not implemented.
- Morph assign: a destination's start value is the value it had when first moved in an assign session, not a hold-and-move gesture on the hardware. The Control Pedal is an on-screen slider, and CC11 drives it.
- Aftertouch is excluded: the A.T. morph source is decorative and listed as unsupported.
- The piano model dial stays decorative, since each type has one model (optional in `piano.json`, listed as unsupported).

**Visual (declared deviation, see `evidence/stage3-visual-audit.md`):**

- At 1440x900 the deck is about 225 px tall (54% of a 3.1:1 instrument). The new layer, envelope, voice, split, clock, and morph controls need more height and width than that, so the sections are dense and several legends still collide: the Piano layer row over its heading, the Synth oscillator heading under its knobs, and the Program row. What was done: short legends for dense controls (`src/model/legends.ts`), row weights, per-section zoom, a grid for split points and the clock, hidden redundant layer titles, smaller layer faders. The controls all render and sit in rows (`src/model/hardware.test.ts`).
- The fix that closes this gate is a decision for the operator: a taller deck or a larger desktop viewport, a smaller legend size, or changing the spec's density. I did not take any of these on my own.
- Narrow (390x844): the instrument is a fixed-width object and is clipped horizontally, which the Phase 2 narrow capture shows too. This is inherited, not a Phase 3 change. `evidence/stage3-narrow.png` records it.

## Order of work (as built)

1. Plan, then the surface model (`hardware.ts`) with scoped sound and effect values.
2. Program state: canonical snapshot, bank, Store, Store As, Live, dirty, factory programs, storage.
3. Splits, zones, scenes, morphs, clock, transpose, Panic.
4. Organ engine, then synth engine, each through the hub and the Phase 2 graph.
5. Render tests for each engine, integration and cleanup tests, the binding audit, the feature matrix, browser pass, and the visual capture.
