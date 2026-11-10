# Phase 1 implementation plan — Nord Stage 4 73

Variant: **Stage 4 73** (`stage-4-73`, hammer action, 73 keys E1–E7).

Assigned specs (both read in full before any code was written):

- `specs/nord-stage-4.visual.json` (v1.4.0) — surface geometry, landmarks, forbidden hardware, presentation rules.
- `specs/nord-stage-4.piano.json` (v2.0.0) — Phase 1 needs only the "one dependable basic piano voice" subset.

Supporting material: `specs/nord-stage-4.variants.json` (variant bounds and key model),
`specs/benchmark-phases.json` (Phase 1 contract), `reference/nord-stage-4-73.jpg`, `reference/manual.pdf`.

## Phase 1 hard gates (copied from `specs/benchmark-phases.json`)

- [x] The exact keybed count and range for the assigned variant are modeled and playable.
- [x] The complete visible control surface is present with the documented section geometry, and Program and Synth are the only primary OLED locations.
- [x] The piano voice supports pointer, touch, computer keyboard, MIDI, velocity, release, sustain, polyphony, and cleanup.
- [x] Every visible panel control moves or presses accessibly but truthfully does nothing else.
- [x] Canonical desktop and narrow captures are complete with a written visual audit.

Each box is ticked only after the matching tests and the browser pass were green; see
`evidence/stage1-visual-audit.md` for the measured numbers behind the visual gates.

## Decisions that need saying out loud

1. **Section widths: the spec wins over the prompt.** `prompts/stage1.md` lists 13/21/15/9/21/21 %.
   `nord-stage-4.visual.json` v1.4.0 lists 14/20/8.5/12.5/25/20 % and says the older values
   "contradicted the photo". My own scan of the photo agrees with the spec (piano ≈ 8.3 %,
   program ≈ 12.2 %, synth ≈ 23.9 %), and `TASK.md` makes the photo authoritative for layout,
   so the build uses the spec fractions exactly.
2. **Photo-measured layout.** Every control, LED, legend, and plate is positioned from pixel
   coordinates read off the reference photo, then mapped into its section with one affine
   transform per section so section boxes land on the spec fractions exactly.
3. **Honest synthesis, no samples.** The Phase 1 voice is live additive synthesis computed
   sample-by-sample by a pure TypeScript DSP kernel. It is described as synthesis everywhere;
   nothing is called a recording. Recorded sample sets are Phase 2 scope.
4. **One DSP kernel, two hosts.** The kernel runs in an `AudioWorklet`; if the worklet cannot
   load, the same kernel runs in a `ScriptProcessorNode` and the status says "fallback".
   Because the kernel is plain TypeScript, tests render real audio offline and measure it —
   no fakes stand in for audible behaviour.
5. **Decorative means decorative.** Panel controls write to a presentation-only hardware store.
   The store has no reference to the audio engine or the note lifecycle, and a test proves the
   rendered audio is bit-identical before and after every control has been moved.
6. **OLEDs tell the truth.** The Program OLED shows the real audio/MIDI/sustain status, not a
   fake program name. The Synth OLED says the section is not active in this phase.

## Order of work

1. This plan.
2. Normalized typed hardware and key data with stable IDs (`src/hardware/`): variant, section
   geometry, the 73-key model, and a per-section control/LED/legend/plate inventory.
3. Chassis, six sections, exact keybed; then every section control with accessible,
   presentation-only interaction (`src/ui/`).
4. Injectable platform boundaries (`src/platform/`), the shared note lifecycle and input
   adapters (`src/input/`), then the piano voice (`src/audio/`).
5. Tests mapped in `tests/feature-matrix.json`, a real-browser pass, captures, the visual audit,
   and `IMPLEMENTATION_DETAILS.json`.

## Architecture

```
src/hardware   typed data: variant, sections, keys, controls, LEDs, legends, presentation store
src/audio      dsp/kernel.ts (pure DSP) · dsp/host.ts (message host) · piano.worklet.ts · engine.ts
src/input      noteLifecycle.ts (one lifecycle for all sources) · keyboard.ts · midi.ts · pointer.ts
src/platform   injectable browser/audio/MIDI/timing/storage boundaries + the real browser binding
src/ui         instrument, sections, controls, keybed, status
tests          one or more test files per required feature ID
evidence       captures, measurements, visual audit
scripts        the Playwright snippet that produced the captures
```

Signal path: pointer / touch / computer keys / Web MIDI → `NoteLifecycle` → `PianoEngine`
→ kernel (voices → master gain → soft limiter) → audio destination. There is exactly one
connection to the destination.

## Status

All five hard gates are met. `pnpm test` (12 files, 183 tests), `pnpm typecheck`, `pnpm lint`,
and `pnpm build` pass. A real-browser pass in Chromium against the production build confirmed:
the worklet loads and reports Ready; all 97 buttons register exactly one press per click; all
49 knobs, dials, faders, drawbars, the wheel, and the stick follow a drag; operating every panel
control leaves audio Idle; chords, sustain, glissando, three-finger multi-touch, blur cleanup,
and the skip link work; the console shows no errors or warnings.

One thing differs from the prompt: the parent capture harness was not reachable from the
workspace, so the captures in `evidence/` come from `scripts/capture-stage1.js`. The visual
audit says so.

## Hand-off notes for Phase 2

- **Attach behaviour by control ID.** `tests/visual.control-inventory.test.tsx` freezes the 146
  IDs. `HardwareStore` already holds every position and indicator step; Phase 2 should read it
  (or subscribe to it) from a new canonical state layer rather than put audio calls in the UI.
- **Selector step order** is in each button's `stepLabels` (for example `piano-type`:
  Grand, Upright, Electric, Clav, Digital, Misc). LED bindings already light the right LEDs.
- **The decorative-controls test must be narrowed, not deleted**, when Piano and Layer Effects
  controls become functional: keep it for Organ, Synth, and Program controls.
- **Audio.** `PianoKernel` owns voices and the master stage; `KernelHost` owns the message
  protocol (`EngineMessage`). `{ type: 'master', gain }` already exists for Master Level.
  Sample playback for Grand / Upright / Electric will need decoded buffers posted to the host.
- **Tests render real audio** through `tests/support/fakes.ts` (`FakeWorkletNode` hosts the real
  kernel) and measure it with `tests/support/signal.ts`.
- **OLED text** lives in `src/ui/Oleds.tsx`; the Program OLED currently shows status, not a
  program name.

## Out of scope in Phase 1 (deliberately inert)

Every panel control, including Master Level; piano types, models, timbre, and layer controls;
all effects; Organ and Synth audio; programs, splits, scenes, morphs, transpose.
