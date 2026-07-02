import fs from 'node:fs'
import path from 'node:path'
import { hashFile } from './protocol.mjs'

// Directories that never count toward authorship comparison.
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.vite', 'evidence'])
// Starter-contract files that are legitimately identical across runs even
// when the starter template is unavailable for hash exclusion.
const SKIP_FILES = new Set(['package.json', 'pnpm-lock.yaml'])

// A candidate phase sharing at least this fraction of its non-starter file
// contents with another run's phase fails verification outright.
export const CONTAMINATION_FAIL_RATIO = 0.5
// Overlaps at or above this fraction are recorded in the verification
// artifact for audit even though they do not fail on their own.
export const CONTAMINATION_FLAG_RATIO = 0.1

function collectContentHashes(directory) {
  const hashes = new Set()
  if (!fs.existsSync(directory)) return hashes
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && !SKIP_FILES.has(entry.name) && fs.statSync(absolute).size > 0) hashes.add(hashFile(absolute))
    }
  }
  visit(directory)
  return hashes
}

/**
 * Compare one run's phase tree against every other run's phase trees by file
 * content hash. Starter-template contents are excluded so that legitimately
 * shared scaffolding never counts as copying. Phases within the same run are
 * never compared because one-way inheritance is part of the protocol.
 */
export function checkContamination(root, runId, phaseValue) {
  const phase = Number(phaseValue)
  const stageDir = path.join(root, 'runs', runId, `stage${phase}`)
  const starterHashes = collectContentHashes(path.join(root, 'benchmark', 'starter'))
  const candidateHashes = new Set([...collectContentHashes(stageDir)].filter((hash) => !starterHashes.has(hash)))
  const matches = []
  const runsDir = path.join(root, 'runs')
  for (const otherId of fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []) {
    if (otherId === runId) continue
    const otherRoot = path.join(runsDir, otherId)
    if (!fs.statSync(otherRoot).isDirectory()) continue
    for (const entry of fs.readdirSync(otherRoot)) {
      if (!/^stage\d+$/.test(entry) || !fs.statSync(path.join(otherRoot, entry)).isDirectory()) continue
      const otherHashes = collectContentHashes(path.join(otherRoot, entry))
      let shared = 0
      for (const hash of candidateHashes) if (otherHashes.has(hash)) shared += 1
      const ratio = candidateHashes.size === 0 ? 0 : shared / candidateHashes.size
      if (ratio >= CONTAMINATION_FLAG_RATIO) {
        matches.push({
          runId: otherId,
          stage: entry,
          sharedFiles: shared,
          candidateFiles: candidateHashes.size,
          ratio: Math.round(ratio * 1000) / 1000,
          exceedsFailRatio: ratio >= CONTAMINATION_FAIL_RATIO,
        })
      }
    }
  }
  matches.sort((a, b) => b.ratio - a.ratio)
  return {
    passed: !matches.some((match) => match.exceedsFailRatio),
    candidateFiles: candidateHashes.size,
    failRatio: CONTAMINATION_FAIL_RATIO,
    flagRatio: CONTAMINATION_FLAG_RATIO,
    matches,
  }
}
