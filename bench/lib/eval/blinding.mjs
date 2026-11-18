// What a grader may learn about the producer of the artifact it rates:
// nothing. Two layers keep it that way.
//
//   1. blindVerification() passes the seal record through an allowlist. Only
//      fields that describe the artifact itself reach the grader. A field not
//      named in VERIFICATION_SHAPE is dropped, so whatever the seal starts
//      recording later stays out until someone decides it is about the
//      artifact. The strings that survive have every run id, host path, known
//      model name, and timestamp scrubbed.
//   2. assertBlindInputs() reads back every file the harness put in front of
//      the grader and fails closed if a known model or run name appears in one,
//      in any punctuation. The evaluator workspace is not built, the evaluator
//      is not launched, and an assessment is not registered while it fails.
//
// The first version of (1) was a denylist. The seal record grew `usage` and
// `budget` blocks after it was written, and both went straight through, so all
// six protocol-3 graders before this were shown the producing model's id.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJson, stagebenchHome } from '../shared.mjs'
import { loadPrices } from '../usage.mjs'

// Bumped whenever what a grader can see of the producer changes, and stamped on
// every evaluator workspace, evaluation, and ledger score entry made under it.
//   1  protocol 3.0.0 as shipped: a denylist over the seal record. The grader's
//      copy kept `usage` and `budget`, which name the producing model.
//   2  an allowlist over the seal record, and the guard on every grader input.
export const EVAL_BLINDING_VERSION = 2

// Written into each evaluator workspace beside (not inside) what the grader
// reads, so a workspace built under an older blinding is refused rather than
// launched or registered.
export const BLINDING_STAMP = '.blinding.json'

// A name as a pattern that survives re-punctuation: "gpt-6-2-sol" also finds
// "GPT 6.2 Sol" and "gpt_6.2_sol".
export function namePattern(name) {
  const tokens = String(name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.join('').length < 5) return null
  return new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9\\n]{0,3}'), 'gi')
}

// The same name in a slashed form ("openai/gpt-6.2-sol") goes as a whole, the
// vendor prefix with it.
function redactionPattern(name) {
  const pattern = namePattern(name)
  return pattern && new RegExp(`(?:[a-z0-9_.-]+/)?(?:${pattern.source})`, 'gi')
}

const normalizedName = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// --- the names a producer is known by ----------------------------------------------------

// Every model id the seal record itself carries: the launches, the gateway's
// tally, the priced usage, the efforts and served ids, and the budget.
export function recordIdentities(record) {
  const names = new Set()
  const add = (value) => { if (typeof value === 'string' && value.trim()) names.add(value.trim()) }
  const addKeys = (object, split = null) => {
    for (const key of Object.keys(object && typeof object === 'object' ? object : {})) {
      if (split) for (const part of key.split(split)) add(part)
      else add(key)
    }
  }
  const addUsage = (usage) => {
    addKeys(usage?.byModel)
    for (const entry of Object.values(usage?.byModel ?? {})) add(entry?.priceId)
    addKeys(usage?.efforts, /:/)
    addKeys(usage?.responseModels, /\s*->\s*/)
  }
  if (!record || typeof record !== 'object') return []
  add(record.runId)
  for (const launch of Array.isArray(record.isolation?.launches) ? record.isolation.launches : []) add(launch?.model)
  addKeys(record.isolation?.gateway?.models)
  addUsage(record.isolation?.gateway?.usage)
  addUsage(record.usage)
  add(record.budget?.effort?.primaryModel)
  addKeys(record.budget?.effort?.observed, /:/)
  // An effort is not a name ("gpt-6.2-sol:high" splits into both halves).
  return [...names].filter((name) => !/^(none|minimal|low|medium|high|xhigh|max|default|unspecified)$/i.test(name))
}

// Every name the guard and the scrub look for: this run's (its id, its model,
// its title, and every model id its seal record names), every other run's in
// runs/, and every model in the price table. Reads run records; never writes
// one. Fails closed: without the price table it cannot say what a model id is.
export function knownIdentities(root, { id, producerNames = [], record = null } = {}) {
  let prices
  try {
    prices = loadPrices(root)
  } catch (error) {
    throw new Error(`Cannot check that the grader's inputs are blind: the price table that lists every known model id (bench/prices.json) could not be read (${error.message})`)
  }
  const names = new Set(producerIdentities({ id, producerNames, record }))
  for (const model of Object.keys(prices.models ?? {})) names.add(model)
  for (const [alias, target] of Object.entries(prices.aliases ?? {})) {
    names.add(alias)
    names.add(String(target))
  }
  const runsDir = path.join(root, 'runs')
  for (const entry of fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []) {
    const file = path.join(runsDir, entry, 'run.json')
    if (!fs.existsSync(file)) continue
    const run = readJson(file)
    for (const name of [entry, run.id, run.model, run.title, run.agent?.model]) if (name) names.add(String(name))
  }
  // Vendors are not model ids, but the grader has no business with them
  // either; the scrub takes them out of whatever free text survives.
  const vendors = new Set(Object.values(prices.models ?? {}).map((entry) => entry?.provider).filter(Boolean))
  return { names: [...names].sort(), vendors: [...vendors].sort() }
}

// --- the grader's copy of the seal record -----------------------------------------------

// A leaf: a string, number, boolean, or null. Objects and arrays at a leaf are
// dropped. `[shape]` is an array of that shape; `{ key: shape }` an object with
// only those keys; `{ '*': shape }` a map whose every value has that shape.
const KEEP = true

// What the grader is shown of the seal record: what the artifact is and how it
// fared. How it was produced (isolation, operator messages, launches, seal
// attempts, usage, cost, budget, effort, timestamps, the record's own run id
// and protocol) is left out, because it identifies the producer or narrows it
// down.
const VERIFICATION_SHAPE = {
  stage: KEEP,
  passed: KEEP,
  contractError: KEEP,
  artifactDigest: KEEP,
  artifactFiles: KEEP,
  materials: { '*': { version: KEEP, digest: KEEP } },
  phaseContract: { manifest: KEEP, specs: [KEEP], hardGates: KEEP, acknowledgedHardGates: KEEP, plan: KEEP },
  featureMatrix: { coveredFeatures: KEEP, requiredFeatures: KEEP },
  implementationDetails: { audioStrategy: KEEP, generatedSources: KEEP, sampleSources: KEEP },
  // Gate results keep their outcome; where they ran is not the grader's concern.
  checks: [{ id: KEEP, command: KEEP, passed: KEEP, advisory: KEEP, skipped: KEEP, durationMs: KEEP, detail: KEEP }],
  evidence: [{ id: KEEP, passed: KEEP, advisory: KEEP, detail: KEEP }],
  audio: { file: KEEP, plan: KEEP, status: KEEP, failure: { kind: KEEP, detail: KEEP }, scores: { '*': KEEP } },
  // Where each sample came from is the grader's business: it is how "recorded,
  // with truthful provenance" gets judged. Nothing in it names the producer.
  sampleProvenance: {
    pack: { id: KEEP, version: KEEP, manifestSha256: KEEP },
    bundled: KEEP,
    bundledBytes: KEEP,
    declared: KEEP,
    fromPack: KEEP,
    generated: KEEP,
    sources: { '*': { name: KEEP, license: KEEP, files: KEEP } },
    unverifiable: [{ path: KEEP, packFile: KEEP, reason: KEEP }],
    inlineAudio: [KEEP],
    acoustic: { checked: KEEP, matched: KEEP, threshold: KEEP, lowestMatch: KEEP, failed: [{ path: KEEP, packFile: KEEP, status: KEEP, score: KEEP }] },
  },
  // Only a count: the origins name other runs.
  assetProvenance: { assets: KEEP, matched: KEEP },
}

// The evidence entries that describe the artifact. The rest ("lockdown decoys",
// "artifact does not name its producer", "agent instruction files",
// "transcripts", and any the seal adds later) are about how it was made, and
// some point the grader at whatever gives the producer away.
const EVIDENCE_KEPT = new Set([
  'dist/index.html standards mode',
  'feature tests executed',
  'sample provenance',
  'sample provenance: unverified derivations',
  'sample provenance: inline audio',
  'asset provenance',
])
const keptEvidence = (id) => EVIDENCE_KEPT.has(id) || /^evidence\/stage\d+-[a-z0-9.-]+$/i.test(String(id))

function project(value, shape) {
  if (shape === KEEP) return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined
  // "None" is a fact too: no audio failure, no sample pack, no acoustic check.
  if (value === null) return null
  if (Array.isArray(shape)) {
    return Array.isArray(value) ? value.map((entry) => project(entry, shape[0])).filter((entry) => entry !== undefined) : undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const kept = {}
  for (const [key, entry] of Object.entries(value)) {
    const inner = Object.hasOwn(shape, key) ? shape[key] : shape['*']
    if (inner === undefined) continue
    const projected = project(entry, inner)
    if (projected !== undefined) kept[key] = projected
  }
  return kept
}

const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g

function scrubber({ id, blindId, root, names, vendors }) {
  // Host paths name the operator, the checkout, and often the run.
  const paths = [
    [root ? path.join(root, 'runs', id) : null, '<artifact>'],
    [root, '<repository>'],
    [stagebenchHome(), '<workspace-home>'],
    [os.homedir(), '~'],
  ].filter(([needle]) => needle)
  // Longest first, so "GPT 6.2 Sol High" goes as a whole before "GPT 6.2 Sol" takes part of it.
  const patterns = [...new Set([id, ...names, ...vendors].filter(Boolean).map(String))]
    .sort((a, b) => b.length - a.length).map(redactionPattern).filter(Boolean)
  const text = (value) => {
    let next = value
    for (const [needle, replacement] of paths) next = next.split(needle).join(replacement)
    // The run id becomes the handle the grader knows the artifact by; any other
    // spelling of it, and every other name, is redacted.
    next = next.split(id).join(blindId)
    for (const pattern of patterns) next = next.replace(pattern, '[redacted]')
    return next.replace(TIMESTAMP, '[timestamp]')
  }
  const visit = (value) => {
    if (typeof value === 'string') return text(value)
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [text(key), visit(entry)]))
    return value
  }
  return visit
}

// Make the grader's copy of the seal record. `names` are the known model and
// run names (knownIdentities); the record's own are always added, so even a
// caller that passes none gets a copy that does not name its producer.
export function blindVerification(record, id, blindId, { root = null, names = [], vendors = [] } = {}) {
  const kept = project(record, VERIFICATION_SHAPE) ?? {}
  if (Array.isArray(kept.evidence)) {
    const assetProvenance = record.assetProvenance
    kept.evidence = kept.evidence
      .filter((entry) => keptEvidence(entry.id))
      .map((entry) => (entry.id === 'asset provenance' && assetProvenance
        ? {
          ...entry,
          detail: assetProvenance.matched > 0
            ? `${assetProvenance.matched} of ${assetProvenance.assets} bundled assets are byte-identical to assets that already exist outside this artifact`
            : `${assetProvenance.assets} bundled assets; none is byte-identical to an asset known outside this artifact`,
        }
        : entry))
  }
  const scrub = scrubber({ id, blindId, root, names: [...names, ...recordIdentities(record)], vendors })
  return { runId: blindId, ...scrub(kept) }
}

// --- the guard ------------------------------------------------------------------------------

// Every file in an evaluator workspace that the harness wrote or copied for the
// grader. No known model or run name may appear in any of them.
// (assessment.json starts as the template and is the grader's own writing
// after that.)
const GRADER_INPUTS = ['EVAL.md', '.assessment.template.json', 'inputs']
// The candidate's sealed bytes and the published build of them. Another model's
// name in them is the candidate's business; the producer's own is not. The seal
// refuses an artifact that names its producer and the grader's copy has those
// names redacted, so one found here means the blinding failed.
const CANDIDATE_BYTES = ['artifact', 'build']
// Reference material copied byte for byte from the repository (the manual, the
// product photo). It is the same for every run, so it cannot name a producer.
const REFERENCE_BINARY = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp'])
// The grader is told which model it must be (the rubric's pin, repeated in
// EVAL.md and pre-filled as the template's evaluatorModel). That is the same
// for every run graded under the rubric, so it says nothing about the producer,
// and these are the only files where the pinned grader's own names may appear.
const NAMES_THE_GRADER = new Set(['EVAL.md', '.assessment.template.json', 'inputs/rubric.json'])

function decodeText(buffer) {
  if (buffer.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

function workspaceFiles(workspace, entries) {
  const files = []
  for (const entry of entries) {
    const absolute = path.join(workspace, entry)
    if (!fs.existsSync(absolute)) continue
    if (!fs.statSync(absolute).isDirectory()) {
      files.push(absolute)
      continue
    }
    for (const child of fs.readdirSync(absolute, { recursive: true, withFileTypes: true })) {
      const file = path.join(child.parentPath ?? child.path, child.name)
      if (child.isFile()) files.push(file)
      else if (!child.isDirectory()) throw new BlindingError(`Cannot check the grader's inputs: ${path.relative(workspace, file)} is neither a file nor a directory`)
    }
  }
  return files.sort()
}

export class BlindingError extends Error {}

const patternsFor = (names) => [...new Set(names.filter(Boolean).map(String))].map((name) => ({ name, pattern: namePattern(name) })).filter((entry) => entry.pattern)

// Fail closed if any known model or run name is in anything the harness put in
// front of the grader, or the producer's own name is in its copy of the
// artifact or build. `names` are every known name (knownIdentities),
// `producer` this run's, and `grader` the pinned grader's own (the rubric's
// evaluator block). Returns what was checked, for the record; names no names.
export function assertBlindInputs(workspace, { names, producer = [], grader = [] }) {
  const known = patternsFor(names)
  if (known.length === 0) throw new BlindingError('Cannot check the grader\'s inputs: no known model or run names to check them against')
  const own = patternsFor(producer)
  const pinned = new Set(grader.filter(Boolean).map(normalizedName))
  const inputs = workspaceFiles(workspace, GRADER_INPUTS)
  if (!inputs.some((file) => path.relative(workspace, file) === 'EVAL.md')) throw new BlindingError(`Cannot check the grader's inputs: ${workspace} has no EVAL.md`)
  const leaks = []
  let checked = 0
  for (const file of inputs) {
    const relative = path.relative(workspace, file).split(path.sep).join('/')
    const text = decodeText(fs.readFileSync(file))
    if (text === null) {
      if (relative.startsWith('inputs/') && REFERENCE_BINARY.has(path.extname(relative).toLowerCase())) continue
      throw new BlindingError(`Cannot check the grader's input ${relative} for model names: it is not text`)
    }
    checked += 1
    for (const { name, pattern } of known) {
      if (NAMES_THE_GRADER.has(relative) && pinned.has(normalizedName(name))) continue
      const found = text.match(pattern)
      if (found) leaks.push(`${relative}: "${found[0]}" (${name})`)
    }
  }
  // Audio, images, and other binary assets are the candidate's own bytes and
  // carry no text a grader reads.
  for (const file of own.length > 0 ? workspaceFiles(workspace, CANDIDATE_BYTES) : []) {
    const relative = path.relative(workspace, file).split(path.sep).join('/')
    const text = decodeText(fs.readFileSync(file))
    if (text === null) continue
    checked += 1
    for (const { name, pattern } of own) {
      const found = text.match(pattern)
      if (found) leaks.push(`${relative}: "${found[0]}" (${name})`)
    }
  }
  if (leaks.length > 0) {
    throw new BlindingError(`The grader's inputs name a model or run, so grading would not be blind. Nothing was launched or registered.\n${leaks.slice(0, 20).map((leak) => `  - ${leak}`).join('\n')}${leaks.length > 20 ? `\n  - … and ${leaks.length - 20} more` : ''}`)
  }
  return { version: EVAL_BLINDING_VERSION, filesChecked: checked, namesChecked: known.length }
}

export function writeBlindingStamp(workspace) {
  fs.writeFileSync(path.join(workspace, BLINDING_STAMP), `${JSON.stringify({ version: EVAL_BLINDING_VERSION }, null, 2)}\n`)
}

// The guard as the CLI runs it before launching an evaluator and before
// registering an assessment: the workspace must have been built under this
// blinding, and its inputs must still name nobody.
export function checkEvalWorkspace(root, { id, workspace, producerNames = [], record = null, rubric = null }) {
  if (!fs.existsSync(path.join(workspace, 'EVAL.md'))) throw new BlindingError(`Missing evaluator workspace at ${workspace}; run pnpm bench score ${id} first`)
  let stamp = null
  try { stamp = readJson(path.join(workspace, BLINDING_STAMP)) } catch { stamp = null }
  if (!stamp || stamp.version !== EVAL_BLINDING_VERSION) {
    throw new BlindingError(`The evaluator workspace at ${workspace} was built under grader blinding ${stamp?.version ?? 1}, not ${EVAL_BLINDING_VERSION}: its inputs may name the producer. Remove it (pnpm bench clean ${id}) and build it again with pnpm bench score ${id}.`)
  }
  const { names } = knownIdentities(root, { id, producerNames, record })
  return assertBlindInputs(workspace, { names, producer: producerIdentities({ id, producerNames, record }), grader: graderNames(rubric) })
}

// The names this run's producer goes by: its run id, model, title, and every
// model id its seal record names.
export function producerIdentities({ id, producerNames = [], record = null }) {
  return [...new Set([id, ...producerNames, ...recordIdentities(record)].filter(Boolean).map(String))]
}

export function graderNames(rubric) {
  const evaluator = rubric?.evaluator ?? {}
  return [evaluator.model, evaluator.pinnedId, evaluator.label].filter(Boolean)
}
