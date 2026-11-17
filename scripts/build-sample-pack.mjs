#!/usr/bin/env node
// Maintainer tool: (re)build sample-pack/manifest.json from the upstream
// sources named below, pinned to exact commits.
//
//   node scripts/build-sample-pack.mjs
//
// It lists each upstream tree at its pinned commit, keeps the files the
// selection rule names, downloads them into sample-pack/files/, and records
// every file's size and sha256. Changing a source, a commit, or a selection is
// a comparison-critical change: a different manifest is a different pack.
//
// Selection never edits audio. A file is either taken whole, exactly as
// published, or left out.
import fs from 'node:fs'
import path from 'node:path'
import { samplePackDir, samplePackFilesDir, upstreamUrl } from '../bench/lib/sample-pack.mjs'
import { sha256 } from '../bench/lib/shared.mjs'

const root = path.resolve(import.meta.dirname, '..')

const SOURCES = [
  {
    id: 'salamander-grand-v3',
    name: 'Salamander Grand Piano V3',
    role: 'Grand',
    instrument: 'Yamaha C5 grand piano',
    author: 'Alexander Holm',
    license: 'CC-BY-3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    attribution: 'Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://archive.org/details/SalamanderGrandPianoV3',
    homepage: 'https://archive.org/details/SalamanderGrandPianoV3',
    repository: 'sfzinstruments/SalamanderGrandPiano',
    commit: '3382bf9496bba2486f5ab0de55a264d1dfc38404',
    directory: 'grand/salamander-grand-v3',
    format: 'FLAC, 48 kHz, 24-bit, stereo (two AKG C414 in AB, about 12 cm above the strings)',
    selection: 'Six of the sixteen velocity layers (v1, v4, v7, v10, v13, v16) for all 30 sampled notes (minor thirds, A0 to C8), plus every auxiliary recording: 88 hammer-release noises (rel*), 69 string-resonance recordings (harm*), and 4 pedal noises. The other ten velocity layers are left out to keep the pack a reasonable size; nothing that is included is altered.',
    select: (file) => /^Samples\/[A-G]#?\dv(1|4|7|10|13|16)\.flac$/.test(file) || /^Samples\/(rel|harm|pedal)[^/]*\.flac$/.test(file) || ['README.md', 'LICENSE', 'Salamander Grand Piano V3.sfz'].includes(file) || /^Data\/[^/]+\.txt$/.test(file),
  },
  {
    id: 'upright-piano-kw',
    name: 'Upright Piano KW',
    role: 'Upright',
    instrument: 'Kawai upright piano, recorded in a living room',
    author: 'Gonzalo and Roberto (FreePats project)',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Upright Piano KW by Gonzalo and Roberto, FreePats project, CC0 1.0 (public domain dedication). Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html',
    homepage: 'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html',
    repository: 'freepats/upright-piano-KW',
    commit: '570f6c60ed2eff67accad3b85d5b452e57a3ad28',
    directory: 'upright/upright-piano-kw',
    format: 'FLAC, 44.1 kHz, 24-bit, stereo (Zoom H1 at the player position)',
    selection: 'The whole published sample set: 66 recordings in two dynamics (vL, vH), with the upstream README, LICENSE, and SFZ mapping.',
    select: (file) => /^samples\/[^/]+\.flac$/.test(file) || ['README.md', 'LICENSE', 'UprightPianoKW-20220221.sfz'].includes(file),
  },
  {
    id: 'greg-sullivan-e-pianos',
    name: "Greg Sullivan's E-Pianos",
    role: 'Electric',
    instrument: 'Wurlitzer EP200 (reed), Hohner Pianet T (reed), Yamaha CP80 (electric grand)',
    author: 'Greg Sullivan',
    license: 'CC-BY-3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    attribution: "Wurlitzer EP200, Hohner Pianet T, and Yamaha CP80 samples by Greg Sullivan (http://www.sullivang.net/), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://github.com/sfzinstruments/GregSullivan.E-Pianos",
    homepage: 'http://www.sullivang.net/',
    repository: 'sfzinstruments/GregSullivan.E-Pianos',
    commit: '8c3e581acda3594b553948ff0222d4f84a698376',
    directory: 'electric/greg-sullivan-e-pianos',
    format: 'FLAC, 44.1 kHz, 16-bit, mono',
    selection: 'The whole published set: all three instruments with their SFZ mappings, the upstream README, and LICENSE.',
    select: (file) => /\.(flac|sfz)$/.test(file) || ['README.md', 'LICENSE'].includes(file),
  },
]

async function fetchRetry(url, json = false) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'sample-pack-builder', ...(json ? { accept: 'application/vnd.github+json' } : {}) } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return json ? await response.json() : Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (attempt >= 4) throw new Error(`${url}: ${error.message}`)
      await new Promise((done) => setTimeout(done, 800 * (attempt + 1)))
    }
  }
}

const filesDir = samplePackFilesDir(root)
const files = []
const sources = []
for (const { select, ...source } of SOURCES) {
  const tree = await fetchRetry(`https://api.github.com/repos/${source.repository}/git/trees/${source.commit}?recursive=1`, true)
  if (tree.truncated) throw new Error(`${source.repository}: tree listing was truncated`)
  const chosen = tree.tree.filter((entry) => entry.type === 'blob' && select(entry.path)).sort((a, b) => a.path.localeCompare(b.path))
  process.stderr.write(`${source.id}: ${chosen.length} files\n`)
  let bytes = 0
  let next = 0
  const records = new Array(chosen.length)
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < chosen.length) {
      const index = next
      next += 1
      const entry = chosen[index]
      const relative = `${source.directory}/${entry.path}`
      const target = path.join(filesDir, relative)
      let buffer = fs.existsSync(target) && fs.statSync(target).size === entry.size ? fs.readFileSync(target) : null
      if (!buffer) {
        buffer = await fetchRetry(upstreamUrl(source, entry.path))
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, buffer)
      }
      if (buffer.length !== entry.size) throw new Error(`${relative}: ${buffer.length} bytes, upstream tree says ${entry.size}`)
      bytes += buffer.length
      records[index] = { path: relative, source: source.id, upstreamPath: entry.path, bytes: buffer.length, sha256: sha256(buffer) }
    }
  }))
  files.push(...records)
  const audio = records.filter((record) => record.path.endsWith('.flac'))
  sources.push({ ...source, files: records.length, recordings: audio.length, bytes })
}

const manifest = {
  $comment: 'Generated by scripts/build-sample-pack.mjs. The recordings are not in this repository: `pnpm bench fetch` downloads each file from its pinned upstream commit and checks it against the sha256 below.',
  id: 'stagebench-raw-samples',
  version: '1.0.0',
  description: 'Raw, permissively licensed piano recordings for Stagebench protocol 3: one grand, one upright, three electric pianos. Every file is byte-identical to what its author published; nothing is trimmed, levelled, re-encoded, or mapped.',
  totals: { sources: sources.length, files: files.length, recordings: files.filter((file) => file.path.endsWith('.flac')).length, bytes: files.reduce((total, file) => total + file.bytes, 0) },
  sources,
  files,
}
fs.writeFileSync(path.join(samplePackDir(root), 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`)
console.log(JSON.stringify({ manifest: 'sample-pack/manifest.json', ...manifest.totals, megabytes: Number((manifest.totals.bytes / 1024 / 1024).toFixed(1)), sources: sources.map(({ id, license, files: count, recordings, bytes }) => ({ id, license, files: count, recordings, megabytes: Number((bytes / 1024 / 1024).toFixed(1)) })) }, null, 2))
