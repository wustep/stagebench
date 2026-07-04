# Phase 2 Implementation Plan

## Assigned Specs
- `specs/nord-stage-4.piano.json` — six piano types, two layers, performance controls
- `specs/nord-stage-4.effects.json` — six effect units per layer + shared rotary, routing, focus, global modes

## Phase 2 Hard Gates (Checklist)

### Piano Section
- [ ] Six selectable piano types (Grand, Upright, Electric as bundled recorded samples; Clav, Digital, Misc as synthesis fallbacks)
- [ ] Two independent layers (A, B) with enable, focus, level fader, octave shift, voice ownership
- [ ] Performance controls all measurably change audio: KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, Master Level
- [ ] Layer level faders affect output volume; octave shift ±12 semitones per layer
- [ ] Sustain pedal (UI, keyboard, MIDI CC64) affects enabled layers with SUSTPED on

### Effects Chain
- [ ] Six units per layer chain: Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb
- [ ] Shared Rotary speaker (one per program)
- [ ] Signal order: Layer source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb → [Rotary if routed] → Layer level → Master gain/limiter → Destination
- [ ] Every unit type processes real audio and is audibly distinct
- [ ] Per-unit on/bypass, all-effects bypass (Layer Effects ON button)
- [ ] Dry/wet mixing per unit
- [ ] FX focus follows layer focus; manual focus buttons override
- [ ] Group mode: Piano layers share effect settings
- [ ] Global mode: Shift+On on Delay/Compressor/Reverb applies to all layers

### Sample Provenance (Bundled, Offline, Redistributable)
- [ ] Grand: Salamander Grand (CC BY 3.0, Alexander Holm)
- [ ] Upright: MIDI-JS Honky-tonk (MIT license)
- [ ] Electric: MIDI-JS EP1 (MIT license)
- [ ] All samples have complete license, source, and usage metadata in IMPLEMENTATION_DETAILS.json

### Audio Architecture
- [ ] One AudioContext (inherited from Phase 1)
- [ ] Per-layer buses with ordered effects processing
- [ ] Master path with gain and limiter
- [ ] Click-free parameter ramps
- [ ] Complete node cleanup on layer disable/note end/unmount
- [ ] Voice/node/timer counts return to baseline after cleanup

### Regression (Phase 1)
- [ ] All Phase 1 tests remain passing (45+ tests minimum)
- [ ] Keybed behavior, input handling, decorative controls unchanged
- [ ] Phase 1 visual surface preserved

## Implementation Architecture

### Audio Module Organization
```
src/audio/
  ├── piano/
  │   ├── sample-library.ts        # Grand, Upright, Electric sample loading with fallbacks
  │   ├── synth-fallbacks.ts       # Clav, Digital, Misc synthesis
  │   ├── layer-engine.ts          # Per-layer voice management with effects bus
  │   └── performance-controls.ts  # KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res
  ├── effects/
  │   ├── graph.ts                 # Effect signal chain, routing, focus, global modes
  │   ├── mod1.ts                  # A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump
  │   ├── mod2.ts                  # Chorus, Flanger, Phaser, Vibe, Ensemble, Spin
  │   ├── delay.ts                 # Tempo, feedback filter, tap tempo, sync
  │   ├── amp-eq.ts                # EQ, Twin, JC, Small, LP24, HP24, To Rotary
  │   ├── compressor.ts            # Soft-knee dynamics with fast mode
  │   ├── reverb.ts                # Room, Booth, Spring, Stage, Hall, Cathedral
  │   └── rotary.ts                # Shared speaker, slow/fast, drive
  ├── master.ts                    # Master gain/limiter path
  └── node-cleanup.ts              # Registry and cleanup utilities
```

### Component Updates
```
src/components/
  ├── piano-section.tsx            # Piano type selector, layer controls
  ├── layer-controls.tsx           # Per-layer enable/focus/level/octave
  ├── performance-controls.tsx     # KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res
  ├── effects-panel.tsx            # Six units + rotary with routing/focus
  ├── effect-unit.tsx              # Generic unit with type selector, parameters, on/bypass
  └── master-controls.tsx          # Master level (extend from Phase 1)
```

### State Management
- Extend hardware model to include:
  - Piano layer enable/focus/level/octave per layer
  - Piano type and model selector
  - Performance control values (KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res)
  - Effects chain state (type, parameters, on/bypass, focus, group, global per unit)
  - Master level
- Keep immutable pattern from Phase 1
- All state changes trigger corresponding audio graph updates

## Implementation Sequence

### Phase 2A: Piano Layers & Performance Controls (Days 1-2)
1. Extend hardware model to include layer enable/focus/level/octave
2. Build sample library loading system with fallback synthesis
3. Implement layer engine with per-layer voice management and effects bus
4. Implement performance controls (KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res)
5. Update note lifecycle to respect layer focus and octave shift
6. Build piano selection UI (type button, model dial)
7. Build layer control UI (enable, focus, level, octave)
8. Build performance control UI
9. Test piano layer switching, voice ownership, control audio changes
10. Verify Phase 1 regression

### Phase 2B: Effects Chain & Routing (Days 2-3)
1. Build effect graph factory with signal order enforcement
2. Implement Mod 1 effects (A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump)
3. Implement Mod 2 effects (Chorus, Flanger, Phaser, Vibe, Ensemble, Spin)
4. Implement Delay with feedback filter, tap tempo, sync
5. Implement Amp Sim/EQ with all amp models and filters
6. Implement Compressor with fast mode
7. Implement Reverb with all types
8. Implement shared Rotary with To Rotary routing
9. Build effects UI for each unit
10. Implement focus routing (auto-follow + manual buttons)
11. Implement group and global modes
12. Test effect audio measurability, dry/wet, on/bypass
13. Test focus routing, group/global modes
14. Test cleanup (node counts return to baseline)

### Phase 2C: Integration, Testing, Evidence (Days 3-4)
1. Verify master level control
2. Run full test suite (Phase 1 + Phase 2)
3. Run typecheck, lint, build
4. Create visual audit evidence (screenshots, state transitions)
5. Create audio test evidence (rendered waveforms proving parameter changes)
6. Write IMPLEMENTATION_DETAILS.json with sample provenance
7. Seal stage2

## Key Technical Decisions

### Sample Loading Strategy
- Pre-load Grand/Upright/Electric samples at app init (or lazy-load on first use)
- Fall back to synthesis if samples fail to load
- Store sample index (root note, velocity) for quick sample selection
- No network; all samples bundled in build

### Effects Architecture
- Each effect is a factory function returning an active node graph
- Bypass is click-free (crossfade or parameter manipulation, not node disconnection)
- Per-unit dry/wet uses a crossfade/mixer node
- Focus routing: input selector at the chain entrance (selects which layer's output enters)
- Global mode: shares control state across all instances (not nodes; nodes stay per-layer)

### Layer Isolation
- Each layer has its own set of effect nodes (except Rotary which is shared)
- Layer enable/disable cleanly removes its voices and effect nodes
- Layer focus sets which layer's output feeds to effects (for shared group mode)
- Octave shift happens at note frequency calculation, not via pitch shifter node

### Node Cleanup Strategy
- Maintain a WeakMap of active nodes per voice/layer
- On note release: stop oscillators, cancel ramped values, disconnect nodes
- On layer disable: stop all voices, disconnect all effect nodes
- On unmount: cleanup everything, verify node counts return to baseline

## Testing Strategy

### Unit Tests (Phase 2A-B)
- Piano layers: enable/disable, focus switching, level measurably affects output
- Performance controls: each control changes rendered audio measurably
- Effects: each unit/type changes signal measurably, on/bypass works, dry/wet works
- Sample loading: success/failure paths, fallback behavior
- Cleanup: node/timer counts return to baseline after layer disable/unmount

### Integration Tests (Phase 2C)
- Layer + effects: layer focus correctly routes to active effects
- Focus routing: manual buttons override auto-follow
- Group mode: Piano A and B share effect settings when enabled
- Global mode: Shift+On applies Delay/Compressor/Reverb to all layers
- Master path: all layer outputs → master gain → limiter → destination (nothing bypasses)

### Regression Tests (Phase 2C)
- All Phase 1 tests pass without modification
- Keybed geometry, key count, input behavior unchanged
- Phase 1 visual surface identical
- Phase 1 audio behavior unchanged

## Dependencies
- Web Audio API (no external synthesis libraries)
- React 19 + Vite (Phase 1 already uses these)
- No new npm packages required (use built-in Web Audio and synthesis)

## Timeline & Burn-Down
- **Phase 2A (Piano): ~1-2 hours** (layers, performance controls, sample loading)
- **Phase 2B (Effects): ~4-6 hours** (all 6 units + routing + focus + modes)
- **Phase 2C (Test/Seal): ~2-3 hours** (full test suite, evidence, IMPLEMENTATION_DETAILS)
- **Total: ~7-11 hours for full Phase 2**

This is a realistic estimate given the complexity of real Web Audio effects synthesis and the need to ensure all controls measurably change audio.
