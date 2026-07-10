# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Stagebench is a benchmark that asks coding agents to recreate the Nord Stage 4 keyboard as an interactive browser instrument, plus a React gallery for comparing the results. The candidate-facing task definition, phases, and feature IDs live in `TASK.md` (run workspaces receive a copy filtered to their phase); the protocol, harness, and evaluation docs live in `BENCHMARK.md`; design principles in `PRODUCT.md`.

Core rule of the benchmark (the "honesty contract"): controls either work canonically or visibly do nothing — never fake success. `IMPLEMENTATION_DETAILS.json` must truthfully declare audio sources.

## Node & package manager

- **Node 24** (`.nvmrc`). The shell often defaults to Node 18 — commands may fail there. `.claude/launch.json` pins the NVM path; for Bash commands use:
  `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`
- **pnpm 11** (`packageManager` field). The `showcase/` package has its own lockfile and is NOT a pnpm workspace — install/run there with `pnpm -C showcase <cmd>`.

## Commands

Root (gallery + bench harness):

```sh
pnpm dev          # Vite dev server on 5173 (predev regenerates src/data/runs.json)
pnpm build        # tsc -b + vite build
pnpm typecheck    # tsc -b --pretty false
pnpm lint         # oxlint (config: .oxlintrc.json; ignores runs/** and public/previews/**)
pnpm test         # node --test tests/*.test.mjs  (Node native runner, assert/strict)
node --test tests/bench.test.mjs   # single test file
```

Showcase (separate package):

```sh
pnpm -C showcase dev --port 5199
pnpm -C showcase test         # Vitest
pnpm -C showcase typecheck
pnpm -C showcase lint
pnpm -C showcase build
pnpm -C showcase verify:layout   # layout check against specs/nord-stage-4.visual.json
```

Prefer the preview servers in `.claude/launch.json` (`dev`, `showcase`) over ad-hoc Bash servers.

### Bench CLI (`bench/cli.mjs`)

`pnpm bench <command>` orchestrates the run lifecycle:

- `fetch` — download the Nord manual + product photos into `reference/` (gitignored, required before other bench commands)
- `new --model <id> --target <1|2|3> [--variant stage-4-73]` — create a run
- `start <run-id>` — create the isolated phase workspace (clones `bench/starter/`)
- `exec <run-id> --command "..."` — run a command inside the run's container
- `seal <run-id> [--cost-usd N ...]` — import, validate gates, Playwright capture, verify contract, freeze the phase
- `score <run-id>` — first call builds the isolated, blind-handled evaluator workspace (artifact copy + rubric + specs + template); second call (after the evaluator fills `assessment.json`) reruns gates against an out-of-repo copy and registers the evaluation. Panels: extra `assessment.<n>.json` files median-merge. `--sandbox` runs gates in Docker.
- `status <run-id>` / `clean <run-id> [--all]` / `export <run-id>` / `reindex` / `showcase` (publishes showcase build to `public/previews/showcase/`)
- **Transient workspaces (work/eval/gates) live under `~/.stagebench/<repo-key>/`, not in the repo tree** — override with `STAGEBENCH_HOME`. Sealed `runs/<id>/stage<N>/` never contains `node_modules` (gates run on a copy).

## Layout & architecture

- `src/` — gallery app (React 19 + Vite). `App.tsx` renders the run index, a live preview iframe (`?run=<id>&phase=<N>`), and a playable keyboard rail. Its data source is the generated `src/data/runs.json` — built from `runs/*/run.json` by `pnpm bench reindex` (run automatically on predev/prebuild). Never edit generated files under `src/data/`.
- `bench/` — the harness: `lib/run/` (store, workspace, verify, capture, export), `lib/eval/` (technical checks, rubric scoring, reports), `rubric.json`, `schemas/`, and `starter/` (the template agents clone).
- `runs/<id>/` — one directory per benchmark run. `run.json` is the authoritative state (stages, verification, evaluation, telemetry). **Sealed stage directories (`stage1/`–`stage3/`) are immutable evidence — never modify them.** Legacy (pre-schema-v4) runs keep frozen scores and are read-only to the CLI.
- `showcase/` — the flagship Nord Stage 4 implementation. It is *not* a benchmark run: it was seeded from the best-scoring artifact and iterated further (log in `showcase/SHOWCASE.md`). It must keep passing its own test/typecheck/lint/build gates. Internal structure: `src/audio/` (engines + effects graph, one AudioContext with per-layer buses), `src/model/` (typed hardware model), `src/components/`, `src/input/` (MIDI/keyboard/pointer with injectable boundaries for tests), `src/state/`.
- `specs/` — machine-readable Nord Stage 4 specs (`nord-stage-4.visual.json` geometry and control inventory, plus piano/organ/synth/effects/programs) and `benchmark-phases.json` (phase scopes and hard gates). These are the source of truth for visual fidelity work.
- `prompts/stage<N>.md` — per-phase instructions given to agents.
- `reference/` — Nord manual PDF + product photos, fetched via `pnpm bench fetch`, gitignored, not redistributed.
- `public/previews/`, `public/reports/` — published playable builds and static evaluation reports (generated; don't hand-edit).
- `middleware.js` — Vercel middleware for `/secret` only (HMAC-signed extras cookie gated by `STAGEBENCH_PASSWORD`; the main gallery is public).

## Testing conventions

- Root tests use the Node native runner; showcase uses Vitest.
- Tests are deterministic: MIDI, audio, and timing boundaries are injectable (see `showcase/src/test/`). Audio behavior is asserted on real Web Audio signals via analyser/signal-comparison utilities, not mocks.

## Visual-fidelity work on the showcase

When adjusting the panel UI, compare against `reference/nord-stage-4*.jpg` and the geometry in `specs/nord-stage-4.visual.json`, and run `pnpm -C showcase verify:layout` afterward.
