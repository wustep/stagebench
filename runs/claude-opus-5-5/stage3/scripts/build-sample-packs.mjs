#!/usr/bin/env node
// Builds the bundled recorded-sample packs (public/samples/*.nspk) from the processed WAV zones
// produced by scripts/samples/build.py (24 kHz mono 16-bit, see scripts/samples/manifest*.json).
//
//   node scripts/build-sample-packs.mjs <dir-with-processed-wavs>
//
// <dir> must contain grand/, upright/, electric/ and electric_rhodes/ subfolders of WAVs named as
// in the manifests. Pack layout: 'NSPK' | u32 version=1 | u32 headerLength | JSON header | data.
// Audio is block IMA-ADPCM (4 bit, 1017 samples per 512-byte block), decoded in
// src/audio/samplePack.ts by the browser and the tests alike.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const srcDir = process.argv[2]
if (!srcDir) {
  console.error('usage: node scripts/build-sample-packs.mjs <processed-wav-dir>')
  process.exit(1)
}

const BLOCK_SAMPLES = 1017
const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
  3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
  29794, 32767,
]
const INDEX_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8]

function readWav(path) {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`)
  let pos = 12
  let fmt = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    if (id === 'data') {
      if (!fmt || fmt.channels !== 1 || fmt.bits !== 16) throw new Error(`${path}: expected mono 16-bit`)
      const n = size / 2
      const pcm = new Int16Array(n)
      for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(body + i * 2)
      return { rate: fmt.rate, pcm }
    }
    pos = body + size + (size & 1)
  }
  throw new Error(`${path}: no data chunk`)
}

/** Encode with the exact arithmetic of decodeZone(); state carries across blocks. */
function encode(pcm) {
  const out = []
  let pred = 0
  let index = 0
  let n = 0
  while (n < pcm.length) {
    pred = pcm[n]
    out.push(pred & 255, (pred >> 8) & 255, index, 0)
    n++
    const inBlock = Math.min(BLOCK_SAMPLES - 1, pcm.length - n)
    const bytes = new Uint8Array(Math.ceil(inBlock / 2))
    for (let i = 0; i < inBlock; i++) {
      const target = pcm[n++]
      const step = STEPS[index]
      let diff = target - pred
      let code = 0
      if (diff < 0) {
        code = 8
        diff = -diff
      }
      if (diff >= step) {
        code |= 4
        diff -= step
      }
      if (diff >= step >> 1) {
        code |= 2
        diff -= step >> 1
      }
      if (diff >= step >> 2) code |= 1
      // Reconstruct exactly as the decoder does.
      let d = step >> 3
      if (code & 4) d += step
      if (code & 2) d += step >> 1
      if (code & 1) d += step >> 2
      pred = code & 8 ? Math.max(-32768, pred - d) : Math.min(32767, pred + d)
      index = Math.min(88, Math.max(0, index + INDEX_ADJUST[code & 7]))
      bytes[i >> 1] |= i & 1 ? code << 4 : code
    }
    for (const b of bytes) out.push(b)
  }
  return Uint8Array.from(out)
}

const manifest = {
  ...JSON.parse(readFileSync(join(here, 'samples/manifest.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(here, 'samples/manifest-extra.json'), 'utf8')),
}

const PACKS = [
  { id: 'grand', src: 'grand' },
  { id: 'upright', src: 'upright' },
  { id: 'electric', src: 'electric' },
  { id: 'electric-rhodes', src: 'electric_rhodes' },
]

mkdirSync(join(root, 'public/samples'), { recursive: true })
for (const p of PACKS) {
  const meta = manifest[p.src]
  const chunks = []
  const zones = []
  let offset = 0
  let rate = 0
  for (const z of meta.zones) {
    const wav = readWav(join(srcDir, p.src, z.file))
    rate = wav.rate
    const data = encode(wav.pcm)
    // Playback correction for measurably detuned recordings (|measured| > 15 cents).
    const tuneCents = Math.abs(z.measuredCents ?? 0) > 15 ? -z.measuredCents : 0
    zones.push({
      root: z.rootMidi,
      layer: z.layer,
      velLo: z.velocityRange[0],
      velHi: z.velocityRange[1],
      length: wav.pcm.length,
      offset,
      bytes: data.length,
      tuneCents,
      source: z.originalFile,
      file: z.file,
    })
    chunks.push(data)
    offset += data.length
  }
  const header = {
    format: 'nspk',
    version: 1,
    id: p.id,
    name: meta.name,
    recordedInstrument: meta.recordedInstrument,
    author: meta.author,
    license: meta.license,
    licenseUrl: meta.licenseUrl,
    attribution: meta.attribution,
    sourceUrl: meta.source,
    downloadUrl: meta.download,
    sampleRate: rate,
    codec: 'ima-adpcm-block',
    blockSamples: BLOCK_SAMPLES,
    zones,
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const pre = Buffer.alloc(12)
  pre.writeUInt32LE(0x4b50534e, 0)
  pre.writeUInt32LE(1, 4)
  pre.writeUInt32LE(json.length, 8)
  const file = Buffer.concat([pre, json, ...chunks.map((c) => Buffer.from(c))])
  writeFileSync(join(root, `public/samples/${p.id}.nspk`), file)
  console.log(`${p.id}: ${zones.length} zones, ${(file.length / 1048576).toFixed(2)} MiB`)
}
