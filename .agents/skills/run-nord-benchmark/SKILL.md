---
name: run-nord-benchmark
description: Run the repository's isolated three-phase Nord Stage 4 web recreation benchmark, with a selectable cumulative completion target, provenance/telemetry, sealed verification, blinded independent evaluation, and classified gallery publication.
---

# Run Nord Benchmark — protocol v3

Execute one attributed, isolated benchmark run. Use the public `pnpm stagebench` CLI as the state authority; do not reproduce state transitions by editing JSON.

## Preconditions

1. Work from the repository containing `METHODOLOGY.md`, `BENCHMARK.md`, `TESTING.md`, `specs/benchmark-phases.json`, `schemas/`, and `scripts/stagebench.mjs`.
2. Read the methodology and active phase manifest completely.
3. Run `pnpm stagebench doctor`. Official runs stop if protocol, pnpm/git, references, isolation runtime, or required provenance is unavailable.
4. Preserve unrelated user changes. Never let a candidate modify benchmark prompts/specs/rubrics/verifier/runner/reference files.
5. Require fresh-context implementation agents and fresh independent evaluators. If unavailable, mark the run exploratory or stop; do not claim official isolation.
6. Use the exact selectable model/snapshot/settings. Do not attribute another model’s work to the requested label.

## 1. Resolve run identity and cumulative target

Obtain or infer these fields before creation:

- canonical model ID, provider, exact snapshot/response model ID, reasoning setting, agent/tool version;
- hardware variant: `stage-4-88`, `stage-4-73`, or `stage-4-compact-73`;
- completion target:
  - **1 — Complete surface + basic Piano:** creates Phase 1;
  - **2 — Piano library + working effects:** creates Phases 1 and 2;
  - **3 — Complete Stage 4 system:** creates Phases 1, 2, and 3;
- resource/network track and limits;
- official versus exploratory classification.

If the user did not name a target or variant, ask. A target is cumulative; do not interpret target 3 as “run only Phase 3.”

Create the run:

```sh
pnpm stagebench create \
  --model <canonical-id> \
  --title <display-title> \
  --provider <provider> \
  --model-snapshot <snapshot> \
  --reasoning <setting> \
  --agent-version <version> \
  --tool-bundle <version> \
  --browser <version> \
  --target-phase <1|2|3> \
  --variant <variant-id> \
  --network-policy <none|registry-only|unrestricted> \
  --budget-track <track> \
  --official <true|false>
```

The returned `run.json` is authoritative. Do not write `src/data/runs.json`; it is generated later.

## 2. Execute each selected phase sequentially

For each phase in `selectedPhases`:

### 2.1 Prepare and isolate

```sh
pnpm stagebench prepare --id <id> --phase <N>
pnpm stagebench bundle --id <id> --phase <N>
pnpm stagebench mark --id <id> --phase <N> --status running
```

The bundle lives under `.stagebench/workspaces/<id>/phaseN/`:

- `candidate/` is the only writable candidate directory;
- `inputs/` contains only current allowlisted docs/prompt/specs/selected references;
- no other runs, gallery data, reports, evaluator output, future prompts, or solutions are present.

Official model execution must use an equivalent container/sandbox boundary with only these mounts. Giving a subagent the path while leaving host-repository access available is exploratory, not official.

### 2.2 Spawn one fresh implementation agent

Give it only the candidate/input paths, selected phase/variant, model selection, and resource policy. Require it to:

1. read the current prompt and allowlisted inputs fully;
2. write/update `IMPLEMENTATION_PLAN.md` with exact hard gates/specs before feature work;
3. work exclusively in `candidate/`;
4. use pnpm and preserve the starter package contract/Vite base;
5. implement in prompt order with red-green-refactor and inherited tests;
6. keep `tests/feature-matrix.json` and `IMPLEMENTATION_DETAILS.json` truthful;
7. test real browser/audio boundaries where required;
8. perform the required browser/visual repair loops;
9. return test results, architecture, provenance, exercised flows, resource usage, and known limitations.

Do not provide later-phase prompts, evaluator findings, another solution, parent-conversation conclusions, or model identity claims the runtime cannot verify.

Import the finished candidate bundle into the authoritative phase directory. This copies only `candidate/`, excludes caches, and never imports the input mount:

```sh
pnpm stagebench import --id <id> --phase <N>
```

### 2.3 Parent canonical capture and smoke test

Start the sealed candidate build locally and run:

```sh
pnpm stagebench capture --id <id> --phase <N> --url <local-url>
```

At minimum, independently exercise:

- Phase 1: exact surface/keybed, pointer/touch-style ownership, computer keys, sustain input, velocity, blur/disconnect cleanup, decorative panel-control honesty, narrow layout;
- Phase 2: all Piano choices/layers, pedals/fallback, every effect family, focus/target/bypass/wet-dry, rapid play and cleanup;
- Phase 3: Programs/store/live, presets, splits/scenes/morphs, representative Organ/Synth modes, inherited effects/routing, full binding audit, stress cleanup.

Check console/page errors after interaction. Infrastructure/smoke failures may return to the implementation agent before independent evaluation; evaluator feedback never does.

### 2.4 Verify, repair mechanical failures, and seal

```sh
pnpm stagebench verify --id <id> --phase <N>
```

Verification enforces the current/legacy phase contract, candidate package checks, required feature mappings, implementation provenance, valid canonical evidence, and creates an artifact digest. Return only exact mechanical failures to the same implementation agent, within the run’s verifier-repair budget. Re-capture/re-verify after changes.

Completion requires a passing sealed verification:

```sh
pnpm stagebench mark --id <id> --phase <N> --status complete
pnpm stagebench preview --id <id>
```

The executable state machine rejects skipped prerequisites and unverified completion.

### 2.5 Record telemetry

Record measured values when available, estimates only when labeled, and unavailable otherwise:

```sh
pnpm stagebench telemetry --id <id> --phase <N> \
  --wall-time-seconds <n> \
  --input-tokens <n> \
  --output-tokens <n> \
  --reasoning-tokens <n> \
  --cost-usd <n> \
  --tool-calls <n> \
  --subagents <n> \
  --implementation-attempts <n> \
  --verifier-repairs <n> \
  --kind <measured|estimated|unavailable>
```

### 2.6 Create a blinded evaluation

After completion:

```sh
pnpm evaluate:template --id <id> --phase <N>
```

For v3 this creates `.stagebench/blind/trial-…` plus a private mapping. Spawn a new evaluator with no inherited context and give it only the printed opaque bundle/assessment path and local preview. Do not reveal run ID, model, provider, title, other solutions, or generation transcript.

Require direct rendered/interactive/audio inspection and integer 0–4 ratings with concrete evidence. Source presence and candidate-authored tests are not proof of audible/interactive behavior. Evaluators are read-only and never repair the candidate.

Score using the printed assessment path:

```sh
pnpm evaluate:score --id <id> --phase <N> --assessment <opaque-assessment-path>
```

Do not send evaluator issues/scores back to implementation or rescore after candidate repair. Assessment correction for evaluator/infrastructure error is a separate audited workflow.

## 3. Finish and publish

When every selected phase is complete and evaluated:

```sh
pnpm stagebench publish --id <id>
pnpm stagebench reindex
pnpm stagebench validate
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

If work ends before the selected target, use `partial`; it marks the result incomplete and non-comparable. Never relabel it as a lower target after seeing performance.

Open the gallery, verify selected phase switching/report links, and confirm classification/validity. Official, exploratory, legacy, partial, and invalid results must remain visibly distinct.

## 4. Final response

Report model/agent identity, run ID, variant, target/selected phases, protocol digest, resource track/limits, status/validity/classification, phase evaluations, implementation/verifier attempts, telemetry, evidence paths, architecture/provenance, browser checks, and unresolved candidate versus infrastructure limitations.

Never claim success for a failed gate, unsealed artifact, identity leak, budget violation, missing telemetry as zero, or an exploratory/legacy result as official.
