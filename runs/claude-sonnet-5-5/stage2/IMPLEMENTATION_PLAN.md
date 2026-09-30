# Implementation plan — Phase 2 (Stage 4 73): piano library and working effects

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json` and `specs/nord-stage-4.effects.json`
(variant entry `stage-4-73` in `specs/nord-stage-4.variants.json`, reference `reference/nord-stage-4-73.jpg`, manual pp. 23–26 and 48–53).
Phase 2 contract: `specs/benchmark-phases.json`, phase 2. Phase 1 (surface, keybed, inputs) is inherited unchanged and must not regress.

## Phase 2 hard gates (checklist)

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
  - Evidence: Salamander Grand V3 (CC BY 3.0), Upright Piano KW (CC0), Wurlitzer EP200 and Hohner Pianet T (CC BY 3.0): 236 Ogg files, 7 MB. Every file, root note, velocity layer and license is in `IMPLEMENTATION_DETAILS.json`, checked against the manifest and the files by `src/audio/library.test.ts`.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
  - Evidence: `src/audio/rendered.piano.test.ts` and `rendered.effects.test.ts` render the real engine on node-web-audio-api; `src/engine/panelBindings.test.ts` and `src/app.phase2.test.tsx` check the panel.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
  - Evidence: `src/audio/rendered.effects.test.ts`.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
  - Evidence: `src/audio/graph.test.ts`.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.
  - Evidence: all Phase 1 tests are present and green; 0.16 % of instrument pixels differ from the Phase 1 capture, none in the keybed, Organ or Synth (`evidence/stage2-visual-regression.json`).

Feature ids added to `tests/feature-matrix.json`: `piano.instrument-library`, `piano.layers`, `piano.velocity-controls`, `piano.pedals`, `piano.fallback`, `effects.graph`, `effects.routing`, `effects.processing`, `regression.phase1`.

## Scope

In: Piano section (6 types, models, 2 layers with enable/focus/level/octave/SUSTPED/PSTICK, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, sustain from UI/keyboard/MIDI CC64, labelled fallback), Layer Effects for Piano A and B (Mod 1, Mod 2, Delay, Amp/EQ, Compressor, Reverb + shared Rotary through To Rotary, focus, group, global, bypass), Master Level, pitch stick (needed by PSTICK).

Still decorative (move/light, annotated `aria-description`): Organ, Synth, Program controls, mod wheel, KB ZONE, AUX KB, SOLO, INFO/LIST, rotary ORGAN/STOP MODE/CLOSE MIC. Spec-excluded (unsupported, same treatment): pedal noise/half-pedaling, Triple Pedal, size classes, preset library, per-type Variations, Reverb Chorale, Delay feedback-loop effects and Analog, Mod 1 pedal modes, rotary close mic/stop angle.

## Sample provenance plan

| Type | Model | Source | License | Contents used |
| --- | --- | --- | --- | --- |
| Grand | Salamander Grand | Alexander Holm, Salamander Grand Piano V3 (archive.org; sfzinstruments mirror) | CC BY 3.0 | 30 roots (every minor third, A0–C8) × velocity layers v3, v8, v13 of 16 |
| Upright | Upright KW | FreePats "Upright Piano KW" 2022-02-21 (Kawai, Zoom H1) | CC0 1.0 | its 2 velocity layers, 30–36 roots each |
| Electric | Wurlitzer EP200 | Greg Sullivan (sfz mapping by kinwie) | CC BY 3.0 | 4 velocity layers (pp/mp/f/ff), 10–13 roots each |
| Electric | Hohner Pianet T | Greg Sullivan (sfz mapping by kinwie) | CC BY 3.0 | 2 velocity layers (P/FF), 16–17 roots each |
| Clav ×4, Digital ×2, Misc ×2 | — | — | original code | live synthesis (never described as recordings) |

`scripts/build-samples.py` downloads the sources, picks notes/layers, mixes to mono, trims tails (7 s, faded), encodes Ogg Vorbis (no looping, no pitch shifting inside files) and writes `public/samples/**` and `src/audio/library/manifest.json`; `scripts/write-details.mjs` regenerates `IMPLEMENTATION_DETAILS.json` from the manifest. Attribution strings live in the manifest and the details file.
Loudness: every sample is levelled by its measured RMS to one velocity law (`params.targetRms`), so layers/models join seamlessly and the velocity layer supplies only timbre.

## Architecture

```
                         canonical state (src/engine/state.ts, pure reducers)
                          ▲ edits                              │ subscribe
   hardware store ── panelBindings ──► EngineStore ────────────┼──────────────► panel LEDs / knobs / OLED (syncPanel)
   (presentation)     press · hold · Shift · tap tempo          ▼
                                                     WebAudioPianoSink.syncState ──► MasterGraph.apply (20 ms ramps)

   NoteLifecycle (Phase 1, now with a LayerRouter: one voice per enabled layer, per-layer SUSTPED)
        │ start(id, note, velocity, {layer, transpose, pedal})
        ▼
   WebAudioPianoSink ── recorded sample voice │ live-synthesis voice │ labelled fallback (generated buffers → oscillator)
        │ voice = sources → envelope gain
        ▼
 ONE AudioContext
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ layer A bus ─► timbre EQ ─► Mod 1 ─► Mod 2 ─► Delay ─► Amp Sim/EQ ─► Compressor ─► Reverb ─► layer level ─┬─► to master ─┐
 │ layer B bus ─► timbre EQ ─► Mod 1 ─► Mod 2 ─► Delay ─► Amp Sim/EQ ─► Compressor ─► Reverb ─► layer level ─┤              │
 │                                                                                    "To Rotary" layers ─► shared Rotary ─┤ (lazily built)
 │                                                                                                          master gain ◄─┘
 │ master gain ─► soft clip ─► limiter (DynamicsCompressor, only feeder) ─► destination                                   │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 Delay: input ─► dry ─► out ; input ─► delay ─┬─► wet ─► out ; delay ─► feedback filter (Off/LP/HP/BP) ─► feedback gain ─► delay
```

- `src/audio/library/*` catalog of six types / models; `SampleLibrary` fetches + decodes on demand (middle velocity layer first), reports loading/ready/error truthfully.
- `src/audio/voices.ts` sample, synth, generated-fallback and oscillator voices; unison (detuned pair, panned), pitch-stick detune, string-resonance grains.
- `src/audio/effects/*` `ModUnit` (6+6 types, crossfaded branches), `DelayUnit`, `AmpEqUnit`, `CompressorUnit`, `ReverbUnit` (generated IRs, two convolvers crossfading), `RotaryUnit`; every unit bypasses by dry/wet crossfade and every parameter moves by a 20 ms ramp.
- `src/engine/panelBindings.ts` maps the existing decorative control ids onto the canonical state; anything unbound stays Phase 1 presentation state and is annotated.
- Layer buttons (manual p. 23): tap = focus/switch, hold 0.5 s = off, both together or Shift+press = add. Effects focus follows layer focus; FX FOCUS button swaps A/B, Shift or long press = group; Global tags or Shift+ON.
- Documented deviation: layer level is applied before the shared Rotary (one rotary instance must be fed by level-scaled layers).

## Order of work (done)

1. Plan, provenance, sample build script and library.
2. Refactor the Phase 1 voice into layer/bus/master; `NoteLifecycle` gets a router (Phase 1 tests keep passing).
3. Piano types, two-layer state, performance controls, panel bindings.
4. Effect units in signal order, focus/group/global routing and panel bindings.
5. Rendered-audio tests, browser pass (real Chrome: samples decode, analyser taps measure output), visual regression against Phase 1, captures, provenance.

## Evidence

- `tests/feature-matrix.json` (all Phase 1 + Phase 2 ids), `IMPLEMENTATION_DETAILS.json` (generated by `scripts/write-details.mjs`).
- `evidence/stage2-desktop.png`, `stage2-narrow.png`, `stage2-capture.json` (`scripts/capture2.mjs`), `stage2-piano-zoom.png`, `stage2-effects-zoom.png`, `stage2-visual-regression.json` + diff images (`scripts/visual-regression.py`), `stage2-visual-audit.md`.

## Regression notes (Phase 1 tests adapted, none removed)

Five Phase 1 assertions depended on Phase 1 internals that Phase 2 legitimately changed, and were updated with their intent kept:
`app.test.tsx` OLED test (READY now means the recordings are decoded, which is asynchronous), `instrument.test.ts`: fallback test (the recorded-set failure is known after decoding; a plain oscillator still appears when buffers are impossible), node-count baseline (measured on the persistent graph instead of the constant 2), release-ramp test (finds the voice envelope through the source), and `evidence.test.ts` (Phase 2 details). Everything else passes unmodified.

## Known gaps

Soft/sostenuto pedals, Master Clock sync, Rotary stop mode, mod wheel, per-type Variations and other spec-excluded items are not implemented; Wurlitzer's softest layer has sparse roots (≤ ±6 semitones of shifting); String Res is simulated; amp models are approximations; the real Nord signal path is only approximated where documented in `IMPLEMENTATION_DETAILS.json`.
