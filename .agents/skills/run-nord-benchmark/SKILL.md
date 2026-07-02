---
name: run-nord-benchmark
description: Run the repository's three-phase Nord Stage 4 recreation benchmark end to end with fresh implementation and evaluation agents, using the pnpm bench CLI.
---

# Run Nord Benchmark

Execute one benchmark run using the public `pnpm bench` CLI as the state authority. Never edit `run.json` by hand, and never let a candidate agent modify benchmark prompts, specs, the rubric, or `bench/`.

## Setup

1. Work from the repository containing `BENCHMARK.md` and `bench/cli.mjs`. Read `BENCHMARK.md`.
2. Ensure reference material is present: `pnpm bench fetch`.
3. Ask the user for the model and target phase (1, 2, or 3) if not given. Targets are cumulative.

## Create

```sh
pnpm bench new --model <model-id> --target <1|2|3> [--variant stage-4-73] [--title ...] [--provider ...] [--reasoning ...]
```

## Per phase (repeat until done)

1. `pnpm bench start <run-id>` — prints the workspace path.
2. Spawn a **fresh implementation agent** whose working directory is that workspace. Its instructions: read `WORKSPACE.md`, implement the phase per `inputs/` inside `candidate/` only, and run the four package gates before finishing. Do not give it any other repository context. When Docker is available, have it run commands through `pnpm bench exec <run-id> --command "..."` (candidate writable, inputs read-only, network off; `--network registry` for installs).
3. `pnpm bench seal <run-id> --cost-usd <n> --input-tokens <n> --output-tokens <n> --reasoning-tokens <n> --tool-calls <n>` — imports, checks, captures, verifies, and seals, recording the implementation agent's reported usage (wall time is automatic; omit flags you cannot measure — use `pnpm bench telemetry` to add them later). If sealing fails, relay the failure to the implementation agent (same workspace), then seal again.
4. `pnpm bench score <run-id>` — writes the assessment template and prints its path.
5. Spawn a **fresh evaluator agent**, independent of the implementer, with read-only access to the sealed `runs/<id>/stage<N>/` artifact, the phase specs, and the template. It fills in every rating (0–4) with concrete evidence from running/inspecting the artifact — its prompt should describe the artifact, not the model that made it.
6. `pnpm bench score <run-id>` again — validates, scores, and publishes the report.

`pnpm bench status <run-id>` always prints the next command if you lose track.

## Finish

When all selected phases are sealed and scored, the run is complete and already indexed. Verify the gallery renders it (`pnpm dev`) and report the phase scores, aggregate, preview link, and report link to the user.
