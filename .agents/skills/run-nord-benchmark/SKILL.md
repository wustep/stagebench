---
name: run-nord-benchmark
description: Run the repository's three-phase Nord Stage 4 recreation benchmark end to end with fresh implementation and evaluation agents, using the pnpm bench CLI.
---

# Run Nord Benchmark

Execute one benchmark run using the public `pnpm bench` CLI as the state authority. Never edit `run.json` by hand, and never let a candidate agent modify benchmark prompts, specs, the rubric, or `bench/`.

## Setup

1. Work from the repository containing `BENCHMARK.md` and `bench/cli.mjs`. Read `BENCHMARK.md` and `docs/PROTOCOL-3.md`.
2. Once per machine: `pnpm bench lockdown-setup` (container VM with no host directories, both images), then `pnpm bench fetch` (manual, photos, and the sample pack; each file is checked against its sha256), then `pnpm bench redteam` (expect every attempt blocked).
3. Ask the user for the model and target phase (1, 2, or 3) if not given. Targets are cumulative.

## Rules that are not yours to bend

- **Never edit, patch, or re-seal a sealed phase**, and never hand-edit `run.json`, a digest, or `runs/<id>/ledger.jsonl`. If a sealed artifact has to change for any reason, that is a new run: `pnpm bench fork <run-id> --to <new-id> --reason "..."`. It is labelled as an operator patch everywhere and the original keeps its score.
- **Never write your own message to a boxed candidate.** Use the templates below. If you believe a message outside them is unavoidable, stop and ask the user; `--off-protocol-message` marks the phase and footnotes the run.
- **Never run a candidate or an evaluator outside the lockdown** for a protocol-3 run without the user asking for it by name (`--isolation none`, `--unlocked`). It is recorded and footnoted as not an official result.

## Model policy: evaluation always runs on a strong model

The orchestrating agent's session model may be a weak/cheap model (e.g. DeepSeek). Never let that model grade the artifact. Evaluation uses a capable panel model independent of the run's unit-under-test:

- The **evaluator** that fills `assessment.json` runs on the model pinned in `bench/rubric.json` (`pnpm bench evaluator` passes it for you), not the session model.
- After the evaluator fills the assessment, run a separate, independent **reviewer** on the same pinned model over the filled `assessment.json` (`--message review`). Its job: check each rating is fair and grounded in concrete evidence against `EVAL.md`, `inputs/`, and `artifact/`, and flag any rating that is unsupported, overstated, or too harsh. The evaluator reconciles flagged ratings (or the reviewer writes a corrected `assessment.json` alongside, keeping the original), then the sealed assessment registers.
- Do not tell the evaluator or reviewer which model produced the artifact, and they must never read the parent repo, `runs/`, other scores, or other solutions.

## Create

```sh
pnpm bench new --model <model-id> --target <1|2|3> [--variant stage-4-73] [--title ...] [--provider ...] [--harness ...] [--reasoning ...]
```

## Per phase (repeat until done)

1. `pnpm bench start <run-id>` — builds the workspace (prompt, specs, capture harness, ready-to-paste hard gates, the sample pack, the offline package list).
2. Run the **implementation agent inside the lockdown**: `pnpm bench agent <run-id> --harness <codex|claude|omp|custom> [--model <model>] [--effort <level>]`. This starts a fresh agent in a container that holds only that workspace: none of this machine's filesystem, no internet, and its own model API as its only egress. The first message is fixed; do not pass a prompt. Do not start the agent yourself in the workspace directory, and do not give it any other repository context. See `docs/LOCKDOWN.md` for credentials and for harnesses without an adapter (`--harness custom`).
   - If the agent stopped early (timeout, crash, usage limit): `pnpm bench agent <run-id> --harness <same> --message continue`.
   - Only if the run was created with `--isolation none`: spawn a fresh agent whose working directory is the workspace. For Codex, launch it with `scripts/bench-candidate-codex -C <workspace>` so it cannot read outside the workspace (see `bench/codex-candidate.config.toml`; check it with `scripts/verify-candidate-sandbox.sh`), and do not pass `--sandbox` or `--dangerously-bypass-approvals-and-sandbox`. Use exactly this prompt: "Read WORKSPACE.md at the workspace root and follow it exactly. Implement this phase according to the instructions in inputs/, working only inside candidate/. Do not modify files outside candidate/. Do not look outside this workspace. Do not read the parent repository, other runs, other projects, scoring materials, or the harness. Do not reuse sample banks or assets from other projects on this machine. Do not change benchmark prompts, specs, or anything under inputs. Before you finish, run all four package gates inside candidate/: pnpm test, pnpm typecheck, pnpm lint, and pnpm build. Fix any failures that are your responsibility. When you are done, report a brief summary of what you implemented and the result of each gate. Complete the implementation yourself. Do not hand this work off to any other agent, and do not ask me to switch models."
3. `pnpm bench seal <run-id> --cost-usd <n> --input-tokens <n> --output-tokens <n> --reasoning-tokens <n> --tool-calls <n>` — exports the phase from its box, runs the gates, the canonical capture, and the sample check in boxes with no network, verifies, archives the transcripts, and seals, recording the usage you pass (wall time is automatic; omit flags you cannot measure — use `pnpm bench telemetry` to add them later; the seal output's `lockdown.gateway` usage is the gateway's own token count). **If sealing fails**, relay it with `pnpm bench agent <run-id> --harness <same> --message seal-failure` — that sends the seal's own output, verbatim, and nothing else — then seal again. Do not explain, summarise, or add hints.
4. `pnpm bench score <run-id>` — builds the blind evaluator workspace (under `~/.stagebench/eval/…`, outside the repo and with no checkout name in its path: artifact copy with agent instruction files and producer names removed, rubric, specs, references, `assessment.json` template, `EVAL.md`).
5. Run the **evaluator inside the lockdown**: `pnpm bench evaluator <run-id> --phase <N> --harness claude` (the model is the one `bench/rubric.json` pins). Its box holds that workspace and nothing else. For a lower-noise score, add independent panel members with `--slot 2`, `--slot 3` (they median-merge at registration). Do not tell an evaluator which model produced the artifact. Only for a run created with `--isolation none`: spawn a fresh evaluator agent on the pinned model whose working directory is that workspace, as the `eval-nord-benchmark` skill describes.
6. An independent review of the filled assessment, by a fresh agent in the same box: `pnpm bench evaluator <run-id> --phase <N> --harness claude --message review`.
7. `pnpm bench score <run-id>` again — validates, verifies the sealed digest, reruns gates in a box against an out-of-repo copy, scores, archives the assessment(s) and the evaluator transcripts into the run record, publishes the report, and removes the evaluator workspace and its boxes.

`pnpm bench status <run-id>` always prints the next command if you lose track.

## Finish

When all selected phases are sealed and scored, generate the gallery hover thumbnail before committing or publishing the run:

1. `pnpm bench verify-sealed <run-id>` — every sealed stage still matches `run.json` and the seal ledger.
2. `pnpm bench thumbs <run-id>` — shoot the published preview and write `public/previews/<run-id>/stage<N>/thumb.jpg`, where `stage<N>` is the stage in that run's `previewPath`. The gallery derives the hover URL from `previewPath` by replacing `index.html` with `thumb.jpg`. A published preview without this file still plays; its leaderboard row simply shows no hover card. This does not re-seal, re-score, or edit `run.json`.
3. The run is already indexed. Verify the gallery renders it (`pnpm dev`), including the hover thumbnail on the new row, its protocol version and isolation mode, and any footnotes, and report the phase scores, aggregate, footnotes, preview link, and report link to the user.