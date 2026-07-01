# Stagebench benchmark improvement backlog

Date: 2026-07-01  
Status: Proposed for review; no task in this document is approved merely by appearing here.  
Scope: Benchmark validity, reproducibility, run orchestration, Nord implementation workflow, evaluation, data/reporting, and contributor/operator experience.

## Executive assessment

Stagebench already has a stronger foundation than many first benchmarks: an explicit four-phase contract, machine-readable domain specs, versioned rubrics, incremental artifacts, implementation/evaluation separation, technical gates, provenance manifests, reference fetching, a gallery, and a passing root test/typecheck/lint/build suite.

The main risk is no longer “can the repository run?” It is whether two displayed scores are scientifically and operationally comparable. Today a score combines model capability with uncontrolled differences in time, tools, retries, dependencies, evaluator judgment, and access to other solutions. Candidate-authored tests and evidence are checked mostly for presence, not truth. A run label does not fully record the model or environment that produced it. One evaluator supplies coarse 0–4 ratings, with no calibration or inter-rater measurement. Prior candidate solutions also live in the same shared repository, so fresh conversational context does not provide filesystem isolation.

Until those issues are fixed, results should be described as **exploratory agent runs under the recorded Stagebench workflow**, not as a precise leaderboard of model quality.

The recommended order is:

1. Establish an immutable protocol and trustworthy run identity.
2. Isolate candidates and standardize resource budgets/environment.
3. Add benchmark-owned black-box verification and authentic evidence capture.
4. Calibrate the rubric and evaluator process.
5. Automate the full workflow with a resumable state machine.
6. Run repeated trials and report uncertainty.
7. Expand beyond one product only after the Nord task is reliable.

## Audit observations that drive this backlog

- The root repository currently passes `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- `verify-stage.mjs` verifies feature-matrix entries by test-file existence and size. All features can point to the same trivial file; it does not prove that the declared test ran or asserted the feature.
- Evidence checks verify only that three paths exist and are non-empty. The verifier self-test writes plain text into `.png` files and passes.
- Hard-gate acknowledgement is verified with case-insensitive substring checks in `IMPLEMENTATION_PLAN.md`, not with executable assertions or structured attestations.
- `manage-run.mjs` can prepare or mark phases without proving the preceding phase completed, verification passed, or evaluation exists. The documented skill workflow is stricter than the executable state machine.
- `run.json` is described as authoritative, but normal save paths still write both it and `src/data/runs.json`. There is no cross-process run lock or compare-and-swap protection.
- The runner is chiefly a prose skill. Important operations—fresh-agent creation, retry limits, browser smoke tests, evaluator handoff, and publication—are not one resumable command with durable state.
- Model labels are user-supplied metadata. Runs do not record a provider response model ID, model snapshot, reasoning setting, agent/tool version, prompt hashes, commit, token usage, cost, or resource limits.
- Prior implementations and built previews share the same filesystem as new candidates. Instructions discourage reading them, but access is not technically prevented.
- The four root technical checks are rerun during evaluation, but candidate tests are not benchmark-owned and can be weak, tautological, skipped, or narrowly aligned to visible requirements.
- Visual evaluation has good written guidance but no canonical crop, landmark annotations, deterministic capture harness, or quantitative comparison. Candidate-authored audit measurements are trusted.
- Audio evaluation has strong intent but no standard input trace, conformance adapter, objective rendered-audio measures, latency/load protocol, or reference outputs.
- A single LLM evaluator assigns every rating. The evaluator sees run/model identity, no inter-rater agreement is measured, and anchor examples are prose only.
- Arbitrary technical score caps (59 and 49) mix artifact validity with product quality. A technically invalid run can still appear numerically close to a valid one.
- Partial-run aggregates are normalized over available phases, which can visually resemble complete-run scores despite measuring less of the benchmark.
- Older three-phase and current four-phase records coexist without a full migration boundary. `benchmarkVersion` is absent from legacy runs and is hardcoded for new runs rather than derived from an immutable protocol release.
- The working tree can reach several gigabytes during active runs because every phase copies sources, dependencies, evidence, and audio. The tracked footprint is much smaller, but local storage and cleanup are significant operator concerns.
- Candidate previews are loaded in same-origin iframes without a `sandbox` attribute. Generated applications should be treated as untrusted artifacts.

## Priority and effort legend

- **P0** — required before treating model-to-model scores as meaningfully comparable.
- **P1** — materially improves reliability, evaluation quality, and routine operation.
- **P2** — scaling, analysis, polish, or benchmark-suite expansion after the core protocol is sound.
- Effort: **S** (hours), **M** (a few days), **L** (roughly one to two weeks), **XL** (multi-week/research project).

---

## Project A — Define what Stagebench claims to measure

### A1. Write a benchmark methodology and claims document

- **Priority / effort:** P0 / M
- **Outcome:** A reader can distinguish what Stagebench measures from what it does not.
- **Work:** Define the construct (long-horizon browser product reconstruction), unit of evaluation (agent configuration, not just base model), target population, allowed tools, expected use, known confounds, and invalid interpretations. Explain why Nord is useful and where a single-product task cannot generalize.
- **Acceptance:** `METHODOLOGY.md` includes explicit claims, non-claims, threat-to-validity categories, and a worked example of a valid and invalid comparison. The gallery links to it near scores.
- **Dependencies:** None.

### A2. Define the canonical “agent configuration” identity

- **Priority / effort:** P0 / S
- **Outcome:** Results are attributed to the complete system that produced them.
- **Work:** Specify identity fields for provider, exact model/snapshot, reasoning or effort setting, system/agent version, tool bundle, orchestration policy, context-window policy, and benchmark protocol version. Decide which changes require a new comparison series.
- **Acceptance:** Two runs cannot share a comparison label if any comparison-critical identity field differs; the run schema and gallery expose the fields.
- **Dependencies:** A1.

### A3. Specify a fair resource policy

- **Priority / effort:** P0 / M
- **Outcome:** Models are compared under a declared, enforceable budget.
- **Work:** Choose one or more official tracks, such as fixed wall-clock, fixed tokens/cost, or fixed attempts. Define phase timeouts, implementation retries, verifier repairs, evaluator budget, subagent policy, network policy, and whether cached dependencies are allowed.
- **Acceptance:** Each track has machine-readable limits; orchestration stops or marks a budget violation automatically; reports show consumed versus allowed resources.
- **Dependencies:** A1, A2.

### A4. Define the unit of analysis and repeated-trial policy

- **Priority / effort:** P0 / M
- **Outcome:** A “model result” is not inferred from one stochastic run.
- **Work:** Select a minimum replicate count, trial naming, variant assignment, randomization policy, failure handling, and statistical summaries. Decide whether trials are paired by environment/variant and how incomplete runs contribute.
- **Acceptance:** The methodology specifies primary statistics (at least median or mean, spread, and confidence interval) and the gallery separates individual trials from configuration-level summaries.
- **Dependencies:** A2, A3.

### A5. Establish baselines and calibration runs

- **Priority / effort:** P1 / L
- **Outcome:** Scores have interpretable reference points.
- **Work:** Produce a minimal non-agent baseline, a competent human implementation under a recorded budget, and at least one intentionally flawed fixture for each major failure mode. Preserve their artifacts as evaluator calibration fixtures rather than candidate examples.
- **Acceptance:** The baseline set covers missing, placeholder, partial, strong, and exceptional anchors; expected score bands and rationale are reviewed by at least two people.
- **Dependencies:** A1, H2.

### A6. Test the value of the incremental design

- **Priority / effort:** P2 / L
- **Outcome:** Phase splitting is supported by evidence rather than assumption.
- **Work:** Run a small controlled comparison of incremental four-phase development versus one-shot delivery and, optionally, persistent-context versus fresh-context phases. Measure quality, regressions, cost, and completion rate.
- **Acceptance:** A short study records the protocol and results and either validates the current design or proposes a versioned change.
- **Dependencies:** A3, A4, B1.

### A7. Plan a multi-task benchmark suite

- **Priority / effort:** P2 / XL
- **Outcome:** Stagebench can make broader claims than performance on one public product.
- **Work:** Define two or more additional reconstruction tasks with different UI/audio/system characteristics, licensing-safe references, matched difficulty, and shared evaluation dimensions. Keep Nord as one task rather than silently changing it.
- **Acceptance:** A design proposal includes task-selection criteria, pilot protocol, cross-task aggregation, and leakage considerations; no new task is added before a pilot reliability study.
- **Dependencies:** A1–A5, H6.

---

## Project B — Make every run immutable and reproducible

### B1. Introduce a protocol release manifest

- **Priority / effort:** P0 / M
- **Outcome:** “Benchmark version 2.0.0” resolves to exact benchmark inputs.
- **Work:** Create a canonical release manifest containing phase manifest, prompt, spec, rubric, verifier, reference-asset checksum, starter-template, and orchestration-policy hashes. Generate the version from this release rather than hardcoding it in `manage-run.mjs`.
- **Acceptance:** Run creation fails if protocol files do not match the selected release; `run.json` records the release ID and digest; old releases remain readable.
- **Dependencies:** A1.

### B2. Record the repository and source snapshot

- **Priority / effort:** P0 / S
- **Outcome:** A run points to the exact code state that launched it.
- **Work:** Record git commit, dirty-tree status, relevant uncommitted patch hash (or forbid dirty launches), branch, and runner skill digest. Decide whether official runs require a clean signed tag.
- **Acceptance:** Official-track run creation refuses an ambiguous dirty source state; exploratory runs may proceed but are visibly marked non-reproducible.
- **Dependencies:** B1.

### B3. Add cryptographic reference-asset verification

- **Priority / effort:** P0 / S
- **Outcome:** Every candidate and evaluator uses identical photos/manual bytes.
- **Work:** Store URL, expected SHA-256, expected media type, and minimum size for each legal fetch target. Verify existing and newly downloaded files and reject unexpected HTML/error bodies.
- **Acceptance:** `pnpm fetch:reference` prints verified digests, fails on mismatch, and a run records the digest set without redistributing the assets.
- **Dependencies:** B1.

### B4. Expand the run manifest to capture generation provenance

- **Priority / effort:** P0 / M
- **Outcome:** The run can be audited without reading a transcript.
- **Work:** Add schema-versioned fields for agent identity, model response identity, exact settings, phase start/end times, attempts, exit reasons, tool versions, operating system/architecture, browser version, Node/pnpm versions, network policy, budget, and protocol digest.
- **Acceptance:** Required fields are captured automatically; official runs cannot publish with placeholders or user-asserted model identity alone.
- **Dependencies:** A2, A3, B1, B2.

### B5. Capture token, cost, latency, and tool telemetry

- **Priority / effort:** P1 / M
- **Outcome:** Quality can be evaluated alongside resources.
- **Work:** Record per-phase input/output/reasoning tokens where available, wall time, implementation and repair attempts, subagent count, tool-call counts, package download time, and estimated cost. Mark unavailable values explicitly rather than as zero.
- **Acceptance:** Reports show totals and phase breakdowns; configuration summaries can plot score versus cost/time; telemetry schema distinguishes measured, estimated, and unavailable.
- **Dependencies:** A3, B4, D2.

### B6. Snapshot candidate inputs at phase start

- **Priority / effort:** P1 / M
- **Outcome:** Later repository changes cannot alter what a phase received.
- **Work:** Create a phase-input manifest with hashes for prompt, assigned specs, inherited artifact, reference set, starter, and allowed support files. Store it outside the candidate-writable directory.
- **Acceptance:** Verification compares the recorded input manifest with the actual phase inputs and reports drift.
- **Dependencies:** B1, C1.

### B7. Add explicit schema migrations

- **Priority / effort:** P1 / M
- **Outcome:** Legacy three-phase and current four-phase data are handled deliberately.
- **Work:** Version `run.json`, assessment, evaluation, verification, and implementation-details schemas independently. Add read-time migrations or a one-way migration command, and encode `protocolKind`/`phaseCount` instead of inferring legacy behavior from array length.
- **Acceptance:** Every gallery record validates after migration; historical data remains identifiable and is never silently scored with a newer rubric.
- **Dependencies:** I1, B1.

---

## Project C — Isolate candidates and standardize execution

### C1. Run candidates in a solution-free filesystem

- **Priority / effort:** P0 / L
- **Outcome:** A fresh candidate cannot inspect previous Stagebench solutions.
- **Work:** Build each run from an allowlisted benchmark bundle or clean worktree/container that excludes `runs/`, `public/previews/`, reports, git history containing solutions, and evaluator outputs. Mount only the assigned phase directory as writable.
- **Acceptance:** An automated isolation test proves candidate processes cannot read another run, the gallery registry, or evaluator files. The parent still collects artifacts after completion.
- **Dependencies:** B1.

### C2. Enforce one-way phase inheritance

- **Priority / effort:** P0 / M
- **Outcome:** Phase N sees its own prior artifact but not later prompts or unrelated answers.
- **Work:** Create an explicit phase bundle containing only inherited candidate files, current prompt/specs, allowed references, and the testing contract. Prevent access to future prompts/specs if the benchmark claims they are hidden at that stage.
- **Acceptance:** Bundle-content tests enumerate allowed files for all phases; a candidate cannot traverse to the host repository.
- **Dependencies:** C1, B6.

### C3. Define and enforce a network policy

- **Priority / effort:** P0 / M
- **Outcome:** External help and dependency access are comparable.
- **Work:** Decide whether candidates have no network, registry-only access, or unrestricted access as distinct tracks. If registry access is allowed, proxy/log requests and freeze approved dependency sources. Pre-fetch references outside the candidate environment.
- **Acceptance:** Network behavior is technically enforced and recorded; failures cannot silently switch tracks.
- **Dependencies:** A3, C1.

### C4. Provide a pinned execution image

- **Priority / effort:** P0 / L
- **Outcome:** OS, browser, fonts, audio APIs, and build tooling are repeatable.
- **Work:** Package a container/VM image with pinned Node, pnpm, Chromium, fonts, screenshot tooling, and audio test support. Record the image digest. Define CPU, memory, and disk limits.
- **Acceptance:** The same known fixture produces matching technical results and near-identical canonical screenshots on two clean hosts.
- **Dependencies:** A3, C1.

### C5. Control nondeterminism

- **Priority / effort:** P1 / M
- **Outcome:** Tests and evidence are stable enough to compare.
- **Work:** Define seeded random sources where the agent/runtime allows it, fixed locale/time zone, deterministic test clocks, browser flags, animation disabling for capture, font readiness, and consistent viewport/device scale.
- **Acceptance:** Repeated captures of calibration fixtures meet documented pixel/metric tolerances; run manifests record seed and capture environment.
- **Dependencies:** C4, F1.

### C6. Separate source, working dependencies, and retained artifacts

- **Priority / effort:** P1 / L
- **Outcome:** Active runs do not balloon local disk or commit redundant material.
- **Work:** Keep one content-addressed dependency store, exclude per-phase `node_modules`, store phase deltas or source snapshots rather than blind full copies, deduplicate inherited evidence/audio, and define which builds belong in Git versus artifact storage.
- **Acceptance:** A full four-phase calibration run uses a measured target substantially below today’s multi-gigabyte workspace behavior; cleanup never removes the authoritative source/evaluation record.
- **Dependencies:** D9, I7.

---

## Project D — Turn the prose workflow into a reliable benchmark CLI

### D1. Add `stagebench doctor`

- **Priority / effort:** P1 / M
- **Outcome:** Operators discover setup failures before an expensive run.
- **Work:** Check protocol integrity, clean/allowed git state, reference digests, Node/pnpm/browser availability, model selection support, disk space, port availability, credentials, container/runtime support, and network track.
- **Acceptance:** The command exits nonzero with actionable fixes, supports human and JSON output, and is required by official run creation.
- **Dependencies:** B1–B4, C3–C4.

### D2. Build one typed `stagebench` command surface

- **Priority / effort:** P1 / L
- **Outcome:** Operators do not memorize internal script paths and npm aliases.
- **Work:** Provide subcommands such as `doctor`, `run`, `resume`, `status`, `verify`, `evaluate`, `publish`, `archive`, and `reindex`. Use validated option parsing, consistent errors/exit codes, `--json`, `--dry-run`, and generated help.
- **Acceptance:** README workflows use the public CLI only; existing scripts become libraries or compatibility shims; contract tests cover invalid arguments and exit codes.
- **Dependencies:** D1, I1.

### D3. Implement a durable run state machine

- **Priority / effort:** P0 / L
- **Outcome:** Invalid transitions are impossible even when the prose skill is bypassed.
- **Work:** Encode allowed run/phase states and transition prerequisites: preparation requires prior completion, completion requires a passing verification, evaluation requires a sealed artifact, publication requires the configured evaluation policy, and partial/failure states have explicit semantics.
- **Acceptance:** Transition tests reject skipping phases, completing without verification, publishing without required evaluations, reopening sealed artifacts, and mutating finished official runs.
- **Dependencies:** B4, E2.

### D4. Make the workflow resumable and idempotent

- **Priority / effort:** P1 / L
- **Outcome:** A crash or app restart does not require manual reconstruction.
- **Work:** Journal every orchestration step, input/output artifact, agent attempt, and external process ID. On resume, detect completed durable steps, validate their hashes, and continue. Make preview/report generation safe to rerun.
- **Acceptance:** Integration tests interrupt a fixture run after creation, build, verification, and evaluation, then successfully resume each case without duplicate scoring or corrupted status.
- **Dependencies:** D3, D5.

### D5. Add per-run locking and transactional writes

- **Priority / effort:** P0 / M
- **Outcome:** Concurrent agents and commands cannot lose metadata updates.
- **Work:** Use an advisory lock or atomic lease per run, revision numbers for compare-and-swap updates, temp-file + fsync/rename semantics, and stale-lock recovery. Stop dual-writing the generated gallery index during every run mutation.
- **Acceptance:** A concurrency test starts conflicting writers and proves one waits/fails cleanly; `run.json` stays valid; `reindex` deterministically rebuilds the registry after completion.
- **Dependencies:** I2.

### D6. Create a benchmark-owned candidate starter

- **Priority / effort:** P1 / M
- **Outcome:** Scores measure Nord implementation more than repetitive Vite setup choices.
- **Work:** Supply a minimal React/TypeScript/pnpm project with required scripts, test framework, Vite base, browser/audio test shims, evidence directories, and empty implementation manifest. Decide which architecture is intentionally left open.
- **Acceptance:** Phase 1 starts from a versioned starter hash; all candidates receive identical scaffolding; setup time and avoidable package-manager failures decrease in pilot runs.
- **Dependencies:** B1, C1.

### D7. Generate prompt boilerplate from the phase manifest

- **Priority / effort:** P1 / M
- **Outcome:** Specs, prompts, verifier requirements, and docs do not drift.
- **Work:** Move repeated spec lists, hard gates, evidence paths, required feature IDs, and commands into canonical structured files. Render prompt sections and documentation tables from them while preserving authored task guidance.
- **Acceptance:** A consistency test fails when a prompt, verifier, rubric, and phase manifest disagree; duplicate hardcoded feature arrays are removed.
- **Dependencies:** E1, I1.

### D8. Add official `smoke`, `pilot`, and `full` modes

- **Priority / effort:** P1 / M
- **Outcome:** Contributors can test infrastructure without spending full benchmark resources.
- **Work:** Define a synthetic smoke fixture, shortened pilot budget, and official full protocol. Mark outputs so smoke/pilot results can never enter the official leaderboard.
- **Acceptance:** `stagebench run --mode smoke` completes end to end locally; registry and gallery visibly classify its output as non-comparable.
- **Dependencies:** A3, D2–D4.

### D9. Add safe archive and cleanup commands

- **Priority / effort:** P1 / M
- **Outcome:** Operators can reclaim disk without guessing what is disposable.
- **Work:** Report space by run/phase/category; remove only caches, `node_modules`, temporary browsers, and regenerable builds; optionally package immutable sources/evidence/evaluations with checksums.
- **Acceptance:** `--dry-run` lists exact paths and bytes; cleanup preserves everything required to rebuild reports and verify provenance; tests cover active-run refusal.
- **Dependencies:** C6, I7.

### D10. Write an operator runbook and failure guide

- **Priority / effort:** P1 / M
- **Outcome:** A new maintainer can run, resume, diagnose, and publish without reading implementation code.
- **Work:** Document expected duration/cost/disk, official versus exploratory runs, error recovery, stale runs, evaluator replacement policy, reference failures, security boundaries, and release procedure.
- **Acceptance:** A person unfamiliar with the repository completes the smoke protocol using only the runbook and records any missing step.
- **Dependencies:** D1–D9.

---

## Project E — Replace presence checks with benchmark-owned verification

### E1. Create one canonical phase requirement registry

- **Priority / effort:** P0 / M
- **Outcome:** Required features exist in one structured source.
- **Work:** Move feature IDs, inherited requirements, evidence kinds, hard gates, and assigned specs into a schema-validated registry used by prompts, verifier, evaluator templates, and docs.
- **Acceptance:** `REQUIRED_FEATURES` is no longer duplicated in script code; every requirement has an owner, phase, verification method, and rubric mapping.
- **Dependencies:** I1.

### E2. Seal verified phase artifacts

- **Priority / effort:** P0 / M
- **Outcome:** The artifact evaluated is exactly the artifact that passed verification.
- **Work:** Hash the complete retained source/build/evidence tree after verification, store the verification digest outside candidate write access, and prevent or detect mutation before evaluation/publication.
- **Acceptance:** Editing any sealed file invalidates evaluation and publication until a new versioned attempt is verified; reports reference the artifact digest.
- **Dependencies:** B6, D3.

### E3. Build benchmark-owned black-box browser tests

- **Priority / effort:** P0 / XL
- **Outcome:** Core behavior is assessed by tests the candidate did not author.
- **Work:** Create external Playwright scenarios for startup, console cleanliness, keyboard geometry, control accessibility, pointer/keyboard interaction, phase-specific program flows, state persistence, and failure handling. Prefer user-visible/accessibility queries; define a narrow test adapter only where black-box access is impossible.
- **Acceptance:** The harness runs outside the candidate tree, cannot be edited by candidates, emits structured evidence, and distinguishes the calibration fixtures at expected levels.
- **Dependencies:** C1, C4, D6, E1.

### E4. Verify candidate tests actually execute and assert behavior

- **Priority / effort:** P0 / L
- **Outcome:** Feature-matrix coverage is evidence, not a filename claim.
- **Work:** Capture test enumeration/results, map feature IDs to named tests, reject skipped/todo-only mappings, require assertion counts or framework events, detect identical catch-all mappings, and add coverage/mutation checks for critical modules where practical.
- **Acceptance:** The current trivial self-test pattern—every feature pointing to one non-empty export—fails. A mapped test must appear in the executed result and contain at least one relevant passing assertion.
- **Dependencies:** D6, E1.

### E5. Validate evidence files semantically

- **Priority / effort:** P0 / M
- **Outcome:** Text renamed `.png` and stale screenshots cannot pass.
- **Work:** Decode images, check format/dimensions, capture time, viewport metadata, perceptual uniqueness, and artifact association. Generate screenshots from the parent harness rather than trusting candidate files when possible.
- **Acceptance:** Invalid bytes, wrong dimensions, duplicate desktop/narrow images, and screenshots not matching the sealed build all fail verification.
- **Dependencies:** E2, F1.

### E6. Convert hard gates into executable checks or structured attestations

- **Priority / effort:** P0 / L
- **Outcome:** A sentence copied into a plan does not satisfy a gate.
- **Work:** Classify gates as mechanically testable, evaluator-observed, or provenance-attested. Implement the mechanical checks, require structured evidence locators for observed gates, and reserve attestation for facts that cannot be independently measured.
- **Acceptance:** Substring matching in `IMPLEMENTATION_PLAN.md` is not a completion signal; every gate records verifier/evaluator result and evidence source.
- **Dependencies:** E1, E3–E5, H4.

### E7. Run technical checks once per sealed artifact and reuse them

- **Priority / effort:** P1 / M
- **Outcome:** Verification and evaluation cannot disagree because they reran different code or environments.
- **Work:** Centralize package-manager validation and check execution, store full logs plus normalized results against the artifact digest, and have scoring consume that record. Allow explicit rerun only as a new attempt.
- **Acceptance:** `verify` and `evaluate` use the same technical-check library/result; timeout, signal, missing executable, and truncated-output cases are tested.
- **Dependencies:** E2, D3.

### E8. Add adversarial verifier fixtures

- **Priority / effort:** P1 / L
- **Outcome:** The verifier is tested against cheating and accidental false positives.
- **Work:** Add fixtures with fake PNGs, skipped tests, always-pass tests, copied evidence, missing inherited behavior, decorative controls, disconnected audio, modified post-verification files, path escapes/symlinks, and misleading manifests.
- **Acceptance:** CI demonstrates that each fixture fails for the intended reason and that valid fixtures pass.
- **Dependencies:** E3–E7.

---

## Project F — Make visual fidelity measurement repeatable

### F1. Build a canonical screenshot harness

- **Priority / effort:** P0 / L
- **Outcome:** Every run is captured under identical conditions.
- **Work:** Pin browser, viewport, device scale, fonts, color mode, reduced motion, load/idle criteria, and screenshot format. Capture desktop and narrow images from the sealed build, record browser logs, and hash outputs.
- **Acceptance:** The harness produces the required images and metadata without candidate cooperation; repeated fixture captures stay within documented tolerance.
- **Dependencies:** C4–C5, E2.

### F2. Create versioned reference annotations

- **Priority / effort:** P0 / L
- **Outcome:** “Match the image” has reproducible landmarks.
- **Work:** For each hardware variant, annotate chassis bounds, rails, deck/keybed split, section boundaries, OLEDs, keyboard bounds, key counts, forbidden regions, representative controls, and colors. Record how source-image perspective/cropping is handled.
- **Acceptance:** Annotation files validate against image dimensions, render as an overlay for review, and are tied to reference hashes.
- **Dependencies:** B3.

### F3. Add quantitative visual metrics

- **Priority / effort:** P1 / XL
- **Outcome:** Evaluators receive objective measurements alongside judgment.
- **Work:** Measure silhouette/aspect error, landmark displacement, section-width error, key geometry/count, chassis color coverage, forbidden-object violations, overflow/clipping, and optionally perceptual similarity on aligned crops. Do not use one whole-image similarity score as the final rating.
- **Acceptance:** Metrics correctly rank purpose-built good/medium/bad fixtures; thresholds and failure modes are documented; raw overlays and measurements are retained.
- **Dependencies:** F1–F2, A5.

### F4. Add cross-phase visual regression measurement

- **Priority / effort:** P1 / M
- **Outcome:** Later features cannot quietly degrade the Phase 1 surface.
- **Work:** Align each phase with its predecessor and report changed pixels/landmarks outside allowlisted dynamic regions. Separate intentional display-state changes from geometry drift.
- **Acceptance:** A calibration fixture with shifted panels fails while legitimate OLED/text changes pass; reports show a diff overlay.
- **Dependencies:** F1–F3.

### F5. Define responsive success separately from product fidelity

- **Priority / effort:** P1 / M
- **Outcome:** Narrow behavior is scored consistently without pretending a physical keyboard has a canonical mobile form.
- **Work:** Specify acceptable strategies (fit-to-width, scrollable inspection, detail mode, etc.), minimum control legibility/target size, no-loss rules, and which choices affect fidelity versus usability.
- **Acceptance:** The rubric and browser harness use explicit narrow assertions; evaluators do not invent personal preferences per run.
- **Dependencies:** A1, F1.

---

## Project G — Make audio and interaction evaluation objective

### G1. Define a narrow Stagebench conformance adapter

- **Priority / effort:** P0 / L
- **Outcome:** The evaluator can drive and inspect audio behavior without dictating application architecture.
- **Work:** Design an optional/required test-only adapter for note events, sustain, parameters, program state, offline rendering, active voice count, graph diagnostics, and cleanup. Keep production UI behavior independently testable and prevent adapter-only implementations from receiving credit.
- **Acceptance:** The adapter is versioned, supplied by the starter, disabled or read-only in published builds as appropriate, and exercised by benchmark-owned tests.
- **Dependencies:** D6, E3.

### G2. Create deterministic input and behavior traces

- **Priority / effort:** P0 / L
- **Outcome:** Every candidate receives the same musical and interaction stimuli.
- **Work:** Define MIDI/note sequences for velocity, overlap, sustain, stealing, panic, splits, morphs, scenes, program round-trip, effects, Organ models, Synth sources, arp/gate, and rapid-load stress. Include expected state invariants.
- **Acceptance:** Traces run in real-time browser smoke tests and deterministic/offline tests; failures name the violated invariant and event index.
- **Dependencies:** G1, E1.

### G3. Add rendered-audio measurements

- **Priority / effort:** P0 / XL
- **Outcome:** “Audibly different” and “connected” become testable claims.
- **Work:** Render standardized traces and measure silence, clipping, RMS/peak, duration, release behavior, spectral centroid/band energy, channel differences, effect tails, modulation periodicity, and deterministic distinctions between models/sources. Use tolerant relationships rather than exact waveform goldens across browser versions.
- **Acceptance:** Disconnected controls, renamed identical oscillators, silent fallbacks, ineffective effects, and stuck voices fail calibration fixtures; metric tolerances are documented.
- **Dependencies:** C4, G1–G2, A5.

### G4. Add real-time latency and load tests

- **Priority / effort:** P1 / L
- **Outcome:** Playability and stability have common measures.
- **Work:** Measure input-to-scheduled-audio latency, main-thread stalls, underrun proxies, voice cleanup, memory growth, CPU under standardized layered play, and recovery after focus/MIDI failures. Define host limits before comparing runs.
- **Acceptance:** Reports contain comparable p50/p95 latency and stress results; tests identify clicks/clipping/voice leaks using documented proxies.
- **Dependencies:** C4, G2.

### G5. Strengthen sample and license provenance

- **Priority / effort:** P1 / M
- **Outcome:** Published audio is legal, traceable, and truthfully described.
- **Work:** Hash bundled audio, verify every file is covered by a source/license entry, distinguish redistribution rights from attribution, reject undeclared remote loads, and scan build output as well as source.
- **Acceptance:** Orphan audio files, unapproved network audio, and file-list/provenance mismatches fail publication; the report links each detected asset to its manifest entry.
- **Dependencies:** E2, I1.

### G6. Separate functional audio scores from musical-quality judgment

- **Priority / effort:** P1 / M
- **Outcome:** Objective connection/behavior and subjective realism are not conflated.
- **Work:** Split criteria into conformance (note lifecycle, routing, control effect, cleanup) and perceptual quality (piano realism, model character, artifacts). Define when listening is required and how it is blinded.
- **Acceptance:** Rubric weights and evaluator forms clearly separate the two; objective failures cannot be overridden by a favorable musical impression.
- **Dependencies:** G3, H2–H3.

---

## Project H — Calibrate evaluators and scoring

### H1. Blind evaluation to model and provider identity

- **Priority / effort:** P0 / M
- **Outcome:** Brand/model expectations are less likely to affect ratings.
- **Work:** Give evaluators opaque trial IDs and a solution-only bundle. Remove model names from page titles, paths, reports, and metadata visible during scoring. Reveal identity only after the assessment is sealed.
- **Acceptance:** An automated bundle audit finds no configured identity strings; evaluation metadata records when unblinding occurred.
- **Dependencies:** C1, B4.

### H2. Use at least two independent evaluators for official runs

- **Priority / effort:** P0 / L
- **Outcome:** A score is not one judge’s unmeasured opinion.
- **Work:** Collect independent ratings before either sees the other, calculate agreement per criterion/category, and define adjudication or median/mean policy for material disagreements. Keep automated measures separate.
- **Acceptance:** Official reports show evaluator count and agreement; disagreements above a preset threshold trigger adjudication rather than silent averaging.
- **Dependencies:** A3, H1.

### H3. Create criterion-specific anchor examples and evaluator training

- **Priority / effort:** P0 / L
- **Outcome:** Ratings 0–4 mean similar things across evaluators and time.
- **Work:** For every criterion, provide observable anchor descriptions and selected calibration evidence for at least ratings 1, 2, and 3; clarify disqualifying conditions and how partial breadth/depth trade off. Run a short calibration assessment before official scoring.
- **Acceptance:** Evaluators meet a documented agreement threshold on held-out calibration fixtures; ambiguous criteria are revised before release.
- **Dependencies:** A5, H2.

### H4. Require structured, traceable evidence

- **Priority / effort:** P0 / M
- **Outcome:** Every rating can be audited.
- **Work:** Replace free-form-only evidence strings with typed locators: screenshot/region, video timestamp, browser scenario/result, audio trace/metric, source file/line, test result, or evaluator observation. Require at least one direct observation for user-facing criteria.
- **Acceptance:** Assessment validation rejects missing/unknown artifact references and source-only proof for interactive/audio claims; reports deep-link to retained evidence.
- **Dependencies:** E3, F1, G2, I1.

### H5. Separate validity status from quality score

- **Priority / effort:** P0 / M
- **Outcome:** An invalid artifact is not represented as merely a 49 or 59.
- **Work:** Define statuses such as valid, valid-with-warnings, invalid-technical, incomplete, budget-exceeded, and infrastructure-failure. Decide which failures yield no official score, which reduce a separate reliability dimension, and which legitimately affect quality.
- **Acceptance:** Reports and gallery never rank invalid/incomplete runs beside complete valid runs by one number; raw quality estimates may remain available diagnostically.
- **Dependencies:** A1, D3.

### H6. Validate rubric weights empirically

- **Priority / effort:** P1 / XL
- **Outcome:** Weights and aggregation reflect intended importance and discriminate useful quality differences.
- **Work:** Score calibration fixtures and pilot runs, inspect criterion correlations/double-counting, sensitivity to one-point changes, phase correlation, ceiling/floor effects, and ranking stability. Revisit double-counting inherited behavior across phases.
- **Acceptance:** A rubric-validation note justifies weights, documents sensitivity, and records reviewer approval; changes create a new protocol/rubric version.
- **Dependencies:** A5, H2–H4, F3, G3.

### H7. Define evaluator-error and appeal policy

- **Priority / effort:** P1 / M
- **Outcome:** “First score is final” does not preserve obvious evaluator or infrastructure mistakes.
- **Work:** Distinguish candidate repair (not allowed after evaluation) from assessment correction, missing evidence, corrupt capture, rubric bug, or evaluator noncompliance. Define who can reopen, required audit log, and when all comparable runs need rescoring.
- **Acceptance:** Every assessment revision is append-only, reasoned, and visible; protocol bugs trigger a versioned remediation plan rather than selective rescoring.
- **Dependencies:** B1, H2.

### H8. Report uncertainty and score precision honestly

- **Priority / effort:** P1 / M
- **Outcome:** Displayed precision matches evaluator and trial reliability.
- **Work:** Use trial variation and inter-rater disagreement to choose decimals/rounding, confidence intervals, and minimum meaningful difference. Stop implying that tenths are meaningful if ratings are coarse and unstable.
- **Acceptance:** Configuration-level reports include uncertainty; the gallery explains ties and avoids rank claims inside the minimum meaningful difference.
- **Dependencies:** A4, H2, H6.

---

## Project I — Harden schemas, registry, reports, and gallery

### I1. Add JSON Schemas for every persisted contract

- **Priority / effort:** P0 / L
- **Outcome:** Data shape is validated consistently at CLI, tests, and publication.
- **Work:** Define schemas for protocol releases, phase specs/requirements, run manifests, phase attempts, feature matrices, implementation details, verifications, assessments, evaluations, telemetry, and registry entries. Generate TypeScript types where useful.
- **Acceptance:** All existing data either validates or has an explicit migration/legacy schema; ad hoc shape assertions are replaced by shared validation with useful paths/errors.
- **Dependencies:** B1, E1.

### I2. Make `run.json` the only mutable run source of truth

- **Priority / effort:** P0 / M
- **Outcome:** Registry drift and lost dual writes disappear.
- **Work:** Remove registry writes from ordinary run/evaluation save paths. Rebuild `src/data/runs.json` transactionally from sealed run manifests during publication/build, with deterministic ordering and a generated-file header or check.
- **Acceptance:** CI fails on stale registry; deleting and regenerating it yields byte-identical output; concurrent run updates do not touch it.
- **Dependencies:** D5, I1.

### I3. Separate official, exploratory, legacy, partial, and invalid results

- **Priority / effort:** P0 / M
- **Outcome:** Users cannot accidentally compare unlike records.
- **Work:** Add explicit classification and compatibility series. Filter/rank official complete results by default; show exploratory/legacy/partial/invalid records in clearly labeled views with coverage.
- **Acceptance:** A normalized partial score never appears as a complete leaderboard peer; legacy three-phase runs do not share a rank with current protocol runs.
- **Dependencies:** H5, B7.

### I4. Add configuration-level trial summaries

- **Priority / effort:** P1 / L
- **Outcome:** The gallery represents repeated benchmark results, not only individual anecdotes.
- **Work:** Group trials by agent configuration/protocol/track, show completion rate, central score, spread/confidence interval, phase distributions, cost/time, and failure reasons. Keep each trial inspectable.
- **Acceptance:** Summary calculations are tested against fixtures and never combine incompatible protocol or resource tracks.
- **Dependencies:** A4, B4–B5, H8.

### I5. Add criterion and phase comparison views

- **Priority / effort:** P2 / L
- **Outcome:** Users can understand why results differ.
- **Work:** Compare configurations by phase, objective metrics, rubric categories, reliability, regressions, time/cost, and evaluator agreement. Include protocol filters and avoid a single-rank-only presentation.
- **Acceptance:** Every chart/table states sample size, protocol, track, coverage, and uncertainty; links reach underlying evidence.
- **Dependencies:** I4, H4.

### I6. Sandbox untrusted candidate previews

- **Priority / effort:** P0 / M
- **Outcome:** Generated applications cannot control or impersonate the gallery shell.
- **Work:** Serve candidates from a separate origin when possible; otherwise apply restrictive iframe `sandbox`, CSP, permissions policy, and explicit allowlist for audio/MIDI/fullscreen needs. Keep evaluation reports in a safer separate policy.
- **Acceptance:** A malicious fixture cannot access parent DOM/storage, navigate the top frame, open unauthorized popups, or call unnecessary device APIs; required audio interaction still works after user gesture.
- **Dependencies:** C1.

### I7. Define artifact retention and storage policy

- **Priority / effort:** P1 / M
- **Outcome:** The repository remains usable as runs accumulate.
- **Work:** Decide retention for source snapshots, lockfiles, builds, screenshots, audio, logs, transcripts, dependency caches, and reports. Use content-addressed external artifacts where appropriate and store hashes/URLs in Git.
- **Acceptance:** Policy states what is reproducible versus archived, includes backup/expiry behavior, and prevents deleting evidence referenced by official reports.
- **Dependencies:** C6, B4.

### I8. Add a machine-readable results export

- **Priority / effort:** P2 / M
- **Outcome:** Researchers can analyze results without scraping the UI.
- **Work:** Publish a versioned export containing compatible trial/config summaries, scores, uncertainty, objective metrics, budgets, provenance, classifications, and artifact links—excluding secrets and third-party copyrighted assets.
- **Acceptance:** Export validates against a public schema and is generated from authoritative records; methodology documents citation and interpretation.
- **Dependencies:** I1, I3–I4.

---

## Project J — Strengthen repository tests, CI, and contributor experience

### J1. Expand unit tests for run management and evaluator scripts

- **Priority / effort:** P1 / L
- **Outcome:** Script behavior, not only happy-path self-test output, is protected.
- **Work:** Test every command, state transition, invalid option, path/symlink escape, missing file, corrupt JSON, timeout, failed subprocess, report regeneration, registry ordering, and legacy migration using isolated fixtures.
- **Acceptance:** Tests import core libraries directly where possible and assert structured outputs/status, not merely `stdout` containing `"ok": true`.
- **Dependencies:** D2–D5, I1.

### J2. Add end-to-end orchestration fixtures

- **Priority / effort:** P1 / L
- **Outcome:** The complete benchmark plumbing is continuously exercised.
- **Work:** Use a tiny deterministic fake agent/evaluator to perform create → phase bundle → build → verify → seal → evaluate → publish → reindex → gallery render. Include resume and failure cases.
- **Acceptance:** CI runs the smoke fixture without external models or Nord references and asserts artifact digests, statuses, and report links.
- **Dependencies:** D3–D8, E2.

### J3. Split CI into fast, integration, and release tiers

- **Priority / effort:** P1 / M
- **Outcome:** Contributors get quick feedback while expensive checks still run before protocol releases.
- **Work:** Keep formatting/type/unit checks fast; run orchestration/browser fixtures in integration jobs; run container reproducibility, schema migration, gallery safety, and calibration checks for release/nightly workflows. Add concurrency cancellation and artifact logs.
- **Acceptance:** Branch protection requires the appropriate tier; failures retain useful logs; release tags cannot be created with protocol/hash drift.
- **Dependencies:** J1–J2, B1.

### J4. Add generated documentation consistency tests

- **Priority / effort:** P1 / M
- **Outcome:** README, BENCHMARK, TESTING, skill instructions, and CLI help remain accurate.
- **Work:** Generate command/reference tables from canonical definitions and test links, filenames, phase counts, required scripts, and terminology. Correct the current testing README claim that evaluation reruns only typecheck/lint/build when the active rubric also requires tests.
- **Acceptance:** CI detects stale generated sections and broken local links; one glossary consistently uses “phase” versus legacy “stage.”
- **Dependencies:** D7, I1.

### J5. Add a contributor quickstart and architecture map

- **Priority / effort:** P1 / M
- **Outcome:** New contributors can locate the source of truth and make safe changes.
- **Work:** Document repository layers (protocol, runner, candidate artifacts, evaluator, gallery), how data flows, which files are generated, how to run smoke tests, how to add a criterion/spec field, and how to release a protocol version.
- **Acceptance:** Quickstart reaches a passing smoke run from a clean clone; architecture map identifies ownership and mutation boundaries.
- **Dependencies:** D2, D8, I2.

### J6. Add stale-run inspection and recovery UX

- **Priority / effort:** P1 / M
- **Outcome:** “running” records do not linger without explanation.
- **Work:** Show last durable event, active lease, elapsed time, budget, current step, and recommended recovery action. Provide `status`, `resume`, `fail --reason`, and `abandon` with audit logs.
- **Acceptance:** A stale-run fixture is detected deterministically; recovery never rewrites an official sealed attempt in place.
- **Dependencies:** D3–D5.

### J7. Add benchmark release checklists and changelog

- **Priority / effort:** P1 / S
- **Outcome:** Protocol changes are deliberate and comparable series are preserved.
- **Work:** Require impact classification for prompt/spec/rubric/verifier/starter/reference changes, migration notes, calibration results, and whether old scores remain comparable. Maintain a human-readable changelog keyed by protocol release.
- **Acceptance:** CI/release tooling requires a release manifest and changelog entry when comparison-critical files change.
- **Dependencies:** B1, H6.

---

## Suggested implementation waves

### Wave 0 — Decide policy before coding

Approve A1–A4, A2’s identity fields, A3’s resource tracks, H5’s invalidity semantics, and the official-versus-exploratory distinction. These decisions shape nearly every schema and command.

### Wave 1 — Trustworthy run core

Implement B1–B4, B3, C1–C4, D3, D5, E1–E2, I1–I3, and I6. At the end of this wave, new official runs are isolated, attributable, immutable, and not mixed with legacy/partial results.

### Wave 2 — Verification that means something

Implement D6–D8, E3–E8, F1–F2, G1–G3, and H4–H5. At the end of this wave, completion gates rely on benchmark-owned observations and authentic captured evidence.

### Wave 3 — Reliable human/LLM judgment

Implement A5, F3–F5, G4–G6, H1–H3, H6–H8. Pilot and revise until evaluator agreement and metric behavior are acceptable.

### Wave 4 — Operational excellence and reporting

Implement B5–B7, C5–C6, D1–D2/D4/D9–D10, I4–I8, and J1–J7. Then run the first repeated official trial set.

### Wave 5 — Generalization research

Only after Nord reliability is measured, perform A6 and A7 to validate incrementality and expand the suite.

## Proposed initial approval slice

If approving everything at once is too broad, the smallest high-leverage project slice is:

1. A1–A4 — define claims, identity, budget, and repeated trials.
2. B1–B4 — immutable protocol and provenance.
3. C1–C4 — isolation and pinned execution.
4. D3/D5 — state machine and locking.
5. E1–E6 — canonical requirements, sealing, benchmark-owned checks, and authentic evidence.
6. H1–H5 — blinded, multi-evaluator, calibrated, evidence-backed scoring with validity separate from quality.
7. I1–I3/I6 — schemas, authoritative registry, result classes, and safe previews.

That slice addresses the largest threats to score credibility before investing in broader gallery polish or additional benchmark tasks.

## Definition of “benchmark v3 ready”

Stagebench should not label a new protocol release “ready for official comparison” until all of the following are true:

- The protocol release is immutable and content-addressed.
- Candidate access to prior solutions/evaluations is technically blocked.
- Model/agent identity and resource policy are automatically recorded.
- Execution environment and reference bytes are pinned.
- Phase state transitions require sealed verification artifacts.
- Benchmark-owned browser and audio checks cover critical behavior.
- Evidence is parent-captured, valid, and linked to the sealed artifact.
- Invalid/incomplete runs are not ranked as low-quality complete runs.
- Official assessments are blinded, independently duplicated, calibrated, and auditable.
- Inter-rater agreement and rubric sensitivity have been measured on fixtures/pilots.
- Official model summaries use repeated trials and show uncertainty, completion rate, time, and cost.
- Legacy and exploratory results remain viewable but cannot be mistaken for current official results.
- A new contributor can execute the smoke workflow and an operator can resume an interrupted run from documented commands.

