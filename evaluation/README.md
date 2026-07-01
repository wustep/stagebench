# Stagebench evaluator

The evaluator turns evidence-backed rubric ratings into reproducible 0–100 scores. It intentionally keeps two concerns separate:

1. An independent evaluator inspects the running artifact, source, primary image, and relevant manual behavior, then records 0–4 ratings with evidence.
2. The scoring command validates the assessment, runs technical checks, applies the phase-specific weights, and registers the result with the run and gallery.

Evaluators are read-only and independent from generation. Their first scored assessment is final; evaluator issues are diagnostic and are never sent back to implementation agents as repair instructions.

## Active protocol-v3 phase weights

| Category | Phase 1 | Phase 2 | Phase 3 |
| --- | ---: | ---: | ---: |
| Visual fidelity/retention | 45% | 10% | 5% |
| Basic Piano or feature completion | 25% | 35% | 35% |
| Effects/audio integration | — | 30% | 30% |
| Interaction or system behavior | 15% | 10% | 20% |
| Engineering quality | 15% | 15% | 10% |

Phases 1–3 contribute 25%, 30%, and 45% respectively. A run only contains the cumulative phases selected by its target. Incomplete/partial aggregates are diagnostic and are not ranked with complete valid runs.

The active rubric lives in [`rubrics/v3.json`](./rubrics/v3.json). `v1.json` and `v2.json` remain only to interpret historical runs.

## Blinded evaluator bundle

For protocol-v3 runs, template creation first creates `.stagebench/blind/trial-…`. The evaluator sees the opaque ID, sealed artifact, current phase inputs, and rubric—not the run ID, model, provider, title, gallery, or other solutions. A private mapping is used only when scoring. Identity-leak scanning rejects model/provider strings in the public evaluator bundle unless explicitly overridden for a non-official diagnostic run.

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

For protocol-v3 this writes the assessment inside the opaque evaluator bundle and prints its path. Pass that path to `evaluate:score --assessment <path>`. Historical protocols retain the run-local assessment path.

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
