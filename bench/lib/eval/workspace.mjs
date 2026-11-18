// Isolated evaluator workspaces. A fresh evaluator agent works in an
// out-of-repo directory named by a blind handle (not the run id, so the model
// identity is not printed in the path it reads) with a copy of the sealed
// artifact and the scoring materials beside it, and never touches runs/, other
// runs' scores, or any other solution. The CLI passes run facts in; this
// module never reads or writes run.json.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NON_ARTIFACT_DIRS, blindRunCode, hashTree, loadProtocol, readJson, stagebenchHome, workspaceRoot, writeJson } from '../shared.mjs'
import { filterTaskToPhase, projectProtocol, projectVariants } from '../materials.mjs'
import { AGENT_INSTRUCTION_DIRS, AGENT_INSTRUCTION_FILES } from '../run/verify.mjs'
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
function scrubRunIdentity(value, id, blindId, paths = []) {
  if (typeof value === 'string') {
    let text = value
    // Host paths name the operator, the checkout, and often the run.
    for (const [needle, replacement] of paths) if (needle) text = text.split(needle).join(replacement)
    return text.split(id).join(blindId)
  }
  if (Array.isArray(value)) return value.map((entry) => scrubRunIdentity(entry, id, blindId, paths))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.split(id).join(blindId), scrubRunIdentity(entry, id, blindId, paths)]))
  }
  return value
}

// A name as a pattern that survives re-punctuation: "gpt-6-2-sol" also finds
// "GPT 6.2 Sol" and "gpt_6.2_sol".
export function namePattern(name) {
  const tokens = String(name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.join('').length < 5) return null
  return new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9\\n]{0,3}'), 'gi')
}

// Make the grader's copy blind. Two things are removed from it, after its
// digest has been checked against the seal:
//
//   - agent instruction files (CLAUDE.md, AGENTS.md, .claude/, .cursor/, …).
//     A harness loads those on its own, so in an artifact they are a message
//     from the candidate to whoever opens it next — the grader.
//   - the producer's name, wherever the artifact wrote it. A run id is a model
//     slug; plans and audits that open with "Run <id>" told four graders which
//     model they were rating.
//
// The sealed tree in runs/ is not touched; this is the copy.
export function blindArtifactCopy(directory, names = []) {
  const stripped = []
  const redacted = []
  // Longest name first, so "Model X High" goes as a whole before "Model X" can take part of it.
  const patterns = [...new Set(names.map(String))].sort((a, b) => b.length - a.length).map(namePattern).filter(Boolean)
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(directory, absolute).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (AGENT_INSTRUCTION_DIRS.includes(entry.name)) {
          fs.rmSync(absolute, { recursive: true, force: true })
          stripped.push(`${relative}/`)
        } else {
          visit(absolute)
        }
        continue
      }
      if (!entry.isFile()) continue
      if (AGENT_INSTRUCTION_FILES.includes(entry.name)) {
        fs.rmSync(absolute, { force: true })
        stripped.push(relative)
        continue
      }
      if (patterns.length === 0 || fs.statSync(absolute).size > 8 * 1024 * 1024) continue
      const buffer = fs.readFileSync(absolute)
      if (buffer.subarray(0, 8192).includes(0)) continue
      const text = buffer.toString('utf8')
      let next = text
      for (const pattern of patterns) next = next.replace(pattern, '[redacted]')
      if (next !== text) {
        fs.writeFileSync(absolute, next)
        redacted.push(relative)
      }
    }
  }
  if (fs.existsSync(directory)) visit(directory)
  return { stripped: stripped.sort(), redacted: redacted.sort() }
}

// What the grader is shown of the seal record. Everything about how the
// artifact was produced is left out, because it identifies the producer: the
// isolation record names the harness, its version, the model the gateway saw,
// and the provider's endpoints; asset provenance names other runs. The grader
// keeps what describes the artifact itself — gates, contract, evidence — and
// only a count for provenance.
export function blindVerification(record, id, blindId, { root = null } = {}) {
  const { isolation: _isolation, assetProvenance, sampleProvenance, operatorPatch: _patch, ...artifactFacts } = record
  const paths = [
    [root ? path.join(root, 'runs', id) : null, '<artifact>'],
    [root, '<repository>'],
    [stagebenchHome(), '<workspace-home>'],
    [os.homedir(), '~'],
  ]
  const blind = scrubRunIdentity(artifactFacts, id, blindId, paths)
  if (Array.isArray(blind.evidence)) {
    blind.evidence = blind.evidence
      // None of these describes the artifact's quality, and two of them would
      // point the grader at whatever gives the producer away.
      .filter((entry) => !['lockdown decoys', 'artifact does not name its run', 'artifact does not name its producer', 'agent instruction files', 'transcripts'].includes(entry.id))
      .map((entry) => (entry.id === 'asset provenance' && assetProvenance
        ? {
          ...entry,
          detail: assetProvenance.matched > 0
            ? `${assetProvenance.matched} of ${assetProvenance.assets} bundled assets are byte-identical to assets that already exist outside this artifact`
            : `${assetProvenance.assets} bundled assets; none is byte-identical to an asset known outside this artifact`,
        }
        : entry))
  }
  if (assetProvenance) blind.assetProvenance = { assets: assetProvenance.assets, matched: assetProvenance.matched }
  // Where each sample came from is the grader's business: it is how "recorded,
  // with truthful provenance" gets judged. Nothing in it names the producer.
  if (sampleProvenance) {
    const { toMatch: _toMatch, problems: _problems, ...facts } = sampleProvenance
    blind.sampleProvenance = facts
  }
  // Gate results keep their outcome; where they ran is not the grader's concern.
  if (Array.isArray(blind.checks)) blind.checks = blind.checks.map(({ isolation: _where, ...check }) => check)
  return blind
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
export function createEvalWorkspace(root, { id, phase, variantId, stageDir, verificationPath, rubric, expectedDigest, sealedPhases = [phase], producerNames = [], boxed = false }) {
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

  // Blind the copy (after the digest check, which is about the sealed bits).
  const blinding = blindArtifactCopy(artifact, [id, ...producerNames])

  // The built app the operator captured and the gallery serves, copied in as
  // `build/`. Every evaluator then exercises identical bits instead of each
  // building its own at whatever versions resolve that day — which was an
  // uncontrolled variable underneath every measurement. Copied by content, so
  // the run id never appears in a path the evaluator can read.
  const previewSource = path.join(root, 'public', 'previews', id, `stage${phase}`)
  let build = null
  if (fs.existsSync(path.join(previewSource, 'index.html'))) {
    build = path.join(workspace, 'build')
    fs.cpSync(previewSource, build, { recursive: true, dereference: false, filter: (entry) => path.basename(entry) !== 'thumb.jpg' })
    // Instruction files only: the build is what gets measured, so it is not rewritten.
    blinding.strippedFromBuild = blindArtifactCopy(build, []).stripped
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
    writeJson(path.join(inputs, 'verification.json'), blindVerification(readJson(verificationPath), id, blindId, { root }))
  }
  // Blind template: identified by the handle, never the model id. The
  // run-level panel axis rides on the highest sealed phase only.
  const carriesRunAxis = isTopPhase(rubric, phase, sealedPhases)
  const template = createAssessmentTemplate(rubric, blindId, phase, { includeRunAxis: carriesRunAxis })
  writeJson(path.join(workspace, 'assessment.json'), template)
  // The blank template, kept aside: every boxed grader in a panel starts from
  // it, whatever an earlier grader has already written into assessment.json.
  writeJson(path.join(workspace, '.assessment.template.json'), template)

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
    ...(boxed ? [
      '**Where you are.** A container with no internet and nothing of the operator\'s machine in it: this directory is',
      'everything there is. Chromium is installed. For a browser pass, `pnpm add playwright` inside `scratch/` (it installs',
      'from a mirror inside this machine; there is no download) and serve `build/` from `127.0.0.1` with any static server.',
      '`node`, `pnpm`, `python3`, `ffmpeg`, `ffprobe`, `sox`, `jq`, and `rg` are available.',
      '',
    ] : []),
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

  return { id, blindId, phase: Number(phase), workspace, artifact, inputs, build, assessment: path.join(workspace, 'assessment.json'), blinding }
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
