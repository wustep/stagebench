# Phase 2 implementation plan — Nord Stage 4 73

Phase 2 turns the **Piano** section and the **Layer Effects** section into working audio, plus
Master Level and the Rotary Speaker's speed and drive. Organ, Synth and Program stay honestly
decorative. This plan supersedes nothing in Phase 1: every Phase 1 test, control and behaviour is
carried forward.

Assigned specs (all three read in full before writing code):

- `specs/nord-stage-4.visual.json` — deck/keybed split, six section fractions, section landmarks,
  forbidden hardware, reference colours, presentation constraints. Unchanged from Phase 1; this
  phase must not move a pixel of it.
- `specs/nord-stage-4.piano.json` — two layers, six types, the recorded Grand/Upright/Electric
  sets, KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, sustain routing, and the
  truthful loading/ready/error state with a labelled playable fallback.
- `specs/nord-stage-4.effects.json` — Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb per
  layer chain plus the shared Rotary, focus/group/global routing, per-unit and all-effects
  bypass, and the documented signal order.

Variant: `stage-4-73` from `specs/nord-stage-4.variants.json` — 73 keys, E1–E7, 43 white / 30
black. Reference: `reference/nord-stage-4-73.jpg` (authoritative for layout) and
`reference/manual.pdf` pages 23–26 (piano) and 48–53 (effects).

## Phase 2 hard gates (checklist, copied verbatim from `specs/benchmark-phases.json`)

Each line below is a hard gate for this phase.

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have complete redistributable provenance.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free.

## Shared completion gates

- [x] All benchmark-owned and candidate-authored tests pass.
- [x] The browser console contains no errors during the required interaction pass.
- [x] Every claimed audio feature is connected to the audible signal graph.
- [x] The latest phase preserves all inherited tests, visual evidence, and behavior.
- [x] IMPLEMENTATION_DETAILS.json accurately distinguishes recorded samples, generated buffers, and live synthesis.
- [x] The evaluated source, build, and evidence match the sealed verification digest.

## Signal graph

One `AudioContext`, one destination connection. Both piano layers own a full chain; the Rotary is
shared and sits last, exactly as the effects spec's `signalContract` orders it.

```
                       ┌── layer A voices ──┐
 keybed / MIDI / UI ───┤                    ├─ per voice: source → tone filter → velocity gain
                       └── layer B voices ──┘                → stereo panner (unison spread)
                                                             → layer voice bus
                                                             ↘ string-resonance combs ↗

 layer voice bus → timbre stage (2 biquads)
        → Mod 1 → Mod 2 → Delay → Amp Sim/EQ or 24 dB filter → Compressor → Reverb
        → layer level fader
        ├── (normal)     → piano bus ─────────────┐
        └── (To Rotary)  → shared Rotary ─────────┤
                              horn + bass rotor   │
                                                  ▼
                                      master gain → limiter (wave shaper) → destination
```

- Every unit is `input → [dry gain | wet path] → output`, so On/bypass and dry/wet are gain ramps
  (20 ms) rather than reconnections: click-free, and provably identical to the dry path when off.
- The Delay's feedback filter is *inside* the feedback loop, so each repeat is filtered again
  while the dry path and the first tap are not (manual p. 51).
- Reverb precedes the Rotary for a routed layer; nothing bypasses the master gain and limiter.

## Sample provenance plan

Grand, Upright and Electric are **recordings**, bundled in `public/samples/` and loaded from disk
with no network at runtime. They are produced by `tools/build-samples.py` — which is the
provenance record — from these upstream releases:

| Type | Upstream | Licence |
| --- | --- | --- |
| Grand | FreePats **YDP-GrandPiano** 2016-08-04 (Zenph Studios Yamaha Disklavier Pro multisamples for OLPC) | CC BY 3.0 |
| Upright | FreePats **UprightPianoKW** 2022-02-21 (Kawai upright, recorded by Gonzalo and Roberto) | CC0 1.0 |
| Electric | **FluidR3_GM** "Rhodes" tine electric piano, Frank Wen (Debian `fluid-soundfont-gm` 3.1-6) | MIT |

The script downmixes to mono, resamples to 24 kHz through a windowed-sinc low pass, trims and
fades each note, normalises each set with a single gain, verifies each sample's pitch class by
autocorrelation, and writes `src/audio/sampleManifest.json` with the root note, velocity window,
length, upstream sample name and licence of every file. Clav, Digital and Misc are **synthesis**
and are never described as recordings; the same synthesis is the labelled fallback voice when an
asset fails to load.

## Order of work

1. This plan.
2. Extend the injectable audio boundary (`src/audio/graph.ts`) and the deterministic offline
   renderer (`src/audio/offline.ts`) with the nodes the effects need — stereo, delay lines, wave
   shapers, stereo panners, audio-rate parameter modulation and feedback loops.
3. Sample pipeline: `tools/build-samples.py`, `sampleManifest.json`, `wav.ts`, `sampleLibrary.ts`.
4. Refactor the Phase 1 voice into layer / bus / master architecture without changing input
   behaviour (`layer.ts`, `pianoEngine.ts`), keeping the Phase 1 engine API intact.
5. Piano types, two-layer state and the performance controls.
6. The six effect units in signal order, then the shared Rotary, then focus / group / global
   routing and the panel bindings.
7. Rendered-audio tests for every claim, browser pass, visual regression against Phase 1,
   captures and provenance.

## Honesty contract commitments

- `data-functional` on every control now reports the truth per control, from one declared list
  (`FUNCTIONAL_CONTROL_IDS` in `src/model/controls.ts`). Organ, Synth and Program remain `false`
  in their entirety, and a test asserts both directions.
- Deliberately still decorative, and listed as unsupported: `fx.delay.effects` (the delay
  feedback-loop effects are spec-excluded), `fx.focus.organ` / `fx.focus.synth` (no engine until
  Phase 3), `perf.rotary.source` and `perf.rotary.stop-mode` (organ routing, close mic, stop
  angle), the PSTICK indicator and the pitch stick (no section is bent yet), the mod wheel, and
  the Comp FAST indicator (this panel has no button for it).
- The Program display shows the focused layer, its model name and whether that sound is a
  recording, the fallback, or synthesis. It never reports a feature as working.
- `IMPLEMENTATION_DETAILS.json` lists every bundled file's licence and says exactly which types
  are recordings, which are synthesis, and what the one generated buffer (the hammer transient)
  is.
