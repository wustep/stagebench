// The one sample pack every protocol-3 candidate starts from.
//
// A candidate has no internet, so the recorded piano samples Phase 2 requires
// come from here and nowhere else: a fixed set of upstream files, byte for
// byte as their authors published them, fetched by the operator from pinned
// commits and checked against the sha256 in sample-pack/manifest.json. Nothing
// is trimmed, levelled, re-encoded, or mapped: choosing roots and velocity
// layers and turning them into something a browser can load is still the
// candidate's work.
//
// The manifest and the candidate-facing documents are committed; the audio is
// not (sample-pack/files/ is gitignored, like the manual).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { hashFile, readJson, sha256 } from './shared.mjs'

export const PACK_DOCUMENTS = ['README.md', 'LICENSES.md', 'ATTRIBUTION.md', 'sample-sources.json']

export function samplePackDir(root) {
  return path.join(root, 'sample-pack')
}

export function samplePackFilesDir(root) {
  return path.join(samplePackDir(root), 'files')
}

// The manifest, plus a digest of its bytes: the pack's identity. Two runs with
// the same digest were given the same recordings.
export function loadSamplePack(root) {
  const manifestPath = path.join(samplePackDir(root), 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  const text = fs.readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(text)
  return { manifest, manifestPath, digest: sha256(text), id: manifest.id, version: manifest.version }
}

export function upstreamUrl(source, upstreamPath) {
  return `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${upstreamPath.split('/').map(encodeURIComponent).join('/')}`
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
  })
}

async function pool(items, size, worker) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      await worker(items[index], index)
    }
  }))
}

// Which manifest files are missing or do not match. Sizes are checked first;
// `deep` re-hashes every file (about a second per 300 MB).
export async function checkSamplePack(root, { deep = true } = {}) {
  const pack = loadSamplePack(root)
  if (!pack) return { present: false, problems: ['sample-pack/manifest.json is missing'] }
  const filesDir = samplePackFilesDir(root)
  const problems = []
  await pool(pack.manifest.files, 8, async (entry) => {
    const file = path.join(filesDir, entry.path)
    if (!fs.existsSync(file)) problems.push(`${entry.path}: missing`)
    else if (fs.statSync(file).size !== entry.bytes) problems.push(`${entry.path}: ${fs.statSync(file).size} bytes, expected ${entry.bytes}`)
    else if (deep && await sha256File(file) !== entry.sha256) problems.push(`${entry.path}: sha256 mismatch`)
  })
  // Nothing may sit in the pack that the manifest does not name.
  const known = new Set(pack.manifest.files.map((entry) => entry.path))
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (!known.has(path.relative(filesDir, absolute).split(path.sep).join('/'))) problems.push(`${path.relative(filesDir, absolute)}: not in the manifest`)
    }
  }
  visit(filesDir)
  return { present: problems.length === 0, problems: problems.sort(), pack }
}

// Download whatever is missing from the pinned upstream commits and verify it.
export async function fetchSamplePack(root, { force = false, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const pack = loadSamplePack(root)
  if (!pack) throw new Error('sample-pack/manifest.json is missing')
  const filesDir = samplePackFilesDir(root)
  const sources = new Map(pack.manifest.sources.map((source) => [source.id, source]))
  let downloaded = 0
  let bytes = 0
  const failed = []
  await pool(pack.manifest.files, 8, async (entry) => {
    const target = path.join(filesDir, entry.path)
    if (!force && fs.existsSync(target) && fs.statSync(target).size === entry.bytes && await sha256File(target) === entry.sha256) return
    try {
      let buffer = null
      for (let attempt = 0; attempt < 4 && !buffer; attempt += 1) {
        try {
          const response = await fetch(upstreamUrl(sources.get(entry.source), entry.upstreamPath))
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          buffer = Buffer.from(await response.arrayBuffer())
        } catch (error) {
          if (attempt === 3) throw error
          await new Promise((done) => setTimeout(done, 800 * (attempt + 1)))
        }
      }
      if (buffer.length !== entry.bytes || sha256(buffer) !== entry.sha256) throw new Error('downloaded bytes do not match the manifest')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, buffer)
      downloaded += 1
      bytes += buffer.length
      if (downloaded % 50 === 0) log(`  sample pack: ${downloaded} files fetched`)
    } catch (error) {
      failed.push(`${entry.path}: ${error.message}`)
    }
  })
  return { id: pack.id, version: pack.version, files: pack.manifest.files.length, downloaded, downloadedBytes: bytes, failed }
}

// Put the pack where a candidate reads it: inputs/samples/. Files are cloned
// where the filesystem can (instant on APFS), copied otherwise.
export function materializeSamplePack(root, destination) {
  const pack = loadSamplePack(root)
  if (!pack) throw new Error('sample-pack/manifest.json is missing')
  const filesDir = samplePackFilesDir(root)
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of pack.manifest.files) {
    const source = path.join(filesDir, entry.path)
    if (!fs.existsSync(source)) throw new Error(`The sample pack is incomplete (${entry.path}). Run pnpm bench fetch.`)
    const target = path.join(destination, entry.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE)
  }
  for (const name of PACK_DOCUMENTS) fs.copyFileSync(path.join(samplePackDir(root), name), path.join(destination, name))
  fs.copyFileSync(pack.manifestPath, path.join(destination, 'MANIFEST.json'))
  return { id: pack.id, version: pack.version, digest: pack.digest, files: pack.manifest.files.length, bytes: pack.manifest.totals.bytes }
}

// The record of which pack a phase was given, for workspace.json and the seal.
export function samplePackRecord(root) {
  const pack = loadSamplePack(root)
  return pack ? { id: pack.id, version: pack.version, manifestSha256: pack.digest, files: pack.manifest.files.length, bytes: pack.manifest.totals.bytes } : null
}

// sha256 → manifest entry, for recognising a pack file wherever it turns up.
export function packIndex(pack) {
  return {
    byPath: new Map(pack.manifest.files.map((entry) => [entry.path, entry])),
    bySha256: new Map(pack.manifest.files.map((entry) => [entry.sha256, entry])),
    sources: new Map(pack.manifest.sources.map((source) => [source.id, source])),
  }
}

export { hashFile, readJson }
