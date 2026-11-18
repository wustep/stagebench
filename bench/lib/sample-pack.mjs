// The one sample pack every protocol-3 candidate starts from.
//
// A candidate has no internet, so the recordings Phase 2 and Phase 3 may use
// come from here and nowhere else: a fixed set of upstream files, byte for
// byte as their authors published them, fetched by the operator from pinned
// commits and checked against the sha256 in sample-pack/manifest.json. Nothing
// is trimmed, levelled, re-encoded, or mapped: choosing roots and velocity
// layers and turning them into something a browser can load is still the
// candidate's work.
//
// The manifest and the candidate-facing documents are committed; the audio is
// not (sample-pack/files/ is gitignored, like the manual).
//
// How a file is kept on the operator's disk (its stored form) is separate from
// what a candidate is given, which is always the published file:
//
//   - As published, at files/<path>: every FLAC recording and every text file.
//     FLAC is already lossless compression; re-encoding it would save about 5%
//     and change the bytes provenance pins, and wrapping it saves under 1%.
//   - flac-pcm, at files/<path>.flac: an uncompressed WAV recording. Its
//     samples are coded losslessly as FLAC; the bytes around them (the RIFF
//     header and any chunks after the audio, such as loop points) are kept
//     verbatim in the manifest. Decoding the samples and putting those bytes
//     back gives the published file, and every rebuild is checked against its
//     published sha256 before it is used.
//
// fetch writes the stored form, materialize rebuilds the published files into
// a workspace and verifies each one, and the lockdown re-hashes the pack again
// inside the engine when it loads it into a volume.
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { hashFile, readJson, sha256 } from './shared.mjs'

export const PACK_DOCUMENTS = ['README.md', 'LICENSES.md', 'ATTRIBUTION.md', 'sample-sources.json']
export const RECORDING = /\.(flac|wav)$/i
export const FLAC_PCM = 'flac-pcm'

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

// Where a manifest entry is kept in files/.
export function storedName(entry) {
  return entry.stored?.codec === FLAC_PCM ? `${entry.path}.flac` : entry.path
}

// --- WAV recordings stored as FLAC-coded samples ------------------------------

// Split a RIFF/WAVE file into the bytes before its samples, the samples, and
// the bytes after them. Only integer PCM at 16 or 24 bits is split (what FLAC
// codes and decodes back exactly); anything else returns null and is kept as
// published.
export function wavLayout(buffer) {
  if (buffer.length < 44 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WAVE') return null
  let offset = 12
  let format = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('latin1', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ' && length >= 16 && offset + 24 <= buffer.length) {
      const tag = buffer.readUInt16LE(offset + 8)
      const extensiblePcm = tag === 0xfffe && length >= 40 && buffer.readUInt16LE(offset + 32) === 1
      format = { integerPcm: tag === 1 || extensiblePcm, channels: buffer.readUInt16LE(offset + 10), sampleRate: buffer.readUInt32LE(offset + 12), blockAlign: buffer.readUInt16LE(offset + 20), bitsPerSample: buffer.readUInt16LE(offset + 22) }
    }
    if (id === 'data') {
      if (!format?.integerPcm || ![16, 24].includes(format.bitsPerSample) || format.channels < 1 || format.channels > 8) return null
      if (format.blockAlign !== format.channels * format.bitsPerSample / 8) return null
      const start = offset + 8
      const available = Math.min(length, buffer.length - start)
      const end = start + available - (available % format.blockAlign)
      if (end <= start) return null
      return { head: buffer.subarray(0, start), pcm: buffer.subarray(start, end), tail: buffer.subarray(end), ...format }
    }
    offset += 8 + length + (length & 1)
  }
  return null
}

let flacFound = null
export function flacAvailable() {
  if (flacFound === null) flacFound = spawnSync('flac', ['--version'], { encoding: 'utf8' }).status === 0
  return flacFound
}

function requireFlac(why) {
  if (!flacAvailable()) throw new Error(`The flac command is needed to ${why} (macOS: brew install flac; Debian/Ubuntu: apt install flac).`)
}

const RAW = ['--force-raw-format', '--endian=little', '--sign=signed']

function encodeArgs(layout) {
  return ['-8', '--silent', '--no-padding', ...RAW, `--channels=${layout.channels}`, `--bps=${layout.bitsPerSample}`, `--sample-rate=${layout.sampleRate}`, '-o', '-', '-']
}
const DECODE_ARGS = ['-d', '--silent', ...RAW, '-o', '-', '-']

function runAsync(bin, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    const err = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (status) => status === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${bin} exited ${status}: ${Buffer.concat(err).toString().trim().slice(-300)}`)))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

function runSync(bin, args, input) {
  const result = spawnSync(bin, args, { input, maxBuffer: 1024 * 1024 * 1024 })
  if (result.status !== 0 || result.error) throw new Error(`${bin} failed: ${String(result.stderr || result.error?.message).trim().slice(-300)}`)
  return result.stdout
}

function assemble(entry, pcm) {
  const rebuilt = Buffer.concat([Buffer.from(entry.stored.head, 'base64'), pcm, Buffer.from(entry.stored.tail, 'base64')])
  if (rebuilt.length !== entry.bytes || sha256(rebuilt) !== entry.sha256) throw new Error(`${entry.path}: the stored form does not rebuild the published file`)
  return rebuilt
}

// The published file, from its stored form. Throws unless the result is
// exactly the published bytes.
export async function rebuildRecording(entry, stored) {
  if (entry.stored?.codec !== FLAC_PCM) return stored
  requireFlac('rebuild the pack’s WAV recordings from their stored form')
  return assemble(entry, await runAsync('flac', DECODE_ARGS, stored))
}

export function rebuildRecordingSync(entry, stored) {
  if (entry.stored?.codec !== FLAC_PCM) return stored
  requireFlac('rebuild the pack’s WAV recordings from their stored form')
  return assemble(entry, runSync('flac', DECODE_ARGS, stored))
}

// The stored form of a published file: what `fetch` writes. The FLAC is
// decoded again before it is accepted, so a stored file is never kept unless
// it rebuilds the original exactly.
export async function storeRecording(entry, published) {
  if (entry.stored?.codec !== FLAC_PCM) return published
  requireFlac('store the pack’s WAV recordings compressed')
  const layout = wavLayout(published)
  if (!layout || layout.head.toString('base64') !== entry.stored.head || layout.tail.toString('base64') !== entry.stored.tail) throw new Error(`${entry.path}: the published file does not have the layout the manifest records`)
  const stored = await runAsync('flac', encodeArgs(layout), layout.pcm)
  await rebuildRecording(entry, stored)
  return stored
}

// --- checking, fetching, and materializing ------------------------------------

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

// What is on disk for one entry: its stored form, or (for a flac-pcm entry on
// a machine that had no flac when it fetched) the published file itself.
function onDisk(filesDir, entry) {
  const stored = path.join(filesDir, storedName(entry))
  if (fs.existsSync(stored)) return { file: stored, form: entry.stored?.codec ?? 'published' }
  const published = path.join(filesDir, entry.path)
  if (entry.stored && fs.existsSync(published)) return { file: published, form: 'published' }
  return null
}

// Why one entry's file on disk is not good, or null. `deep` re-hashes (and,
// for a stored WAV, decodes and rebuilds) the file.
async function entryProblem(filesDir, entry, deep) {
  const found = onDisk(filesDir, entry)
  if (!found) return 'missing'
  const size = fs.statSync(found.file).size
  if (found.form === 'published') {
    if (size !== entry.bytes) return `${size} bytes, expected ${entry.bytes}`
    if (deep && await sha256File(found.file) !== entry.sha256) return 'sha256 mismatch'
    return null
  }
  if (size === 0) return 'stored form is empty'
  if (deep) {
    try {
      await rebuildRecording(entry, fs.readFileSync(found.file))
    } catch (error) {
      return /does not rebuild/.test(error.message) ? 'sha256 mismatch (stored form does not rebuild the published file)' : error.message
    }
  }
  return null
}

// Which manifest files are missing or do not match. Sizes are checked first;
// `deep` re-hashes every file and rebuilds every stored WAV (a few seconds for
// the whole pack).
export async function checkSamplePack(root, { deep = true } = {}) {
  const pack = loadSamplePack(root)
  if (!pack) return { present: false, problems: ['sample-pack/manifest.json is missing'] }
  const filesDir = samplePackFilesDir(root)
  const problems = []
  let storedBytes = 0
  let uncompressed = 0
  await pool(pack.manifest.files, 8, async (entry) => {
    const problem = await entryProblem(filesDir, entry, deep)
    if (problem) problems.push(`${entry.path}: ${problem}`)
    const found = onDisk(filesDir, entry)
    if (found) storedBytes += fs.statSync(found.file).size
    if (found && entry.stored && found.form === 'published') uncompressed += 1
  })
  // Nothing may sit in the pack that the manifest does not name.
  const known = new Set(pack.manifest.files.flatMap((entry) => entry.stored ? [entry.path, storedName(entry)] : [entry.path]))
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (!known.has(path.relative(filesDir, absolute).split(path.sep).join('/'))) problems.push(`${path.relative(filesDir, absolute)}: not in the manifest`)
    }
  }
  visit(filesDir)
  return { present: problems.length === 0, problems: problems.sort(), pack, storedBytes, uncompressed }
}

async function download(url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (attempt === 3) throw error
      await new Promise((done) => setTimeout(done, 800 * (attempt + 1)))
    }
  }
}

function writeAtomically(target, buffer) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.partial-${process.pid}`
  fs.writeFileSync(temporary, buffer)
  fs.renameSync(temporary, target)
}

// Download whatever is missing or wrong from the pinned upstream commits,
// verify it against the published sha256, and keep it in its stored form. A
// WAV recording is kept as published when this machine has no flac (and is
// compressed by the next fetch that has it).
export async function fetchSamplePack(root, { force = false, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const pack = loadSamplePack(root)
  if (!pack) throw new Error('sample-pack/manifest.json is missing')
  const filesDir = samplePackFilesDir(root)
  const sources = new Map(pack.manifest.sources.map((source) => [source.id, source]))
  const compress = flacAvailable()
  let downloaded = 0
  let bytes = 0
  let compressed = 0
  const failed = []
  await pool(pack.manifest.files, 8, async (entry) => {
    const found = onDisk(filesDir, entry)
    const wantsCompression = entry.stored && compress && found?.form === 'published'
    if (!force && !wantsCompression && await entryProblem(filesDir, entry, true) === null) return
    try {
      let published = null
      // A published WAV already on disk only needs compressing.
      if (wantsCompression && !force && await entryProblem(filesDir, entry, true) === null) published = fs.readFileSync(found.file)
      else {
        published = await download(upstreamUrl(sources.get(entry.source), entry.upstreamPath))
        if (published.length !== entry.bytes || sha256(published) !== entry.sha256) throw new Error('downloaded bytes do not match the manifest')
        downloaded += 1
        bytes += published.length
        if (downloaded % 50 === 0) log(`  sample pack: ${downloaded} files fetched`)
      }
      const keepCompressed = entry.stored && compress
      writeAtomically(path.join(filesDir, keepCompressed ? storedName(entry) : entry.path), keepCompressed ? await storeRecording(entry, published) : published)
      if (keepCompressed) compressed += 1
      // Only one form of a file is kept.
      if (entry.stored) fs.rmSync(path.join(filesDir, keepCompressed ? entry.path : storedName(entry)), { force: true })
    } catch (error) {
      failed.push(`${entry.path}: ${error.message}`)
    }
  })
  return { id: pack.id, version: pack.version, files: pack.manifest.files.length, downloaded, downloadedBytes: bytes, compressed, flac: compress, failed }
}

// Put the pack where a candidate reads it: inputs/samples/, every file exactly
// as published. Files kept as published are cloned where the filesystem can
// (instant on APFS) and copied otherwise; stored WAVs are rebuilt and checked
// against their sha256.
export function materializeSamplePack(root, destination) {
  const pack = loadSamplePack(root)
  if (!pack) throw new Error('sample-pack/manifest.json is missing')
  const filesDir = samplePackFilesDir(root)
  fs.mkdirSync(destination, { recursive: true })
  let rebuilt = 0
  for (const entry of pack.manifest.files) {
    const found = onDisk(filesDir, entry)
    if (!found) throw new Error(`The sample pack is incomplete (${entry.path}). Run pnpm bench fetch.`)
    const target = path.join(destination, entry.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (found.form === 'published') fs.copyFileSync(found.file, target, fs.constants.COPYFILE_FICLONE)
    else {
      fs.writeFileSync(target, rebuildRecordingSync(entry, fs.readFileSync(found.file)))
      rebuilt += 1
    }
  }
  for (const name of PACK_DOCUMENTS) fs.copyFileSync(path.join(samplePackDir(root), name), path.join(destination, name))
  fs.copyFileSync(pack.manifestPath, path.join(destination, 'MANIFEST.json'))
  return { id: pack.id, version: pack.version, digest: pack.digest, files: pack.manifest.files.length, bytes: pack.manifest.totals.bytes, rebuilt }
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
