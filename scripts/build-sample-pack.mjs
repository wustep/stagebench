#!/usr/bin/env node
// Maintainer tool: (re)build sample-pack/manifest.json from the upstream
// sources named below, pinned to exact commits.
//
//   node scripts/build-sample-pack.mjs
//
// It lists each upstream tree at its pinned commit, keeps the files the
// selection rule names, downloads them (checking each against upstream's own
// git blob hash), stores them in sample-pack/files/, and records every file's
// size and sha256. Changing a source, a commit, or a selection is a
// comparison-critical change: a different manifest is a different pack.
//
// Selection never edits audio. A file is either taken whole, exactly as
// published, or left out. An uncompressed WAV recording is stored with its
// samples coded as FLAC and the bytes around them recorded in the manifest
// (see bench/lib/sample-pack.mjs); that needs the flac command, and the stored
// file is accepted only after it rebuilds the published bytes exactly.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { FLAC_PCM, RECORDING, loadSamplePack, rebuildRecording, samplePackDir, samplePackFilesDir, storeRecording, storedName, upstreamUrl, wavLayout } from '../bench/lib/sample-pack.mjs'
import { sha256 } from '../bench/lib/shared.mjs'

const root = path.resolve(import.meta.dirname, '..')

const SALAMANDER_LAYERS = [1, 2, 3, 4, 7, 10, 13, 16]

const SOURCES = [
  {
    id: 'salamander-grand-v3',
    name: 'Salamander Grand Piano V3',
    role: 'Grand',
    instrument: 'Yamaha C5 grand piano',
    author: 'Alexander Holm',
    license: 'CC-BY-3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    licenseFiles: ['LICENSE'],
    attribution: 'Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://archive.org/details/SalamanderGrandPianoV3',
    homepage: 'https://archive.org/details/SalamanderGrandPianoV3',
    repository: 'sfzinstruments/SalamanderGrandPiano',
    commit: '3382bf9496bba2486f5ab0de55a264d1dfc38404',
    directory: 'grand/salamander-grand-v3',
    format: 'FLAC, 48 kHz, 24-bit, stereo (two AKG C414 in AB, about 12 cm above the strings)',
    selection: 'Eight of the sixteen velocity layers (v1, v2, v3, v4, v7, v10, v13, v16) for all 30 sampled notes (minor thirds, A0 to C8), plus every auxiliary recording: 88 hammer-release noises (rel*), 69 string-resonance recordings (harm*), and 4 pedal noises. v2 and v3 were added to the first six because the step from v1 to v4 (about 9 dB) was three times any other step between the kept layers; with them the largest step is under 5 dB. The other eight layers are left out to keep the pack a reasonable size; nothing that is included is altered.',
    select: (file) => new RegExp(`^Samples/[A-G]#?\\dv(${SALAMANDER_LAYERS.join('|')})\\.flac$`).test(file) || /^Samples\/(rel|harm|pedal)[^/]*\.flac$/.test(file) || ['README.md', 'LICENSE', 'Salamander Grand Piano V3.sfz'].includes(file) || /^Data\/[^/]+\.txt$/.test(file),
  },
  {
    id: 'upright-piano-kw',
    name: 'Upright Piano KW',
    role: 'Upright',
    instrument: 'Kawai upright piano, recorded in a living room',
    author: 'Gonzalo and Roberto (FreePats project)',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    licenseFiles: ['LICENSE'],
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
    licenseFiles: ['LICENSE'],
    attribution: "Wurlitzer EP200, Hohner Pianet T, and Yamaha CP80 samples by Greg Sullivan (http://www.sullivang.net/), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://github.com/sfzinstruments/GregSullivan.E-Pianos",
    homepage: 'http://www.sullivang.net/',
    repository: 'sfzinstruments/GregSullivan.E-Pianos',
    commit: '8c3e581acda3594b553948ff0222d4f84a698376',
    directory: 'electric/greg-sullivan-e-pianos',
    format: 'FLAC, 44.1 kHz, 16-bit, mono',
    selection: 'The whole published set: all three instruments with their SFZ mappings, the upstream README, and LICENSE.',
    select: (file) => /\.(flac|sfz)$/.test(file) || ['README.md', 'LICENSE'].includes(file),
  },
  {
    // Jeff Learman's own CC0 release of a GM cut of his Rhodes, separate from
    // jRhodes3c/3d (CC BY-NC, not in the pack). He committed the instrument and
    // its license line himself, and confirmed the license in public; see
    // licenseEvidence and LICENSES.md.
    id: 'learman-rhodes-gm',
    name: 'Rhodes Mark I, GM version (Discord SFZ GM Bank)',
    role: 'Electric',
    instrument: '1977 Rhodes Mark I Stage 73 (tine electric piano), recorded from the harp output',
    author: 'Jeff Learman',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    licenseFiles: ['Discord GM/Melodic/005-Electric Piano 1.sfz', 'README.md'],
    licenseEvidence: [
      'Discord GM/Melodic/005-Electric Piano 1.sfz, header committed by the author (GitHub jlearman, commits 05d5ed8befa0 and 945cca9cab6e): "Author: Jeff Learman ... License: Creative Commons CC0, Jeff Learman ... Mapped and relooped for GM by jlearman"',
      'The bank README: each instrument is licensed by its creator, with the terms in its .sfz file; only CC0, CC-BY, and equivalent licenses are allowed.',
      'The author, on KVR (2022-11-14, https://www.kvraudio.com/forum/viewtopic.php?p=8555554#p8555554): "The Rhodes and acoustic guitar are CC0 for sure because I released them"',
    ],
    attribution: 'Rhodes Mark I samples (jRhodes GM version) by Jeff Learman, CC0 1.0 (public domain dedication). Source: https://github.com/sfzinstruments/Discord-SFZ-GM-Bank',
    homepage: 'https://github.com/sfzinstruments/Discord-SFZ-GM-Bank',
    repository: 'sfzinstruments/Discord-SFZ-GM-Bank',
    commit: '7a9c478fe331f94f246d33332f0adedb25bbbe27',
    directory: 'electric/learman-rhodes-gm',
    format: 'WAV, 44.1 kHz, 16-bit, mono; shortened and looped by the author (loop points in each file’s smpl chunk)',
    selection: 'The whole instrument as its author published it in the bank (General MIDI program 5, Electric Piano 1): 15 recordings, one dynamic per note, a root every three to six semitones from F1 to C7 (file names give the MIDI note), with its SFZ mappings and the bank README. The other instruments in the bank are not included.',
    select: (file) => file === 'README.md' || file === 'Discord GM/Melodic/005-Electric Piano 1.sfz' || file.startsWith('Discord GM/Melodic/005-Electric Piano 1/'),
  },
  {
    id: 'vcsl-pipe-organ',
    name: 'VCSL Pipe Organ',
    role: 'Organ',
    instrument: 'Pipe organ, two registrations on the third manual',
    author: 'Simon Dalzell (Ivy Audio), for Versilian Studios',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    licenseFiles: ['LICENSE', 'Aerophones/Edge-blown Aerophones/Pipe Organ/Info.txt'],
    attribution: 'Pipe organ samples by Simon Dalzell (Ivy Audio), from the Versilian Community Sample Library by Versilian Studios LLC, CC0 1.0 (public domain dedication). Source: https://github.com/sgossner/VCSL',
    homepage: 'https://github.com/sgossner/VCSL',
    repository: 'sgossner/VCSL',
    commit: 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e',
    directory: 'organ/vcsl-pipe-organ',
    format: 'WAV, 44.1 kHz, 16-bit, stereo, about 12 s per note',
    selection: 'The two manual registrations, Loud (Rode_Man3Open_*) and Quiet (NT5_Man3Quiet_*), each with 21 notes in minor thirds from C1 to C6, plus the set’s Info.txt and the library README and LICENSE. The two pedal registrations (22 recordings) and the blower noise are left out for size, as is the rest of the library.',
    select: (file) => /^Aerophones\/Edge-blown Aerophones\/Pipe Organ\/(Loud|Quiet)\/[^/]+\.wav$/.test(file) || file === 'Aerophones/Edge-blown Aerophones/Pipe Organ/Info.txt' || ['README.md', 'LICENSE'].includes(file),
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

// What git calls the file: sha1 over "blob <size>\0" and the bytes. The tree
// listing gives it for every file, so each download is checked against
// upstream itself, not only against its size.
const gitBlobSha = (buffer) => crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')

const filesDir = samplePackFilesDir(root)
const previous = new Map((loadSamplePack(root)?.manifest.files ?? []).map((entry) => [entry.path, entry]))

// The published bytes of one upstream file: from what is already stored when
// it still matches upstream's blob hash, from upstream otherwise.
async function published(source, entry, relative) {
  const candidates = []
  const earlier = previous.get(relative)
  if (earlier?.stored && fs.existsSync(path.join(filesDir, storedName(earlier)))) candidates.push(async () => rebuildRecording(earlier, fs.readFileSync(path.join(filesDir, storedName(earlier)))))
  if (fs.existsSync(path.join(filesDir, relative)) && fs.statSync(path.join(filesDir, relative)).size === entry.size) candidates.push(async () => fs.readFileSync(path.join(filesDir, relative)))
  for (const read of candidates) {
    try {
      const buffer = await read()
      if (gitBlobSha(buffer) === entry.sha) return { buffer, downloaded: false }
    } catch { /* fetch it again */ }
  }
  const buffer = await fetchRetry(upstreamUrl(source, entry.path))
  if (buffer.length !== entry.size || gitBlobSha(buffer) !== entry.sha) throw new Error(`${relative}: download does not match upstream's blob (${buffer.length} bytes, tree says ${entry.size})`)
  return { buffer, downloaded: true }
}

const files = []
const sources = []
for (const { select, ...source } of SOURCES) {
  const tree = await fetchRetry(`https://api.github.com/repos/${source.repository}/git/trees/${source.commit}?recursive=1`, true)
  if (tree.truncated) throw new Error(`${source.repository}: tree listing was truncated`)
  const chosen = tree.tree.filter((entry) => entry.type === 'blob' && select(entry.path)).sort((a, b) => a.path.localeCompare(b.path))
  for (const name of source.licenseFiles) if (!chosen.some((entry) => entry.path === name)) throw new Error(`${source.id}: license file ${name} is not in the selection`)
  let next = 0
  let downloads = 0
  const records = new Array(chosen.length)
  const formats = new Set()
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < chosen.length) {
      const index = next
      next += 1
      const entry = chosen[index]
      const relative = `${source.directory}/${entry.path}`
      const { buffer, downloaded } = await published(source, entry, relative)
      if (downloaded) downloads += 1
      const record = { path: relative, source: source.id, upstreamPath: entry.path, bytes: buffer.length, sha256: sha256(buffer) }
      const layout = /\.wav$/i.test(entry.path) ? wavLayout(buffer) : null
      if (layout) {
        formats.add(`${layout.sampleRate} Hz, ${layout.bitsPerSample}-bit, ${layout.channels} ch`)
        record.stored = { codec: FLAC_PCM, head: layout.head.toString('base64'), tail: layout.tail.toString('base64') }
      }
      const stored = await storeRecording(record, buffer)
      const target = path.join(filesDir, storedName(record))
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(stored)) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, stored)
      }
      if (record.stored) fs.rmSync(path.join(filesDir, relative), { force: true })
      records[index] = { record, storedBytes: stored.length }
    }
  }))
  files.push(...records.map(({ record }) => record))
  const audio = records.filter(({ record }) => RECORDING.test(record.path))
  const bytes = records.reduce((total, { record }) => total + record.bytes, 0)
  const storedBytes = records.reduce((total, { storedBytes: size }) => total + size, 0)
  process.stderr.write(`${source.id}: ${chosen.length} files (${downloads} downloaded)${formats.size ? `; WAV ${[...formats].join(' / ')}` : ''}\n`)
  sources.push({ ...source, files: records.length, recordings: audio.length, bytes, storedBytes })
}

const totalBytes = files.reduce((total, file) => total + file.bytes, 0)
const totalStored = sources.reduce((total, source) => total + source.storedBytes, 0)
const manifest = {
  $comment: 'Generated by scripts/build-sample-pack.mjs. The recordings are not in this repository: `pnpm bench fetch` downloads each file from its pinned upstream commit, checks it against the sha256 below, and stores it (a WAV as FLAC-coded samples plus the `stored` head and tail bytes, which rebuild the published file exactly). `bytes` and `sha256` are always the published file; `storedBytes` is what the maintainer\'s flac produced and varies a little with the flac version.',
  id: 'stagebench-raw-samples',
  version: '2.0.0',
  description: 'Raw, permissively licensed recordings for Stagebench protocol 3: one grand, one upright, four electric pianos (one tine, two reed, one electric grand), and a pipe organ. Every file is byte-identical to what its author published; nothing is trimmed, levelled, re-encoded, or mapped by the pack.',
  totals: { sources: sources.length, files: files.length, recordings: files.filter((file) => RECORDING.test(file.path)).length, bytes: totalBytes, storedBytes: totalStored },
  sources,
  files,
}
fs.writeFileSync(path.join(samplePackDir(root), 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`)
const mb = (value) => Number((value / 1024 / 1024).toFixed(1))
console.log(JSON.stringify({ manifest: 'sample-pack/manifest.json', ...manifest.totals, megabytes: mb(totalBytes), storedMegabytes: mb(totalStored), sources: sources.map(({ id, license, files: count, recordings, bytes, storedBytes }) => ({ id, license, files: count, recordings, megabytes: mb(bytes), storedMegabytes: mb(storedBytes) })) }, null, 2))
