/**
 * Offline-bake multi-root multi-velocity PCM sample sets for Grand, Upright, Electric.
 * These are authored demo sample assets (not mic recordings of acoustic instruments).
 * Output: public/samples/{grand,upright,electric}/r{midi}_v{0|1}.wav
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', 'public', 'samples')
const SR = 22050
const ROOTS = [36, 42, 48, 54, 60, 66, 72, 78, 84] // every 6 semitones
const VELOCITIES = [0, 1] // soft / hard

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function writeWav(filePath, samples, sampleRate) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 21) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2)
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buf)
}

/** Distinct harmonic recipes per instrument family */
const PROFILES = {
  grand: {
    partials: [
      { m: 1, a: 1.0 },
      { m: 2, a: 0.42 },
      { m: 3, a: 0.18 },
      { m: 4, a: 0.09 },
      { m: 5, a: 0.04 },
      { m: 6, a: 0.02 },
    ],
    decay: 2.8,
    brightness: 1.0,
    noise: 0.002,
  },
  upright: {
    partials: [
      { m: 1, a: 1.0 },
      { m: 2, a: 0.55 },
      { m: 3, a: 0.28 },
      { m: 4, a: 0.14 },
      { m: 5, a: 0.08 },
      { m: 7, a: 0.03 },
    ],
    decay: 1.9,
    brightness: 0.75,
    noise: 0.006,
  },
  electric: {
    partials: [
      { m: 1, a: 1.0 },
      { m: 2, a: 0.12 },
      { m: 3, a: 0.35 },
      { m: 5, a: 0.08 },
      { m: 7, a: 0.04 },
    ],
    decay: 2.2,
    brightness: 1.15,
    noise: 0.001,
    tine: true,
  },
}

function renderNote(profile, midi, velLayer) {
  const dur = 0.9
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const f0 = midiToFreq(midi)
  const vel = velLayer === 0 ? 0.45 : 0.95
  const attack = 0.004 + (1 - vel) * 0.008

  for (let i = 0; i < n; i++) {
    const t = i / SR
    let env = 1
    if (t < attack) env = t / attack
    else env = Math.exp(-(t - attack) * profile.decay * (0.7 + (1 - vel) * 0.5))
    env *= vel

    let s = 0
    for (const p of profile.partials) {
      const amp = p.a * Math.pow(profile.brightness, p.m - 1) * Math.exp(-t * profile.decay * p.m * 0.35)
      // slight inharmonicity for acoustic character
      const inh = profile.tine ? 1 : 1 + p.m * p.m * 0.0003
      s += amp * Math.sin(2 * Math.PI * f0 * p.m * inh * t)
    }
    if (profile.tine) {
      // electric tine attack ping
      s += 0.25 * vel * Math.exp(-t * 40) * Math.sin(2 * Math.PI * f0 * 14 * t)
    }
    // tiny noise for acoustic body
    s += (Math.random() * 2 - 1) * profile.noise * env
    out[i] = s * env * 0.35
  }
  // normalize peak
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) {
    const g = 0.9 / peak
    for (let i = 0; i < n; i++) out[i] *= g
  }
  return out
}

for (const [name, profile] of Object.entries(PROFILES)) {
  const dir = path.join(ROOT, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const midi of ROOTS) {
    for (const v of VELOCITIES) {
      const samples = renderNote(profile, midi, v)
      const file = path.join(dir, `r${midi}_v${v}.wav`)
      writeWav(file, samples, SR)
    }
  }
  // manifest
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        name,
        sampleRate: SR,
        roots: ROOTS,
        velocityLayers: VELOCITIES.length,
        files: ROOTS.flatMap((m) => VELOCITIES.map((v) => `r${m}_v${v}.wav`)),
      },
      null,
      2,
    ),
  )
  console.log(`wrote ${name}: ${ROOTS.length * VELOCITIES.length} files`)
}
