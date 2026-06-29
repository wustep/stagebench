# Stagebench

A React + Vite gallery and repeatable four-phase benchmark for comparing coding-model recreations of the Nord Stage 4.

## Gallery

```sh
pnpm install
pnpm dev
```

Run `pnpm build` for a production build and `pnpm lint` for static checks.

## Evaluate a run

The evaluator uses a versioned, evidence-backed rubric with different category values for each phase. Generate a Phase 1 assessment template and score it with:

```sh
pnpm evaluate:template --id <run-id> --phase 1
pnpm evaluate:score --id <run-id> --phase 1
```

The scoring command reruns technical checks and registers phase and aggregate scores in the gallery data. The full workflow and weight table are in [evaluation/README.md](./evaluation/README.md).

## Run the benchmark

Before running the benchmark or scoring visual fidelity, fetch the reference material:

```sh
pnpm fetch:reference
```

This downloads the Nord Stage 4 user manual and the official 88 / 73 / Compact 73 top-down photos from Nord's servers into `reference/` (gitignored). See [Reference material & attribution](#reference-material--attribution).

Invoke `$run-nord-benchmark` in Codex. The project skill asks which model label to use, creates an isolated run under `runs/<model-id>/`, and executes four incremental, spec-backed prompts with fresh-context implementation and evaluation agents. It publishes only after Visual, Piano, Programs and Effects, and Organ and Synth all pass their tests, browser checks, repair loops, and evaluations.

The complete specification is in [BENCHMARK.md](./BENCHMARK.md). Future benchmark runs evaluate each completed phase before publishing it.

## Reference material & attribution

Stagebench is an independent, non-commercial benchmark for studying browser UI/audio reconstruction. It is **not affiliated with, authorized, or endorsed by Clavia DMI AB**. "Nord" and "Nord Stage" are trademarks of Clavia DMI AB, used here only to identify the product being studied.

The Nord Stage 4 user manual and product photography are copyrighted by Clavia DMI AB and are **not redistributed** in this repository. `pnpm fetch:reference` downloads them from Nord's official servers into `reference/` (gitignored) for local evaluation only. Do not commit, re-host, or redistribute their contents. The benchmark recreations (and any code in this repo authored here) are independent works produced for comparison and study.
