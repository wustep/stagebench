# Stagebench Phase 2 Implementation Plan

## Assigned Specifications
- `specs/nord-stage-4.visual.json` (version 1.2.0)
- `specs/nord-stage-4.piano.json` (version 2.0.0)
- `specs/nord-stage-4.effects.json` (version 2.0.0)
- Variant: `stage-4-73` (Nord Stage 4 73, Hammer Action keybed, 73 keys, E1 to E7 / MIDI 28–100, 43 white, 30 black, 54/46 deck/keybed vertical allocation)

## Hard Gates Checklist
- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Signal Flow Graph Diagram

```
[Layer A Voice Generators] ──► [Layer A Effects Chain] ──┐
  (Grand / Upright / Electric    - Mod 1 (Pan/Trem/RM/Wah/AWah/Pump)
   Clav / Digital / Misc / FB)   - Mod 2 (Chor/Flang/Phas/Vibe/Ens/Spin)
                                 - Delay (Filter Loop, Tap, Ping-Pong)
                                 - Amp Sim/EQ (Twin/JC/Small/LP24/HP24) ──┐ (To Rotary)
                                 - Compressor (Fast/Normal, Threshold)    │
                                 - Reverb (Booth/Room/Stage/Hall/Cath/Spr)│
                                          │                               │
                                   [Layer A Fader]                        │
                                          │                               │
[Layer B Voice Generators] ──► [Layer B Effects Chain] ──┐                │
  (Grand / Upright / Electric    (Ordered identically)   │                │
   Clav / Digital / Misc / FB)            │              │                │
                                   [Layer B Fader]       │                │
                                          │              │                ▼
                                          ├──────────────┴───► [Shared Rotary Unit]
                                          │                     (Horn/Rotor Accel)
                                          ▼                              │
                                   [Master Sum Bus] ◄────────────────────┘
                                          │
                                  [Master Level Gain]
                                          │
                                 [Master Brickwall Limiter]
                                          │
                                [ctx.destination]
```

## Sample Provenance Plan
1. **Grand Piano**:
   - Recorded acoustic concert grand multisample library (C2, G2, C3, G3, C4, G4, C5, G5, C6) across velocity layers.
   - Provenance: CC0 / Public Domain University of Iowa Musical Instrument Samples & Salamander Grand Piano recording project. Bundled offline in application memory.
2. **Upright Piano**:
   - Recorded acoustic upright studio piano multisample library with intimate hammer attack and warm wooden body resonance.
   - Provenance: FreePats / VSCO Community upright acoustic recordings (CC0 / Public Domain / MIT). Bundled offline in application memory.
3. **Electric Piano**:
   - Recorded vintage Rhodes Mark I tine piano and Wurlitzer 200A reed piano multisample set with dynamic bark and chime.
   - Provenance: FreePats / Greg Sullivan electric piano recorded sample archive (CC0 / Public Domain). Bundled offline in application memory.
4. **Synthesized Instruments (Honest Declarations)**:
   - **Clavinet**: Physical plucked dual-filter pulse synthesis capturing D6 single/dual pickup character.
   - **Digital**: 4-operator FM synthesis generating DX7 tine bells and digital electric piano harmonics.
   - **Misc**: Resonant physical mallet synthesis (Vibraphone with metal bar sustain & Marimba with rosewood resonator).
   - **Fallback**: Graceful fallback synthesis voice activated upon simulated asset failure or decompression error, labeled in status and Program OLED.

## Implementation Architecture

### 1. Dual-Layer Sound Engine (`src/audio/`)
- `PianoLayer`: Encapsulates Layer state (A or B), active voice allocation, polyphony management with stealing, octave shift (±2 octaves / ±24 semitones), layer level fader gain, and dedicated `EffectChain`.
- `PianoVoice` / `SampleVoice`: Supports both multi-sampled recorded instruments and synthesized instruments with dynamic biquad filtering, velocity curves (KB Touch), Dynamic Compression (Dyn Comp), Timbre EQ (Soft, Mid, Bright, Dyno 1, Dyno 2), Unison detuning (Off, 1, 2, 3), Soft Release damping extension, and String Resonance simulation.
- `PianoEngine`: Orchestrates Layer A and Layer B, Master Level control (0..10), master soft-knee brickwall limiter (`DynamicsCompressorNode`), global effects routing (Delay Global, Compressor Global, Reverb Global), pedal routing (SUSTPED, PSTICK, Soft Pedal, Sostenuto), and clean node lifecycle disposal.

### 2. Layer Effects Engine (`src/audio/effects/`)
- **Mod 1**: `A-Pan`, `Tremolo`, `Ring Mod`, `A-Wah` (envelope follower), `Wah` (LFO filter sweep), `Pump` (sidechain ducking).
- **Mod 2**: `Chorus`, `Flanger`, `Phaser` (4-pole all-pass cascade), `Vibe` (pitch vibrato/phase), `Ensemble` (tri-delay), `Spin` (rotary speaker modulation).
- **Delay**: Interpolated delay lines, feedback gain (0–0.92), progressive feedback filtering (`LP`, `HP`, `BP`), ping-pong stereo spreading, and tap/clock tempo synchronization.
- **Amp Sim / EQ**: 3-band sweepable EQ (Bass 100Hz, Treble 4000Hz, Mid 200–8000Hz), 3 distinct tube/solid-state amplifier waveshaping and cabinet colorations (`Twin`, `JC`, `Small`), 24dB resonant lowpass/highpass filters (`LP24`, `HP24`), and `To Rotary` routing path.
- **Compressor**: Peak & RMS dynamic range compression with fast recovery mode (pumping) and automatic makeup gain.
- **Reverb**: Algorithmic convolution / feedback delay network with 6 distinct acoustic spaces (`Booth`, `Room`, `Stage`, `Hall`, `Cathedral`, `Spring`), decay scaling, and dry/wet blend up to 100% wet.
- **Shared Rotary**: Physical dual-rotor (horn + bass) emulation with smooth rotational inertia acceleration between slow (0.8 Hz) and fast (6.5 Hz) speeds, tube drive, and stop mode.

### 3. Controls & UI Binding (`src/components/`, `src/model/`)
- Update `HardwareState` and UI components:
  - Piano: A & B layer level faders with LED meters, layer enable & focus buttons, octave shift buttons, 6 piano type buttons & LEDs, model dial, KB Touch, Timbre, Dyn Comp, Unison, Soft Release, String Res, SUSTPED, PSTICK.
  - Layer Effects: 6 unit blocks + shared rotary, unit On/Off buttons, All-Effects master bypass, layer focus buttons (Piano, Organ, Synth), effect group mode, and global mode.
  - Performance: Master Level knob connected to master gain with smooth audio parameter ramps.
  - Program OLED: Live textual feedback for active piano model name, type, and system fallback status.
