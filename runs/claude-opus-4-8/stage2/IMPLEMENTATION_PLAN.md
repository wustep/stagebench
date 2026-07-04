# Phase 2 Implementation Plan — Nord Stage 4 (variant stage-4-73)

Assigned specs: `specs/nord-stage-4.visual.json`, `specs/nord-stage-4.piano.json`, and `specs/nord-stage-4.effects.json`.

Phase 2 brings exactly two sections to life on top of the sealed Phase 1 artifact — **Piano** and **Layer Effects** — plus the **Master Level** knob. Organ, Synth, and Program keep their honest Phase 1 decorative behavior. This document lists the Phase 2 hard gates verbatim, the sample-provenance plan, and the single-AudioContext signal graph.

## Hard gates (from `specs/benchmark-phases.json` Phase 2)

Each of the following is a Phase 2 hard gate and is satisfied by this implementation:

- Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- Each effect unit and type processes real audio with working bypass and dry/wet.
- One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- The Phase 1 surface, keybed, and input behavior remain regression-free.

Each hard gate above maps to rendered-audio tests that assert on real Web Audio signals (analyser / OfflineAudioContext render), never mocks.

## Package gates

- `pnpm test` (vitest) — Phase-1 tests preserved + Phase-2 rendered-audio tests (instrument distinctions, control changes, pedal behavior, layer ownership, effect processing/bypass/order, single context, cleanup).
- `pnpm typecheck` — zero errors.
- `pnpm lint` — zero errors.
- `pnpm build` — produces `dist/` with the bundled `samples/` present for offline play.

## Sample provenance plan

Grand, Upright, and Electric are RECORDED, multi-sampled, bundled, redistributable sets. They are fetched reproducibly by `scripts/fetch-samples.mjs` from the pre-rendered `gleitz/midi-js-soundfonts` project (FluidR3_GM SoundFont) and committed under `public/samples/`, so the built app plays fully offline with no network.

- Source project: gleitz/midi-js-soundfonts (`https://github.com/gleitz/midi-js-soundfonts`), MIT project code.
- SoundFont: FluidR3_GM by Frank Wen — license Creative Commons Attribution 3.0 (CC-BY 3.0).
- Bundled instruments (each a distinct FluidR3_GM program):
  - `grand/`    <- `acoustic_grand_piano` (recorded acoustic grand)
  - `upright/`  <- `honkytonk_piano` (recorded upright / tack piano, audibly distinct from the grand)
  - `electric/` <- `electric_piano_1` (recorded Rhodes-style tine electric piano)
- Sample density: 30 recorded root notes per set, spaced a minor third apart across A0–C8, so at playback no note is pitch-shifted more than ~1 semitone (no obvious stretching). Every file, root note, license, and attribution is declared in `IMPLEMENTATION_DETAILS.json` under `sampleSources` and echoed in each `public/samples/<set>/manifest.json` and `public/samples/LICENSE.txt`.
- Clav, Digital, and Misc are HONEST SYNTHESIS (declared under `generatedSources`), never described as recordings; if a sample set fails to load the type flashes and a labeled synthesized fallback stays playable.

## Signal graph (one AudioContext)

```
                        one AudioContext
  ┌───────────────────────────────────────────────────────────────────────┐
  │  Piano Layer A voices ─┐                                                │
  │  Piano Layer B voices ─┤ (each voice = sampler buffer OR synth osc)     │
  │                        ▼                                                │
  │            Layer bus (A) ─▶ Mod1 ─▶ Mod2 ─▶ Delay ─▶ Amp Sim/EQ         │
  │                              ▶ Compressor ─▶ Reverb ─▶ Layer level (A) ─┐│
  │            Layer bus (B) ─▶ Mod1 ─▶ Mod2 ─▶ Delay ─▶ Amp Sim/EQ         ││
  │                              ▶ Compressor ─▶ Reverb ─▶ Layer level (B) ─┤│
  │                                                                        ││
  │   (Amp model "To Rotary" reroutes a layer's post-Reverb signal into    ││
  │    the shared Rotary — reverb always precedes rotary)                   ││
  │                                    shared Rotary ──────────────────────┤│
  │                                                                        ▼▼
  │                                              Master gain ─▶ Limiter ─▶ destination
  └───────────────────────────────────────────────────────────────────────┘
```

Documented signal order (effects spec `signalContract.requiredOrder`): Layer source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ (or Filter) → Compressor → Reverb → Rotary when routed → Layer level → Master gain/limiter → Destination. Delay feedback filtering sits INSIDE the feedback loop so each repeat is progressively filtered. Parameter changes use short (~20 ms) ramps to stay click-free; every node is disconnected on release and the context is closed on teardown.

## Architecture

- `src/audio/audioEngine.ts` — the single-context engine: two Piano layer chains, the shared rotary, master gain + limiter, voice allocation/stealing, sustain with per-layer SUSTPED gating, focus/group/global effect targeting.
- `src/audio/effects.ts` — real Web Audio effect units (Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb, Rotary) with per-unit bypass and dry/wet.
- `src/audio/sampler.ts` — sampled voices (nearest-root playback-rate pitch, ≤1 semitone shift) + honest synth voices, plus the offline sample loader.
- `src/audio/instruments.ts` — the six-type registry (sampled vs synth) and timbre lists.
- `src/audio/controlBindings.ts` — maps panel control state to real audio (Piano, Layer Effects, Master); Organ/Synth/Program controls are intentionally NOT bound (stay decorative).
- `src/hooks/useAudioEngine.ts` — owns the one AudioContext (built in the mount effect, closed on teardown), loads the library, re-syncs the engine from the ControlStore.

## Honesty contract

Grand/Upright/Electric play RECORDED samples; Clav/Digital/Misc play HONEST SYNTHESIS; both are declared truthfully in `IMPLEMENTATION_DETAILS.json`. Organ, Synth, and Program controls remain decorative and are listed as such — no decorative control fakes audio or system state. If samples fail to load the app enters a labeled, still-playable synthesized fallback and never reports recordings it does not have.
