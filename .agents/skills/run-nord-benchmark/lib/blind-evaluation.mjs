import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { writeJson } from './cli.mjs'
import { hashTree } from './protocol.mjs'
import { loadRun } from './run-store.mjs'

const OMIT = new Set(['node_modules', '.git', '.vite'])

export function createBlindId() {
  return `trial-${crypto.randomBytes(8).toString('hex')}`
}

function assertIdentityAbsent(directory, identities) {
  const leaks = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (OMIT.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && fs.statSync(absolute).size < 2_000_000 && /\.(?:json|md|txt|html|css|js|jsx|ts|tsx)$/i.test(entry.name)) {
        const text = fs.readFileSync(absolute, 'utf8').toLowerCase()
        for (const identity of identities) if (identity && text.includes(identity.toLowerCase())) leaks.push(path.relative(directory, absolute))
      }
    }
  }
  visit(directory)
  return [...new Set(leaks)]
}

export function createBlindEvaluationBundle(root, id, phaseValue, options = {}) {
  const phase = Number(phaseValue)
  const run = loadRun(root, id)
  const stage = run.stages.find((entry) => entry.number === phase)
  if (!stage || !['verified', 'complete'].includes(stage.status)) throw new Error(`Phase ${phase} must be sealed before creating a blind evaluation bundle`)
  const stageSource = path.join(root, 'runs', id, `stage${phase}`)
  const currentArtifact = hashTree(stageSource)
  if (currentArtifact.digest !== stage.artifactDigest) throw new Error(`Phase ${phase} changed after verification; re-verify before evaluation`)
  const blindId = options.blindId ?? createBlindId()
  const publicRoot = path.join(root, '.stagebench', 'blind', blindId)
  const privateRoot = path.join(root, '.stagebench', 'private', 'blind-map')
  if (fs.existsSync(publicRoot)) throw new Error(`Blind bundle already exists: ${blindId}`)
  const artifact = path.join(publicRoot, 'artifact')
  fs.mkdirSync(artifact, { recursive: true })
  fs.cpSync(stageSource, artifact, {
    recursive: true,
    filter: (entry) => !OMIT.has(path.basename(entry)),
  })
  const protocol = path.join(publicRoot, 'protocol')
  fs.mkdirSync(protocol, { recursive: true })
  for (const relative of ['BENCHMARK.md', 'TESTING.md', 'specs/benchmark-phases.json', `prompts/stage${phase}.md`, 'evaluation/rubrics/v3.json', 'schemas/assessment.schema.json']) {
    const source = path.join(root, relative)
    const destination = path.join(protocol, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'specs', 'benchmark-phases.json'), 'utf8')).phases.find((entry) => entry.number === phase)
  for (const relative of [...contract.specs, 'specs/nord-stage-4.variants.json']) {
    const source = path.join(root, relative)
    const destination = path.join(protocol, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }
  const leaks = assertIdentityAbsent(publicRoot, [run.id, run.model, run.title, run.agent?.provider, run.agent?.modelSnapshot])
  if (leaks.length > 0 && options.allowIdentityLeaks !== true) {
    fs.rmSync(publicRoot, { recursive: true, force: true })
    throw new Error(`Identity strings were found in the evaluator bundle: ${leaks.slice(0, 8).join(', ')}`)
  }
  writeJson(path.join(publicRoot, 'bundle.json'), {
    version: 1,
    blindId,
    phase,
    artifactDigest: stage.artifactDigest,
    identityBlinded: leaks.length === 0,
    identityLeakFiles: leaks,
    createdAt: new Date().toISOString(),
  })
  writeJson(path.join(privateRoot, `${blindId}.json`), { blindId, runId: id, phase, artifactDigest: stage.artifactDigest, createdAt: new Date().toISOString() })
  return { blindId, bundle: publicRoot, mapping: path.join(privateRoot, `${blindId}.json`), identityBlinded: leaks.length === 0 }
}
