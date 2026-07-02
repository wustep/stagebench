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
