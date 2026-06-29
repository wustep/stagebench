# Stagebench evaluator

The evaluator turns evidence-backed rubric ratings into reproducible 0–100 scores. It intentionally keeps two concerns separate:

1. An independent evaluator inspects the running artifact, source, primary image, and relevant manual behavior, then records 0–4 ratings with evidence.
2. The scoring command validates the assessment, runs technical checks, applies the phase-specific weights, and registers the result with the run and gallery.

## Phase weights

| Category | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
| --- | ---: | ---: | ---: | ---: |
| Visual fidelity | 55% | 25% | 15% | 10% |
| Feature completion | 20% | 25% | 30% | 35% |
| Audio implementation | — | 30% | 30% | 30% |
| Interaction or system behavior | 15% | 15% | 15% | 15% |
| Engineering quality | 10% | 5% | 10% | 10% |

Phases 1–4 contribute 20%, 25%, 25%, and 30% respectively to a run's aggregate score. Until all phases are evaluated, the aggregate is normalized over only the available phase weights and reports that coverage explicitly.

The active versioned rubric lives in [`rubrics/v2.json`](./rubrics/v2.json). The prior three-phase rubric remains in `v1.json` only to interpret historical runs. Every category also contains weighted criteria and evaluation guidance.

## Rating anchors

- `0` — missing, broken, or unsupported by evidence
- `1` — minimal or substantially incorrect
- `2` — partial, with important gaps
- `3` — strong and substantially complete
- `4` — exceptional against the supplied references

Scores are calculated from criterion ratings, then category weights, then phase weights. Ratings must be integers and every rating requires at least one concrete evidence item.

## Commands

Generate an assessment template:

```sh
pnpm evaluate:template --id <run-id> --phase 1
```

This writes `runs/<run-id>/evaluations/stage1.assessment.json`. An evaluator fills its metadata, ratings, evidence, summary, and issues without changing the benchmark artifact.

Validate, score, and register the assessment:

```sh
pnpm evaluate:score --id <run-id> --phase 1
```

The command runs the phase artifact's `test`, `typecheck`, `lint`, and `build` scripts and verifies `dist/index.html`. A failed technical check caps the score at 59; a missing built artifact caps it at 49. The uncapped score remains in `rawScore` so the result is auditable.

Inspect the rubric or a single phase:

```sh
pnpm evaluate:rubric
pnpm evaluate:rubric --phase 2
```

## Output

The scored result is written to `runs/<run-id>/evaluations/stageN.json`. The pipeline then adds a compact evaluation summary to the matching phase entry in `run.json` and `src/data/runs.json`, and recalculates the run aggregate. The `stageN` filename is retained for compatibility.

The stored result includes:

- overall, raw, category, and criterion scores;
- the rubric version and evaluator attribution;
- evidence for every rating;
- automated technical-check results and any score cap;
- evaluator summary and issue list.

## Readable reports

Every scored run also receives two consistently formatted reports:

- `runs/<run-id>/evaluations/report.md` for source control and terminal reading;
- `public/reports/<run-id>/index.html` for the gallery's Evaluation report view.

The report always uses the same order: run overview, phase score, plain-language summary, category table, strongest findings, priority issues, technical gate, and expandable criterion evidence. Rebuild it from existing scored JSON without rerunning an evaluation:

```sh
pnpm evaluate:report --id <run-id>
```

Do not score visual fidelity from source inspection alone. Compare the rendered artifact directly with the run's selected-variant reference image (its `referenceImage` in `specs/nord-stage-4.variants.json`, e.g. `reference/nord-stage-4-73.jpg` for the Stage 4 73) at desktop and narrow widths.
