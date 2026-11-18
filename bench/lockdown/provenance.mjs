// Seal-time asset provenance. Every bundled binary asset in a sealed artifact
// is hashed and compared against every asset this machine already knows about:
// other runs' sealed artifacts, and any local libraries the operator names.
//
// Inside the lockdown a candidate cannot reach those files, so a match there
// means two runs fetched the same upstream bytes (an npm package, say) — worth
// a look, not an accusation. Outside it, this is the check that would have
// caught 89 byte-identical samples copied from a neighbouring project. It runs
// on every seal, locked or not.
import fs from 'node:fs'
import path from 'node:path'
import { NON_ARTIFACT_DIRS, hashFile, readJson, workspaceRoot, writeJson } from '../lib/shared.mjs'

const ASSET_EXTENSIONS = new Set([
  '.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.aac', '.webm', '.aif', '.aiff',
  '.sf2', '.sf3', '.sfz', '.mid', '.midi', '.wasm', '.bin', '.dat', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf',
])
const SKIPPED_DIRS = new Set([...NON_ARTIFACT_DIRS, 'evidence'])
// Tiny files (silence, click-free padding, an empty font subset) collide by accident.
const MIN_BYTES = 2048

function assetFiles(directory) {
  const files = []
  const visit = (current) => {
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) visit(absolute)
      } else if (entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const { size, mtimeMs } = fs.statSync(absolute)
        if (size >= MIN_BYTES) files.push({ absolute, size, mtimeMs })
      }
    }
  }
  visit(directory)
  return files
}

// Local libraries to compare against, beyond other runs. A path-list in
// STAGEBENCH_ASSET_LIBRARIES (e.g. a prior build's samples directory).
export function assetLibraries(env = process.env) {
  return String(env.STAGEBENCH_ASSET_LIBRARIES ?? '').split(path.delimiter).map((entry) => entry.trim()).filter(Boolean)
}

// sha256 -> [source labels], over other runs' sealed stages and the libraries.
// Hashes are cached by path, size, and mtime: the first build reads every
// sample on disk, later ones only what changed.
export function buildAssetIndex(root, { excludeRunId, libraries = assetLibraries() } = {}) {
  const cachePath = path.join(workspaceRoot(root, 'cache'), 'asset-hashes.json')
  let cache = {}
  try { cache = readJson(cachePath) } catch { cache = {} }
  const next = {}
  const index = new Map()
  const add = (file, label) => {
    const cached = cache[file.absolute]
    const sha256 = cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs ? cached.sha256 : hashFile(file.absolute)
    next[file.absolute] = { size: file.size, mtimeMs: file.mtimeMs, sha256 }
    if (!index.has(sha256)) index.set(sha256, [])
    index.get(sha256).push(label)
  }
  const runsDir = path.join(root, 'runs')
  if (fs.existsSync(runsDir)) {
    for (const runId of fs.readdirSync(runsDir)) {
      if (runId === excludeRunId) continue
      const runDir = path.join(runsDir, runId)
      let stages = []
      try { stages = fs.readdirSync(runDir).filter((name) => /^stage\d+$/.test(name)) } catch { stages = [] }
      for (const stage of stages) {
        const stageDir = path.join(runDir, stage)
        for (const file of assetFiles(stageDir)) add(file, `run:${runId}/${stage}/${path.relative(stageDir, file.absolute).split(path.sep).join('/')}`)
      }
    }
  }
  for (const library of libraries) {
    if (!fs.existsSync(library)) continue
    for (const file of assetFiles(library)) add(file, `library:${path.join(library, path.relative(library, file.absolute))}`)
  }
  try { writeJson(cachePath, next) } catch { /* the cache is an optimisation */ }
  return index
}

// Hash the stage's assets and report which are already known elsewhere.
export function assetProvenance(root, id, stageDir, options = {}) {
  const index = options.index ?? buildAssetIndex(root, { excludeRunId: id, libraries: options.libraries })
  const assets = assetFiles(stageDir).map((file) => ({
    path: path.relative(stageDir, file.absolute).split(path.sep).join('/'),
    bytes: file.size,
    sha256: hashFile(file.absolute),
  })).sort((a, b) => a.path.localeCompare(b.path))
  const matches = assets
    .filter((asset) => index.has(asset.sha256))
    .map((asset) => ({ path: asset.path, sha256: asset.sha256, sources: index.get(asset.sha256).slice(0, 5), sourceCount: index.get(asset.sha256).length }))
  const sources = new Map()
  for (const match of matches) {
    for (const source of index.get(match.sha256)) {
      const origin = source.startsWith('run:') ? source.split('/')[0] : `library:${path.dirname(source.slice('library:'.length))}`
      sources.set(origin, (sources.get(origin) ?? 0) + 1)
    }
  }
  return {
    version: 1,
    assets: assets.length,
    bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    matched: matches.length,
    matchedOrigins: Object.fromEntries([...sources.entries()].sort((a, b) => b[1] - a[1])),
    matches: matches.slice(0, 200),
    files: assets,
  }
}

// The advisory evidence entry recorded with a seal.
export function assetProvenanceCheck(report) {
  const id = 'asset provenance'
  if (report.assets === 0) return { id, advisory: true, passed: true, detail: 'No bundled binary assets' }
  if (report.matched === 0) return { id, advisory: true, passed: true, detail: `${report.assets} bundled assets; none is byte-identical to an asset in another run or a known local library` }
  const origins = Object.entries(report.matchedOrigins).slice(0, 4).map(([origin, count]) => `${origin} (${count})`).join(', ')
  return {
    id,
    advisory: true,
    passed: false,
    detail: `${report.matched} of ${report.assets} bundled assets are byte-identical to assets that already exist outside this run: ${origins}. Check the declared provenance names the immediate source.`,
  }
}

// Grading is blind: the grader is not told which run an artifact belongs to.
// That only holds if the artifact does not say so itself. A run id is a model
// slug, so its appearance in the sealed tree gives the producer away. Advisory:
// it cannot be removed without changing the artifact, but it should be known.
export function blindArtifactCheck(stageDir, id, hits) {
  const check = { id: 'artifact does not name its run', advisory: true }
  if (hits.length === 0) return { ...check, passed: true, detail: 'The run id does not appear in the sealed artifact' }
  return {
    ...check,
    passed: false,
    detail: `The run id appears in ${hits.length} file(s) of the sealed artifact (${hits.slice(0, 4).join(', ')}), so the grader can tell which run it is grading`,
  }
}
