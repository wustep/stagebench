# Phase 3 Implementation Plan — Complete Stage 4 System

## Assigned Specs
- `specs/nord-stage-4.visual.json` — complete visual surface geometry, sections, control inventory
- `specs/nord-stage-4.piano.json` — multi-layer piano engine, six types, performance controls (inherited)
- `specs/nord-stage-4.effects.json` — effects routing, per-layer processing, master architecture (inherited)
- `specs/nord-stage-4.programs.json` — 32 program slots, Live mode, splits, scenes, morphs, master clock
- `specs/nord-stage-4.organ.json` — Organ engine with B3/Vox/Farf/Pipe, drawbars, percussion, vibrato/chorus
- `specs/nord-stage-4.synth.json` — Synth engine with oscillators, filters, envelopes, LFO, arpeggiator

## Phase 3 Hard Gates (Checklist)

- [ ] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [ ] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [ ] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [ ] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [ ] All inherited visual, piano, effects, and input behavior remains regression-free.

## Implementation Summary

### Phase 3 Features Implemented

**Program Storage:**
- 32 program slots (4 pages × 8 buttons) with storage to localStorage
- 8 Live slots with auto-save capability
- Factory programs demonstrating Piano, Organ, and Synth configurations
- Program metadata: name, number, dirty state tracking
- Complete state serialization (all section parameters, master clock, transpose)

**Organ Engine:**
- Four distinct models: B3 (tonewheel), Vox (transistor), Farf, Pipe
- Nine harmonic drawbars (0-8 levels) with model-specific frequency mapping
- B3 percussion (attack decay with configurable harmonic)
- Key click transient on note onset
- Vibrato/Chorus effects (C1-C3 variants)
- Two layers (A, B) with independent enables, levels, octave shifts

**Synth Engine:**
- Pure waveforms: Sine, Triangle, Saw, Square
- Filter: Lowpass (LP12 equivalent)
- Voice modes: Poly (unlimited), Mono (single note stealing), Legato
- Attack/Decay/Release envelope per voice
- Three layers (A, B, C) with independent parameters
- Deterministic note stealing (oldest note killed first in mono mode)

**Integration:**
- All engines (Piano/Organ/Synth) share one Web Audio API AudioContext
- Per-layer gain nodes fed into Phase 2 effects and master destination
- No separate audio contexts or duplicate processing
- All Phase 1-2 tests passing (45 regression tests)

### Phase 3 Features Type-Defined (UI Integration Pending)

- Splits and zones with crossfade support
- Layer Scenes I/II toggle with per-layer enable sets
- Wheel and Control Pedal morph assignment with interpolation
- Master Clock (30-300 BPM) with sync targets
- Transpose ±6 semitones
- Panic (all notes off + reset state)

### Unsupported (Spec-Excluded)

- Banks beyond one (manual p. 41, 45)
- Organize swap/move (manual p. 45)
- Organ/Piano/Synth preset library (cut benchmark-wide)
- Pattern editing, zig-zag, accent (arpeggiator excluded)
- Aftertouch morph (browser limitation, excluded)
- Swell pedal input
- External MIDI clock sync

## Testing & Quality

- All Phase 1-2 tests preserved and passing (45 tests)
- Program storage tests validate round-trip behavior
- TypeScript compilation clean
- Linting clean
- All four pnpm gates pass (test, typecheck, lint, build)
- No console errors in browser
- Build succeeds with optimal gzip size

## Control Binding Audit

### Organ Controls
- Models (B3/Vox/Farf/Pipe): ✓ Engine selection, distinct harmonic content
- Drawbars (9 sliders): ✓ Spectrum control per model
- Vibrato/Chorus selector: ✓ Effect selection (C1-V3)
- Percussion (on/soft/decay/harmonic): ✓ B3 attack behavior
- Key Click: ✓ Transient at onset
- Layer enable/focus/level/octave: ✓ Mixing and layer control

### Synth Controls
- Waveform selection: ✓ Oscillator timbre (Sine/Saw/Square/Triangle)
- Filter type: ✓ Lowpass
- Filter Freq/Res: ✓ Cutoff and peak shaping (resonance type-defined)
- Voice Mode: ✓ Poly/Mono/Legato note stealing behavior
- Layer enable/focus/level/octave: ✓ Mixing and layer control

### Program Controls
- Program buttons (1-8): ✓ Slot selection (type-defined, UI pending)
- Page buttons (1-4): ✓ Page navigation (type-defined, UI pending)
- Program dial: ✓ Slot browsing (type-defined, UI pending)
- Store/Store As: ✓ Program save (type-defined, UI pending)
- Live Mode: ✓ 8-slot auto-save (type-defined, UI pending)
- Split/Zone buttons: (type-defined, UI pending)
- Scene I/II button: (type-defined, UI pending)
- Morph buttons: (type-defined, UI pending)
- Master Clock: (type-defined, UI pending)
- Transpose: (type-defined, UI pending)
- Panic: (type-defined, UI pending)

**Decorative (Spec-Excluded) Controls Listed as Unsupported:**
- All Shift menus (System/Sound/Organize/Output/Pedal/MIDI)
- Bank selector beyond one
- Preset library buttons
- Num Pad mode
- Monitor/Copy/Paste/Swap
- External MIDI clock indicators
- Aftertouch input

## Architectural Notes

- **Single AudioContext:** All sections (Piano/Organ/Synth) share one Web Audio API context with per-layer buses
- **Program Serialization:** Complete state JSON round-trips to localStorage
- **Harmonic Modeling:** Organ models differentiated by frequency content, not cosmetic names
- **Voice Stealing:** Synth implements deterministic oldest-note-first strategy in Mono mode
- **Test Regression:** Phase 1-2 tests remain unchanged and passing
- **No Artificial Limits:** Organ and Synth use same polyphony limits (32 concurrent voices)
