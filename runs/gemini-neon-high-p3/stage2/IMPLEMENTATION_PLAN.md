# Nord Stage 4 73 — Phase 2 Implementation Plan

## Scope & Reference Authority

This plan covers **Phase 2 (Piano library and working effects)** for the assigned hardware variant **Nord Stage 4 73** (`stage-4-73`, 73-key hammer-action keybed E1–E7, 43 white / 30 black keys, aspect ratio 3.0951), extending the sealed Phase 1 artifact without regressing its visual surface, control inventory, keybed geometry, or input behavior.

Assigned specs:
- `inputs/specs/nord-stage-4.visual.json` (`nord-stage-4.visual.json`)
- `inputs/specs/nord-stage-4.piano.json` (`nord-stage-4.piano.json`)
- `inputs/specs/nord-stage-4.effects.json` (`nord-stage-4.effects.json`)
- Variant geometry: `inputs/specs/nord-stage-4.variants.json` (`nord-stage-4.variants.json`)
- Product photo authority: `inputs/reference/nord-stage-4-73.jpg`

### Scope Boundary (Honesty Contract)
- **Functional in Phase 2:**
  - **Piano section:** Section On/Off, two independent layers (A and B) with Enable, Focus, Level fader, Octave shift (±12 semitones), SUSTPED and PSTICK per-section routing toggles, 6 selectable piano types (`Grand`, `Upright`, `Electric`, `Clav`, `Digital`, `Misc`) with Model Dial selection shown in the Program OLED, KB Touch (`Heavy`, `Medium`, `Light`), Dyn Comp (`Off`, `1`, `2`, `3`), Timbre (`Off`, `Soft`, `Mid`, `Bright`, plus `Dyno 1` / `Dyno 2` for Electric), Unison (`Off`, `1`, `2`, `3`), Acoustics (`Soft Release` — disabled for Clav — and `String Res` sympathetic resonance), sustain from UI/keyboard/MIDI CC64, pitch stick bend (±2 semitones when PSTICK enabled), and labeled playable fallback with flashing Type LED + Program OLED alert on sample load failure.
  - **Layer Effects section:** Independent per-layer chains for Piano A and Piano B (`Mod 1`, `Mod 2`, `Delay`, `Amp Sim/EQ`, `Compressor`, `Reverb`) plus the shared `Rotary` speaker reached via `To Rotary`, Layer Effects all-effects bypass (`ON`), FX Focus following Piano layer focus plus manual focus buttons (`Organ`, `Piano`, `Synth`), Piano Group Mode (Shift + FX Focus Piano), Global Mode (Shift + On for `Delay`, `Compressor`, `Reverb`), per-unit on/bypass, dry/wet, and all spec-listed unit types.
  - **Performance section:** `Master Level` knob (real master bus gain), `Pitch Stick` (±2 semitones to Piano when PSTICK is on), and `Rotary Speaker` controls (`Drive`, `Stop Mode`, `Slow/Fast` speed with smooth acceleration).
- **Decorative in Phase 2 (honestly presentation-only):** Organ section, Synth section, Program/Morph/Split/Clock/Transpose/Preset/Live/Scene controls, Mod Wheel, and all spec-`excluded` controls (Pedal noise/half-pedaling, Triple Pedal, Piano size classes/INFO, per-type FX Variations, Reverb Chorale, Delay feedback-loop FX/Analog mode, Mod 1 pedal modes, Rotary close mic/stop angle).

## Phase 2 hard gates

- [ ] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [ ] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [ ] Each effect unit and type processes real audio with working bypass and dry/wet.
- [ ] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [ ] The Phase 1 surface, keybed, and input behavior remain regression-free.

Assigned specs: `nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`

## Sample Provenance Plan

All bundled audio recordings are cut exclusively from `inputs/samples/` without pitch-shifting, time-stretching, or layering baked into files, encoded as Ogg Vorbis (`-q:a 4`, >= 80 kbps) with trimmed leading silence and smooth tail fades, and declared individually in `IMPLEMENTATION_DETAILS.json` under `audio.files` with source entries copied verbatim from `inputs/samples/sample-sources.json` into `audio.sampleSources`:

| Piano Type | Model(s) | Origin | Pack Source ID | License | Coverage |
| --- | --- | --- | --- | --- | --- |
| **Grand** | `Salamander Grand`, `Studio Grand 2` | Recorded (`origin: "pack"`) | `salamander-grand-v3` | `CC-BY-3.0` | 78 stereo OGG files: 26 minor-third roots D#1–F#7 × 3 velocity layers (`v3`, `v10`, `v16`) |
| **Upright** | `Kawai Upright KW`, `Felt Upright` | Recorded (`origin: "pack"`) | `upright-piano-kw` | `CC0-1.0` | 52 stereo OGG files: 26 roots D#1–F#7 × 2 velocity layers (`vL`, `vH`) |
| **Electric** | `EP1 Mk I Rhodes` | Recorded (`origin: "pack"`) | `learman-rhodes-gm` | `CC0-1.0` | 15 mono OGG files: all 15 roots F1–C7 (single dynamic; velocity via gain + dynamic low-pass filtering) |
| **Electric** | `EP2 Wurli 200` | Recorded (`origin: "pack"`) | `greg-sullivan-e-pianos` | `CC-BY-3.0` | 24 mono OGG files: 12 roots A1–Ab6 × 2 velocity layers (`mp`, `ff`) |
| **Clav** | `Clavinet D6`, `Harpsichord 8'` | Live Web Audio synthesis (`generatedSources`) | — | — | Plucked harmonic/sawtooth + resonant pickup filter synthesis; Soft Release disabled per manual p. 25 |
| **Digital** | `DX E.Piano`, `FM Bell Grand` | Live Web Audio synthesis (`generatedSources`) | — | — | 2-operator FM tine + warm body synthesis with velocity-scaled modulation index |
| **Misc** | `Concert Marimba`, `Warm Vibraphone` | Live Web Audio synthesis (`generatedSources`) | — | — | Fundamental + 4th harmonic bar overtone + filtered mallet strike transient (with motor tremolo on Vibraphone) |
| **Fallback** | `Synth Piano Fallback` | Live Web Audio synthesis (`generatedSources`) | — | — | Playable harmonic fallback engaged only while a recorded bank is loading or failed; visibly labeled |

Reverb impulse responses are generated programmatically in memory per AudioContext (`generatedSources`) so zero undeclared audio files exist.

## Single-AudioContext Signal Graph Diagram

```text
One AudioContext (ctx)
│
├── Piano Layer A Voices (Sampled / Synth / Fallback)
│     ├── Pitch: MIDI + Layer A Octave (±12) + Pitch Stick (±2 st if PSTICK)
│     ├── Velocity: KB Touch curve → Dyn Comp floor → layer sample / filter / gain
│     ├── Unison (Off / 1 / 2 / 3 detuned stereo voices)
│     ├── Timbre EQ (Off / Soft / Mid / Bright / Dyno 1 / Dyno 2)
│     ├── Acoustics: Soft Release (disabled on Clav) + Sympathetic String Resonance bus
│     ▼
│   [Layer A Bus]
│     ▼
│   [Layer A FX Chain] (or shared Piano Group chain when Piano Group Mode active)
│     ├── 1. Mod 1      (A-Pan | Tremolo | Ring Mod | A-Wah | Wah | Pump) [Rate/Sens, Amt, On]
│     ├── 2. Mod 2      (Chorus | Flanger | Phaser | Vibe | Ensemble | Spin) [Rate, Amt, On]
│     ├── 3. Delay      (Tempo/Tap, Feedback, Feedback Filter Off/LP/HP/BP, Ping-Pong, Dry/Wet, On, Global)
│     ├── 4. Amp Sim/EQ (EQ only | Twin | JC | Small | LP24 | HP24 | To Rotary; Drive, Bass/Mid/MidFreq/Treble, On)
│     ├── 5. Compressor (Amount, Fast Mode, On, Global)
│     └── 6. Reverb     (Room | Booth | Spring | Stage | Hall | Cathedral; Bright/Dark, Dry/Wet, On, Global)
│     │
│     ├─── if To Rotary NOT routed ──► [Layer A Level Gain] ──────────────────┐
│     └─── if To Rotary routed ──────► [Shared Rotary Bus]                    │
│                                        (Horn + Bass rotors, Drive,          │
│                                         Slow/Fast smooth ramp, Stop mode)   │
│                                        └──► [Rotary Post-Level Send A/B] ───┤
│                                                                             │
├── Piano Layer B Voices ──► [Layer B Bus] ──► [Layer B FX Chain] ────────────┤
│                                                                             │
│   (Global Delay / Compressor / Reverb when Global Mode active:              │
│    shared global unit parameters & processing applied to all layers         │
│    while preserving Reverb-before-Rotary order)                             │
│                                                                             ▼
│                                                                 [Master Bus Sum]
│                                                                        │
│                                                           [Master Level Gain Knob]
│                                                                        │
│                                                           [Master Soft-Knee Limiter]
│                                                                        │
│                                                               [ctx.destination]
```

*Note on Signal Order & All-Effects Bypass:* Every parameter transition uses short `setTargetAtTime` / linear ramps (5–20 ms) to prevent clicks. `Layer Effects ON = Off` cleanly crossfades each layer around its entire FX chain and Rotary send straight into Layer Level. `Layer Level` scales the layer's contribution (both direct and rotary send) so turning a layer level to 0 silences that layer completely.

## Architecture & Implementation Order

1. **Sample Preparation (`public/samples/upright/`, `public/samples/electric/`, `src/audio/sampleManifests.ts`)**: Encode Upright KW (52 files), Rhodes Mk I (15 files), and Wurlitzer EP200 (24 files) with onset-trimmed cuts and generate typed manifests + `IMPLEMENTATION_DETAILS.json` entries.
2. **Canonical Piano + Effects State (`src/model/instrumentState.ts`)**: Canonical state for Piano section (sectionOn, focusLayer, sustped, pstick, layers A/B with enabled/level/octave/type/modelIndex/timbre/kbTouch/dynComp/unison/softRelease/stringRes), Layer Effects (allOn, focusTarget, pianoGroupMode, shiftHeld, per-chain Mod1/Mod2/Delay/AmpEq/Comp/Reverb settings, global unit flags/states, shared Rotary settings), Master Level, and Pitch Stick. Keeps `HardwarePresentationState` for decorative Organ/Synth/Program controls and mirrors focused-layer Piano/FX values onto panel controls so every control's ARIA value, LED state, and label agree with live state.
3. **Single-AudioContext Engine (`src/audio/effectUnits.ts`, `src/audio/effectChain.ts`, `src/audio/stageAudioEngine.ts`)**:
   - Refactors Phase 1 `WebAudioPianoEngine` into a unified engine owning one `AudioContext`, multi-bank `SampleBankManager` (Grand, Upright, Rhodes, Wurlitzer), Piano layer voice spawners (recorded + Clav/Digital/Misc synthesis + labeled fallback), sympathetic String Resonance resonator, per-layer ordered Effect Chains, shared Rotary speaker, Master Level gain, and soft-knee limiter.
   - Preserves `PianoVoiceBackend` compatibility and `NoteLifecycleController` multi-input behavior (pointer, multi-touch, keyboard with repeat suppression, Web MIDI notes + CC64) while routing note ownership per enabled Piano layer (A, B, or both) with per-layer octave shift and SUSTPED/PSTICK gating.
4. **UI Integration (`src/components/sections/PianoSection.tsx`, `EffectsSection.tsx`, `PerformanceSection.tsx`, `ProgramSection.tsx`, `StatusFooter.tsx`)**: Bind functional controls, add Shift-combo support for Group Mode / Global Mode / Delay Filter / Comp Fast / SUSTPED / PSTICK, display focused layer/model/failure alerts on the Program OLED (with flashing Type LED on load failure), update StatusFooter attribution for CC-BY-3.0 sources (Salamander Grand + Greg Sullivan E-Pianos) and CC0 sources (Upright KW + Learman Rhodes).
5. **Verification & Evidence**: Real `OfflineAudioContext` rendered-audio tests via `node-web-audio-api` plus React/DOM integration tests covering every Phase 1 and Phase 2 `tests/feature-matrix.json` ID, canonical Phase 2 Playwright capture via `node ../inputs/harness/capture-evidence.mjs --phase 2`, visual regression audit against Phase 1 (`evidence/stage2-visual-audit.md`), and all four pnpm gates (`test`, `typecheck`, `lint`, `build`).
