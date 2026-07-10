// Isolated evaluator workspaces. A fresh evaluator agent works in an
// out-of-repo directory named by a blind handle (not the run id, so the model
// identity is not printed in the path it reads) with a copy of the sealed
// artifact and the scoring materials beside it, and never touches runs/, other
// runs' scores, or any other solution. The CLI passes run facts in; this
// module never reads or writes run.json.
import fs from 'node:fs'
import path from 'node:path'
import { blindRunCode, hashTree, loadProtocol, readJson, workspaceRoot, writeJson } from '../shared.mjs'
import { filterTaskToPhase, projectProtocol, projectVariants } from '../materials.mjs'
import { createAssessmentTemplate } from './scoring.mjs'

const ARTIFACT_EXCLUDES = new Set(['node_modules', '.git', '.vite'])

export function evalWorkspaceDir(root, id, phase) {
  return path.join(workspaceRoot(root, 'eval'), blindRunCode(id), `stage${phase}`)
}

export function evalAssessmentPath(root, id, phase) {
  return path.join(evalWorkspaceDir(root, id, phase), 'assessment.json')
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
export function createEvalWorkspace(root, { id, phase, variantId, stageDir, verificationPath, rubric, expectedDigest }) {
  const blindId = blindRunCode(id)
  const workspace = evalWorkspaceDir(root, id, phase)
  const artifact = path.join(workspace, 'artifact')
  const inputs = path.join(workspace, 'inputs')
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.mkdirSync(artifact, { recursive: true })
  fs.mkdirSync(inputs, { recursive: true })

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
    fs.copyFileSync(verificationPath, path.join(inputs, 'verification.json'))
  }
  // Blind template: identified by the handle, never the model id.
  writeJson(path.join(workspace, 'assessment.json'), createAssessmentTemplate(rubric, blindId, phase))

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
    `1. Read \`inputs/rubric.json\` — rate Phase ${phase} on its 0–4 anchors.`,
    '2. Inspect `artifact/` — the sealed candidate: source, tests, `evidence/`, and the',
    '   built app in `artifact/dist/` (serve it with any static file server to exercise',
    '   it). Treat `artifact/` as read-only evidence.',
    '3. Compare against `inputs/TASK.md`, the phase contract in',
    `   \`inputs/specs/benchmark-phases.json\`, the assigned specs, the variant entry`,
    `   (**${variant.label}**, \`inputs/${variant.referenceImage}\` if fetched), and the manual.`,
    '4. `inputs/verification.json` records the checks and digest from sealing.',
    '5. Fill in `assessment.json` completely: keep its `runId` handle as-is; set every',
    '   rating with concrete evidence (file paths, measurements, observed behavior), plus',
    '   `evaluator`, `evaluatedAt`, `summary`, and any `issues`.',
    '',
    'When done, the operator registers this evaluation from the repository.',
    '',
  ].join('\n'))

  return { id, blindId, phase: Number(phase), workspace, artifact, inputs, assessment: path.join(workspace, 'assessment.json') }
}

export function removeEvalWorkspace(root, id, phase) {
  fs.rmSync(evalWorkspaceDir(root, id, phase), { recursive: true, force: true })
}
