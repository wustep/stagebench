// Bundle a single run into a self-contained ZIP for external review: its
// run.json, evaluations, the published static report, and the published
// preview build, plus a manifest. Nothing from the gitignored reference/
// directory (copyrighted Nord material) is ever included — this module only
// reads from runs/<id>, public/reports/<id>, and public/previews/<id>.
import fs from 'node:fs'
import path from 'node:path'
import { loadRun, pathsFor } from './store.mjs'

// --- Minimal dependency-free ZIP writer (store, i.e. no compression) --------
// Node 20+ ships no zip builder, so rather than shell out to a system `zip`
// binary (which may be absent) we emit a spec-compliant store-only archive.
const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Encode a Date as a DOS date/time pair (used in ZIP headers).
function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f)
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
  return { time, day }
}

function createZip(entries, now = new Date()) {
  const { time, day } = dosDateTime(now)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0) // local file header signature
    localHeader.writeUInt16LE(20, 4) // version needed to extract
    localHeader.writeUInt16LE(0x0800, 6) // general purpose flag: UTF-8 names
    localHeader.writeUInt16LE(0, 8) // compression method: store
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(day, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18) // compressed size
    localHeader.writeUInt32LE(data.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra field length
    localParts.push(localHeader, nameBuffer, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0) // central directory header signature
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(0x0800, 8) // UTF-8 names
    centralHeader.writeUInt16LE(0, 10) // store
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(day, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra field length
    centralHeader.writeUInt16LE(0, 32) // comment length
    centralHeader.writeUInt16LE(0, 34) // disk number start
    centralHeader.writeUInt16LE(0, 36) // internal attributes
    centralHeader.writeUInt32LE(0, 38) // external attributes
    centralHeader.writeUInt32LE(offset, 42) // local header offset
    centralParts.push(centralHeader, nameBuffer)

    offset += localHeader.length + nameBuffer.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  endRecord.writeUInt16LE(0, 4) // disk number
  endRecord.writeUInt16LE(0, 6) // disk with central directory
  endRecord.writeUInt16LE(entries.length, 8) // entries on this disk
  endRecord.writeUInt16LE(entries.length, 10) // total entries
  endRecord.writeUInt32LE(centralDirectory.length, 12)
  endRecord.writeUInt32LE(offset, 16) // central directory offset
  endRecord.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, centralDirectory, endRecord])
}

// Collect every file under a directory as { name, data } entries rooted at
// prefix, following a stable sorted order so archives are reproducible.
function collectDir(absoluteDir, prefix, entries) {
  if (!fs.existsSync(absoluteDir)) return
  for (const dirent of fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(absoluteDir, dirent.name)
    const name = `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) collectDir(absolute, name, entries)
    else if (dirent.isFile()) entries.push({ name, data: fs.readFileSync(absolute) })
  }
}

export function exportRun(root, id, options = {}) {
  const run = loadRun(root, id) // Throws Unknown run: <id> for a bad id.
  const locations = pathsFor(root)
  const runDir = path.join(locations.runs, id)
  const now = new Date()

  const entries = []
  // run.json
  entries.push({ name: `${id}/run.json`, data: fs.readFileSync(path.join(runDir, 'run.json')) })
  // evaluations/ (sealed scores, assessments, implementation details)
  collectDir(path.join(runDir, 'evaluations'), `${id}/evaluations`, entries)
  // published static report
  collectDir(path.join(locations.reports, id), `${id}/report`, entries)
  // published preview build, if present
  const hasPreview = fs.existsSync(path.join(locations.previews, id))
  collectDir(path.join(locations.previews, id), `${id}/preview`, entries)

  const manifest = {
    schema: 1,
    runId: id,
    model: run.model,
    title: run.title ?? run.model,
    protocolVersion: run.protocol?.version ?? run.benchmarkVersion ?? null,
    exportedAt: now.toISOString(),
    includes: {
      runJson: true,
      evaluations: fs.existsSync(path.join(runDir, 'evaluations')),
      report: fs.existsSync(path.join(locations.reports, id)),
      preview: hasPreview,
    },
    fileCount: entries.length,
  }
  entries.push({ name: `${id}/manifest.json`, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) })

  const zip = createZip(entries, now)
  const outPath = options.out
    ? path.resolve(root, options.out)
    : path.join(root, `${id}.zip`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, zip)

  return {
    id,
    output: path.relative(root, outPath).split(path.sep).join('/'),
    bytes: zip.length,
    fileCount: entries.length,
    includes: manifest.includes,
  }
}

// Exported for tests.
export const __internals = { createZip, crc32 }
