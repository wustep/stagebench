# Phase 3 implementation plan

Assigned specs (filenames only, as provided in this workspace):

- `specs/nord-stage-4.visual.json`
- `specs/nord-stage-4.piano.json`
- `specs/nord-stage-4.effects.json`
- `specs/nord-stage-4.programs.json`
- `specs/nord-stage-4.organ.json`
- `specs/nord-stage-4.synth.json`

Assigned variant: Stage 4 73 (`specs/nord-stage-4.variants.json`).

## Hard gates (Phase 3)

Copied from `specs/benchmark-phases.json`:

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

Inherited Phase 1–2 gates remain green.

## Canonical state schema

A **program patch** serializes every supported sounding parameter except Master Level:

- Section on/off; per-layer enable/focus/level/octave/SUSTPED/PSTICK/KB zone
- Piano type and performance controls (inherited)
- Organ model, drawbars, percussion, key click, vibrato/chorus, rotary routing
- Synth oscillator/filter/envelopes/LFO/voice/arp for layers A/B/C
- Effect unit settings, targeting, group/global, To Rotary
- Splits (three points, 11 positions, Off/±6/±12), Layer Scenes I/II, morph assignments
- Master Clock BPM + keyboard sync, Transpose ±6

Session-only (not stored in a program): Master Level, pitch stick, mod wheel, control pedal, store/name/list UI, morph latch, dirty/undo buffers.

Storage: 32 program slots (4 pages × 8) plus 8 Live slots. Live auto-writes the sounding patch. Dirty `E` compares the sounding patch to the last loaded slot; changing program without Store discards edits. Optional single-level undo keeps that discarded patch.

## Graph (one AudioContext)

```
Organ A+B voices ──► organ mix ──► shared organ FX chain ──► (ORGAN→Rotary?) ─┐
Piano A voices  ──► bus A ──► Mod1→Mod2→Delay→Amp/EQ→Comp→Reverb ─► (To Rotary?)┤
Piano B voices  ──► bus B ──► …                                                ├─► master → limiter → dest
Synth A/B/C     ──► per-layer FX chains ─► (To Rotary?)                        ┘
```

No second `AudioContext`. Organ layers share one effect chain. Synth layers have independent chains.

## Control-binding audit plan

1. Inventory every `CONTROLS` id.
2. Bind each non-excluded id to canonical state and, where sonically meaningful, the graph.
3. List spec-excluded ids as unsupported in the UI notes and `stage3-visual-audit.md` (they still move/press).
   Excluded on this panel: `program-morph-at` (aftertouch morph), `organ-preset-1` / `organ-preset-2` (preset/Drawbar Live library).
4. Prove bindings with Phase 3 tests (round-trip, splits/scenes/morphs, organ models, synth sources/filters/envelopes/LFO/voice/arp, one-context, Panic, cleanup).

## Order of work

1. Canonical program schema, Store/Store As/Live, dirty lifecycle.
2. Splits, zones, crossfades, scenes, morphs, clock, transpose, Panic.
3. Organ engine into the inherited buses, then Synth engine.
4. Full binding audit, regression, rendered-audio tests, provenance.
