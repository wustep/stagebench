# Stagebench showcase — the "perfect" Nord Stage 4

This is **not a benchmark run.** It was seeded from the best-scoring artifact
(`claude-fable-5` Phase 2, sealed 2026-07-02, Phase 1 scored 96/100) and is
iterated on continuously — using the evaluation findings, the reference
photography, and the manual — beyond what any single-run protocol allows.
Its numbers must never be compared with the runs in the gallery.

Rules that still apply: the honesty contract (no control fakes behavior),
truthful `IMPLEMENTATION_DETAILS.json` provenance, and green
`test` / `typecheck` / `lint` / `build` gates before publishing.

Publish to the gallery with `pnpm bench showcase` (builds and copies to
`public/previews/showcase/`).

## Iteration log

### 1 — seed + evaluation-issue fixes (2026-07-02)

- Seeded from `runs/claude-fable-5/stage2` (excluding evidence/plan).
- Fixed `legend-truncation-desktop`: legends wrap like the printed panel
  instead of ellipsis-truncating (`RATE/TIME` breaks at the slash via `<wbr>`);
  the Synth OLED widened from 30% to 40% of its row with resized type and
  stacked dial captions, so `OSC WAVEFORM` / `Super Saw` render in full.
  Verified at 1440x900: zero truncated legends, zero caption collisions.
- Fixed `first-note-warmup-latency`: the engine warms during idle time after
  mount (context created suspended, graph built, samples decoded), so the
  first key press only resumes the context. Injected test boundaries keep the
  lazy path; offline render contexts are never resumed early.
- Still open for a future iteration: `narrow-legend-legibility` (sub-pixel
  legends at 390x844 — needs an inspect/zoom affordance).

### 2 — complete piano library + pedal routing (2026-07-02)

Worked through the Phase 2 evaluation's priority issues (89/100, piano
library was the weak category at 73):

- **All six piano types now bundle a recorded model.** Clav = GM Clavinet,
  Digital = GM Electric Piano 2 (FM/DX character), Misc = GM Vibraphone
  (mallet, per the spec's Misc source rule) — same MIT MIDI-JS-Soundfonts
  provenance chain as the existing Upright/Electric sets, 19 roots × 1 layer
  each, synced by `scripts/sync-samples.mjs` and declared in
  `IMPLEMENTATION_DETAILS.json` / `public/samples/SOURCES.md`. Rendered-audio
  tests prove all six audibly distinct; live-browser analyser sweep confirmed
  distinct zero-crossing/RMS signatures per type. "Piano not found" is now
  reached only through load failure — the type LED flashes for a failed load
  (spec `missingModelState`), and recovery restores samples.
- **SUSTPED and PSTICK are functional** exactly as the manual specifies
  (p. 23): Shift + Layer A routes/unroutes the sustain pedal for the Piano
  section, Shift + Layer B gates the pitch stick (±2 st). Their panel LEDs now
  show routing state; toggling mid-note releases held voices / re-applies the
  bend. No new physical controls invented — the photo-measured surface is
  unchanged.
- **On-screen sustain pedal** (latching, accessible, in the status strip —
  off-chassis) completes the spec's required UI/keyboard/MIDI sustain trio.
- **Soft Release is disabled for Clav** (manual p. 25), tested.
- Fixed a real dev-only bug found while verifying in the browser: StrictMode's
  simulated unmount disposes the engine and detached its store subscription
  permanently, freezing every panel control's audio effect in dev (production
  unaffected). `attachStore` now re-attaches on mount, with a StrictMode
  regression test.
- Fixed `typecheck` portability: `@types/node` is now a direct devDependency,
  so `tsc --noEmit` passes on an isolated copy (verified on a scratch clone
  with a frozen-lockfile install).
- Gates: 211/211 tests, typecheck, lint, build all green.
- Still open: `narrow-legend-legibility` (above) and the evaluation's note
  about spec-excluded extras (half-pedaling, pedal noise, delay feedback-loop
  effects, Analog mode) staying functional — kept intentionally in the
  showcase, declared honestly.
