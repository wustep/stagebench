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
  filename matches `build/assets` before trusting a measurement — a previous
  evaluator was silently served another agent's build after a port fell back.
- **A uniquely-named scratch file.** One evaluator had its harness script
  overwritten mid-session by another agent writing the same path.
- **Incremental writes.** Tell it to save ratings into `assessment.json` as it
  goes; a batch of evaluations once lost all its work to a transient API error.
- **Timeouts on every browser wait.** One agent stalled for 600s on an
  indefinite wait and was killed.
- **Playwright directly, not the Chrome MCP tools** — those have timed out in
  three separate evaluations.

Cap concurrency at **5**. Six caused a stall; five have run clean. **Count the
agents you actually launched** — describing one as "queued" when the tool call
carried five leaves an evaluation silently unstarted.

### Measurement traps to name in the prompt

Each of these produces a confidently wrong number rather than an error, so an
evaluator that hits one reports a clean result that happens to be false. All
were found the hard way:

| Trap | What it does | Fix to state |
|---|---|---|
| First note after page load | Starts the `AudioContext` and triggers sample loading, so it plays the labelled fallback voice — every instrument measurement is really the fallback | Play a warm-up note first |
| First note after *any state change* | One artifact rebuilt and closed its `AudioContext` on every panel interaction (11 clicks, 11 contexts), so the first note after each one rendered exactly `0.000000`. Without a warm-up per A/B, its whole engine sweep reads as silence | Warm up before every comparison, not just once per page |
| `PageUp` repeated inside one `evaluate()` | Collapses to a single step through stale React closures, silently understating any knob-range test | One event per animation frame |
| Space appearing not to sustain | May be deliberately swallowed while a panel control holds focus | Clear focus before concluding it is broken |
| `Playwright.click()` for reachability | Scrolls an `overflow:hidden` container and reports success for a control nobody can reach | The rubric's 5×5 `elementFromPoint` grid |
| Synthetic `dispatchEvent('pointerdown')` | Throws inside `setPointerCapture` for an unknown pointer id and silently plays nothing | Real mouse, or CDP `Input.dispatchTouchEvent` |
| Synthetic `KeyboardEvent` | Never activates a native `<button>`. One evaluator's operability count went 24/101 → 101/101 after switching | `page.keyboard.press` |
| Reading `aria-pressed` right after `click()` | Returns the stale value | Wait a frame |
| An effect tail from the previous note | Contaminates the next capture, so a real difference is attributed to the wrong control | Let the graph settle between takes |
| Web MIDI in headless Chromium | Reports `denied`/`unavailable`, so CC64 and note paths look broken | Stub `requestMIDIAccess`, and label those claims stub-measured rather than measured. If `requestMIDIAccess` appears nowhere in source or bundle, that is an absence by inspection, not a headless limit |
| A surprising negative | Two evaluators recorded defects that were their own probe state — a zeroed Layer A fader read as "split silences everything", inverted arrow-key polarity read as dead drawbars | Re-measure before recording any negative |

### Verify the graph, not the knob

The dominant failure in this benchmark is code that is correct, tested, and
never reached by the browser — **six of eleven artifacts** in the rubric-2.0
re-scoring. A knob A/B cannot see it, because the control still moves the
output. Census the real edges by instrumenting `AudioNode.prototype.connect`
before the app builds its graph, and tell the agent to check for:

- Units with **no path to the destination** while their knobs still change the
  signal — a dry/wet pair summing in parallel reads as a working effect. Seen:
  12/12 `DelayNode`s unreachable, 6/6 `ConvolverNode`s at in-degree 0, 484
  `StereoPannerNode`s with zero edges, a `rotaryRouted` flag written and never
  read. One artifact rendered the identical peak `0.12014346569776535` for
  every unit at every setting including bypass.
- An **LFO never connected to its mod gain**, so a fully-wet unit is
  bit-identical to bypass — or no LFO anywhere in the live graph.
- A **parallel dry path** capping every wet mix near 50%.
- **Sibling types that are one shared node** with different coefficients.
  Measure siblings against each other, not just against bypass.
- Types that **silence the instrument** while the LED reports them engaged,
  because the panel sends an abbreviation the effect class never matches.
- A **selector that changes the panel but not the sound**.
- **Whole engines** that bypass the shared rack (chain baked into a buffer,
  `source → gain → master`), or are fixed pre-rendered buffers so a held note
  stops dead at 2.4 s or 8 s. Test the *same* effect control against each
  engine: one artifact's Reverb moved the piano 0.0357→0.0026 and the organ
  0.05116→0.05413. Hold a note past 3 s.
- **Dead modules** tree-shaken out of the shipped bundle. Check the bundle, not
  the source tree.
- **A green suite proving nothing**: the tests assert an offline renderer, a
  `measureEnergy()` stand-in (one degraded under jsdom to
  `type.length * 0.03 + type.charCodeAt(0) * 0.001`), or a `MockAudioContext`
  with no rendered-signal assertions. Four green gates are consistent with zero
  audible effects.
- **Provenance claims**: count `decodeAudioData` occurrences and look for real
  audio assets before accepting a declared sample library. One artifact
  declared three third-party libraries and 27 `.pcm` files with zero audio
  assets shipped; another's 54 bundled WAVs were all malformed by a one-byte
  offset, so every decode failed and the build ran its fallback forever.

### What the agent is told about scoring

`EVAL.md` in the workspace already carries this — do not restate it in the
prompt, just point at it. It covers the two kinds of criterion (judged 0–4
versus computed from measurements), the run-level panel axis when the phase
carries one, the evidence floor, and the issue shape.

Three things worth repeating in the prompt because evaluators have got them
wrong:

- **Computed criteria take no rating.** Fill every number in `measurements`.
  A null is honest and gets dropped; a guess corrupts the score.
- **Reachability is measured by the method the rubric names**, not by a
  framework click helper. `Playwright.click()` scrolls an `overflow:hidden`
  container and reports success for a control a person can never reach.
- **`forbiddenPresent` is counted by the rules in the visual spec** under
  `forbiddenDetection`, applied literally against the rendered DOM — once per
  section that satisfies a rule, never once per element. It was the one number
  in the axis still resting on an eye, and counts of 0–3 across the field were
  not reproducible.

**Weight the top phase.** It carries the whole computed panel-fidelity axis —
40% of the run, and the only place measurements are filled — so say so in that
prompt and tell the agent to budget for unhurried, exact geometry. Two hard
gates live there: `keysInsideKeybed` and `deckFraction`, each capping the axis
at 40. Both have tripped on a single line (an inline `flex: 6` overriding a
correct basis put one artifact's deck at 0.4759 and 74 of 161 controls out of
reach; that run has the best audio in the benchmark and still finishes
eleventh). Tell the agent to measure the overall aspect ratio too — one
artifact came in at 1.64 against a 3.0951 target — and to compare against the
spec's fractions rather than the artifact's own constants, because several
self-audits check against superseded numbers and report "Deviation: None"
while being measurably out.

For a phase 3, add the whole-engine checks: that Organ, Synth, programs,
splits, scenes, morphs and the arpeggiator each reach audio *and* state. Seen
failing: engines silent because a default scene ships them disabled and no
rendered control writes the keys the state reader consults; a program system
fully implemented, tested and never imported; an arpeggiator referenced only by
its own file and one test; splits and Layer Scenes returning identical layer
vectors; source categories that are renamed copies of one oscillator.

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
  not supply. Others ship no lint config, so bare `oxlint` walks `node_modules`
  and the gate's verdict turns partly on vendored code — one artifact's lint
  exits non-zero purely from dependency noise. Record either as a portability
  issue in the notes; do not fail the gate over it and do not silently work
  around it. Scoring now records an advisory `lint-coverage` check that plants a
  deliberate violation beside a real source file and reports whether the lint
  script names it, so a lint that reads nothing is visible without capping a
  score.
- **A phase with no published preview** gets no `build/`, so the evaluator has
  to build its own and its measurements are not comparable to anyone else's.
  `EVAL.md` says so; make sure the agent flags it in `notes`.
- **A `build/index.html` that is a doctype-less fragment** renders in quirks
  mode, where the box model differs — and every panel-fidelity number is
  geometry. It also usually lacks a viewport meta, so the 390×844 narrow
  profile lays out at 980 px CSS width and narrow reachability is measured
  against a page that never got its viewport. This was the starter template's
  fault, not the candidates': 30 of 42 published previews were the same 170-byte
  fragment, so most of the rubric-2.0 field was measured this way. The starter
  is fixed and seal records an advisory `dist/index.html standards mode` check,
  but **runs sealed before that keep the old builds** — have the agent record
  the mode it measured in.

## Report back

Give the user, per run: the panel-fidelity score and whether its hard gate
tripped, each phase score against its previous value, the aggregate, and any
`critical` issues. Flag measurement divergence between passes — that is the
signal the panel exists to surface, and it is more informative than the score.
