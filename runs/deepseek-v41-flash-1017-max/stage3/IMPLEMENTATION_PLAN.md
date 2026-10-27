# Phase 3 implementation plan — Nord Stage 4 73

Assigned specs (authoritative for this phase; all cited by filename):

- `specs/nord-stage-4.visual.json` — deck geometry, section widths, landmarks, forbidden hardware, presentation bounds. Phase 3 changes nothing on the surface: the same six sections, the same 167-control inventory, the same two OLEDs.
- `specs/nord-stage-4.piano.json` — inherited unchanged: six types, two layers, three recorded sets, the performance controls, sustain, fallback.
- `specs/nord-stage-4.effects.json` — extended, not forked: the same six units and the same shared Rotary now exist on all six chain instances, and the Organ reaches the rotary with its own ORGAN button.
- `specs/nord-stage-4.programs.json` — 32 programs, 8 Live slots, Store/Store As, dirty state, edit-discard, splits and zones, Layer Scenes, Wheel and Control Pedal morphs, Master Clock, Transpose, Panic.
- `specs/nord-stage-4.organ.json` — two layers over four required-distinct engines, nine drawbars, B3 percussion and key click, vibrato/chorus, rotary routing.
- `specs/nord-stage-4.synth.json` — three layers, the exact waveform list, four filters, three envelopes, LFO, voice modes, arpeggiator/gate.
- `specs/benchmark-phases.json` — the Phase 3 outcome, inclusions, exclusions and hard gates.
- `specs/nord-stage-4.variants.json` — variant `stage-4-73` (73 keys, E1–E7, hammer action).

Inherited from Phases 1 and 2 and preserved: the surface layout, the whole note lifecycle, the piano library, the effect chain, and every earlier test file. Phase 2 behaviour is covered by `regression.phase2`, which names every inherited Phase 2 test file.

## Phase 3 hard gates (copied from `specs/benchmark-phases.json`)

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.

Where each gate is proved: `evidence/stage3-capture.json` holds the measurements and
`evidence/stage3-visual-audit.md` interprets them; 572 tests across 33 files are the
automated proof; the four package gates are green.

## Canonical state schema

One `ProgramState` (`src/audio/programState.ts`) is the instrument. Every field is plain
JSON — no functions, no class instances, no `undefined` — which is what makes "a program
round-trips" testable by serialising it rather than by trusting a setter.

```text
ProgramState
├─ piano      PianoState      section on, focused layer, per-layer
│                             {enabled, level, octave, type, model, sustPed, pitchStick},
│                             kbTouch, dynComp, timbre, unison, softRelease, stringRes,
│                             masterLevel*, revision
├─ organ      OrganState      section on, focused layer, per-layer
│                             {enabled, level, octave, model, drawbars[9], vibratoOn,
│                              vibratoType, percussion{on,soft,fast,third,poly}, keyClick,
│                              sustPed, pitchStick, zones[4]}, revision
├─ synth      SynthState      section on, focused layer, per-layer
│                             {enabled, level, octave, waveform, oscCtrl, oscEnvAmount,
│                              coarse, fine, oscEnvToPitch, oscEnv, filterOn, filterType,
│                              filterFreq, filterRes, filterEnvAmount, keyTracking,
│                              filterDrive, filterEnv, ampEnv, ampVelocity, lfo{...},
│                              arp{mode,run,rate,range,direction,hold,clockSync},
│                              voiceMode, priority, glide, unison, vibrato, sustPed,
│                              zones[4]}, revision
├─ effects    EffectState     allOn, focus, focusedLayer, pianoGroup,
│                             chains{piano.a, piano.b, organ, synth.a, synth.b, synth.c},
│                             rotary{on,speed,drive,organRouted}, revision
├─ split      SplitState      on, points{Low,Mid,High}×{position,crossfade},
│                             zones[layer][4]
├─ scenes     SceneState      second, sceneI[layer], sceneII[layer]
├─ morph      MorphState      wheel[assignment], pedal[assignment], wheelPosition, pedalPosition
├─ clock      ClockState      bpm, keyboardSync, sync{arp,lfo,delay,mod1}
├─ transpose  number          -6..6
└─ transposeOn boolean
```

\* `masterLevel` lives in `PianoState` because Master Level is a **performance control**,
and `programStatesEqual` excludes it — so the knob neither dirties a program nor moves when
one loads. That is the one deliberate asymmetry in the schema, and the programs spec asks
for it (`programState.excludes: ["Master Level"]`).

The dirty indicator is never assigned. `ProgramSnapshot.dirty` is
`!programStatesEqual(read(), stored)`, where `read()` is the live instrument state; the
comparison ignores `revision` counters (which change without any value changing) and key
insertion order (which differs between a state built by the constructor and one rebuilt
through a program load).

## Control-binding audit plan

`src/audio/panelBindings.ts` is the single place that decides what a control does, and it
holds two tables rather than one:

| Table | Meaning |
| --- | --- |
| `CONTROL_BINDINGS` | The control writes real state. Each entry names the store it writes (`piano`, `organ`, `synth`, `effects`, `program`, `performance`) and, where the spec allows it, the morph parameter it can be assigned to. |
| `UNSUPPORTED_CONTROLS` | The control is spec-excluded. Each entry carries the reason and the **spec file and bullet** that excludes it. |

`auditControls()` walks the real catalog and reports four numbers: how many controls are
bound, how many are explicitly unsupported, which controls are in neither, and which
bindings name a control the catalog does not contain. All four are asserted, so a control
added without a decision fails the suite instead of silently doing nothing. The same table
is printed in the UI's unsupported notes, so the honest list is visible to a player and not
only to a test.

Result at time of writing: **167 controls — 147 bound, 20 explicitly unsupported, 0
unaccounted, 0 phantom bindings.** The 20 excluded controls are the aftertouch morph source,
the per-section preset library (3), the Organ preset and sync, aux-keyboard routing (2),
Piano INFO and pedal noise, Synth Samples/Extern mode, its pitch page and its arp pattern,
the three per-type Variations, the rotary close-mic and stop-angle switches, and the
monitor-head input.

## Order of work, as executed

1. **This file** — Phase 3 gates, canonical schema, audit plan.
2. **State and program system first**, because everything else is stored in it:
   `programState.ts` (the schema and its pure helpers), then `programStore.ts` (32 slots,
   the eight Live slots, Store/Store As, the dirty lifecycle, the persistence boundary). The
   system reads and writes the instrument's live state through injected `read`/`write`
   rather than keeping a copy, which is what makes the dirty flag truthful.
3. **Splits, zones, crossfades, scenes, morphs, clock, transpose, Panic.** Splits are pure
   arithmetic on the eleven documented positions; a crossfade belongs to a *boundary*, so a
   zone's gain is the product of its fade-in and fade-out and the two neighbours sum to
   unity through the band.
4. **The Organ engine.** A model is a registration: B3 is nine sine partials with wheel
   leakage, Vox is seven reed partials through a formant plus a filtered/unfiltered mix
   drawbar, Farf is on/off register selectors each with its own voice, and Pipe is nine
   principal ranks. Then percussion, key click, vibrato/chorus, and the rotary route.
5. **The Synth engine.** Five genuinely different source categories, four filters, three
   envelopes, a five-waveform LFO, voice modes and the arpeggiator. A note is rendered to a
   buffer and played as one source, so the array the browser plays is the array the tests
   measure.
6. **Integration and the audit** — six chains in one context, one master path, then the
   control-binding audit and the rendered-audio regression pass.

## Audio graph, as extended

```text
                       ┌──────────────────────── one AudioContext ────────────────────────┐
                       │                                                                  │
  keybed / MIDI ──► NoteSession ──► Piano A voice ──► piano.a chain ─┐                    │
                       │        ├─► Piano B voice ──► piano.b chain ─┤                    │
                       │        ├─► Organ A voice ─┐                  │                    │
                       │        ├─► Organ B voice ─┴► organ chain ────┤                    │
                       │        ├─► Synth A voice ──► synth.a chain ──┤                    │
                       │        ├─► Synth B voice ──► synth.b chain ──┤                    │
                       │        └─► Synth C voice ──► synth.c chain ──┤                    │
                       │                                             │                    │
                       │   chain X = Mod 1 → Mod 2 → Delay → Amp/EQ → Comp → Reverb           │
                       │                          │                                        │
                       │                          ├──► To Rotary (Piano/Synth) ──┐          │
                       │                          └──► ORGAN button (Organ) ────┴► Rotary  │
                       │                                                             │    │
                       │                    layer level ──► master gain ──► limiter ──┴──► destination
                       └──────────────────────────────────────────────────────────────────┘
```

Rules the graph enforces, not just documents:

1. Exactly one `AudioContext`; one source file constructs it, and a test scans the tree to
   prove no other module does.
2. Six chain instances — Piano A, Piano B, the shared Organ chain, Synth A/B/C — each with
   its own units.
3. The Organ's two layers share one chain; its level stage sums their faders (capped at 1),
   so one layer at zero is silent while the other plays.
4. One Rotary instance for the whole instrument, and it is last: Piano and Synth enter with
   To Rotary, the Organ with its ORGAN button.
5. Nothing bypasses master gain and limiter; exactly one connection reaches the
   destination, counted on adapters during a real offline render.
6. Every parameter change is ramped; unit bypass is a crossfaded gain pair.

## Test strategy for the Phase 3 audible claims

- Organ and Synth claims are measured by rendering the **production** generators
  (`organModel`, `synthModel`, `synthVoice`) — the same functions the browser plays — and
  comparing spectra, crossing rates, brightness, centroid and tail length. Assertions are
  tolerant relationships ("Pipe 2 is brighter than Pipe 1", "LP24 is darker than LP12"),
  never exact waveforms.
- Program, split, scene and morph claims are exercised on the real program system with a
  live state object, so "round-trips" is measured on the state the instrument would play.
- Routing claims are asserted twice: on the session's voice bookkeeping (which layer got
  which voice) and, where it matters, on rendered audio so a router that only relabels fails.
- Panel claims run through the real `App`, because a browser pass caught a defect no unit
  test had: momentary buttons reported only their release, so Store, the program buttons,
  the page buttons and Panic were accessible and completely inert. `programs-panel.test.tsx`
  exists to keep that fixed.

## Honesty notes for this phase

- Nothing is described as a recording unless it is one. The Organ and Synth engines contain
  no audio files; `IMPLEMENTATION_DETAILS.json` declares their generators individually.
- Aftertouch is not claimed anywhere: the A.T. morph source and the A.T. vibrato mode exist,
  press, and are listed as unsupported because a browser keyboard has no pressure sensor.
- Master Level is excluded from program state, as the programs spec says, and a test asserts
  that changing it does not dirty a program.
- Every control is either bound or listed with the spec that excludes it. There is no
  control that is neither.
