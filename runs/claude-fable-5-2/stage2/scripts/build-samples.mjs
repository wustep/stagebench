#!/usr/bin/env node
/**
 * Rebuilds the bundled piano sample library in public/samples/ from its upstream sources.
 *
 *   node scripts/build-samples.mjs --cache /some/dir/outside/the/repo
 *
 * It needs network access (pinned GitHub commits), `curl`, and `ffmpeg`. It is a provenance
 * tool: the app, the tests, and the build never run it and never touch the network. The files it
 * wrote are committed under public/samples/ and described in src/audio/library/manifest.json.
 *
 * What it does to each upstream recording, and nothing else:
 *   1. downmix to mono (0.5·L + 0.5·R) and resample to 32 kHz;
 *   2. bake in the 2-pole lowpass the upstream SFZ asks for on a few Upright regions;
 *   3. trim leading silence (2 ms before the first sample above -40 dB of the peak);
 *   4. cap the length by register and fade the tail out (the cap is listed per file);
 *   5. peak-normalise to -0.5 dBFS for 16-bit resolution (the factor is undone by `gain`);
 *   6. encode as 16-bit FLAC.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'samples')
const MANIFEST = join(ROOT, 'src', 'audio', 'library', 'manifest.json')
const cacheFlag = process.argv.indexOf('--cache')
const CACHE = cacheFlag > 0 ? resolve(process.argv[cacheFlag + 1]) : null
if (!CACHE) {
  console.error('usage: node scripts/build-samples.mjs --cache <download dir outside the repo>')
  process.exit(1)
}

const RATE = 32000
/** Reference short-term level every velocity layer is aligned to before the engine applies its own curve. */
const REFERENCE_RMS = 0.1

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

/** Seconds kept per recording, by root note. Piano notes ring longer in the bass. */
function lengthCap(root, set) {
  if (set === 'electric') return 4
  if (root <= 40) return 6
  if (root <= 52) return 5.5
  if (root <= 64) return 5
  if (root <= 76) return 4
  if (root <= 88) return 3
  return 2
}

const SOURCES = {
  grand: {
    name: 'Salamander Grand Piano V3',
    instrument: 'Yamaha C5 grand piano',
    author: 'Alexander Holm',
    repo: 'sfzinstruments/SalamanderGrandPiano',
    commit: '3382bf9496bba2486f5ab0de55a264d1dfc38404',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    upstream: 'https://archive.org/details/SalamanderGrandPianoV3',
  },
  upright: {
    name: 'Upright Piano KW (2022-02-21)',
    instrument: 'Kawai upright piano',
    author: 'Gonzalo and Roberto (FreePats project)',
    repo: 'freepats/upright-piano-KW',
    commit: '570f6c60ed2eff67accad3b85d5b452e57a3ad28',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    upstream: 'http://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW',
  },
  electric: {
    name: 'Wurlitzer EP200 Electric Piano v1.1',
    instrument: 'Wurlitzer EP200 reed electric piano',
    author: 'Greg Sullivan',
    repo: 'sfzinstruments/GregSullivan.E-Pianos',
    commit: '8c3e581acda3594b553948ff0222d4f84a698376',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    upstream: 'http://www.sullivang.net/',
  },
}

const rawUrl = (set, path) =>
  `https://raw.githubusercontent.com/${SOURCES[set].repo}/${SOURCES[set].commit}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

async function fetchCached(set, path) {
  const target = join(CACHE, set, path)
  if (existsSync(target) && statSync(target).size > 0) return target
  mkdirSync(dirname(target), { recursive: true })
  await run('curl', ['-sSfL', '--retry', '3', '-m', '180', '-o', target, rawUrl(set, path)])
  return target
}

async function pool(items, size, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

// ── Region lists ──────────────────────────────────────────────────────────────

/** Salamander: 30 roots a minor third apart (A0..C8); three of its sixteen velocity layers. */
function grandRegions() {
  const layers = [
    { name: 'v4', maxVelocity: 0.4 },
    { name: 'v9', maxVelocity: 0.72 },
    { name: 'v14', maxVelocity: 1 },
  ]
  const regions = []
  layers.forEach((layer, layerIndex) => {
    for (let root = 21; root <= 108; root += 3) {
      regions.push({
        layer: layerIndex,
        lo: root === 21 ? 0 : root - 1,
        hi: root === 108 ? 127 : root + 1,
        root,
        tune: 0,
        volume: 0,
        source: `Samples/${noteName(root)}${layer.name}.flac`,
      })
    }
  })
  return { layers, regions }
}

/** Minimal SFZ reader: enough for the two upstream mappings used here. */
function parseSfz(text) {
  const defines = {}
  const clean = text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
  for (const match of clean.matchAll(/#define\s+(\$\w+)\s+(\S+)/g)) defines[match[1]] = match[2]
  const resolved = clean.replace(/\$\w+/g, (name) => defines[name] ?? name)
  const headers = [...resolved.matchAll(/<(\w+)>([^<]*)/g)]
  const regions = []
  let group = {}
  let control = {}
  for (const [, kind, body] of headers) {
    const opcodes = {}
    // Opcode values may contain spaces (sample paths), so split on the next `name=`.
    for (const match of body.matchAll(/(\w+)=([\s\S]*?)(?=\s+\w+=|\s*$)/g)) opcodes[match[1]] = match[2].trim()
    if (kind === 'control') control = opcodes
    else if (kind === 'group') group = opcodes
    else if (kind === 'region') regions.push({ ...group, ...opcodes })
  }
  return { control, regions }
}

function sfzRegions(text, sampleDir) {
  const { control, regions: parsed } = parseSfz(text)
  const prefix = sampleDir + (control.default_path ?? '')
  const ceilings = [...new Set(parsed.map((region) => Number(region.hivel ?? 127)))].sort((a, b) => a - b)
  const layers = ceilings.map((hivel) => ({ name: `vel-${hivel}`, maxVelocity: hivel >= 127 ? 1 : hivel / 127 }))
  const regions = parsed.map((region) => ({
    layer: ceilings.indexOf(Number(region.hivel ?? 127)),
    // `key=N` is SFZ shorthand for lokey = hikey = pitch_keycenter = N.
    lo: Number(region.lokey ?? region.key ?? 0),
    hi: Number(region.hikey ?? region.key ?? 127),
    root: Number(region.pitch_keycenter ?? region.key),
    tune: Number(region.tune ?? 0),
    volume: Number(region.volume ?? 0),
    source: prefix + region.sample.replace(/\\/g, '/'),
    lowpass: region.fil_type === 'lpf_2p' ? Number(region.cutoff) : undefined,
  }))
  return { layers, regions }
}

// ── Audio processing ──────────────────────────────────────────────────────────

async function decode(path, lowpass) {
  const args = ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE)]
  if (lowpass) args.push('-af', `lowpass=f=${lowpass}:p=2`)
  args.push('-f', 'f32le', '-')
  const { stdout } = await run('ffmpeg', args, { encoding: 'buffer', maxBuffer: 1 << 28 })
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4)).slice()
}

function shape(samples, capSeconds) {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  let first = 0
  while (first < samples.length && Math.abs(samples[first]) < peak * 0.01) first += 1
  const start = Math.max(0, first - Math.round(RATE * 0.002))
  const available = samples.length - start
  const frames = Math.min(available, Math.round(capSeconds * RATE))
  const out = new Float32Array(frames)
  // A truncated recording fades over its last 30 %; a complete one only gets a short safety fade.
  const fade = frames < available ? Math.round(frames * 0.3) : Math.min(frames, Math.round(RATE * 0.05))
  const rampIn = Math.min(16, frames)
  for (let i = 0; i < frames; i += 1) {
    let gain = 1
    if (i < rampIn && start > 0) gain *= (i + 1) / rampIn
    const fromEnd = frames - 1 - i
    if (fromEnd < fade) {
      const t = fromEnd / fade
      gain *= t * t * (3 - 2 * t)
    }
    out[i] = samples[start + i] * gain
  }
  let outPeak = 0
  for (const sample of out) outPeak = Math.max(outPeak, Math.abs(sample))
  const window = Math.min(frames, Math.round(RATE * 0.3))
  let sum = 0
  for (let i = 0; i < window; i += 1) sum += out[i] * out[i]
  return { out, peak: outPeak, rms: Math.sqrt(sum / Math.max(1, window)), truncated: frames < available }
}

function wavBytes(samples, scale) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + samples.length * 2, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(RATE, 24)
  bytes.writeUInt32LE(RATE * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples.length * 2, 40)
  // FNV-1a over the little-endian PCM bytes: lets the test suite prove the app's own FLAC
  // decoder returns exactly the samples that were encoded, without needing ffmpeg.
  let hash = 0x811c9dc5
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-32768, Math.min(32767, Math.round(samples[i] * scale * 32767)))
    bytes.writeInt16LE(value, 44 + i * 2)
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193)
    hash = Math.imul(hash ^ ((value >> 8) & 0xff), 0x01000193)
  }
  return { bytes, pcmHash: (hash >>> 0).toString(16).padStart(8, '0') }
}

const slug = (path) =>
  path
    .split('/')
    .pop()
    .replace(/\.flac$/i, '')
    .replace(/#/g, 's')
    .replace(/[^A-Za-z0-9_-]/g, '_')

async function buildSet(set) {
  let mapping
  if (set === 'grand') {
    mapping = grandRegions()
  } else if (set === 'upright') {
    const sfz = await fetchCached(set, 'UprightPianoKW-20220221.sfz')
    mapping = sfzRegions(readFileSync(sfz, 'utf8'), '')
  } else {
    const sfz = await fetchCached(set, 'Wurlitzer EP200/Wurlitzer EP200.sfz')
    mapping = sfzRegions(readFileSync(sfz, 'utf8'), 'Wurlitzer EP200/')
  }
  const { layers, regions } = mapping

  // One output file per distinct (recording, baked lowpass, length cap).
  const outputs = new Map()
  for (const region of regions) {
    const cap = lengthCap(region.root, set)
    const key = `${region.source}|${region.lowpass ?? ''}`
    const existing = outputs.get(key)
    if (existing) existing.cap = Math.max(existing.cap, cap)
    else {
      const suffix = region.lowpass ? `-lp${region.lowpass}` : ''
      outputs.set(key, { key, source: region.source, lowpass: region.lowpass, cap, file: `${set}/${slug(region.source)}${suffix}.flac`, root: region.root })
    }
    region.key = key
  }

  const list = [...outputs.values()]
  await pool(list, 8, async (output) => {
    const source = await fetchCached(set, output.source)
    const { out, peak, rms, truncated } = shape(await decode(source, output.lowpass), output.cap)
    const scale = 0.944 / peak
    const wav = join(CACHE, 'tmp', `${output.file.replace('/', '-')}.wav`)
    mkdirSync(dirname(wav), { recursive: true })
    const encoded = wavBytes(out, scale)
    writeFileSync(wav, encoded.bytes)
    const target = join(OUT, output.file)
    mkdirSync(dirname(target), { recursive: true })
    await run('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'flac', '-compression_level', '12', '-sample_fmt', 's16', target])
    rmSync(wav)
    const bytes = readFileSync(target)
    Object.assign(output, {
      frames: out.length,
      scale,
      rms,
      truncated,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      pcmHash: encoded.pcmHash,
    })
  })

  // Align each velocity layer to the reference level; relative levels across the keyboard stay as recorded.
  const layerGain = layers.map((_, index) => {
    const levels = [...new Set(regions.filter((region) => region.layer === index).map((region) => region.key))]
      .map((key) => outputs.get(key).rms)
      .sort((a, b) => a - b)
    return REFERENCE_RMS / levels[Math.floor(levels.length / 2)]
  })

  const round = (value, digits) => Number(value.toFixed(digits))
  return {
    source: SOURCES[set],
    layers: layers.map((layer, index) => ({
      name: layer.name,
      maxVelocity: round(layer.maxVelocity, 4),
      zones: regions
        .filter((region) => region.layer === index)
        .sort((a, b) => a.lo - b.lo)
        .map((region) => {
          const output = outputs.get(region.key)
          return {
            lo: region.lo,
            hi: region.hi,
            root: region.root,
            tune: region.tune,
            gain: round((layerGain[index] * Math.pow(10, region.volume / 20)) / output.scale, 5),
            file: output.file,
          }
        }),
    })),
    files: list
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((output) => ({
        file: output.file,
        source: output.source,
        root: output.root,
        rootName: noteName(output.root),
        frames: output.frames,
        seconds: round(output.frames / RATE, 3),
        truncated: output.truncated,
        ...(output.lowpass ? { bakedLowpassHz: output.lowpass } : {}),
        bytes: output.bytes,
        sha256: output.sha256,
        pcmFnv1a: output.pcmHash,
      })),
  }
}

const manifest = { sampleRate: RATE, bitDepth: 16, channels: 1, format: 'flac', sets: {} }
for (const set of Object.keys(SOURCES)) {
  rmSync(join(OUT, set), { recursive: true, force: true })
  manifest.sets[set] = await buildSet(set)
  const files = manifest.sets[set].files
  const total = files.reduce((sum, file) => sum + file.bytes, 0)
  console.log(`${set}: ${files.length} files, ${(total / 1e6).toFixed(2)} MB`)
}
for (const set of Object.keys(SOURCES)) {
  const license = await fetchCached(set, 'LICENSE')
  writeFileSync(join(OUT, set, 'LICENSE.txt'), readFileSync(license))
}
mkdirSync(dirname(MANIFEST), { recursive: true })
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`)
console.log(`wrote ${MANIFEST}`)
