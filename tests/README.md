# Evaluation tests

`evaluator.test.mjs` verifies rubric invariants, normalized scoring, technical score caps, and cross-stage aggregation. Run it with:

```sh
pnpm test:evaluator
```

Each benchmark stage remains responsible for its own project-level checks. The evaluator pipeline reruns `typecheck`, `lint`, and `build` when it records a score.
