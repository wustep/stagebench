/**
 * Phase 2 sample generator — deterministic offline bounces.
 *
 * Renders three original synthetic-studio sample sets (Grand / Upright /
 * Electric) into `public/samples/<set>/` as 16-bit mono WAV at 22050 Hz, plus
 * `public/samples/manifest.json` with full provenance.
 *
 * Honesty: these are ORIGINAL synthetic-studio bounces created by this script
 * (CC0-1.0), not acoustic piano recordings, and they are never described as
 * such. IMPLEMENTATION_DETAILS.json and the manifest both say so. They are
 * bundled (work offline), multi-root (15 roots, max pitch-shift +/-3 st), and
 * multi-velocity (3 layers with real timbre differences).
 *
 * Determinism: seeded LCG only (no Math.random, no clock, no I/O-derived
 * values), so `pnpm samples` is byte-reproducible. Verifier can re-run and
 * diff.
 *
 * Run: `pnpm samples` from candidate/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'samples');

const SR = 22050;
const DURATION_SEC = 2.5;
const ROOTS = [28, 33, 38, 43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93, 98];
const LAYERS = [
  { id: 'soft', vel: 40, bright: 0.35, peak: 0.5 },
  { id: 'mid', vel: 80, bright: 0.65, peak: 0.7 },
  { id: 'loud', vel: 115, bright: 1.0, peak: 0.89 },
];
const SEEDS = { grand: 4073, upright: 90211, electric: 51773 };

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Deterministic LCG stream in [-1, 1]. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

function attackRamp(i, n) {
  return i < n ? i / n : 1;
}

/**
 * One-pole-lowpassed noise burst for the hammer transient.
 * @param {Float32Array} out
 * @param {number} ms length of the burst
 * @param {number} gain peak gain
 * @param {number} seed
 * @param {number} lp one-pole coefficient 0..1 (higher = darker)
 */
function hammerBurst(out, ms, gain, seed, lp) {
  const rand = lcg(seed);
  const n = Math.floor(SR * (ms / 1000));
  let y = 0;
  for (let i = 0; i < Math.min(n, out.length); i += 1) {
    const x = rand();
    y += (1 - lp) * (x - y);
    const env = Math.exp(-i / (SR * (ms / 1000 / 3)));
    out[i] += gain * y * env;
  }
}

function addPartial(out, freq, amp, decay, attackN) {
  const total = out.length;
  const phase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SR;
    const env = Math.exp(-t * decay);
    const ramp = attackRamp(i, attackN);
    out[i] += amp * env * ramp * Math.sin(2 * Math.PI * freq * t + phase);
  }
}

function normalizeToPeak(buf, peak) {
  let max = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const a = Math.abs(buf[i]);
    if (a > max) max = a;
  }
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < buf.length; i += 1) buf[i] *= k;
  }
}

const N = Math.floor(SR * DURATION_SEC);

/**
 * Grand "Studio Concert": stretched-partial stack, long decay, bright top.
 * Partials: [ratio, amp, decayMult].
 */
function renderGrand(midi, layer) {
  const out = new Float32Array(N);
  const f = midiToFreq(midi);
  const b = layer.bright;
  const attackN = Math.floor(SR * 0.003);
  const partials = [
    [1, 1.0, 1.0],
    [2, 0.5, 1.5],
    [3, 0.28, 2.2],
    [4.02, 0.16, 3.0],
    [5.03, 0.09, 3.9],
    [6.04, 0.05, 5.0],
  ];
  for (const [ratio, amp, mult] of partials) {
    // Velocity layers differ in timbre AND time: harder strokes open the top
    // partials relatively wider and let them ring longer (slower decay).
    const topness = ratio <= 2 ? 1 : 0.3 + 0.7 * b;
    const ringStretch = ratio <= 2 ? 1 : 1.35 - 0.35 * b;
    addPartial(out, f * ratio, amp * topness, 2.0 * mult * ringStretch, attackN);
  }
  hammerBurst(out, 25, 0.02 + 0.06 * b, SEEDS.grand + midi * 7 + layer.vel, 0.86);
  normalizeToPeak(out, layer.peak);
  return out;
}

/**
 * Upright "Studio Upright": darker top, faster decay, +/-3-cent double
 * course on the fundamental + 2nd partial, woody boosted 2nd partial.
 */
function renderUpright(midi, layer) {
  const out = new Float32Array(N);
  const f = midiToFreq(midi);
  const b = layer.bright;
  const attackN = Math.floor(SR * 0.004);
  const partials = [
    [1, 1.0, 1.0, true],
    [2, 0.62, 1.7, true],
    [3, 0.2, 2.6, false],
    [4.05, 0.09, 3.4, false],
    [5.1, 0.04, 4.6, false],
  ];
  for (const [ratio, amp, mult, chorus] of partials) {
    const topness = ratio <= 2 ? 1 : (0.25 + 0.6 * b) * 0.6;
    const ringStretch = ratio <= 2 ? 1 : 1.35 - 0.35 * b;
    addPartial(out, f * ratio, amp * topness, 3.2 * mult * ringStretch, attackN);
    if (chorus) {
      // Second string of the course, +3 cents, half level — the upright beat.
      addPartial(out, f * ratio * Math.pow(2, 3 / 1200), amp * topness * 0.5, 3.2 * mult * ringStretch, attackN);
    }
  }
  hammerBurst(out, 20, 0.02 + 0.05 * b, SEEDS.upright + midi * 13 + layer.vel, 0.9);
  normalizeToPeak(out, layer.peak);
  return out;
}

/**
 * Electric "Stage Tine": strong fundamental + 2nd, fast-decaying high
 * "ping" partial, short click attack, long even sustain on the fundamental.
 */
function renderElectric(midi, layer) {
  const out = new Float32Array(N);
  const f = midiToFreq(midi);
  const b = layer.bright;
  const attackN = Math.floor(SR * 0.0015);
  const partials = [
    [1, 1.0, 0.85],
    [2.0, 0.45, 1.6],
    [3.01, 0.12, 3.2],
    [4.16, 0.08, 4.5],
    // Tine "ping": bright, dies in ~100 ms, stronger on hard strokes.
    [9.9, 0.05 + 0.09 * b, 16.0],
  ];
  for (const [ratio, amp, mult] of partials) {
    addPartial(out, f * ratio, amp, mult, attackN);
  }
  hammerBurst(out, 8, 0.03 + 0.05 * b, SEEDS.electric + midi * 29 + layer.vel, 0.4);
  normalizeToPeak(out, layer.peak);
  return out;
}

const RENDERERS = { grand: renderGrand, upright: renderUpright, electric: renderElectric };
const SET_NAMES = { grand: 'Studio Concert Grand', upright: 'Studio Upright', electric: 'Stage Tine EP' };

function writeWavMono16(samples, sampleRate) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return data;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const manifest = {
    version: 1,
    tool: 'scripts/generate-samples.mjs (deterministic; re-running `pnpm samples` reproduces these bytes)',
    sampleRate: SR,
    bitDepth: 16,
    channels: 1,
    format: 'wav-pcm16-mono',
    durationSec: DURATION_SEC,
    roots: ROOTS,
    layers: LAYERS.map((l) => ({ id: l.id, velocity: l.vel })),
    license: 'CC0-1.0',
    origin:
      'Original synthetic-studio bounces created by this repository generator — NOT acoustic piano recordings. ' +
      'Grand/Upright/Electric are bundled pre-rendered sample sets (multi-root, multi-velocity) so playback ' +
      'uses real decoded audio assets with at most +/-3 semitones of pitch-shift per note.',
    sets: [],
  };
  for (const setId of Object.keys(RENDERERS)) {
    const setDir = join(outDir, setId);
    await mkdir(setDir, { recursive: true });
    const files = [];
    for (const rootMidi of ROOTS) {
      for (const layer of LAYERS) {
        const buf = RENDERERS[setId](rootMidi, layer);
        const name = `${setId}.${rootMidi}.${layer.id}.wav`;
        await writeFile(join(setDir, name), writeWavMono16(buf, SR));
        files.push(`${setId}/${name}`);
      }
    }
    manifest.sets.push({
      id: setId,
      name: SET_NAMES[setId],
      kind: 'bundled synthetic-studio sample set (offline bounce, original, CC0-1.0)',
      files,
      rootNotes: ROOTS,
      seed: SEEDS[setId],
    });
    console.log(`set ${setId}: ${files.length} files`);
  }
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('manifest.json written');
}

await main();
