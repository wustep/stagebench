// Isolated evaluator workspaces. A fresh evaluator agent works in an
// out-of-repo directory named by a blind handle (not the run id, so the model
// identity is not printed in the path it reads) with a copy of the sealed
// artifact and the scoring materials beside it, and never touches runs/, other
// runs' scores, or any other solution. The CLI passes run facts in; this
// module never reads or writes run.json.
import fs from 'node:fs'
import path from 'node:path'
import { NON_ARTIFACT_DIRS, blindRunCode, hashTree, loadProtocol, readJson, workspaceRoot, writeJson } from '../shared.mjs'
import { filterTaskToPhase, projectProtocol, projectVariants } from '../materials.mjs'
import { createAssessmentTemplate, isTopPhase } from './scoring.mjs'

// Must stay identical to what hashTree ignores, or the copy's digest can never
// match the digest recorded at seal.
const ARTIFACT_EXCLUDES = new Set(NON_ARTIFACT_DIRS)

export function evalWorkspaceDir(root, id, phase) {
  return path.join(workspaceRoot(root, 'eval'), blindRunCode(id), `stage${phase}`)
}

export function evalAssessmentPath(root, id, phase) {
  return path.join(evalWorkspaceDir(root, id, phase), 'assessment.json')
}

// Blinding: harness-written inputs must not name the run. The verification
// record carries the real runId (and could embed it in check output or
// workspace paths), so every string in it is rewritten to the blind handle
// before it reaches the evaluator.
function scrubRunIdentity(value, id, blindId) {
  if (typeof value === 'string') return value.split(id).join(blindId)
  if (Array.isArray(value)) return value.map((entry) => scrubRunIdentity(entry, id, blindId))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.split(id).join(blindId), scrubRunIdentity(entry, id, blindId)]))
  }
  return value
}

function copyInput(root, relativePath, inputRoot) {
  const source = path.resolve(root, relativePath)
  if (!source.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Input escapes repository: ${relativePath}`)
  if (!fs.existsSync(source)) throw new Error(`Missing evaluation input: ${relativePath}`)
  const destination = path.join(inputRoot, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  return relativePath
}

// Build the evaluator workspace for one sealed phase: artifact copy, scoring
// inputs, a blind-coded assessment template, and EVAL.md instructions. The
// template's runId is the blind handle, not the model identity; the CLI maps
// it back to the real run at registration.
export function createEvalWorkspace(root, { id, phase, variantId, stageDir, verificationPath, rubric, expectedDigest, sealedPhases = [phase] }) {
  const blindId = blindRunCode(id)
  const workspace = evalWorkspaceDir(root, id, phase)
  const artifact = path.join(workspace, 'artifact')
  const inputs = path.join(workspace, 'inputs')
  removeWorkspaceTree(workspace)
  fs.mkdirSync(artifact, { recursive: true })
  fs.mkdirSync(inputs, { recursive: true })
  // Somewhere to build and write probe scripts that is not shared with any
  // other evaluator: two agents have had working files overwritten by a
  // concurrent one writing the same path in a common scratch directory.
  fs.mkdirSync(path.join(workspace, 'scratch'), { recursive: true })

  // The sealed artifact including dist/ and evidence/ — a copy, so nothing
  // the evaluator does can touch the sealed record. The registering score
  // call re-verifies the sealed digest in runs/.
  fs.cpSync(stageDir, artifact, {
    recursive: true,
    dereference: false,
    filter: (entry) => !ARTIFACT_EXCLUDES.has(path.basename(entry)),
  })
  // Defense in depth: prove the evaluator is rating exactly the sealed bits.
  // hashTree ignores node_modules/.git/.vite on both sides, so the copy's
  // digest must equal the digest recorded at seal.
  if (expectedDigest) {
    const copyDigest = hashTree(artifact).digest
    if (copyDigest !== expectedDigest) {
      throw new Error(`Sealed artifact for Phase ${phase} changed since sealing (copy ${copyDigest.slice(0, 12)} ≠ sealed ${expectedDigest.slice(0, 12)}); run seal again before scoring`)
    }
  }

  // The built app the operator captured and the gallery serves, copied in as
  // `build/`. Every evaluator then exercises identical bits instead of each
  // building its own at whatever versions resolve that day — which was an
  // uncontrolled variable underneath every measurement. Copied by content, so
  // the run id never appears in a path the evaluator can read.
  const previewSource = path.join(root, 'public', 'previews', id, `stage${phase}`)
  let build = null
  if (fs.existsSync(path.join(previewSource, 'index.html'))) {
    build = path.join(workspace, 'build')
    fs.cpSync(previewSource, build, { recursive: true, dereference: false })
  }

  const { value: protocol } = loadProtocol(root)
  const contract = protocol.phases.find((entry) => entry.number === Number(phase))
  if (!contract) throw new Error(`Unknown phase: ${phase}`)
  const variants = readJson(path.join(root, 'specs', 'nord-stage-4.variants.json'))
  const variant = variants.variants.find((entry) => entry.id === variantId)
  if (!variant) throw new Error(`Unknown run variant: ${variantId}`)

  const files = ['bench/schemas/implementation-details.schema.json', ...contract.specs]
  for (const reference of [protocol.manual.path, variant.referenceImage]) {
    if (fs.existsSync(path.join(root, reference))) files.push(reference)
  }
  for (const file of new Set(files)) copyInput(root, file, inputs)
  fs.writeFileSync(path.join(inputs, 'TASK.md'), filterTaskToPhase(fs.readFileSync(path.join(root, 'TASK.md'), 'utf8'), phase))
  writeJson(path.join(inputs, 'specs', 'benchmark-phases.json'), projectProtocol(protocol, phase, variantId))
  writeJson(path.join(inputs, 'specs', 'nord-stage-4.variants.json'), projectVariants(variants, variantId))
  writeJson(path.join(inputs, 'rubric.json'), rubric)
  if (verificationPath && fs.existsSync(verificationPath)) {
    writeJson(path.join(inputs, 'verification.json'), scrubRunIdentity(readJson(verificationPath), id, blindId))
  }
  // Blind template: identified by the handle, never the model id. The
  // run-level panel axis rides on the highest sealed phase only.
  const carriesRunAxis = isTopPhase(rubric, phase, sealedPhases)
  writeJson(path.join(workspace, 'assessment.json'), createAssessmentTemplate(rubric, blindId, phase, { includeRunAxis: carriesRunAxis }))

  const pinnedModel = rubric.evaluator?.model
  fs.writeFileSync(path.join(workspace, 'EVAL.md'), [
    `# Stagebench evaluation — Phase ${phase} (${blindId})`,
    '',
    'You are a fresh evaluator, independent of the agent that built this artifact,',
    'and you evaluate it blind: you are not told which model or configuration produced',
    'it, and you should not try to find out. Describe the artifact, not its author.',
    '',
    'Work only inside this directory: never read the parent repository, other runs,',
    'other scores, or any other solution.',
    '',
    ...(pinnedModel ? [
      `**Required model.** This evaluation must be produced by \`${pinnedModel}\`. Set`,
      `\`evaluatorModel\` in \`assessment.json\` to exactly \`${pinnedModel}\`; registration`,
      'rejects any other value. If you are not running that model, stop and say so',
      'rather than filling the assessment in.',
      '',
    ] : []),
    `1. Read \`inputs/rubric.json\` — rate Phase ${phase} on its 0–4 anchors.`,
    '2. Inspect `artifact/` — the sealed candidate: source, tests and `evidence/`.',
    '   Treat it as read-only evidence; it is chmod-protected on purpose. Build and',
    '   write probe scripts in `scratch/`, which belongs to you alone — never in a',
    '   shared temp directory, where concurrent evaluators have overwritten each',
    "   other's files.",
    ...(build ? [
      '   **Measure against `build/`**, not a build of your own. That is the published',
      '   build of this artifact — the exact bits the operator captured — so every',
      '   evaluator exercises the same thing. Serve it with any static file server.',
    ] : [
      '   No published build is available for this phase, so build `artifact/` in a',
      '   scratch copy and say so in your notes: your measurements come from a build',
      '   nobody else will reproduce exactly.',
    ]),
    '3. Compare against `inputs/TASK.md`, the phase contract in',
    `   \`inputs/specs/benchmark-phases.json\`, the assigned specs, the variant entry`,
    `   (**${variant.label}**, \`inputs/${variant.referenceImage}\` if fetched), and the manual.`,
    '4. `inputs/verification.json` records the checks and digest from sealing.',
    '5. Fill in `assessment.json` completely: keep its `runId` handle as-is; set every',
    '   rating with concrete evidence, plus `evaluator`, `evaluatorModel`, `evaluatedAt`,',
    '   `summary`, and any `issues`.',
    '',
    'Evidence and issues are constrained, because they varied by 5–9× between past',
    'evaluations of the same rubric:',
    '',
    '- Every criterion needs **at least two evidence items**, and at least one must carry',
    '  a measurement, a file path, or a behavior you observed running the build — not an',
    '  impression. "Geometry looks close" is not evidence; "aspect-ratio 3.0951 vs 3.09',
    '  specified" is.',
    '- Keep `summary` under 1200 characters. It is a verdict, not a transcript.',
    '- Each entry in `issues` is an object with `severity` (`critical`, `major`, or',
    '  `minor`), `title`, and `detail`. Optionally `criterion`.',
    '',
    '## Two kinds of criterion',
    '',
    'A criterion with `"scoring": "judged"` takes a 0–4 `rating`. A criterion with',
    '`"scoring": "computed"` takes **no rating at all** — fill in every number in its',
    '`measurements` object and the score is derived, so no judgment enters where the',
    'specs already give ground truth. Leave a measurement `null` only if you genuinely',
    'could not take it: nulls are dropped and the rest re-normalised, so a guess is',
    'worse than a null. Every number you report must be one you actually measured.',
    '',
    ...(carriesRunAxis ? [
      `## ${rubric.runAxis.category.label} — scored once, here`,
      '',
      `This is the highest sealed phase, so your assessment also carries the run-level`,
      `\`${rubric.runAxis.category.id}\` block — **${rubric.runAxis.weight}% of the whole run**, rated once`,
      'against this final artifact. The phases are cumulative, so a regression introduced',
      'in a later phase is caught here: this artifact is the regressed one.',
      '',
      ...rubric.runAxis.category.criteria.flatMap((criterion) => [
        `- **${criterion.label}** (\`${criterion.id}\`, weight ${criterion.weight}, ${criterion.scoring})`,
        `    ${criterion.guidance}`,
        ...(criterion.measurements ?? []).map((spec) => {
          const shape = spec.kind === 'band' ? `target ${spec.target} ±${spec.tolerance}`
            : spec.kind === 'range' ? `in [${spec.minimum}, ${spec.maximum}]`
            : spec.kind === 'ratio' ? `a count, scored as a fraction of \`${spec.denominator}\` (report that too)`
            : `count of occurrences; each costs ${spec.penaltyEach ?? 25}`
          return `      - \`${spec.id}\` — ${spec.label}; ${shape}`
        }),
        '',
      ]),
      ...(rubric.runAxis.hardGate?.measurements ?? []).map((rule) =>
        `A ${rule.kind === 'ratioBelow' ? `\`${rule.criterion}.${rule.measurement}\` ratio below ${rule.threshold}` : `\`${rule.criterion}.${rule.measurement}\` score below ${rule.threshold}`} caps this axis at ${rubric.runAxis.hardGate.scoreCap}.`),
      '',
      'Measure in the rendered page at 1440×900. That is the entire point of this axis.',
      '',
    ] : []),
    'When done, the operator registers this evaluation from the repository.',
    '',
  ].join('\n'))

  // Sealed evidence is read-only: a failed evaluator once ran its build
  // directly inside artifact/ and mutated the copy it was rating. Directories
  // keep +x so the tree stays traversable.
  for (const entry of fs.readdirSync(artifact, { recursive: true, withFileTypes: true }).reverse()) {
    const target = path.join(entry.parentPath ?? entry.path, entry.name)
    fs.chmodSync(target, entry.isDirectory() ? 0o555 : 0o444)
  }
  fs.chmodSync(artifact, 0o555)

  return { id, blindId, phase: Number(phase), workspace, artifact, inputs, build, assessment: path.join(workspace, 'assessment.json') }
}

// artifact/ is chmod'd read-only while the evaluator works, and a read-only
// directory cannot have its contents unlinked — so both removing a workspace
// and rebuilding over one have to restore write first.
function restoreWritable(directory) {
  if (!fs.existsSync(directory)) return
  fs.chmodSync(directory, 0o755)
  for (const entry of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const target = path.join(entry.parentPath ?? entry.path, entry.name)
    fs.chmodSync(target, entry.isDirectory() ? 0o755 : 0o644)
  }
}

function removeWorkspaceTree(workspace) {
  restoreWritable(path.join(workspace, 'artifact'))
  fs.rmSync(workspace, { recursive: true, force: true })
}

export function removeEvalWorkspace(root, id, phase) {
  removeWorkspaceTree(evalWorkspaceDir(root, id, phase))
}
