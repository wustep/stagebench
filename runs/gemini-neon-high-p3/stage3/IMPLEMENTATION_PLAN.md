# Nord Stage 4 73 — Phase 3 Implementation Plan

## Scope & Reference Authority

This plan covers **Phase 3 (Complete Stage 4 system)** for the assigned hardware variant **Nord Stage 4 73** (`stage-4-73`, 73-key hammer-action keybed E1–E7, 43 white / 30 black keys, aspect ratio 3.0951), extending the sealed Phase 2 artifact without regressing its visual surface, control inventory, keybed geometry, piano library, layer effects, or multi-input behavior.

Assigned specs:
- `inputs/specs/nord-stage-4.visual.json` (`nord-stage-4.visual.json`)
- `inputs/specs/nord-stage-4.piano.json` (`nord-stage-4.piano.json`)
- `inputs/specs/nord-stage-4.effects.json` (`nord-stage-4.effects.json`)
- `inputs/specs/nord-stage-4.programs.json` (`nord-stage-4.programs.json`)
- `inputs/specs/nord-stage-4.organ.json` (`nord-stage-4.organ.json`)
- `inputs/specs/nord-stage-4.synth.json` (`nord-stage-4.synth.json`)
- Variant geometry: `inputs/specs/nord-stage-4.variants.json` (`nord-stage-4.variants.json`)
- Product photo authority: `inputs/reference/nord-stage-4-73.jpg`

## Phase 3 hard gates

- [ ] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [ ] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [ ] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [ ] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [ ] All inherited visual, piano, effects, and input behavior remains regression-free.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, `nord-stage-4.synth.json`

## Canonical Serializable Program State Schema

Every saved program (`ProgramPatch`, stored across 32 Program slots `1.1–4.8` and 8 auto-storing Live slots `L:1–L:8`, persisted via an injectable `StorageAdapter`) serializes all supported sound, routing, split, scene, morph, clock, and transpose state while explicitly **excluding `Master Level`** (`nord-stage-4.programs.json`):

```ts
interface ProgramPatch {
  version: 3
  organ: OrganSectionState       // sectionOn, focusedLayer (A|B), sustped, pstick, layers A & B (enabled, level, octave, zone, model, 9 drawbars, V/C type & on, B3 percussion, keyClick)
  piano: PianoSectionState       // sectionOn, focusedLayer (A|B), sustped, pstick, layers A & B (enabled, level, octave, zone, type, modelIndex, timbre, kbTouch, dynComp, unison, softRelease, stringRes)
  synth: SynthSectionState       // sectionOn, focusedLayer (A|B|C), sustped, pstick, layers A/B/C (enabled, level, octave, zone, mode, oscCategory, oscWaveform, oscCtrl, pitchCoarse/Fine, oscEnv, filter, filterEnv, ampEnv, lfo, voice, vibrato, arp)
  effects: EffectsSectionState   // allOn, focusedChain (pianoA|pianoB|organ|synthA|synthB|synthC), pianoGroupMode, synthGroupMode, chains[6], global (Delay/Comp/Reverb), rotary (organRouted, speed, stopMode, drive, driveOn)
  split: SplitState              // enabled, points { low, mid, high } each with active, note (11 documented positions C2..C7), crossfade (0 | 6 | 12)
  scenes: LayerScenesState       // activeScene ('I'|'II'), sceneI & sceneII layer enable snapshots (shared sound params, enable state only)
  morphs: MorphState             // wheel[] and controlPedal[] assignments ({ target, start, end } supporting positive & inverted sweeps)
  masterClock: MasterClockState  // bpm (30..300), kbSync (boolean)
  transpose: TransposeState      // enabled, semitones (-6..6)
}
```

Runtime-only (non-saved) state in `StageInstrumentState`:
- `masterLevel` (0–100, excluded from program save/load)
- `pitchStick` (-100..100), `modWheel` (0..100), `controlPedal` (0..100, driven by on-screen Control Pedal and MIDI CC11)
- `programBank`: 32 stored `ProgramSlot` entries (12 factory programs + initialized slots up to 32), 8 `LiveSlot` entries, active mode (`program` | `live`), active slot index, truthful `dirty` flag (deep comparison vs stored slot; always clean in Live Mode because edits auto-store), single-level `undoSnapshot`, and modal edit state (`idle` | `store-confirm` | `store-as-name` | `list-view` | `split-edit` | `clock-edit` | `transpose-edit` | `morph-assign`).
- `synthOledView`: `'wave' | 'osc-pitch' | 'osc-env' | 'filter' | 'filter-env' | 'amp-env' | 'arp' | 'voice-vib'`

## Single-AudioContext Signal Graph

```text
One AudioContext (ctx)
│
├── Organ Layer A (B3 / B3 Bass / Vox / Farf / Pipe 1 / Pipe 2) ──► [Layer A Level] ─┐
├── Organ Layer B (independent model/drawbars/V-C/zone/octave)  ──► [Layer B Level] ─┼─► [Shared Organ FX Chain] ──► Direct OR Shared Rotary
│
├── Piano Layer A (Recorded Grand/Upright/Rhodes/Wurli + Clav/Digital/Misc) ─────────► [Piano A FX Chain] ───────► Direct OR Shared Rotary
├── Piano Layer B (or Piano Group Chain when Piano Group Mode active) ───────────────► [Piano B FX Chain] ───────► Direct OR Shared Rotary
│
├── Synth Layer A (Pure/Sync/Multi/Super/FM-H + Filter + 3 Envs + LFO + Arp/Gate) ──► [Synth A FX Chain] ───────► Direct OR Shared Rotary
├── Synth Layer B (or Synth Group Chain when Synth Group Mode active) ───────────────► [Synth B FX Chain] ───────► Direct OR Shared Rotary
├── Synth Layer C ───────────────────────────────────────────────────────────────────► [Synth C FX Chain] ───────► Direct OR Shared Rotary
│
│   Shared Rotary Speaker (Horn + Bass rotor, Drive, Stop, morphable Slow/Fast acceleration)
│       └──► [Master Bus Sum]
│
│   All Direct Layer Outputs ──► [Master Bus Sum] ──► [Master Level Gain] ──► [Soft-Knee Limiter] ──► [Safety Brickwall] ──► [ctx.destination]
```

Every layer chain enforces exact order: `Layer source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ or Filter → Compressor → Reverb → [Rotary when routed] → Layer level → Master gain/limiter → Destination`. Global Delay/Compressor/Reverb apply uniformly across Organ, Piano, and Synth layers while preserving Reverb-before-Rotary order.

## Audio Source Provenance

- **Recorded pack samples (`origin: "pack"`, 170 OGG files preserved unchanged from Phase 2)**:
  - Grand: `salamander-grand-v3` (78 stereo OGG, CC-BY-3.0)
  - Upright: `upright-piano-kw` (52 stereo OGG, CC0-1.0)
  - Electric Rhodes: `learman-rhodes-gm` (15 mono OGG, CC0-1.0)
  - Electric Wurlitzer: `greg-sullivan-e-pianos` (25 mono OGG, CC-BY-3.0)
- **Live Web Audio synthesis (`generatedSources`)**:
  - Piano Clav, Digital, Misc, Sympathetic String Resonance, Fallback Piano, Procedural Reverb IRs (from Phase 2)
  - Organ engines: B3 & B3 Bass (9-partial tonewheel synthesis with foldback, single-triggered percussion, key click, V1–V3/C1–C3), Vox Continental (7 transistor partials + flute/reed mix drawbar + vibrato), Farfisa Compact (9 on/off register switches ≥5/8 with nasal formant synthesis + vibrato), Pipe 1 & Pipe 2 (9 distinct pipe ranks 16'–1' with chiff breath onset and rank detuning)
  - Synth engine: Analog mode (`Pure`, `Sync`, `Multi`, `Super`) and `FM-H` (`FM 2-op`) with category-correct `Osc Ctrl`, resonant filters + drive + tracking, 3 envelopes, 5-waveform LFO, voice modes/glide/unison/vibrato, and deterministic Arpeggiator/Gate.

## Control-Binding Audit Plan

Every control in `PANEL_CONTROLS` is audited into either **Canonically Bound** or **Spec-Excluded (Unsupported)** (visibly rendered, movable/pressable, and explicitly listed in `StatusFooter` Credits & Scope and `evidence/stage3-visual-audit.md`):

- **Canonically Bound**:
  - **Performance**: `perf-pitch-stick`, `perf-mod-wheel`, `perf-master-level`, `perf-rotary-drive`, `perf-rotary-drive-on` (Organ Rotary routing + drive), `perf-rotary-stop`, `perf-rotary-speed` (morphable).
  - **Organ**: `organ-section-on`, `organ-layer-a/b-fader`, `organ-layer-a/b-on` (`Shift`: SUSTPED/PSTICK), `organ-octave-down/up` (`Shift`: KB Zone), `organ-model-select`, `organ-vib-type`, `organ-vib-on`, `organ-perc-soft/fast/third/on`, `organ-drawbar-1..9`.
  - **Piano**: All 16 controls (`Shift + octave` assigns KB Zone).
  - **Program & Morph**: `program-morph-wheel`, `program-morph-ctrlped` (click/hold assign, `Shift`: clear), `program-split` (on/off, `Shift`: edit points/crossfade), `program-mst-clk` (tap 4+, `Shift`: dial BPM & KB sync), `program-transpose` (on/off ±6 st, `Shift`: **Panic**), `program-store` (Store confirm, `Shift`: Store As with naming), `program-prog-view` (Numeric List View), `program-dial` (browse / edit active parameter, `Shift`: list view), `program-page-prev/next`, `program-solo` (Solo / `Shift`: Undo), `program-live-mode`, `program-layer-scene` (Scene I/II), `program-btn-1..8`, `program-shift`.
  - **Synth**: `synth-section-on`, `synth-layer-a/b/c-fader`, `synth-layer-a/b/c-on` (`Shift`: SUSTPED/PSTICK), `synth-kb-hold`, `synth-arp-run`, `synth-octave-down/up` (`Shift`: KB Zone), `synth-enc-type/cat/wave`, `synth-mode` (Analog active; Samples/Extern noted unsupported), `synth-waveform-btn` (Wave view / `Shift`: Sound Init), `synth-arp-rate/mode/range/menu`, `synth-voice-mode/glide`, `synth-vibrato-mode/menu`, `synth-lfo-wave/amt/rate/dest`, `synth-osc-pitch/env/ctrl/env-amt`, `synth-filter-type/env/env-amt/freq/res/on`, `synth-amp-env`, `synth-unison`.
  - **Effects**: All 34 controls across Piano A/B, Organ shared chain, Synth A/B/C, Group modes (Piano & Synth), Global Delay/Comp/Reverb, Master Clock sync on Mod 1 & Delay, and morphable FX targets.
- **Spec-Excluded (Explicitly Listed as Unsupported)**:
  - `program-morph-at` (Aftertouch morph — browser keyboards have no aftertouch)
  - `program-preset-organ`, `program-preset-piano`, `program-preset-synth` (Per-section preset library)
  - `program-section-edit`, `program-mon-copy` (Section Edit/Layer Init, Monitor/Copy/Paste/Swap)
  - Shift-menus on `program-btn-1..8` (System/Sound/Organize/Aux KB/Output/Pedal/MIDI/Extern)
  - `organ-preset` (Preset/Drawbar Live sync — virtual drawbars always show live values)
  - Synth `Samples` & `Extern` modes, Arp pattern editor/zig-zag/accent/pan, Filter/LFO/Arp Group modes
  - Effects per-type Variations, Reverb Chorale, Delay feedback-loop FX/Analog mode, Mod 1 pedal modes, Rotary close mic/stop angle
  - Piano pedal noise, half-pedaling, Triple Pedal, size classes, INFO view
  - Organ Swell pedal, tonewheel wear modes, trigger point
  - Banks beyond 1 (32 slots instead of 512), external MIDI clock sync, pedal tap

## Execution Order

1. Canonical serializable state (`src/model/splits.ts`, `src/model/morphs.ts`, `src/model/programBank.ts`, `src/model/instrumentState.ts`) with 32 program slots, 12 factory programs, 8 auto-storing Live slots, dirty tracking, Store/Store As, List View, Undo, Splits/Zones/Crossfades, Scenes I/II, Morphs, Master Clock, Transpose, and Panic.
2. Organ engine (`src/audio/organVoice.ts`) + Synth engine (`src/audio/synthVoice.ts`, `src/audio/arpeggiator.ts`) integrated into `StageAudioEngine` on the single `AudioContext` with shared Organ FX chain, Synth A/B/C FX chains, Master Clock sync, morph resolution, zone crossfade gains, and complete node/timer cleanup.
3. UI bindings across `OrganSection`, `SynthSection`, `ProgramSection`, `PerformanceSection`, `EffectsSection`, `PianoSection`, `App.tsx` (split LEDs, MIDI CC11/CC1/PitchBend), and `StatusFooter` (Control Pedal + Credits & Unsupported Controls list).
4. Comprehensive unit, rendered `OfflineAudioContext`, and React integration tests covering every Phase 1, 2, and 3 `tests/feature-matrix.json` ID; update `IMPLEMENTATION_DETAILS.json`; run canonical Playwright capture (`--phase 3`), live browser interaction pass, `evidence/stage3-visual-audit.md`, and all four pnpm gates.
