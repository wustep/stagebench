# Phase 3 implementation plan — Nord Stage 4 73

Phase 3 is the final phase. It turns the **Organ** section, the **Synth** section and the
**Program / performance system** into working state and working audio, on top of the sealed
Phase 2 artifact (complete surface, recorded-sample piano, six-unit layer effect chains, shared
rotary). Nothing inherited is rewritten: the Phase 1 surface, the Phase 2 piano and effects, and
the inherited tests are carried forward, and the new sections join the *same* AudioContext, the
same layer-chain class, the same buses and the same single destination.

Assigned specs (all six read in full before writing code):

- `specs/nord-stage-4.visual.json` — deck/keybed split, six section fractions, section landmarks,
  control inventory, forbidden hardware, presentation constraints. Unchanged since Phase 1; this
  phase must not move a pixel of it.
- `specs/nord-stage-4.piano.json` — carried forward unchanged; the piano engine, its recorded
  sample sets and its detail controls must stay regression-free while the program system starts
  storing and restoring them.
- `specs/nord-stage-4.effects.json` — carried forward; Organ and Synth layers now instantiate the
  same `LayerChain` (Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Comp → Reverb) and the same shared
  Rotary, with FX Focus extended to the Organ and Synth stacks.
- `specs/nord-stage-4.programs.json` — 32 program slots in 4 pages of 8, program dial browsing and
  a numeric list view, Store / Store As with naming, a truthful dirty indicator, edit-discard on
  program change, 8 auto-storing Live slots, splits with up to 4 zones / 3 split points /
  Off·±6·±12 crossfades, Layer Scenes I and II, Wheel and Control-Pedal morphs, Master Clock,
  Transpose and Panic.
- `specs/nord-stage-4.organ.json` — two layers on one shared effect chain, four audibly distinct
  engines (B3, Vox, Farf, Pipe 1) plus the two documented reuse models (B3 Bass, Pipe 2), nine
  drawbars with LED graphs, B3 percussion and key click, vibrato/chorus C1–C3 / V1–V3, rotary
  routing with morphable speed.
- `specs/nord-stage-4.synth.json` — three independent layers with their own chains, the exact
  required waveform list with category-correct Osc Ctrl, LP12/LP24/HP/BP filters with tracking,
  resonance and drive, oscillator/filter/amplifier envelopes, an LFO with five waveforms and three
  destinations, poly/mono/legato with priority, glide, unison and vibrato, and a deterministic
  arpeggiator/gate.

Variant: `stage-4-73` from `specs/nord-stage-4.variants.json` — 73 keys, E1–E7, 43 white / 30
black. Reference: `reference/nord-stage-4-73.jpg` (authoritative for layout) and
`reference/manual.pdf` — pages 17–22 (organ), 27–36 (synth), 13 and 38–45 (programs, split, morph,
scenes, clock).

## Phase 3 hard gates (checklist, copied verbatim from `specs/benchmark-phases.json`)

Each line below is a hard gate for this phase. The wording is copied exactly, not paraphrased.

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

## Shared completion gates

- [x] All benchmark-owned and candidate-authored tests pass.
- [x] The browser console contains no errors during the required interaction pass.
- [x] Every claimed audio feature is connected to the audible signal graph.
- [x] The latest phase preserves all inherited tests, visual evidence, and behavior.
- [x] IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
- [x] The evaluated source, build, and evidence match the sealed verification digest.

## Signal graph (one context, one destination)

Phase 3 adds two more stacks of layers to the Phase 2 graph. Nothing else about it changes: the
same `LayerChain` class, the same shared `RotaryUnit`, the same master gain and wave-shaper
limiter, the same single `destination` connection. There is exactly one `AudioContext`, created
once in `useInstrument`, and a test asserts that the whole instrument builds on the context it is
handed and connects to `context.destination` exactly once.

```
                    ┌ organ A, organ B ─────┐   (nine drawbars → additive partials
 keybed / MIDI / UI ┤ piano A, piano B      ├─   + key click + percussion + vib/chorus)
   → zone router    └ synth A, synth B, C ──┘   (per-voice osc stack → filter → amp env)
        │
        └ per layer: voices → layer voice bus → (organ: vib/chorus stage · piano: timbre stage)
                     → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Comp → Reverb → layer level
                     ├── (normal)    → section bus (organ / piano / synth) ─┐
                     └── (To Rotary, or organ routed to rotary) → shared Rotary ─┤
                                                                                 ▼
                                                     master gain → limiter → destination
```

- The zone router sits in front of voice construction: each of the seven layers has a keyboard
  zone, and a note only builds a voice for a layer whose zone contains it. Crossfades of ±6 or
  ±12 semitones apply a per-note gain instead of a hard edge.
- Organ layers A and B share **one** effect chain and one output path, as the organ spec requires
  (`layersShareOneEffectChain: true`); synth layers A, B and C each own an independent chain.
- Master Clock is one deterministic tempo value that drives the arpeggiator/gate, the synth LFO,
  the Delay time and the Mod 1 rate whenever their sync flags are set.

## Canonical state schema

One serializable object is the whole instrument. `ProgramSnapshot` in `src/state/program.ts`:

```ts
interface ProgramSnapshot {
  name: string                                    // edited by STORE AS
  values: Record<string, number>                  // every control except perf.master-level
  banks: Record<LayerKey, Record<string, number>> // per-layer focus-scoped values (7 layers)
  octaves: Record<LayerKey, number>               // ±12 semitones per layer
  focus: { organ, piano, synth }; fxSection       // which layer each section's knobs edit
  group: boolean; globals: Record<GlobalUnitId, boolean>
  split: { on, points: [{ note, crossfade }] × 3 }
  zones: Record<LayerKey, { from: number; to: number }>    // zone index range, 0–3
  scene: 'I' | 'II'; scenes: Record<'I'|'II', Record<LayerKey, boolean>>
  morphs: Record<'wheel'|'pedal', Record<string, { from: number; to: number }>>
  clock: { bpm: number; keyboardSync: boolean }
  transpose: number                               // −6 … +6
}
```

- `perf.master-level` is deliberately excluded (`programState.excludes` in the programs spec).
- 32 program slots (4 pages × 8) plus 8 Live slots hold `ProgramSnapshot | null`. Live slots
  auto-store on every edit and are persisted through an injectable `Storage` boundary so a test
  can prove the round trip without touching a real browser.
- Dirty state is `!snapshotsEqual(current, stored)` — computed, never asserted, so the `E`
  indicator cannot lie in either direction.
- At least eight factory programs ship (`FACTORY_PROGRAMS`), demonstrating piano, organ, synth,
  split and layered setups.

## Control-binding audit plan

Every one of the inventory entries is classified into exactly one of three buckets, and both
directions are asserted mechanically (`controls.test.ts`, `interaction.test.tsx`):

1. **Bound** — moving it changes engine state or rendered audio. `functional: true`, rendered as
   `data-functional="true"`.
2. **Spec-excluded** — the control exists on the hardware but its behaviour is listed under
   `scope.excluded` in an assigned spec (Preset Library, Aux KB / Extern / MIDI, Num Pad,
   Mon/Copy/Paste, Section Edit / Layer Init, the A.T. morph source, Samples and Extern synth
   modes, pedal tap, delay feedback-loop effects, organ Preset/Drawbar-Live modes). `functional:
   false`, listed as unsupported in the UI notes and in `evidence/stage3-visual-audit.md`.
3. **Indicator only** — an LED or legend with no control id at all.

No fourth bucket exists: there are no silent no-op bindings. If a control is not in bucket 1, the
audit says why, quoting the spec clause that excludes it.

## Order of work

1. This plan.
2. Canonical serializable program state, Store / Store As / Live slots, dirty lifecycle
   (`src/state/program.ts`, extended `src/state/hardware.ts`).
3. Splits and zones with crossfades, Layer Scenes, Wheel and Control-Pedal morphs, Master Clock,
   Transpose, Panic.
4. Organ engine (`src/audio/organVoice.ts`, `src/audio/organLayer.ts`), integrated as it lands;
   then Synth engine (`src/audio/synthVoice.ts`, `src/audio/synthLayer.ts`, `src/audio/arp.ts`).
5. Full control-binding audit, inherited regression pass, rendered-audio tests for every claim,
   browser sweep, captures and provenance.

## Honesty contract commitments

- `data-functional` keeps reporting the truth per control from one declared list
  (`FUNCTIONAL_CONTROL_IDS` in `src/model/controls.ts`), and a test asserts both directions: every
  id in the list is functional, and every control outside it is not.
- Controls that stay decorative stay decorative *because a spec excludes them*, and each is named
  with its reason in `evidence/stage3-visual-audit.md`.
- Reduced-but-real implementations are declared as reductions, never as the full hardware
  behaviour: the vibrato menu offers documented rate/amount presets rather than two free
  continuous parameters, and the split editor uses a SHIFT + SPLIT press rather than the
  hardware's press-and-hold timing.
- `IMPLEMENTATION_DETAILS.json` keeps the full recorded-sample provenance and licences and adds
  the Phase 3 sources, all of which are live synthesis or generated buffers — no new recordings
  are introduced in this phase.
