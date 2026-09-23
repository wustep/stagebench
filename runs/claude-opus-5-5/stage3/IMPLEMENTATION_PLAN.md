# Phase 3 implementation plan — Nord Stage 4 73

Run: `claude-opus-5-5` · Variant: **Stage 4 73** (`stage-4-73`, 73 keys E1–E7 = MIDI 28–100, hammer action)

I read all six assigned specs in full. I also read `specs/benchmark-phases.json` (Phase 3), `prompts/stage3.md`,
`TASK.md`, `reference/manual.pdf` (pp. 13, 18–22, 27–45, 48–53) and the inherited Phase 1–2 source, tests and
evidence.

- `specs/nord-stage-4.visual.json`: the surface geometry. Phase 3 changes no geometry. It adds no OLED; the Program
  and Synth OLEDs gain content.
- `specs/nord-stage-4.piano.json`: the Phase 2 piano behavior, kept. Piano layers join zones, scenes, morphs and
  programs.
- `specs/nord-stage-4.effects.json`: six chains (Piano A/B, one shared Organ chain, Synth A/B/C) and one Rotary with
  Organ routing, Stop mode, and Master Clock sync for Mod 1 and Delay.
- `specs/nord-stage-4.programs.json`: 32 programs, Store/Store As, the dirty E indicator, Live Mode,
  splits/zones/crossfades, Layer Scenes, Wheel/Control Pedal morphs, Master Clock, Transpose and Panic.
- `specs/nord-stage-4.organ.json`: two layers on one chain; distinct B3/Vox/Farf/Pipe 1 engines (B3 Bass and Pipe 2
  reuse, as documented); drawbars with LED graphs; percussion, key click, vibrato/chorus and Rotary.
- `specs/nord-stage-4.synth.json`: three layers; the Analog-mode waveform list; Osc Ctrl per category; FM-H;
  LP12/LP24/HP/BP; three envelopes; LFO; voice modes; arpeggiator/gate.

## Phase 3 hard gates (from `specs/benchmark-phases.json`)

- [x] Program save/load round-trips all supported state across the 32 slots and 8 Live slots.
  - Evidence: `programModel.test.ts` stores 40 all-area variants through storage and reloads them;
    `programs.test.tsx` covers Store, Store As, Live reload and copying.
- [x] Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.
  - Evidence: `system.test.tsx` covers Shift+SPLIT editing, split LEDs, KB zones through Shift+Octave, a −3 dB
    crossfade at the split point in rendered audio, a panel-assigned wheel morph that darkens rendered audio, scenes
    switching voices, and seven-layer routing.
- [x] B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed
      copies of one oscillator.
  - Evidence: `organ.test.ts` compares harmonic profiles and attacks; `synth.test.ts` compares the five categories and
    Osc Ctrl behaviors.
- [x] Organ and Synth route through the Phase 2 graph with no separate AudioContext.
  - Evidence: `system.test.tsx` shows one context; Master Level 0 silences all engines; organ chain and reverb tests.
- [x] All inherited visual, piano, effects, and input behavior remains regression-free.
  - Evidence: all ten Phase 1–2 test files are kept and green. Decorative-only assertions were narrowed to the
    unsupported controls. The pixel diff against Phase 2 is 0.15 % (`evidence/stage3-visual-audit.md`).

Shared completion gates:

- `pnpm test`, `typecheck`, `lint` and `build` pass.
- The browser pass had 0 console errors and 0 page errors (`evidence/stage3-browser-pass.json`).
- Every claimed audio feature is on the audible graph (rendered-audio tests).
- `IMPLEMENTATION_DETAILS.json` (phase 3) separates recorded samples, generated buffers and live synthesis, and
  carries the control audit.

## Canonical state schema (`src/model/sound.ts`, version 3)

One serialisable object is the whole program. Master Level and the pitch stick are performance state, outside
programs.

```
SoundState {
  version: 3
  piano:  { on, focus: A|B,   layers: { A, B: PianoLayerState } }
  organ:  { on, focus: A|B,   vibType: V1|V2|V3|C1|C2|C3, layers: { A, B: OrganLayerState } }
  synth:  { on, focus: A|B|C, kbHold, layers: { A, B, C: SynthLayerState } }
  every layer (layerCommon.ts): enabled, level 0–127, octave −1…+1, sustPed, pStick, zone [from, to] (KB zones 1–4)
  PianoLayerState: type, models per type, kbTouch, dynComp, timbre, unison, softRelease, stringRes
  OrganLayerState (organState.ts): model farf|vox|b3|pipe1|pipe2|b3bass, drawbars[9] 0–8, vibOn,
                                   perc { on, soft, fast, third }
  SynthLayerState (synthState.ts): wave (index into the 14 required waveforms), oscCtrl, pitch { coarse ±24, fine ±50 },
    oscEnv { a, d, r, velocity }, oscEnvAmt (bipolar), envToPitch,
    filter { on, type LP12|LP24|HP|BP, freq, res, envAmt, track 0–3, drive 0–3 }, filterEnv { a, d, r, velocity },
    ampEnv { a, d (127 = sustain), r, velocity 0–3 }, lfo { wave ×5, dest off|pitch|ctrl|filter, rate, amount, sync },
    voice { mode poly|mono|legato, priority last|low|high, glide }, unison 0–3,
    vibrato { mode off|wheel|delay|on, rate, amount }, arp { mode poly|arp|gate, run, rate, range, direction, sync }
  fx:     { on, focus: organ|A|B|synthA|synthB|synthC, group (piano), synthGroup, chains: 6 × ChainState,
            global { delay, comp, reverb }, globalUnits }          ChainState: Phase 2 units + mod1.sync, delay.sync
  rotary: { fast, drive, organ (Rotary ORGAN routing), stopMode }
  split:  { on, points: [Low, Mid, High] × { pos: 0–10 (C2…C7) | null, xfade: 0|6|12 } }
  scenes: { active: I|II, enabled: { I, II: { organA, organB, A, B, synthA, synthB, synthC } } }
  morph:  { wheel: { destKey → end offset }, pedal: { destKey → end offset } }      (morph.ts MORPH_DESTS)
  clock:  { bpm 30–300, kbSync }      transpose: { on, semitones −6…+6 }
  master (not stored), pitchStick (not stored)
}
```

- Performance inputs outside programs: the mod wheel (panel and MIDI CC1), the Control Pedal (on-screen slider and
  MIDI CC11), the pitch stick, sustain and Solo.
- The engine always plays `applyMorphs(state, wheel, pedal)` (plus Solo).
- The panel shows stored values, or the morph end values while a source is being assigned.
- Programs are stored normalised against this schema (`programs.ts normalizeSound`), so stale or corrupt storage cannot
  break the engine.

## Architecture

- **One `AudioContext`** (`src/audio/stageAudio.ts`) builds the piano graph at unlock. It builds the organ graph
  (`organ.ts`) and the synth graph (`synth.ts`) when their section is first switched on, which keeps tests and CPU low.
  - Organ: layer levels sit before the shared organ chain. The chain then goes to the Rotary via its ORGAN button, or
    direct.
  - Piano/Synth: chain → layer level → direct, or To Rotary.
  - Master gain → limiter → ceiling → the only destination.
- **Note routing** (`layeredEngine.ts`): one physical-key lifecycle feeds seven layer engines.
  - A key is routed by section on/layer enable, KB zone and equal-power crossfade gain (`zones.ts`), then octave and
    Transpose.
  - Piano and organ layers use `NoteEngine`.
  - Synth layers use `SynthLayerEngine`: KB Hold, then the deterministic `Arpeggiator` (`arp.ts`), then poly voices or a
    mono/legato voice with priority and constant-rate glide.
- **Controller** (`src/system/controller.ts`):
  - Owns the canonical state, the program bank (`programs.ts`, `factory.ts`: 10 factory programs) and the program UI
    modes: Store with auditioning, Store As naming, the numeric list, clock, transpose and split edit.
  - Handles morph assign, Solo, Undo and Panic, the Synth OLED page and the OLED content.
  - Binds every control through `panelBindings.ts` (piano, effects, performance), `bindings/organSynth.ts` and its own
    program handler.
  - `hooks/usePiano.ts` is the React adapter.
  - Injectable boundaries (`runtime.ts`): AudioContext, assets, MIDI, key/blur targets, visibility, clock, **storage**,
    the **repeating timer** (arpeggiator clock) and a diagnostics **inspect** hook.

## Control-binding audit (plan → result)

1. Every `PANEL.controls` id is either functional, with a description (`FUNCTIONAL` in `panelBindings.ts`), or
   unsupported, with the spec clause that excludes it (`UNSUPPORTED` in `bindings/audit.ts`), never both.
   - Result: 10 unsupported controls; every other control is functional. Tested in `system.test.tsx`.
2. Every functional control, when operated, changes canonical state, a performance input or the program UI. Every
   unsupported control changes only its presentation.
   - Result: `system.test.tsx` walks every functional control; `surface.test.tsx` operates every unsupported control
     and checks that sound, voices, displays and status do not change.
3. Excluded Shift functions of functional buttons are listed in `UNSUPPORTED_SHIFT` (19). Each one flashes an
   "unsupported" message and is never faked.
4. The UI "Unsupported controls" notes, the accessible descriptions, `IMPLEMENTATION_DETAILS.json` (`controls`) and
   `evidence/stage3-visual-audit.md` all list them.

## Decisions and documented approximations

- **Sync waveforms.** Osc Ctrl sets the synced oscillator's relative pitch as a resonant formant, swept 1–8 × f0 over
  the master saw/square. This approximates hard sync's moving spectral peak, and it lets the oscillator envelope and
  the LFO modulate it at audio rate. FM-H uses a modulator at 2 × f0.
- **Vox/Farf vibrato.** Vox and Farf only have vibrato, so their C1–C3 positions use V depths. Pipe chorus is a
  detuned celeste rank. B3 Bass has no vibrato (organ spec models).
- **Single-pointer gestures.**
  - Morph assign latches on click (like the manual's double-tap latch).
  - Split edit is Shift+SPLIT (the SET KEY legend).
  - MST CLK and TRANSP are pressed, then set with the dial.
  - EXIT is Shift pressed and released alone.
- **Section-level controls.**
  - KB Hold applies to the whole synth section, because the per-layer exclude is excluded.
  - KB SYNC (Shift+ARP RUN) is the Master Clock keyboard sync.
  - The vibrato/chorus type is shared by both organ layers; on/off is per layer.
- **Program change.** Held notes keep their voices. Layers switched off by the new program stop. Edits are discarded,
  and single-level Undo (Shift+SOLO) is available (optional in the spec; claimed and tested).
- **Solo (optional, implemented).** Only the section being edited sounds. Solo is not stored.
- **Not implemented** (optional, not claimed): Samples mode, Prog View modes, Delay Ping Pong, LP M/LP+HP filters, extra
  oscillator categories and FM inharmonic algorithms. The ones with panel controls (Samples via MODE, Prog View, Ping
  Pong) are in the unsupported list.

## Verification

- `tests/feature-matrix.json` (stage 3): 38 IDs. The 20 Phase 1–2 IDs keep their tests. The 18 Phase 3 IDs map to
  `organ.test.ts`, `synth.test.ts`, `programModel.test.ts`, `programs.test.tsx` and `system.test.tsx`, and
  `regression.phase2` lists every Phase 1–2 test file.
- Rendered-audio tests use the in-repo Web Audio simulator. It was extended with detune, looping buffers,
  ConstantSource, PeriodicWave and targeted `disconnect(dest)`, and its free-running modulators are counted separately.
- Browser pass: `node scripts/browser-pass.mjs` (after `pnpm build`) wrote `evidence/stage3-browser-pass.json` and
  screenshots. The canonical captures come from the parent capture harness at seal.

## Progress (checkpoint log — survives session restarts)

- [x] Plan written.
- [x] Canonical state v3, zones, morphs, program bank and factory programs.
- [x] Simulator extensions; organ engine; synth engine; synth layer engine and arpeggiator; LayeredEngine for 7 slots;
      StageAudio with 6 chains (organ/synth built lazily).
- [x] Controller, Organ/Synth bindings, audit, usePiano/App rewired; inherited tests narrowed where Phase 3 turned
      decorative controls functional.
- [x] Phase 3 suites: organ, synth, programModel, programs, system.
- [x] Feature matrix stage 3; `IMPLEMENTATION_DETAILS.json` phase 3; browser pass (0 console/page errors); visual audit.
- [x] Final gates: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
