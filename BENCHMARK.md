# Stagebench — Nord Stage 4 recreation benchmark (protocol 1.1)

Stagebench measures how well a coding-agent configuration can recreate the Nord Stage 4 as an interactive browser instrument, working incrementally from a product photo, the user manual, and machine-readable specs. It exercises dense reference-driven UI, accessibility, browser input, real-time audio, state architecture, and regression-safe extension of an existing artifact.

This file documents the protocol and harness for operators and evaluators. The candidate-facing task — phases, honesty contract, implementation requirements, and required feature IDs — lives in [TASK.md](./TASK.md), which is what run workspaces receive (filtered to the phases the run has reached). Candidates never see this file, the rubric, other runs, or the harness.

## Source-of-truth files

- `TASK.md` — the candidate-facing task definition and required feature IDs.
- `specs/benchmark-phases.json` — phase scopes, hard gates, and shared completion gates.
- `specs/nord-stage-4.visual.json` + `specs/nord-stage-4.variants.json` — surface geometry and the three hardware variants.
- `specs/nord-stage-4.piano.json`, `…effects.json`, `…organ.json`, `…synth.json`, `…programs.json` — per-section behavior, summarized from the manual with page citations.
- `prompts/stage1.md` … `stage3.md` — the per-phase instructions given to the implementation agent.
- `bench/rubric.json` — scoring weights. Never given to candidates.

## Honesty contract

The core rule in every phase (stated in full in `TASK.md`): a control either works canonically or it visibly exists, moves, and does nothing — it never fakes success, and evidence never claims unimplemented behavior. Verification and evaluation both check this boundary, and `IMPLEMENTATION_DETAILS.json` must truthfully declare every audio source.

## Running the benchmark

Fetch the copyrighted reference assets first (never redistributed with this repo):

```sh
pnpm bench fetch
```

Then a run is four commands:

```sh
pnpm bench new --model <id> --target <1|2|3> [--variant stage-4-73]
pnpm bench start <run-id>     # per phase: creates the isolated implementation workspace
pnpm bench seal <run-id>      # per phase: import + checks + capture + verify + seal
pnpm bench score <run-id>     # per phase: run twice — builds the evaluator workspace, then registers the filled assessment
```

**Workspaces live outside the repo.** All transient workspaces (implementation, evaluation, gate scratch) are created under `~/.stagebench/<repo-key>/` — never inside the repository tree — so a candidate or evaluator agent cannot reach `runs/`, `showcase/`, or other solutions with a relative `../..`. Override the base with `STAGEBENCH_HOME`. `pnpm bench clean <run-id>` (or `--all`) removes them; `bench status` surfaces any that linger.

**Implementation isolation.** `start` builds `<home>/work/<id>/stage<N>/` containing `candidate/` (the starter, or the preceding sealed artifact) and `inputs/` with exactly the phase's materials: the phase prompt, the assigned specs, `TASK.md` and `specs/benchmark-phases.json` filtered to phases ≤ the current one, only the assigned variant's entry (also pinned as `defaultVariant`), the implementation-details schema, the manual, and the variant photo. The implementation agent works there and never sees `runs/`, other solutions, future phase details, scoring materials, or the harness. For hard isolation, run the candidate's commands inside Docker: `pnpm bench exec <run-id> --command "pnpm test"` mounts the candidate writable and the inputs read-only with no network (pass `--network registry` to allow package installs).

**Sealing.** `seal` imports the candidate, reruns the four package gates, captures parent-controlled 1440x900 and 390x844 screenshots of the built artifact, verifies the phase contract/feature matrix/evidence/provenance, hashes the tree into `runs/<id>/verifications/stage<N>.json`, and publishes the preview. The sealed `runs/<id>/stage<N>/` tree keeps only source, `dist/`, and evidence — never an installed `node_modules` (gates run against a copy). The candidate also writes `evidence/stage<N>-visual-audit.md` describing measurements, exercised flows, and known deviations.

**Telemetry.** Wall time per phase is recorded automatically (start → seal). Cost and token usage come from the agent runtime, so the operator or orchestrating agent passes them at seal time — `pnpm bench seal <id> --cost-usd 12.50 --input-tokens 1200000 --output-tokens 300000 --reasoning-tokens 80000 --tool-calls 420` — or afterwards with `pnpm bench telemetry <id> --phase <N> <same flags>`. Per-phase values roll up into run totals shown in the gallery; unrecorded values stay `null`, never zero.

> **Gotcha — don't hand-enter `subagent_tokens`.** The Claude Code run-completion notification reports a `subagent_tokens` figure that is the subagent's *final context size*, not the tokens it generated. Entering it as `--output-tokens` overstates usage (observed ~2.1× on one run). The honest number is the sum of per-turn `output_tokens` across the subagent transcript. Recompute it from the JSONL transcript(s) instead of copying the notification: `pnpm bench telemetry <id> --phase <N> --from-jsonl <transcript.jsonl>`, or preview the numbers first with `pnpm telemetry:from-jsonl <transcript.jsonl>` (which prints the ready-to-paste flags). Reasoning tokens aren't in the transcript — Claude bills thinking as output — so add `--reasoning-tokens` by hand only if you have a separate figure.

`bench status <run-id>` always prints the next command plus recorded telemetry. `pnpm bench help` lists everything.

## Evaluation

Evaluation is a separate, isolated flow from the run. The first `bench score` call builds `<home>/eval/<blind-handle>/stage<N>/` containing `artifact/` (a copy of the sealed phase, its digest re-checked against the seal so the evaluator provably rates the sealed bits), `inputs/` (the rubric, `TASK.md`, phase contracts, assigned specs, variant entry, manual, photo, and the sealed verification record), the `assessment.json` template, and `EVAL.md` instructions. The directory is named by a **blind handle**, not the run id, and the template carries that handle — the evaluator is not told which model produced the artifact. A **fresh evaluator agent** — independent of the implementation agent, working only inside that directory — inspects the artifact against the rubric and fills in 0–4 ratings, each with concrete evidence. It never reads `runs/`, other runs' scores, or any other solution.

Running `bench score` again validates the assessment, confirms the sealed digest is unchanged, reruns the technical checks **against an out-of-repo copy** (the sealed tree is never mutated; pass `--sandbox`, or set `STAGEBENCH_SANDBOX=1`, to run them in Docker), maps the blind handle back to the run, computes the score, archives the assessment into `runs/<id>/evaluations/`, writes the gallery report, and removes the evaluator workspace. Phases 1–3 aggregate at 25/30/45; a failed technical check caps the phase at 59, a missing build at 49.

**Evaluator panels.** For a phase, additional independent evaluators may fill `assessment.2.json`, `assessment.3.json`, … beside the primary `assessment.json`. Registration takes the per-criterion **median** rating across the panel (unioning the evidence with attribution) before scoring, which cuts single-observation noise. A lone evaluator is the common case and passes through unchanged.

**Gate environment.** The isolated gate reproduces the platform types the in-repo environment provided by directory walk-up (the starter never declared `@types/node`, so candidate typechecks resolve it ambiently); the copy is given the same `@types/node` after install. This keeps out-of-repo scoring identical to how every prior run was evaluated, rather than silently failing a candidate that relied on the ambient toolchain.

## Interpreting results

- The unit under test is the full agent configuration recorded in `run.json` — not a base model in the abstract.
- A single run is one stochastic observation; small score differences are within evaluator noise. The evaluator works from a blind handle rather than the run id, but blinding is best-effort — an artifact's own source may still reveal its author, and evaluations are not blinded to the task itself. Use a panel to reduce noise further.
- The Nord Stage 4 is a public product; training-data familiarity cannot be ruled out. Results mean "performance on this disclosed task".
- Prompts, specs, rubric, and verifier behavior are comparison-critical: changing them means bumping the protocol version, and runs from different protocol versions are not comparable. Protocol 1.1 changed the materials packaging (candidates no longer see scoring/harness docs, future phase details, or unassigned variants; evaluators work in an isolated workspace) — task content is unchanged from 1.0. Runs recorded before the current run schema are shown as **Legacy** in the gallery with their frozen scores and reports.

## Run records

`runs/<id>/run.json` is the only authoritative run record; `src/data/runs.json` is a generated projection (`pnpm bench reindex`, run automatically before dev/build). Sealed phases record artifact digests; scored phases record evaluations and static HTML reports under `public/reports/<id>/`.
