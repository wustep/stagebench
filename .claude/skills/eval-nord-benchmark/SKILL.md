---
name: eval-nord-benchmark
description: >-
  Evaluate one or more sealed Stagebench runs — build the blind evaluator
  workspaces, drive the pinned evaluator agents, and register the scores. Use
  when the user asks to evaluate, re-evaluate, score, or re-score Stagebench
  runs. Deliberately separate from running the benchmark: the candidate may be
  built on any harness, but the evaluator model is pinned and must run here.
---

# eval-nord-benchmark — score sealed Stagebench runs

Evaluation is a separate flow from the run. A candidate can be produced on any
harness (Codex, Cursor, an API loop); the **evaluator model is pinned in
`bench/rubric.json` and cannot be substituted**, so evaluation has to happen on
a harness that can run it. That is why this is its own command.

## Before anything else: check the pin

```sh
node -e "console.log(require('./bench/rubric.json').evaluator)"
```

**If you are not running the pinned model, stop and tell the user.** Do not
evaluate with a different model and do not offer to — the whole point of the
pin is that scores from different judges are not comparable, and the harness
will reject the assessment at registration anyway.

## Ask first

Never assume the scope. One `AskUserQuestion` call:

1. **Which runs?** — offer `all sealed runs`, `runs not yet scored on the
   current rubric`, and `a specific run`. List candidates from
   `runs/*/run.json` (`status`, `protocol.rubricVersion`) so the user is
   choosing from real state.
2. **Passes per run?** — `1` (default) or `3` (median-merged panel). Three
   passes is the fix for single-observation noise; it triples the cost. State
   the estimate: about **$8 per phase evaluation**, so a three-phase run is
   ~$24 at n=1 and ~$72 at n=3.

## The loop, per run and phase

`pnpm bench score` is a two-call command. The first call builds the workspace;
you spawn the evaluator; the second call registers what it wrote.

```sh
pnpm bench score <run-id> --phase <N>     # 1. builds ~/.stagebench/<key>/eval/<blind>/stage<N>/
#    ... spawn the evaluator agent (below) ...
pnpm bench score <run-id> --phase <N>     # 2. validates, reruns gates, registers, writes reports
```

Work **oldest phase first**. The highest sealed phase carries the run-level
panel-fidelity axis (40% of the run), so its workspace is the largest job.

### Spawning the evaluator

One agent per phase, on the pinned model, with the workspace as its whole
world. Every agent needs:

- **Its workspace path**, and an instruction to read and write only inside it —
  never the parent repo, never another run, never another score.
- **`artifact/` is read-only evidence**, enforced by chmod. It holds source
  only. Tell the agent to **measure against `build/`** — the published build of
  that phase, copied into the workspace so every evaluator exercises identical
  bits. Building from source is only for running the candidate's own suite, and
  belongs in a scratch copy.
- **Exactly one port, with `--strictPort`.** Assign a distinct port per
  concurrent agent and say the number. Tell it to verify the served JS bundle
  filename matches its own `dist/` before trusting a measurement — a previous
  evaluator was silently served another agent's build after a port fell back.
- **Incremental writes.** Tell it to save ratings into `assessment.json` as it
  goes; a batch of evaluations once lost all its work to a transient API error.
- **Timeouts on every browser wait.** One agent stalled for 600s on an
  indefinite wait and was killed.

Cap concurrency at **5**. Six caused a stall; five have run clean.

### What the agent is told about scoring

`EVAL.md` in the workspace already carries this — do not restate it in the
prompt, just point at it. It covers the two kinds of criterion (judged 0–4
versus computed from measurements), the run-level panel axis when the phase
carries one, the evidence floor, and the issue shape.

Two things worth repeating in the prompt because evaluators have got them
wrong:

- **Computed criteria take no rating.** Fill every number in `measurements`.
  A null is honest and gets dropped; a guess corrupts the score.
- **Reachability is measured by the method the rubric names**, not by a
  framework click helper. `Playwright.click()` scrolls an `overflow:hidden`
  container and reports success for a control a person can never reach.

### Registering

The second `score` call validates the assessment, reruns the technical gates
against an out-of-repo copy, maps the blind handle back to the run, archives
the assessment into `runs/<id>/evaluations/`, writes the reports, reindexes the
gallery, and removes the workspace.

It **rejects** an assessment whose `evaluatorModel` is not the pinned value.
That is working as intended. `--allow-evaluator-model` exists only for
re-registering a historical evaluation and should not be used to paper over a
wrong-model run.

For an n=3 pass, put the extra assessments beside the first as
`assessment.2.json`, `assessment.3.json` — registration median-merges them
per criterion (and per measurement, for computed criteria) automatically.

## Known blockers

- **A sealed run whose gates do not reproduce on a clean install.** Some runs
  passed `pnpm build` at seal time via ambient types that a fresh install does
  not supply. Record it as a portability issue in the notes; do not fail the
  gate over it and do not silently work around it.
- **A phase with no published preview** gets no `build/`, so the evaluator has
  to build its own and its measurements are not comparable to anyone else's.
  `EVAL.md` says so; make sure the agent flags it in `notes`.

## Report back

Give the user, per run: the panel-fidelity score and whether its hard gate
tripped, each phase score against its previous value, the aggregate, and any
`critical` issues. Flag measurement divergence between passes — that is the
signal the panel exists to surface, and it is more informative than the score.
