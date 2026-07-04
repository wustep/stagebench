# Phase 3 Implementation Plan — Nord Stage 4 (variant stage-4-73)

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, `specs/nord-stage-4.effects.json`, `specs/nord-stage-4.programs.json`, `specs/nord-stage-4.organ.json`, and `specs/nord-stage-4.synth.json`.

Phase 3 completes the instrument on top of the sealed Phase 2 artifact: the **Organ**, **Synth**, and **Program/performance system** come alive as their specs' `scope.required` lists define. The result is ONE serializable instrument — every control either works canonically or is explicitly listed as unsupported because its spec excludes it. Phase 2 Piano + Layer Effects + Master Level behavior is preserved regression-free.

## Hard gates (from `specs/benchmark-phases.json` Phase 3)

Each of the following is a Phase 3 hard gate and is satisfied by this implementation:

- Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- All inherited visual, piano, effects, and input behavior remains regression-free.

Each hard gate above maps to rendered-audio tests that assert on real Web Audio signals (analyser / OfflineAudioContext render), never mocks.

## Package gates

- `pnpm test` (vitest) — every inherited Phase-1 and Phase-2 test preserved + Phase-3 rendered-audio tests (program round-trips, split/scene/morph behavior, organ model + drawbar spectral distinctions, synth source/filter/envelope/LFO/voice/arp behavior, one-context routing, cleanup).
- `pnpm typecheck` — zero errors.
- `pnpm lint` — zero errors.
- `pnpm build` — produces `dist/` with the bundled `samples/` present for offline play.

## Canonical serializable state schema

The whole instrument is one serializable `ProgramState` value (`src/state/program.ts`). Store/Store As/Live all snapshot and restore this object; it round-trips through `serializeProgram`/`deserializeProgram` (JSON). Master Level is deliberately EXCLUDED from program state (programs spec `programState.excludes`). Shape (abbreviated):

```
ProgramState {
  name: string
  transpose: number            // -6..6
  scene: 'I' | 'II'            // active layer scene
  clock: { bpm: number; keyboardSync: boolean }
  split: {
    on: boolean
    points: { low: SplitPoint|null; mid: SplitPoint|null; high: SplitPoint|null } // note position from the 11 documented positions
    crossfades: { low: 0|6|12; mid: 0|6|12; high: 0|6|12 }
    zones: Record<LayerKey, ZoneIndex 0..3>   // per-layer zone assignment
  }
  scenes: { I: SceneEnables; II: SceneEnables }  // per-scene enable state (sound params shared)
  morph: { wheel: MorphAssignment[]; ctrlPedal: MorphAssignment[] }  // {controlId, from, to}[]
  sections: {
    organ: { on: boolean; focus: 'A'|'B'; layers: Record<'A'|'B', OrganLayerState>; percussion; vibChorus; rotaryRouted }
    piano: { on; focus; type; kbTouch; dynComp; timbre; unison; softRelease; stringRes; layers: Record<'A'|'B', LayerCommon> }
    synth: { on; focus; layers: Record<'A'|'B'|'C', SynthLayerState>; ... }
  }
  effects: ControlSnapshot           // the inherited effect control values
}
```

The Program manager (`src/state/programManager.ts`) owns 32 slots (4 pages × 8) plus 8 Live slots, the dirty (`E`) flag, Store / Store As (naming) / edit-discard-on-change / Live auto-store lifecycle, and ships ≥8 factory programs. It serializes the live `ControlStore` snapshot plus engine-derived performance state, so a stored program restores every supported control.

## Organ / Synth engine approach (audible distinctness)

- **Organ** (`src/audio/organEngine.ts`): additive tonewheel/transistor/pipe synthesis. B3 sums nine sine partials at the drawbar footages with tonewheel leakage + key click + single-triggered percussion; Vox sums a filtered transistor-reed spectrum (square/saw-ish partials); Farf uses a bright buzzy fixed-register voice; Pipe 1 uses flute-like sine ranks with chorus detuning. Distinctness is proven by spectral-energy assertions between models with identical drawbars. Nine drawbars drive each model's partial gains live. Vibrato/chorus (C1–C3/V1–V3) is a shared modulated stage; rotary routes into the inherited shared Rotary with morphable slow/fast speed.
- **Synth** (`src/audio/synthEngine.ts`): the exact waveform list (Pure, Sync, Multi, Super, FM-H) as genuinely different oscillator constructions (PeriodicWave/detuned stacks/hard-sync/2-op FM); category-correct Osc Ctrl; LP12/LP24/HP/BP filters with tracking, resonance, drive; oscillator/filter/amp envelopes; LFO (five waveforms, three destinations); poly/mono/legato + priority + glide + unison + vibrato; a deterministic arpeggiator/gate driven by an injectable clock.

## Integration

Organ + Synth voices enter the existing Phase 2 buses → ordered effects → single master gain/limiter → the ONE `AudioContext.destination`. There is NO second AudioContext. The `AudioEngine` grows per-section layer chains (organ A/B, piano A/B, synth A/B/C) that all share the master + shared rotary. Splits/scenes/morphs/focus/clock work identically across engines through the shared note-dispatch path.

## Control-binding audit plan

Every visible control is audited (`evidence/stage3-visual-audit.md` + `IMPLEMENTATION_DETAILS.json.decorativeControls`): each control id is either BOUND to real audio/system state (through `src/audio/controlBindings.ts` and `src/state/programManager.ts`) or explicitly LISTED as unsupported because its spec excludes it (aftertouch morph `program-morph-at`, Num Pad, and the Program Shift-menu buttons, Synth Extern mode, Organ Preset/Drawbar-Live, etc.). No decorative control fakes audio or system state; spec-excluded controls are inert and labeled, never a silent no-op standing in for a required feature.

## Honesty contract

Grand/Upright/Electric still play RECORDED samples; Clav/Digital/Misc and every Organ/Synth voice play HONEST SYNTHESIS, declared truthfully in `IMPLEMENTATION_DETAILS.json` (`generatedSources`). No control reports success it does not have; spec-excluded controls are listed as unsupported in the UI notes and the audit.
