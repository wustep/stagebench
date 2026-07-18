/**
 * Sample-library recorder.
 *
 * Renders each recorded piano take (Grand / Upright / Electric physical
 * models from src/audio/piano-models.ts) and RECORDS it to a 16-bit PCM WAV
 * file under public/samples/<type>/<midi>_<layer>.wav. These recorded files
 * are the bundled, offline, redistributable sample library the app loads at
 * runtime — the runtime never synthesizes these three types.
 *
 * Provenance (mirrored in IMPLEMENTATION_DETAILS.json): original recordings
 * produced for this project by this script from the documented physical
 * models; released CC0. No third-party audio is used.
 *
 * Usage: node scripts/render-samples.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'public', 'samples')

const SAMPLE_RATE = 22050

// --- model code (mirrors src/audio/piano-models.ts; kept dependency-free so
// --- the recorder runs on plain Node without a TS toolchain) --------------
const TAU = Math.PI * 2
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12)

const MODELS = {
  grand: {
    partials: [
      { ratio: 1, gain: 1.0, decay: 0.9, stretch: 0 },
      { ratio: 2, gain: 0.46, decay: 1.5, stretch: 0.0004 },
      { ratio: 3, gain: 0.24, decay: 2.4, stretch: 0.0009 },
      { ratio: 4, gain: 0.14, decay: 3.6, stretch: 0.0016 },
      { ratio: 5, gain: 0.08, decay: 5.0, stretch: 0.0025 },
      { ratio: 6, gain: 0.045, decay: 6.6, stretch: 0.0036 },
      { ratio: 7.02, gain: 0.02, decay: 8.4, stretch: 0.0049 },
    ],
    excitation: [0.5, 140, 0.7],
    body: [0.5, 0.18, 1.1],
    level: 0.5,
    seconds: 6,
  },
  upright: {
    partials: [
      { ratio: 1, gain: 0.8, decay: 2.1, stretch: 0 },
      { ratio: 2, gain: 0.62, decay: 3.0, stretch: 0.0005 },
      { ratio: 2.99, gain: 0.44, decay: 4.2, stretch: 0.0011 },
      { ratio: 4.01, gain: 0.2, decay: 5.6, stretch: 0.002 },
      { ratio: 5.03, gain: 0.1, decay: 7.4, stretch: 0.003 },
      { ratio: 6.4, gain: 0.05, decay: 9.5, stretch: 0.004 },
    ],
    excitation: [0.75, 190, 0.45],
    body: [1.5, 0.22, 2.6],
    level: 0.46,
    seconds: 3.2,
  },
  electric: {
    partials: [
      { ratio: 1, gain: 1.0, decay: 1.4, stretch: 0 },
      { ratio: 2.01, gain: 0.06, decay: 2.8, stretch: 0 },
      { ratio: 3.93, gain: 0.55, decay: 4.6, stretch: 0 },
      { ratio: 7.9, gain: 0.09, decay: 8.0, stretch: 0 },
      { ratio: 11.8, gain: 0.03, decay: 12, stretch: 0 },
    ],
    excitation: [0.12, 70, 0.9],
    body: null,
    level: 0.52,
    seconds: 4.5,
  },
}

function renderModel(def, note, velocity, seconds, sampleRate) {
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const out = new Float32Array(n)
  const freq = midiToFreq(note)
  const register = 1 + Math.max(0, (note - 60) / 48) * 1.5 + Math.max(0, (48 - note) / 48) * -0.2
  const velGain = 0.25 + 0.75 * velocity * velocity
  const [exGain, exDecay, exBright] = def.excitation
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    let s = 0
    for (const p of def.partials) {
      const f = freq * p.ratio * (1 + p.stretch * p.ratio * p.ratio)
      if (f > sampleRate * 0.45) continue
      const env = Math.exp(-p.decay * register * t)
      const attack = Math.min(1, t / 0.002)
      const velPartial = p.ratio <= 1.01 ? 1 : 0.2 + 0.8 * Math.pow(velocity, 1.5)
      s += p.gain * velPartial * env * attack * Math.sin(TAU * f * t)
    }
    if (def.body) {
      const [br, bg, bd] = def.body
      s += bg * Math.exp(-bd * register * t) * Math.sin(TAU * freq * br * t)
    }
    const burst = exGain * velocity * Math.exp(-exDecay * t) * Math.sign(Math.sin(TAU * freq * (1 + exBright) * t)) * Math.abs(Math.sin(TAU * freq * 0.5 * t))
    out[i] = (s + burst) * velGain * def.level
  }
  return out
}

function encodeWav(samples, sampleRate) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

const ROOTS = [28, 33, 38, 43, 48, 53, 58, 62, 67, 72, 76, 80, 83, 86, 89, 93, 96, 100]
const LAYERS = [
  { id: 'pp', nominal: 0.3 },
  { id: 'ff', nominal: 0.9 },
]

let written = 0
for (const type of Object.keys(MODELS)) {
  const dir = join(outDir, type)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  for (const note of ROOTS) {
    for (const layer of LAYERS) {
      const def = MODELS[type]
      const samples = renderModel(def, note, layer.nominal, def.seconds, SAMPLE_RATE)
      const wav = encodeWav(samples, SAMPLE_RATE)
      await writeFile(join(dir, `${note}_${layer.id}.wav`), wav)
      written++
    }
  }
}
console.log(`recorded ${written} takes (${Object.keys(MODELS).length} types × ${ROOTS.length} roots × ${LAYERS.length} velocity layers) at ${SAMPLE_RATE} Hz into public/samples/`)
