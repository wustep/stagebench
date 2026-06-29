---
name: run-nord-benchmark
description: Run the repository's incremental Nord Stage 4 web recreation benchmark with fresh, isolated subagents and register the attributed result in the Stagebench gallery. Use when the user asks to run, start, execute, benchmark, or compare a model on BENCHMARK.md, asks to add a model output to the gallery, or requests only selected benchmark phases.
---

# Run Nord Benchmark

Execute one attributed four-phase benchmark run with isolated implementation agents, independent evaluators, a fixed repair loop, and honest gallery registration.

## Preconditions

- Work from the repository containing `BENCHMARK.md`, `TESTING.md`, `prompts/`, `specs/benchmark-phases.json`, `runs/`, and `src/data/runs.json`.
- Read `specs/benchmark-phases.json` before creating a run. Treat its phase count, spec assignments, and hard gates as authoritative.
- Preserve unrelated user changes and never modify the reference image, manual, domain specs, rubric, or benchmark-owned scripts from inside a candidate phase.
- Require fresh-context subagents. If unavailable, stop because isolation cannot be guaranteed.
- Use the exact user-requested model when selectable. If model selection is unavailable, explain the limitation and obtain approval before attributing another model's work to that label.
- Use pnpm exclusively for the gallery and every candidate artifact.

## 1. Resolve model and scope

Honor an explicit phase limit; otherwise run all four phases. Do not ask for a model when the user already supplied one unambiguously.

Store:

- `model`: stable canonical identifier shared by variants;
- `title`: human-readable run title;
- `isTest`: true only when the user requests an experimental/test classification.

Create a new isolated run:

```sh
node <skill-directory>/scripts/manage-run.mjs create --model "<canonical-id>" --title "<display-title>"
```

Never reuse or overwrite an existing run directory.

## 2. Execute each requested phase

Run this procedure sequentially for Phase 1 through the requested limit. The phase manifest supplies each phase's prompt and exact spec files.

### 2.1 Prepare and mark running

For Phase 1, use the directory returned by `create`. For later phases:

```sh
node <skill-directory>/scripts/manage-run.mjs prepare --id "<id>" --phase <N>
```

Then:

```sh
node <skill-directory>/scripts/manage-run.mjs mark --id "<id>" --phase <N> --status running
```

`prepare` must copy the previous source, tests, plans, notes, and pnpm lock while excluding caches and build output.

### 2.2 Spawn one isolated implementation agent

Spawn a fresh agent with no inherited parent conversation. Give it only:

- absolute repository and assigned phase-directory paths;
- absolute `BENCHMARK.md` and `TESTING.md` paths;
- absolute `specs/benchmark-phases.json` path;
- only the domain spec files assigned to this phase by the phase manifest;
- the fetched reference manual and primary image paths (see reference/, pnpm fetch:reference);
- the phase's prompt path;
- the preceding phase evaluation JSON/report path when one exists, solely to repair inherited shortcomings;
- the exact model selection when supported;
- instructions to work exclusively inside the assigned phase directory.

Require it to:

1. read the prompt and assigned specs completely;
2. write or update `IMPLEMENTATION_PLAN.md` before feature work;
3. use pnpm, declare `packageManager`, retain `pnpm-lock.yaml`, and keep Vite `base: './'`;
4. implement in the prompt's required milestone order;
5. use a red-green-refactor loop and maintain inherited tests plus `tests/feature-matrix.json`;
6. test real browser/audio boundaries in addition to fakes where required;
7. keep `IMPLEMENTATION_DETAILS.json` truthful and complete;
8. perform the required browser interaction and screenshot repair loops;
9. save desktop, narrow, and visual-audit evidence;
10. return test counts, coverage, evidence paths, architecture, provenance, browser results, and known limitations.

Do not give the implementation agent later-phase prompts, the parent conversation, expected code, or another model's implementation conclusions.

### 2.3 Verify and repair mechanical failures

Run:

```sh
node <skill-directory>/scripts/verify-stage.mjs verify --id "<id>" --phase <N>
```

The verifier must enforce:

- pnpm-only metadata and lockfiles;
- complete inherited and phase-specific feature IDs;
- implementation-details schema and phase number;
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`;
- `dist/index.html`;
- required desktop, narrow, and audit evidence;
- assigned spec files and hard-gate acknowledgement in the implementation plan.

If verification fails, return the exact failures to the same implementation agent. Allow at most two verifier-repair attempts. Never mark a phase complete while verification fails.

### 2.4 Parent browser smoke test

Start the built artifact locally and inspect the rendered phase with the in-app browser. At minimum:

- open desktop and narrow layouts;
- exercise the phase's primary flows from its prompt;
- check the console after interaction;
- confirm the candidate evidence depicts the current build;
- confirm no claimed feature is obviously display-only or disconnected.

Infrastructure problems may be fixed by the parent. Candidate product defects must go back to the implementation agent.

### 2.5 Mark complete and run the initial independent evaluation

After verifier and browser success:

```sh
node <skill-directory>/scripts/manage-run.mjs mark --id "<id>" --phase <N> --status complete
node <skill-directory>/scripts/evaluate-run.mjs template --id "<id>" --phase <N>
```

Spawn a new evaluator with no inherited context. The evaluator must not edit the candidate. Give it:

- repository and candidate phase paths;
- primary image and fetched manual;
- benchmark, testing contract, phase prompt, phase manifest, and all assigned domain specs;
- current rubric, verification JSON, assessment path, and local preview URL;
- instructions to inspect source, candidate tests, rendered desktop/narrow UI, console, real interactions, and audible/system behavior.

Require integer 0-4 ratings with concrete evidence. Source presence is not proof of audible or interactive behavior. Candidate-authored fake tests are not proof that the real browser/audio backend works. The candidate may not evaluate itself.

Score it:

```sh
node <skill-directory>/scripts/evaluate-run.mjs score --id "<id>" --phase <N>
```

### 2.6 Fixed evaluator-guided quality repair

Every completed phase receives one quality-repair opportunity so runs are comparable and the output benefits from evaluation.

Send the same implementation agent only:

- the scored phase evaluation;
- up to the five highest-impact evaluator issues;
- any violated hard gates from `specs/benchmark-phases.json`;
- instructions to repair those issues without expanding phase scope or weakening tests.

After repair, rerun the verifier and parent browser smoke test. If either fails, return failures to the implementation agent once. Do not preserve a broken repair merely because the initial build passed.

Generate a fresh assessment template with `--force true`, spawn a fresh evaluator, and score again. The second score is final. Do not silently edit the candidate after final scoring.

If a hard gate remains violated after the fixed repair pass, mark the phase failed and stop before preparing the next phase. A low rubric score without a hard-gate or technical failure remains an honest completed result.

## 3. Phase-specific emphasis

- **Phase 1 - Visual recreation:** exact hardware structure first; two measured visual repair passes; no audio.
- **Phase 2 - Piano instrument:** credible primary Piano source, one deterministic input lifecycle, real audio-boundary tests, truthful fallback.
- **Phase 3 - Programs and effects:** canonical Program state, editable splits/scenes/morphs, one shared audio graph, connected representative effects; no Organ/Synth audio yet.
- **Phase 4 - Organ and synth:** distinct Organ/Synth engines integrated into inherited Programs, routing, effects, splits, morphs, scenes, and presets.

When the requested scope ends before Phase 4, leave later phases queued and publish a partial run:

```sh
node <skill-directory>/scripts/manage-run.mjs partial --id "<id>"
```

## 4. Reports and publication

Each score command must regenerate:

- `runs/<id>/evaluations/report.md`;
- `runs/<id>/evaluations/implementation-details.json`;
- `public/reports/<id>/index.html`;
- `public/reports/<id>/implementation-details.json`.

Verify the report includes whole-number displayed scores, phase-specific evidence, libraries, audio architecture, samples, and provenance.

Publish a complete run only after all four phases pass:

```sh
node <skill-directory>/scripts/manage-run.mjs publish --id "<id>"
```

This must publish every completed phase preview and use Phase 4 as the latest/root preview. Then run the root gallery tests, typecheck, lint, and build through pnpm. Open the gallery, switch through all available phases, open the report, and check the console.

## 5. Final response

Report:

- model attribution, run ID, requested phase scope, and final gallery state;
- status and final evaluation for all four phases, including queued or failed phases;
- implementation and evaluator-repair attempts;
- verifier commands, browser checks, tests, feature coverage, and evidence paths;
- libraries, audio architecture, bundled sound files, and sample provenance;
- unresolved candidate limitations separately from benchmark-infrastructure limitations.

Never claim success for a failed hard gate or technical check. Keep failed and partial runs registered so benchmark history remains honest.
