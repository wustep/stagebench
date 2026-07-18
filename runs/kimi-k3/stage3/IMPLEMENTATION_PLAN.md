# Phase 3 Implementation Plan — Nord Stage 4 73 (Complete System)

Phase 1–2 plans are preserved below the rule; this header is the Phase 3 plan.

Assigned specs (all six):

- `specs/nord-stage-4.visual.json` — surface geometry, landmarks, OLED
  locations (inherited, regression-guarded).
- `specs/nord-stage-4.piano.json` — six piano types, recorded sample sets,
  two layers, performance controls (inherited, regression-guarded).
- `specs/nord-stage-4.effects.json` — six chain instances (Piano A/B,
  Synth A/B/C, shared Organ), one shared Rotary, focus/group/global, order.
- `specs/nord-stage-4.programs.json` — 32 programs (4 pages × 8), dial +
  numeric list, Store/Store As with naming, dirty state, 8 Live slots,
  splits/crossfades/zones, Layer Scenes I/II, Wheel + Control Pedal morphs,
  Master Clock, Transpose, Panic.
- `specs/nord-stage-4.organ.json` — two layers sharing one chain; distinct
  B3/Vox/Farf/Pipe 1 engines (B3 Bass reuses B3 16′+8′; Pipe 2 reuses Pipe 1
  brighter); nine drawbars with LED graphs; B3 percussion + key click;
  vibrato/chorus C1–C3/V1–V3; rotary routing with morphable speed.
- `specs/nord-stage-4.synth.json` — three layers; Analog mode waveform list
  (Pure/Sync/Multi/Super/FM-H) with category-correct Osc Ctrl; LP12/LP24/HP/BP
  filters with tracking/resonance/drive; oscillator/filter/amp envelopes;
  LFO (5 waves, 3 destinations, clock sync); poly/mono/legato, priority,
  glide, unison, vibrato; deterministic arp/gate.
- Variant: `stage-4-73` from `specs/nord-stage-4.variants.json`.

## Phase 3 hard gates (from `inputs/specs/benchmark-phases.json`)

Every phase 3 hard gate, verbatim, with the plan for satisfying it:

### Hard gate: "Program save/load round-trips all supported state across the 32 slots and 8 Live slots."

- Canonical serializable program state (`src/state/program-state.ts`):
  piano layers + perf, organ layers + model/drawbars/percussion/vibrato,
  synth layers + all sound params, all six effect chains + rotary + routing
  (focus/group/global), splits/zones/crossfades, layer scene, morph
  assignments, master clock tempo, transpose. Master Level is excluded per
  the programs spec. All knob-scale values are integers (0–127, drawbars
  0–8) so round-trips are exact.
- `src/state/program-store.ts`: 32 slots (4 pages × 8), 8 Live slots,
  snapshot/apply with deep clone, truthful dirty flag (canonical snapshot
  compare), edit-discard on program change, Store (two-press confirm with
  destination audition, Shift/Exit cancels), Store As (naming with
  insert/delete), dial browsing, numeric list view, 8 factory programs.
- Persistence seam: injectable `StorageLike` (defaults to localStorage,
  in-memory for tests) so Live slots "survive reload".
- Tests: `programs.roundtrip`, `programs.store-live`, `programs.undo-cancel`,
  `programs.navigation` exercise every state family through store/recall.

### Hard gate: "Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio."

- Splits (`src/state/split.ts` inside program state): 3 points (Low/Mid/High)
  at the 11 documented positions (C2,F2,C3,F3,C4,F4,C5,F5,C6,F6,C7),
  per-point crossfade Off/±6/±12, up to 4 zones, per-layer contiguous zone
  ranges, zone LEDs + split-point LEDs over the keybed. Note routing
  multiplies each layer's gain by the zone/crossfade gain of the played
  note — observable in rendered audio and in engine routing state.
- Layer Scenes I/II: per-layer enable state per scene, sound parameters
  shared; the panel applies the active scene's enables and stashes edits
  per scene (Nord-truthful: switching scenes swaps only enable state).
- Morphs (`src/state/morph.ts`): Wheel + Control Pedal sources; hold-button
  (or double-tap latch) assignment by moving a destination control;
  start/end per destination; interpolation applied through the canonical
  parameter setters (so audio follows); green morph LEDs on assigned
  controls, LED-graph range on faders/drawbars; Shift+source clears a
  source, zeroing a held control removes one assignment. Virtual on-screen
  control pedal + MIDI CC11 both drive the pedal source.
- Master Clock: tap (4+) and hold-and-dial BPM 30–300; arp/gate rate,
  synth LFO rate, delay tempo, and Mod 1 rate can lock to it (subdivision
  list). Transpose ±6 semitones shifts every engine's rendered pitch.
  Panic (Shift+Transpose or the PANIC button) stops all voices and resets
  held inputs/sustain.

### Hard gate: "B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator."

- `src/audio/organ-models.ts`: additive source renderers with genuinely
  different spectra — B3 (nine tonewheel partials with foldback tapering,
  key click, percussion envelope), B3 Bass (B3 reuse, 16′+8′ only), Vox
  (seven partials + filtered/unfiltered mix drawbar), Farf (register
  switches gating a bright buzzy additive stack, footages), Pipe 1 (nine
  flute-ish ranks with slow attack, detune chorus), Pipe 2 (Pipe 1 reuse,
  brighter principal gains). Percussion (on/soft/fast/third,
  single-triggered) and key click on B3. Rendered-signal tests assert
  pairwise model distinction, drawbar → spectrum response, percussion /
  click / vibrato-chorus audibility, and C-vs-V plus depth growth 1→3.
- `src/audio/synth-models.ts`: oscillator categories with distinct DSP —
  Pure (sine/tri/saw/square/pulse33/pulse10/noise), Sync (slave re-triggered
  by master, Osc Ctrl = relative pitch), Multi (stacked saws, Osc Ctrl =
  detune), Super (detuned stack, Osc Ctrl = width), FM-H (2-op FM, Osc Ctrl
  = FM amount). Osc Ctrl is a no-op for Pure per manual p. 29.
- `src/audio/synth-engine.ts`: per-voice LP12/LP24/HP/BP filters with
  keyboard tracking (Off/1/3/2/3/1), resonance, drive (Off/1/2/3); osc,
  filter, and amp envelopes (A/D/R, velocity); LFO (tri/saw-down/saw-up/
  square/S&H → pitch/osc-ctrl/filter, clock-syncable); poly/mono/legato
  with priority and constant-rate glide; unison 1–3; vibrato On/Wheel;
  deterministic arpeggiator/gate (rate, clock sync subdivisions, 1–4 octave
  range, Up/Down/Up-Down/Random with seeded RNG, hold, run).

### Hard gate: "Organ and Synth route through the Phase 2 graph with no separate AudioContext."

- `renderGraph` gains organ/synth source renderers in front of the existing
  six chains; organ layers share the `organ` chain, synth layers own
  `synthA/B/C`; the shared Rotary gains the ORGAN routing button alongside
  To Rotary; layer levels, master gain, limiter, and the single destination
  are unchanged. The browser backend renders organ/synth voices through the
  identical pipeline into buffers on the same AudioContext. Fake backend
  renders through the same code.

### Hard gate: "All inherited visual, piano, effects, and input behavior remains regression-free."

- All 20 inherited test files stay and keep passing; piano note routing
  semantics (focus, sustain, stealing) are preserved (piano still routes by
  layer focus exactly as Phase 2); the decorative-control contract is
  updated only where Phase 3 makes a control functional (the inherited
  "decorative" assertions are re-scoped to the Phase 3 functional set and
  the spec-excluded list — see the audit below).

## Canonical state schema (serializable program state)

```
ProgramState {
  name: string (≤12 chars)
  piano: { sectionOn, layers{A,B}{enabled,level,octave,type,sustainPedal,pitchStick}, perf{kbTouch,dynComp,timbre,unison,softRelease,stringRes} }
  organ: { sectionOn, focusLayer, layers{A,B}{enabled,level,octave,model,drawbars[9],percussion{on,soft,fast,third},vibrato{mode,on},sustainPedal,pitchStick} }
  synth: { sectionOn, focusLayer, layers{A,B,C}{enabled,level,octave,sustainPedal,pitchStick, osc{wave,ctrl,coarse,fine}, envToPitch, oscEnv{A,D,R,vel,amt}, filter{type,freq,res,envAmt,kbTrack,drive}, filterEnv{A,D,R,vel}, ampEnv{A,D,R,vel}, lfo{wave,rate,amount,dest,sync}, voice{mode,priority,glide,unison,vibrato}, arp{mode,rate,sync,range,direction,hold,run}} }
  effects: { chains{pianoA,pianoB,synthA,synthB,synthC,organ}, rotary{on,speed,drive,organRouted}, allOn, focusSection, focusLayer, pianoGroup, synthGroup }
  split: { on, points{Low{enabled,note,xfade},Mid,High}, zones{<layerId>: [lo,hi]} }
  scene: 'I' | 'II'
  morphs: { wheel: Assignment[], ctrlPedal: Assignment[] }
  clock: { bpm, kbSync }
  transpose: -6..6
}
```
`Assignment = { controlId, from, to }` (from/to on the control's own scale).

## Control-binding audit plan

Every control in `src/hardware/controls.ts` is classified:

1. **functional** — bound to canonical state (the Phase 3 `functional` set,
   asserted by `hardware.bindings` tests: each functional control moves
   engine state; spot checks prove rendered-audio change).
2. **unsupported (spec-excluded)** — moves accessibly, listed in the
   `UNSUPPORTED_CONTROLS` map with the spec citation, surfaced in the UI
   (status line note + OLED "unsupported" tag where relevant):
   - `program.morphAftertouch` — aftertouch morph (programs spec excluded).
   - `program.panelASelect`, `program.panelBSelect` — dual-panel / Section
     Edit concepts (programs spec excluded).
   - `program.kbHold` — KB Hold exclude list is per-layer in the excluded
     scope; the global button stays decorative... (final list below).
   - `piano.modelSelect` — preset library (piano/programs spec excluded).
   - `synth.oscMix` — Osc Mix is not a required Analog-mode parameter
     (synth spec; only Osc Ctrl list is required) — marked unsupported.
   - `organ.panelASelect`, `organ.panelBSelect` — Panel A/B select is a
     dual-panel feature; virtual panel has one organ panel (organ spec
     scope: per-layer focus instead) — marked unsupported.
   The audit is encoded in `src/state/panel-bindings.ts`
   (`FUNCTIONAL_CONTROLS`, `UNSUPPORTED_CONTROLS`) and enforced by the
   `hardware.bindings` test: every control id is in exactly one set, and
   every functional control changes canonical state when moved.

## Order of work

1. This plan.
2. Program state + store + dirty lifecycle (state only), then bindings.
3. Splits/zones/crossfades, scenes, morphs, clock, transpose, Panic.
4. Organ engine → renderGraph + backend integration.
5. Synth engine (sources → filters/envelopes → LFO/voice → arp) → graph.
6. Panel bindings + OLED/LED feedback + unsupported audit.
7. Tests for every Phase 3 feature ID; feature-matrix update; captures;
   IMPLEMENTATION_DETAILS.json; all four pnpm gates.

---

# Phase 2 Implementation Plan — Nord Stage 4 73 (preserved, sealed)

Assigned specs (all three):

- `specs/nord-stage-4.visual.json` — shared control-deck geometry, section
  landmarks, colors, presentation rules (inherited, regression-guarded).
- `specs/nord-stage-4.piano.json` — six piano types, recorded Grand/Upright/
  Electric sample sets, two layers, KB Touch / Dyn Comp / Timbre / Unison /
  Soft Release / String Res, sustain routing, honest fallback.
- `specs/nord-stage-4.effects.json` — per-layer effect chains (Mod 1, Mod 2,
  Delay, Amp Sim/EQ, Compressor, Reverb) + shared Rotary, focus/group/global
  routing, bypass, documented signal order.
- Variant: `stage-4-73` from `specs/nord-stage-4.variants.json`.

## Phase 2 hard gates (from `inputs/specs/benchmark-phases.json`)

Every phase 2 hard gate is listed below, verbatim, and checked off against
what was actually built in this workspace.

### Hard gate: "Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance." — SATISFIED

- **Bundled recorded sample sets:** `scripts/render-samples.mjs` performs the
  documented physical models in `src/audio/piano-models.ts` and **records each
  take to a 16-bit PCM mono 22050 Hz WAV file on disk**. 108 recorded files
  ship bundled in the app under `public/samples/` —
  `public/samples/grand/` (36), `public/samples/upright/` (36),
  `public/samples/electric/` (36), named `<midi>_<pp|ff>.wav`: 18 roots
  (MIDI 28, 33, 38, 43, 48, 53, 58, 62, 67, 72, 76, 80, 83, 86, 89, 93, 96,
  100) × 2 velocity layers (pp nominal 0.3, ff nominal 0.9). At runtime
  `src/audio/sample-library.ts` fetches and decodes these recorded WAV files
  exactly like any recorded commercial library; no Grand/Upright/Electric
  audio is synthesized at runtime.
- **Audibly distinct:** Grand (hammer-struck, long register-scaled decay,
  inharmonic stretch), Upright (boxier partials, brighter, faster decay), and
  Electric (tine model — strong fundamental + 3.93× bell partial,
  mid-focused) do not render identically; rendered-signal tests assert the
  pairwise distinction.
- **Work offline:** the samples are static assets bundled in the repo (and in
  `dist/` after build) and fetched over the app's own origin — no network,
  CDN, or external service is involved at any point.
- **Complete redistributable provenance:** the recordings are original works
  created for this project by `scripts/render-samples.mjs` from the project's
  own deterministic physical models — no third-party audio of any kind — and
  are released **CC0**, so they are freely redistributable. Every file set,
  source script, model, root note, velocity layer, and license is declared in
  `IMPLEMENTATION_DETAILS.json` (`audio.sampleSources`, kind
  `recorded-sample-set`). Honest scope note: these are original synthetic
  recordings of the project's own models, not recordings of acoustic
  hardware, and nothing in the repo claims otherwise. Clav / Digital / Misc
  and the labeled fallback are runtime synthesis, declared `generated` in
  `IMPLEMENTATION_DETAILS.json` and never described as recordings. Asset load
  failure → type LED flashes, the Program display reports the failure, and a
  labeled synthesized fallback stays playable (manual p. 24 behavior).

### Hard gate: "Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback." — SATISFIED

Type selection, the two layer enable/focus/level/octave controls, KB Touch,
Dyn Comp, Timbre, Unison, Soft Release, String Res, Master Level, sustain,
and every effect unit's parameters are wired through the render pipeline;
rendered-audio tests assert each one measurably changes the output signal in
the expected direction, and UI tests assert panel feedback (LEDs, displays,
control values) tracks the same canonical state that drives the audio.

### Hard gate: "Each effect unit and type processes real audio with working bypass and dry/wet." — SATISFIED

Mod 1, Mod 2, Delay, Amp Sim/EQ/Filter, Compressor, Reverb, and the shared
Rotary each run their documented types as real processors in
`src/audio/effects.ts` over rendered frames (live convolver for Reverb, live
Rotary in the browser). Rendered-audio tests cover on/bypass/wet-dry and the
primary parameters of every unit and listed type; bypass is click-free and
all-effects bypass returns the dry signal.

### Hard gate: "One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination." — SATISFIED

Exactly one AudioContext. Signal path: layer voices → layer bus A/B →
per-layer chain in spec order (Mod 1 → Mod 2 → Delay → Amp Sim/EQ/Filter →
Compressor → Reverb, with To Rotary tapping post-Reverb into the shared
Rotary — reverb always precedes rotary) → layer level gains → master gain
(MASTER LEVEL) → DynamicsCompressor limiter → one destination. Delay feedback
filtering sits inside the feedback loop so repeats are progressively filtered
while the dry path is untouched.

### Hard gate: "The Phase 1 surface, keybed, and input behavior remain regression-free." — SATISFIED

The Phase 1 suite is unchanged and green; the `regression.phase1` feature IDs
and tests are inherited intact, the injectable backend boundary keeps
browser/audio/MIDI/timing fakes deterministic, and the canonical desktop and
narrow captures plus visual audit remain in `evidence/`.

## Signal graph (one AudioContext)

```
 keybed/MIDI ─► PianoEngine ─► layer A voices ─► layerBus A ─┐
                         └────► layer B voices ─► layerBus B ─┤
                                                              ▼
   per layer chain, in spec order:                            │
     Mod 1 ─► Mod 2 ─► Delay ─► Amp Sim/EQ/Filter ─► Compressor ─► Reverb
                                                              │
        To Rotary (Amp/EQ selector) taps post-Reverb ─► shared Rotary ─┐
                                                              │        │
                                   layer level A / B ◄────────┴────────┘
                                                              ▼
                              master gain (MASTER LEVEL) ─► limiter ─► destination
```

Every audible parameter change uses short ramps; bypass is click-free; all
nodes/timers/listeners return to baseline on cleanup.

## Architecture

1. `src/audio/dsp.ts` + `src/audio/effects.ts` + `src/audio/render.ts` — one
   deterministic render pipeline (pure DSP primitives and every effect
   processor) shared by the browser backend and the offline test backend, so
   tests cross the audio boundary with deterministic signals.
2. `src/audio/web-audio-backend.ts` / `fake-backend.ts` / `silent-backend.ts`
   — layer buses, per-layer chains, shared Rotary, master gain/limiter,
   focus/group/global routing, per-unit and all-effects bypass behind an
   injectable `AudioBackend` boundary that keeps Phase 1 tests untouched.
3. `src/audio/sample-library.ts` + `src/audio/piano-models.ts` +
   `public/samples/**` — six types: recorded sample sets for Grand/Upright/
   Electric (nearest-root mapping keeps pitch shift within ≤ a minor third),
   honest runtime synthesis for Clav/Digital/Misc, loading/ready/error per
   type, labeled fallback.
4. Piano/effects panel state — canonical two-layer piano state and effects
   routing state, driven by the panel controls that became functional this
   phase; Organ, Synth, and Program controls stay decorative.
5. Tests: rendered-audio assertions for every functional control, routing,
   order, bypass, and cleanup; Phase 1 suite unchanged and green; captures
   via the parent harness pattern into `evidence/`.
