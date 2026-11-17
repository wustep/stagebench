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

## Model policy: evaluation always runs on a strong model

The orchestrating agent's session model may be a weak/cheap model (e.g. DeepSeek). Never let that model grade the artifact. Evaluation uses a capable panel model independent of the run's unit-under-test:

- The **evaluator** that fills `assessment.json` runs on **Opus 5** (via `claude -p --model opus` / Claude Code, or an Opus-class subagent), not the session model.
- After the evaluator fills the assessment, fire a separate, independent **Opus 5 reviewer** subagent over the filled `assessment.json`. Its job: check each rating is fair and grounded in concrete evidence against `EVAL.md`, `inputs/`, and `artifact/`, and flag any rating that is unsupported, overstated, or too harsh. The evaluator reconciles flagged ratings (or the reviewer writes a corrected `assessment.json` alongside, keeping the original), then the sealed assessment registers.
- Do not tell the evaluator or reviewer which model produced the artifact, and they must never read the parent repo, `runs/`, other scores, or other solutions.

## Create

```sh
pnpm bench new --model <model-id> --target <1|2|3> [--variant stage-4-73] [--title ...] [--provider ...] [--harness ...] [--reasoning ...]
```

## Per phase (repeat until done)

1. `pnpm bench start <run-id>` — prints the workspace path.
2. Run the **implementation agent inside the lockdown**: `pnpm bench agent <run-id> --harness <codex|claude|custom> [--model <model>] [--effort <level>]`. This starts a fresh agent in a container that holds only that workspace (no host filesystem, no network but its model API and package mirrors), with the standard prompt. Do not start the agent yourself in the workspace directory, and do not give it any other repository context. If the lockdown is not set up, run `pnpm bench lockdown-setup` first; see `docs/LOCKDOWN.md` for credentials and for harnesses without an adapter (`--harness custom`). Only if the run was created with `--isolation none`: spawn a fresh agent whose working directory is the workspace, and tell it to read `WORKSPACE.md`, to work only inside `candidate/`, and not to read anything outside the workspace.
3. `pnpm bench seal <run-id> --cost-usd <n> --input-tokens <n> --output-tokens <n> --reasoning-tokens <n> --tool-calls <n>` — imports, checks, captures, verifies, and seals, recording the implementation agent's reported usage (wall time is automatic; omit flags you cannot measure — use `pnpm bench telemetry` to add them later). If sealing fails, relay the failure to the implementation agent with `pnpm bench agent <run-id> --harness <same> --prompt "<the failure>"` (it resumes the same session and records your message), then seal again.
4. `pnpm bench score <run-id>` — builds the isolated, blind-handled evaluator workspace (under `~/.stagebench/…`, outside the repo: artifact copy, rubric, specs, references, `assessment.json` template, `EVAL.md`) and prints its absolute path.
5. Spawn a **fresh evaluator agent on Opus 5**, independent of the implementer, whose working directory is that workspace. Its instructions: read `EVAL.md`, inspect `artifact/` against `inputs/`, and fill every rating (0–4) in `assessment.json` with concrete evidence. The workspace is blind — do not tell the evaluator which model produced the artifact, and it must never read the parent repo, `runs/`, other scores, or other solutions. For a lower-noise score, run 3 evaluators and have them write `assessment.json`, `assessment.2.json`, `assessment.3.json` (they median-merge at registration).
6. Fire a **fresh, independent Opus 5 reviewer** (per the Model policy above) over the filled assessment(s), in the same blind workspace, to validate that every rating is fair and evidence-grounded. Reconcile any flags into the assessment before registration.
7. `pnpm bench score <run-id>` again — validates, verifies the sealed digest, reruns gates against an out-of-repo copy, scores, archives the assessment(s) into the run record, publishes the report, and removes the evaluator workspace.

`pnpm bench status <run-id>` always prints the next command if you lose track.

## Finish

When all selected phases are sealed and scored, generate the gallery hover thumbnail before committing or publishing the run:

1. `pnpm bench thumbs <run-id>` — shoot the published preview and write `public/previews/<run-id>/stage<N>/thumb.jpg`, where `stage<N>` is the stage in that run's `previewPath`. The gallery derives the hover URL from `previewPath` by replacing `index.html` with `thumb.jpg`. A published preview without this file still plays; its leaderboard row simply shows no hover card. This does not re-seal, re-score, or edit `run.json`.
2. The run is already indexed. Verify the gallery renders it (`pnpm dev`), including the hover thumbnail on the new row, and report the phase scores, aggregate, preview link, and report link to the user.