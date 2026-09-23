# Phase 2 implementation plan — Nord Stage 4 73

Run: `claude-opus-5-5` · Variant: **Stage 4 73** (`stage-4-73`, 73 keys E1–E7, hammer action)

Assigned specs (all three read in full):

- `specs/nord-stage-4.visual.json` — surface geometry; Phase 2 must not regress the Phase 1 surface.
- `specs/nord-stage-4.piano.json` — `scope.required`: two layers, six types, recorded Grand/Upright/Electric, KB Touch,
  Dyn Comp, Timbre, Unison, Soft Release, String Res, sustain (UI, keyboard, MIDI CC64), truthful status + labelled fallback.
- `specs/nord-stage-4.effects.json` — `scope.required`: six units per piano layer chain + shared Rotary, every listed type,
  focus/group/global, per-unit and all-effects bypass, documented signal order.

Also read: `specs/benchmark-phases.json` (Phase 2 contract), `prompts/stage2.md`, `TASK.md`, `reference/manual.pdf`
pp. 23–26 (piano) and 48–53 (effects), and the inherited Phase 1 source, tests and evidence.

## Phase 2 hard gates (from `specs/benchmark-phases.json`)

- [x] Grand, Upright, and Electric are bundled recorded sample sets that are audibly distinct, work offline, and have
      complete redistributable provenance. — `public/samples/*.nspk` + `public/samples/licenses/`, zone-level provenance in
      `IMPLEMENTATION_DETAILS.json`; `pianoLibrary.test.ts`.
- [x] Every functional piano and effect control measurably changes rendered audio and agrees with its panel feedback. —
      `pianoLibrary.test.ts`, `effects.test.ts`, `panelPhase2.test.tsx`.
- [x] Each effect unit and type processes real audio with working bypass and dry/wet. — `effects.test.ts`, `stageGraph.test.ts`.
- [x] One AudioContext feeds layer buses, ordered effects, master gain/limiter, and one destination. — `stageGraph.test.ts`.
- [x] The Phase 1 surface, keybed, and input behavior remain regression-free. — all six Phase 1 test files kept and green;
      browser pass in `evidence/stage2-visual-audit.md`.

Shared completion gates: all tests pass; no console errors in the browser pass; every claimed audio feature is on the
audible graph; `IMPLEMENTATION_DETAILS.json` separates recorded samples, generated buffers and live processing.

## Signal graph (one `AudioContext`)

```
pointer / touch / computer keys / MIDI ──► LayeredEngine ──┬─► NoteEngine A ─► voices A ─┐
  (one shared input lifecycle)            (octave, SUSTPED)└─► NoteEngine B ─► voices B ─┤
                                                                                         │ per layer:
 voice = BufferSource ×unison → StereoPanner → gain → velocity LPF → envelope gain ──────┘
   layer bus → Timbre EQ (low shelf / peak / high shelf) ─┬───────────────────────────► chain input
                                                          └► String Res comb bank ─────► chain input
   chain: Mod 1 → Mod 2 → Delay (filter inside the feedback loop) → Amp Sim/EQ → Compressor → Reverb
        → layer level ─┬► direct ─────────────────────────────┐
                       └► To Rotary ─► shared Rotary (drive, horn + rotor) ─┤
                                                               master gain (Master Level)
                                                               → limiter (DynamicsCompressor)
                                                               → ceiling (WaveShaper, ≤ 0 dBFS)
                                                               → destination (the only one)
```

Deviation, documented: the effects spec lists "Rotary when routed" before "Layer level". Because the Rotary is one
shared instance for both layers, each layer's level gain sits just before the direct/To-Rotary split (so Reverb still
precedes Rotary, and nothing bypasses master). For the linear part of the path this is equivalent; it only changes
how hard a quiet layer drives the rotary's saturation.

## Sample provenance plan (done)

| Model | Pack | Source / license | Roots · velocity layers |
| --- | --- | --- | --- |
| Salamander Grand | `grand.nspk` | Salamander Grand Piano V3 (Alexander Holm), CC BY 3.0 | 30 roots (every 3 st, A0–C8) · 3 |
| Upright KW | `upright.nspk` | FreePats Upright Piano KW, CC0 1.0 | 33 roots · 2 |
| Wurlitzer EP200 | `electric.nspk` | Greg Sullivan E-Pianos (sfzinstruments), CC BY 3.0 | 20 roots (33–92) · 4 |
| Rhodes (jRhodes3), 2nd Electric model | `electric-rhodes.nspk` | Discord SFZ GM Bank jRhodes3 subset, CC0 1.0 | 15 roots · 1 |

Built offline by `scripts/build-sample-packs.mjs` / `scripts/samples/build.py` (mono, 24 kHz, trimmed, block IMA-ADPCM);
decoded in the browser by `src/audio/samplePack.ts`, lazily per zone. `scripts/write-implementation-details.mjs`
regenerates `IMPLEMENTATION_DETAILS.json` from the pack headers (every zone: root, velocity range, original file).
Clav (Clavinet, Harpsichord), Digital (Digital Piano, FM E.Piano) and Misc (Marimba, Vibraphone) are honest synthesis,
labelled "(synth)". Known limit, declared: the Wurlitzer set only has 20 pitches, so its outermost keys shift up to
5 (bottom) / 8 (top) semitones.

## Decisions

1. **Canonical sound state** (`src/model/sound.ts`): piano section + two layers, effect chains per layer, focus, group,
   global units, rotary, master level, pitch stick. Pure update functions; group and global follow the manual (entering
   copies the focused settings; leaving keeps them shared until edited).
2. **Panel bindings** (`src/model/panelBindings.ts`): functional control IDs map to sound-state edits (focused layer /
   focused chain) and sound state maps back to panel values and LED indicators. The hardware store routes functional
   actions through the binding; every other control keeps its Phase 1 decorative behavior. Shift functions per manual:
   Shift+Layer A = SUSTPED and Shift+Layer B = PSTICK (applied to the focused layer), Shift+Piano FX focus = GROUP,
   Shift+Delay/Comp/Reverb ON = GLOBAL, Shift+Comp Amount = FAST. Layer buttons are click-driven: an off layer turns on and
   takes focus, an unfocused layer takes focus, the focused layer turns off (the manual's "hold to turn off" is a click here).
3. **Voice ownership**: `LayeredEngine` keeps one physical-key lifecycle for all inputs and a `NoteEngine` per layer, so
   octave shift, SUSTPED, enable/disable and cleanup are per layer; a released key always frees the voices it started.
4. **Effects** (`src/audio/fx/*`): each unit is a dry/wet shell with click-free ramps; type selectors crossfade gated
   branches. Reverb IRs are generated deterministically; the Rotary is a crossover + doppler + AM + auto-pan model with
   smooth speed changes.
5. **Status honesty**: "Ready" only when every source loaded; a failed pack → "Fallback (labelled)", named in status,
   `LOAD FAILED` on the Program OLED, flashing type LED, and the model plays the synthesized Digital piano.
6. **Stays decorative**: Organ, Synth, Program controls; spec-excluded items (Mod/Delay/Amp variations, delay feedback
   effects and Analog, ping pong, Mod 1 pedal modes, rotary stop mode/close mic, pedal noise, KB zones, Aux KB); master
   clock sync (Phase 3). No soft/sostenuto pedal behavior is claimed.

## Order of work (as executed)

1. Plan → sound model → Phase 1 voice refactored into layer/bus/master architecture (inputs unchanged).
2. Piano types, two-layer state, performance controls.
3. Effect units in signal order, then focus/group/global routing and panel bindings.
4. Rendered-audio tests, browser pass, visual regression against Phase 1, provenance.

## Verification

- `tests/feature-matrix.json` (stage 2): the 11 Phase 1 IDs keep their tests; new IDs map to
  `pianoLibrary.test.ts`, `stageGraph.test.ts`, `effects.test.ts`, `panelPhase2.test.tsx`.
- Phase 1 tests: decorative-only assertions were narrowed to the controls that remain decorative (functional controls
  are now described as functional); no test file was deleted.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass.
- Visual audit: `evidence/stage2-visual-audit.md`; canonical captures come from the parent harness at seal.
