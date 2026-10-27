# Phase 2 implementation plan — Nord Stage 4 73

Assigned specs (authoritative for this phase; all three are cited by filename):

- `specs/nord-stage-4.visual.json` — deck geometry, section widths, landmarks, forbidden hardware, presentation bounds. Phase 2 does not change the surface: the same six sections, the same 167-control inventory, the same two OLEDs.
- `specs/nord-stage-4.piano.json` — six piano types, two layers, recorded Grand/Upright/Electric sets, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, sustain, fallback.
- `specs/nord-stage-4.effects.json` — six effect units per layer chain plus the shared Rotary, focus/group/global routing, bypass, documented signal order, one AudioContext.
- `specs/benchmark-phases.json` — Phase 2 outcome, inclusions, exclusions, hard gates.
- `specs/nord-stage-4.variants.json` — variant `stage-4-73` (73 keys, E1–E7, hammer action).

Inherited from Phase 1 and preserved: `specs/nord-stage-4.visual.json` layout work, the whole note lifecycle, and every Phase 1 test file.
Phase 1 behaviour is now covered by `regression.phase1`, which names every inherited test file.

## Phase 2 hard gates (copied from `specs/benchmark-phases.json`)

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

Where each gate is proved: `evidence/stage2-capture.json` holds the measurements and
`evidence/stage2-visual-audit.md` interprets them; the four package gates and 342 tests
across 23 files are the automated proof.

## Outcome, as built

- **Sample library.** 235 bundled files across three licensed sets (209 original recordings,
  26 derived roots), 3-4 velocity layers and 19-28 root notes per set, every key within two
  semitones of a root. Clav, Digital and Misc are declared modelled synthesis.
- **Piano section functional:** two layers with independent voice ownership, six types over
  eight models, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, SUSTPED, PSTICK,
  Master Level, and a labelled playable fallback.
- **Layer Effects functional** for Piano A and B: six units in the documented order plus the
  one shared rotary reached through To Rotary, with focus following layer focus, a latched
  manual focus pair, Piano group mode, Delay/Compressor/Reverb global mode, per-unit bypass
  and the all-effects bypass.
- **Still decorative, permanently:** Organ, Synth, Program, and every control the two specs
  list under `excluded`. The functional set is 51 explicit IDs out of 167.

## Scope boundary

Functional this phase (from the two section specs' `scope.required`):

- Piano: two layers (enable/focus/level/octave), six types each with a model, recorded Grand/Upright/Electric sets, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, SUSTPED/PSTICK per layer, sustain from UI/keyboard/MIDI CC64, truthful load state and a labelled playable fallback.
- Effects: per-layer chains for Piano A and B — Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb — plus the one shared Rotary reached through To Rotary. Focus follows layer focus; manual focus buttons; Piano group mode; Delay/Compressor/Reverb global mode; per-unit bypass; all-effects bypass; documented order.
- Master Level becomes real.

Still decorative, permanently (spec `excluded` lists): Organ engine and Organ controls, Synth engine and Synth controls, Programs/Live/splits/zones/scenes/morphs, pedal noise, half-pedaling, triple-pedal modelling, piano size classes, INFO, preset libraries, per-type Variations, Reverb Chorale, delay feedback-loop effects, Analog delay mode, Mod 1 Pump/Wah pedal modes, Rotary close mic and stop angle.

Note on the "39" shorthand in `prompts/stage2.md`: the functional set as built is 51 catalog
IDs — 18 Piano, 4 Performance (Master Level plus the three rotary controls) and 29 Layer
Effects (including the two latching focus buttons). The prompt's number counts only the
Piano and effect-section controls and omits Master Level, the rotary block and the focus
buttons; the specs' `scope.required` lists are what this build implements, and all of them
are covered.

The decorative contract is unchanged from Phase 1: those controls move or press, write only to the presentation store, and never touch the audio graph. `interaction.decorative-controls` still proves it with a recording engine, now with the piano and effects controls excluded from the sample set it asserts on.

## Sample provenance plan

Three recorded libraries, all bundled locally under `public/samples/` and loaded from the bundle (no network at runtime):

| Type | Library | Author | Licence | Root notes | Velocity layers |
| --- | --- | --- | --- | --- | --- |
| Grand | Salamander Grand Piano V3 (Yamaha C5) | Alexander Holm | CC BY 3.0 | every 3 semitones, A0–D#7 | 3 of the 16 source layers |
| Upright | VSCO 2 CE "Upright Piano" (Ivy Audio, Simon Dalzell) | Versilian Studios | CC0 1.0 | every 4 semitones, F1–C#7 | 3 |
| Electric | Greg Sullivan's E-Pianos — Wurlitzer EP200 and Yamaha CP80 | Greg Sullivan | CC BY 3.0 | the library's own region centres | 4 (Wurlitzer) / 3 (CP80) |

Clav, Digital and Misc are **honest synthesis** (the piano spec allows it) and are labelled as modelled in the display and in `IMPLEMENTATION_DETAILS.json`. Every recorded file, its source URL, root note and velocity layer is declared there; generated sources are never described as recordings.

Pitch shifting is limited to ±1.5 semitones by the root-note spacing, and every note picks the nearest velocity layer by MIDI velocity. A load failure of any model enters the labelled fallback (`Piano not found` per manual p. 24) and the modelled voice stays playable, so the fallback is never silent-by-accident and never reported as the primary library being ready.

## Audio graph

```text
                       ┌──────────────────────── one AudioContext ────────────────────────┐
                       │                                                                  │
  keybed / MIDI ──► NoteSession ──► LayerVoice (Piano A) ──► Piano A bus ──► chain A ─┐   │
                       │        └─► LayerVoice (Piano B) ──► Piano B bus ──► chain B ─┤   │
                       │                                                              │   │
                       │   chain X = Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Comp → Reverb│   │
                       │                          │                                   │   │
                       │                          ├──► To Rotary ──► shared Rotary ────┤   │
                       │                          │        (Rotary is always last)     │   │
                       │                          ▼                                   ▼   │
                       │                    layer level gain ──► master gain ──► limiter ──► destination
                       └──────────────────────────────────────────────────────────────────┘
```

Rules enforced by the graph, not just documented:

1. Exactly one `AudioContext` per instrument; every node is created from it.
2. Per-layer chain instances are independent (Piano A and B never share a unit), except the single shared Rotary.
3. Rotary is last: a layer routed via To Rotary leaves its own chain after Reverb and enters the shared Rotary, whose output joins the master path.
4. Reverb precedes Rotary for routed layers (global reverb is out of Phase 2 scope, so no post-rotary reverb exists).
5. Delay feedback loops through the feedback filter, so repeats get progressively filtered while the dry path stays unfiltered.
6. Nothing bypasses master gain + limiter; a bypassed unit is crossfaded, not disconnected, so toggling is click-free.
7. Every parameter change uses a short ramp (`setTargetAtTime`, 5–20 ms) rather than a step.

## Order of work

1. **This file** — Phase 2 gates, provenance plan, graph diagram, scope boundary.
2. **Refactor the Phase 1 voice into the layer/bus/master architecture** without changing input behaviour: `NoteSession` gains layer ownership but the same `press`/`release`/`setSustain`/`allNotesOff` surface, so all Phase 1 tests keep passing unchanged.
3. **Piano engine**: sample sets + manifest, model selection, two layers, performance controls, pedal routing, fallback.
4. **Effect units in signal order**, then focus/group/global routing and panel bindings.
5. **Rendered-audio tests** against a real Web Audio render (offline renderer, no device), browser pass, visual regression against Phase 1, captures, provenance.

## Test strategy for audible claims

Phase 1 proved sound by measuring a pure-JS model. Phase 2 has to prove that a *graph* processes audio, so the tests render the real graph offline:

- `node-web-audio-api` provides a real, spec-compliant `OfflineAudioContext` in Node. Tests build the production effect graph and render real samples through it, then compare RMS, spectral centroid, stereo correlation, decay tails and peak.
- The same `EffectChain` code runs in the browser and in tests; only the context implementation differs, exactly as the Phase 1 boundary already does for `AudioContextLike`.
- Assertions are tolerant relationships (A is brighter than B, wet tail outlasts dry, feedback repeats decay, bypass restores the dry signal within tolerance), never exact waveforms.

## Honesty notes for this phase

- The Program display now reports the real piano type/model per layer and the real FX focus. It still prints no bank/slot readout and no invented preset name.
- Non-recorded types (Clav, Digital, Misc) are labelled "Modelled" wherever the display names them.
- Organ/Synth/Program controls stay decorative and are listed as unsupported in `IMPLEMENTATION_DETAILS.json`.
- Soft/sostenuto pedal behaviour is not claimed; only the sustain pedal is functional, and `piano.pedals` says so.
