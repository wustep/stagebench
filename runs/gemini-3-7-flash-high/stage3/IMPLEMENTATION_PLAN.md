# Stagebench Phase 3 Implementation Plan

## Assigned Specifications
- `specs/nord-stage-4.visual.json` (version 1.2.0)
- `specs/nord-stage-4.piano.json` (version 2.0.0)
- `specs/nord-stage-4.effects.json` (version 2.0.0)
- `specs/nord-stage-4.programs.json` (version 2.0.0)
- `specs/nord-stage-4.organ.json` (version 2.0.0)
- `specs/nord-stage-4.synth.json` (version 2.0.0)
- Variant: `stage-4-73` (Nord Stage 4 73, Hammer Action keybed, 73 keys, E1 to E7 / MIDI 28–100, 43 white, 30 black, 54/46 deck/keybed vertical allocation)

## Hard Gates Checklist
- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

## System Architecture Overview

```
[Keybed / MIDI / Touch / Computer Input]
                    │
                    ▼
          [Note Lifecycle & Router]
                    │
   ┌────────────────┼────────────────┐
   │ (Split Zone 1) │ (Split Zone 2) │ (Split Zone 3/4)
   ▼                ▼                ▼
[Piano Engine]    [Organ Engine]   [Synth Engine]
- Layer A (FX Chain 1) - Layer A ┐ (Shared FX   - Layer A (FX Chain 3)
- Layer B (FX Chain 2) - Layer B ┘  Chain 6)    - Layer B (FX Chain 4)
                                                - Layer C (FX Chain 5)
   │                │                │
   │                ├────────────────┘
   │                ▼ (To Rotary)
   │        [Shared Rotary Unit]
   │                │
   ▼                ▼
   [Master Sum Bus (Single AudioContext)]
                    │
          [Master Level Gain]
                    │
        [Master Brickwall Limiter]
                    │
            [ctx.destination]
```

## Section Architecture & Implementations

### 1. Programs & Performance System (`src/model/programs.ts`, `src/model/morph.ts`, `src/model/splits.ts`)
- **32 Program Slots**: 4 pages of 8 buttons with dial browsing, numeric list view, and Store / Store As with character naming.
- **8 Live Slots**: Auto-store every parameter edit instantaneously to isolated Live storage slots.
- **Truthful Dirty Lifecycle**: Any modification to a loaded program marks dirty state (`E` indicator). Changing programs without storing discards unsaved edits.
- **Factory Programs**: Ships with 8 curated factory programs covering Grand Piano, B3 Rock Organ, Synth Lead, Velvet Pad, Split Bass/Piano, Layered Worship, FM Digital, and Arp Groove.
- **Keyboard Splits & Zones**:
  - Up to 4 keyboard zones configured via 3 split points (Low, Mid, High) selectable at 11 positions (C2, F2, C3, F3, C4, F4, C5, F5, C6, F6, C7).
  - Crossfade widths: Off (0), ±6, ±12 semitones with smooth gain attenuation across boundary zones.
  - Per-layer zone assignment flags (Zone 1..4).
- **Layer Scenes I / II**:
  - Toggles active layer enable states (Piano A/B, Organ A/B, Synth A/B/C) independently per scene without duplicating sound synthesis parameters.
- **Morph Engine**:
  - Sources: Modulation Wheel and Control Pedal (virtual pedal & MIDI CC11).
  - Interpolates assigned destination parameters from base values to morphed target values.
  - Supports clear per source (Shift + Morph Source) and single-parameter re-zeroing.
- **Master Clock & Transpose & Panic**:
  - Master Clock: 30–300 BPM via dial or tap tempo, driving Arpeggiator rates, Synth LFO rates, Delay tempo subdivisions, and Mod 1 LFO rates.
  - Transpose: ±6 semitones affecting note routing across all engines.
  - Panic: Internal All-Notes-Off signal flushing all active voices and clearing held inputs.

### 2. Organ Sound Engine (`src/audio/organ/`)
- **Dual Layers (Organ A, Organ B)**: Independent layer volume faders, octave shifts (±12 semitones), vibrato/chorus enable, model selection, and drawbar registrations sharing one dedicated effect chain.
- **4 Distinct Harmonic Models**:
  - **B3 Tonewheel**: 9 sine partials (16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1') with tonewheel leakage, key click transient generator, and 2nd/3rd harmonic percussion (soft/normal, fast/slow decay, single-triggered).
  - **B3 Bass**: Tonewheel engine focused on 16' and 8' drawbars with key click.
  - **Vox Continental**: 7 drawbar partials (16', 8', 4', 2', II, III, IV) plus filtered/unfiltered mix drawbar capturing the vintage Germanium transistor tone.
  - **Farfisa Compact**: Multi-rank transistor organ with on/off switch registration characteristics (pulled past half = active) and distinct high-boost harmonics.
  - **Pipe 1 & Pipe 2**: Flute and principal pipe ranks with pipe chiff attack, acoustic pipe acoustic resonance, and detuned tremulant vibrato/chorus.
- **Vibrato / Chorus Scanner**:
  - Modes: C1, C2, C3, V1, V2, V3 with multi-stage phase/delay modulation and wet/dry mix.
- **Rotary Integration**:
  - Organ section routes directly into the shared Rotary unit with slow/fast speed switching, realistic rotational inertia acceleration, and tube overdrive.

### 3. Synthesizer Sound Engine (`src/audio/synth/`)
- **Three Independent Layers (Synth A, Synth B, Synth C)**: Each layer has full dedicated sound generation and its own independent 6-unit effect chain.
- **Analog Oscillators & Categories**:
  - **Pure**: Sine, Triangle, Saw, Square, Pulse 33, Pulse 10, White Noise.
  - **Sync**: Hard-synced oscillator pair with Osc Ctrl adjusting slave pitch.
  - **Multi**: Multi-saw stack with Osc Ctrl controlling inter-oscillator detuning.
  - **Super**: Hypersaw / Super-square unison stack with Osc Ctrl controlling spread/width.
  - **FM-H**: 2-Operator Harmonic FM with Osc Ctrl modulating FM index.
- **Multi-Mode Filter**:
  - Types: LP12 (12dB lowpass), LP24 (24dB lowpass), HP (highpass), BP (bandpass).
  - Controls: Cutoff frequency (morphable), Resonance (morphable), Drive (Off, 1, 2, 3), Keyboard tracking (Off, 1/3, 2/3, 1), Envelope modulation amount (-10..+10).
- **Three Dedicated Envelopes**:
  - **Oscillator Envelope**: ADR with bipolar pitch modulation and velocity scaling.
  - **Filter Envelope**: ADR with cutoff frequency modulation and velocity scaling.
  - **Amp Envelope**: ADR with master volume shaping and velocity sensitivity.
- **LFO**:
  - Waveforms: Triangle, Saw Down, Saw Up, Square, Sample & Hold.
  - Destinations: Osc Pitch, Osc Ctrl, Filter Frequency.
  - Free rate or Master Clock synced rate.
- **Voice Allocation & Arpeggiator / Gate**:
  - Voice Modes: Polyphonic, Monophonic (retriggering), Legato (smooth transition with portamento Glide).
  - Priority: Low, High, Last Note Priority.
  - Unison: Off, 1, 2, 3.
  - Vibrato: On, Wheel-controlled.
  - Arpeggiator: Modes (Arp, Poly, Gate), Directions (Up, Down, Up/Down, Random), Range (1–4 octaves), Clock Sync, KB Hold, Arp Run.

### 4. Audio Graph Integration
- All 3 engines (Piano, Organ, Synth) route through per-layer buses and dedicated/shared Effect Chains inside ONE AudioContext.
- Master Bus -> Master Level Gain -> Master Limiter -> AudioContext Destination.
- Zero audio node leaks upon note release or engine disposal.
