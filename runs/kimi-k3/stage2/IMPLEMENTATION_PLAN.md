# Phase 2 Implementation Plan — Nord Stage 4 73

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
