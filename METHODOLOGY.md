# Stagebench methodology

## Purpose

Stagebench measures how well a coding-agent configuration can reconstruct a complex, documented browser product under an incremental, evidence-backed workflow. The current task is a Nord Stage 4 study because it combines dense reference-driven UI, stateful interaction, real-time browser audio, device input, long-horizon architecture, and regression-sensitive extension.

The unit being evaluated is the **agent configuration**, not an abstract base model. A configuration includes the exact provider/model snapshot, reasoning setting, agent runtime, tools, orchestration/context policy, benchmark protocol, resource track, environment, and network policy recorded in `run.json`.

## What the benchmark measures

Within the recorded protocol, Stagebench provides evidence about:

- visual reconstruction from a supplied product image and measured specification;
- implementation of a responsive, accessible, dense hardware-style interface;
- browser input and audio programming;
- interpretation of a technical user manual and machine-readable requirements;
- incremental preservation and extension of an existing candidate artifact;
- testing, build reliability, source/provenance honesty, and runtime cleanup;
- delivery quality at three cumulative completion targets.

The three targets are:

1. complete surface and one basic playable Piano voice;
2. the inherited surface plus a multi-Piano library and connected effects;
3. the complete instrument, including Programs/performance systems, Organ, Synth, and all required bindings.

Selecting target 2 creates and evaluates Phases 1 and 2. Selecting target 3 creates and evaluates all three. This preserves incremental-development evidence; a later target is not a shortcut that omits its prerequisites.

## What the benchmark does not establish

Stagebench does not by itself establish:

- general software-engineering ability across domains;
- the quality of a base model independent of its agent, tools, settings, and budget;
- exact acoustic emulation of physical Nord hardware;
- production fitness, legal clearance, security, or accessibility certification;
- a statistically reliable model ranking from a single trial;
- comparability across different benchmark protocols, target phases, hardware variants, resource tracks, or validity classes;
- superiority when score differences are smaller than evaluator/trial uncertainty.

Nord is one public, recognizable product. Familiarity or training-data exposure may affect performance. Prior Stagebench solutions are therefore excluded from candidate filesystems, but public-task contamination cannot be proven absent. Results must be interpreted as performance on this disclosed task.

## Result classes

- **Official:** created under a declared comparison group and resource track, with complete provenance, isolated inputs, sealed verification, blinded evaluation, all selected phases complete, and valid technical gates.
- **Exploratory:** useful development evidence, but missing one or more official controls or intentionally run without a comparison track. Exploratory results are never ranked with official results.
- **Legacy:** predates protocol v3 identity/classification requirements. Legacy results remain viewable under their original rubric but are not current comparison evidence.

Validity is separate from quality. A run can be `valid`, `valid-with-warnings`, `invalid-technical`, `incomplete`, `budget-exceeded`, `infrastructure-failure`, or `legacy-unverified`. Invalid and incomplete runs may retain diagnostic raw scores, but they are not official ranked results.

## Comparison rules

Two trials are directly comparable only when all of the following match:

- protocol and rubric version;
- selected target phase and evaluated-phase coverage;
- hardware variant;
- resource/budget track;
- network policy and pinned execution environment;
- agent configuration fields designated comparison-critical;
- validity requirements.

Individual trials are observations, not model estimates. Configuration-level claims should use repeated trials and report completion rate, central tendency, dispersion or confidence interval, wall time, and cost/token telemetry where available. Stagebench does not currently prescribe a universal replicate count; until a repeated-trial release is declared, the gallery must label results exploratory or individual-trial evidence.

## Evidence model

Candidate-authored tests and notes are supporting evidence, not sole proof. The benchmark records:

- technical checks from the candidate artifact;
- a sealed digest tying source, build, and evidence to evaluation;
- parent-controlled canonical screenshots at 1440x900 and 390x844;
- direct browser interaction and console observations;
- real/offline audio-boundary checks where required;
- independent rubric assessment using an opaque trial identity;
- source and sample provenance.

An interactive or audible criterion cannot receive full credit from source presence alone. A control represented only by metadata, a label, or disconnected state is not implemented when the phase requires behavior.

## Principal threats to validity

### Construct validity

The task mixes visual, audio, architecture, and workflow ability. Aggregate weights express Stagebench priorities but do not prove a universal notion of coding quality. Each phase and category score should remain visible.

### Internal validity

Uncontrolled time, tokens, tools, network access, package availability, retries, evaluator identity, or environment can change outcomes. Protocol-v3 manifests record these factors; official comparisons must enforce the same track rather than merely record differences.

### Evaluation reliability

Rubric ratings are coarse and partly judgment-based. Blinding reduces identity bias but does not eliminate evaluator variance. A single evaluation should be treated as provisional evidence until multi-evaluator calibration and agreement reporting are operational.

### Contamination

The task and reference product are public. Candidate bundles exclude prior solutions, future prompts, run registries, reports, and evaluator output, and official execution is designed for a container with only candidate and allowlisted input mounts. This prevents direct solution copying from the Stagebench workspace; it cannot detect prior model training exposure.

### External validity

A result on one synthesizer recreation may not transfer to other products or codebases. Broader claims require additional tasks with different UI, system, and reference characteristics.

## Example interpretations

Valid: “Under Stagebench protocol 3.0.0, target 2, Stage 4 73, and the fixed-time track, configuration A’s recorded trial completed both phases with a valid aggregate of X, using Y minutes and Z estimated cost.”

Invalid: “Model A is a better coding model than Model B” based on one run each when they used different targets, reasoning settings, tools, budgets, variants, evaluator visibility, or protocol versions.

## Change policy

Prompts, phase scope, specs, rubrics, verifier behavior, starter code, reference bytes, resource policy, or evidence requirements are comparison-critical. Such changes require a new protocol release or a documented determination that stored results remain comparable. Historical results retain their original protocol/rubric identity and are never silently rescored as current results.
