// runs/<id>/ledger.jsonl: what was sealed and scored, in order, append-only.
//
// Sealed evidence is supposed to be immutable, and twice it was not: an
// operator-patched artifact replaced a model's sealed output under the same
// run id, and a hand-written evidence file was dropped into three sealed
// stages and the digests re-recorded to match. Neither left a trace outside
// git history.
//
// The ledger makes a re-seal something the harness refuses, rather than
// something it cannot see. Every seal appends the artifact digest; `seal` will
// not seal a phase the ledger already holds; `redigest` will not move a digest
// unless the artifact definition itself changed; and `verify-sealed` re-hashes
// every sealed tree against both run.json and the ledger. Each line carries
// the hash of the line before it, so an edited or deleted entry breaks the
// chain. A patched artifact is a new run (`bench fork`), with its own ledger.
//
// It does not stop someone who rewrites the ledger and run.json together; the
// file is in git, where that shows.
import fs from 'node:fs'
import path from 'node:path'
import { hashTree, readJson, sha256 } from '../shared.mjs'

const GENESIS = '0'.repeat(64)

export function ledgerPath(root, id) {
  return path.join(root, 'runs', id, 'ledger.jsonl')
}

export function readLedger(root, id) {
  const file = ledgerPath(root, id)
  if (!fs.existsSync(file)) return { exists: false, ok: true, entries: [], head: GENESIS }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim())
  const entries = []
  let prev = GENESIS
  for (const [index, line] of lines.entries()) {
    let entry
    try { entry = JSON.parse(line) } catch { return { exists: true, ok: false, entries, head: prev, error: `line ${index + 1} is not JSON` } }
    if (entry.prev !== prev || entry.seq !== index) return { exists: true, ok: false, entries, head: prev, error: `line ${index + 1} does not chain from the line before it` }
    entries.push(entry)
    prev = sha256(line)
  }
  return { exists: true, ok: true, entries, head: prev }
}

export function appendLedger(root, id, fields, now = new Date()) {
  const ledger = readLedger(root, id)
  if (!ledger.ok) throw new Error(`runs/${id}/ledger.jsonl is broken (${ledger.error}); it is not appended to until that is understood`)
  const entry = { seq: ledger.entries.length, at: now.toISOString(), ...fields, prev: ledger.head }
  fs.mkdirSync(path.dirname(ledgerPath(root, id)), { recursive: true })
  fs.appendFileSync(ledgerPath(root, id), `${JSON.stringify(entry)}\n`)
  return entry
}

// The seal the ledger holds for a phase, if any.
export function sealedEntry(root, id, phase) {
  return readLedger(root, id).entries.findLast((entry) => entry.kind === 'seal' && entry.phase === Number(phase)) ?? null
}

// Re-hash every sealed stage of a run against what was recorded for it.
//   intact      the tree hashes to the digest in run.json (and in the ledger)
//   modified    it does not: the sealed tree, run.json, or the ledger changed
//   unledgered  intact against run.json; sealed before the ledger existed
export function verifySealedRun(root, id) {
  const runPath = path.join(root, 'runs', id, 'run.json')
  const run = readJson(runPath)
  if (run.schemaVersion !== 4) return { id, legacy: true, stages: [] }
  const ledger = readLedger(root, id)
  const stages = []
  for (const stage of run.stages ?? []) {
    if (stage.status !== 'complete') continue
    const stageDir = path.join(root, 'runs', id, `stage${stage.number}`)
    if (!fs.existsSync(stageDir)) {
      stages.push({ phase: stage.number, state: 'missing', recorded: stage.artifactDigest ?? null })
      continue
    }
    const current = hashTree(stageDir).digest
    const sealed = ledger.entries.findLast((entry) => entry.kind === 'seal' && entry.phase === stage.number) ?? null
    const redigested = ledger.entries.findLast((entry) => entry.kind === 'redigest' && entry.phase === stage.number) ?? null
    const ledgerDigest = redigested?.to ?? sealed?.artifactDigest ?? null
    const matchesRun = current === stage.artifactDigest
    const matchesLedger = ledgerDigest === null || current === ledgerDigest
    const verificationPath = path.join(root, 'runs', id, 'verifications', `stage${stage.number}.json`)
    let verificationDigest = null
    try { verificationDigest = readJson(verificationPath).artifactDigest ?? null } catch { verificationDigest = null }
    stages.push({
      phase: stage.number,
      state: matchesRun && matchesLedger ? (sealed ? 'intact' : 'unledgered') : 'modified',
      recorded: stage.artifactDigest ?? null,
      current,
      ledger: ledgerDigest,
      // The digest the seal itself wrote at the time, when it is still there to compare.
      verification: verificationDigest,
      ...(matchesRun ? {} : { detail: 'the sealed tree does not hash to the digest in run.json' }),
      ...(matchesRun && !matchesLedger ? { detail: 'run.json was changed to a digest the ledger never recorded' } : {}),
    })
  }
  return { id, ledger: { exists: ledger.exists, ok: ledger.ok, ...(ledger.ok ? {} : { error: ledger.error }) }, stages }
}

// Which files differ between two trees, with their hashes: the record of an
// operator patch.
export function treeDifference(before, after, { ignored = ['node_modules', '.git', '.vite', 'dist', '.pnpm-store'] } = {}) {
  const list = (directory) => {
    const files = new Map()
    const visit = (current) => {
      if (!fs.existsSync(current)) return
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (ignored.includes(entry.name)) continue
        const absolute = path.join(current, entry.name)
        if (entry.isDirectory()) visit(absolute)
        else if (entry.isFile()) files.set(path.relative(directory, absolute).split(path.sep).join('/'), sha256(fs.readFileSync(absolute)))
      }
    }
    visit(directory)
    return files
  }
  const left = list(before)
  const right = list(after)
  const changes = []
  for (const [file, hash] of right) {
    if (!left.has(file)) changes.push({ path: file, change: 'added', after: hash })
    else if (left.get(file) !== hash) changes.push({ path: file, change: 'modified', before: left.get(file), after: hash })
  }
  for (const [file, hash] of left) if (!right.has(file)) changes.push({ path: file, change: 'removed', before: hash })
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}
