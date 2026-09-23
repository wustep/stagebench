// Honest synthesis of a basic piano tone. Nothing here is a recording: each root note is
// generated at load time by additive synthesis of inharmonic string partials (stiff-string
// stretch), a two-stage (prompt + aftersound) decay per partial, two slightly detuned strings
// above the bass, and a short deterministic hammer-noise transient.

export const TONE_SAMPLE_RATE = 32000
/** Root notes every 3 semitones E1…E7, so playback never shifts a root by more than ±1 semitone. */
export const ROOT_STEP = 3

export function rootNotes(low: number, high: number): number[] {
  const roots: number[] = []
  for (let n = low; n <= high; n += ROOT_STEP) roots.push(n)
  if (roots[roots.length - 1] !== high) roots.push(high)
  return roots
}

export function nearestRoot(roots: readonly number[], note: number): number {
  let best = roots[0]
  for (const r of roots) if (Math.abs(r - note) < Math.abs(best - note)) best = r
  return best
}

export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

export function toneDurationSeconds(note: number): number {
  return Math.min(6.5, Math.max(1.6, 6.5 - (note - 28) * 0.07))
}

export interface ToneOptions {
  sampleRate?: number
  /** Scale the rendered length (tests use short tones). */
  durationScale?: number
}

/** Deterministic PRNG (mulberry32) so every build renders identical buffers. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function renderPianoTone(note: number, options: ToneOptions = {}): Float32Array {
  const sr = options.sampleRate ?? TONE_SAMPLE_RATE
  const duration = toneDurationSeconds(note) * (options.durationScale ?? 1)
  const length = Math.max(1, Math.round(duration * sr))
  const out = new Float64Array(length)
  const f0 = midiToHz(note)
  const nyquistLimit = Math.min(sr * 0.45, 10000)
  // Stiff-string inharmonicity grows toward the treble.
  const B = 0.0001 * Math.pow(2, (note - 40) / 10)
  // Decay constants shorten with pitch.
  const pitchNorm = (note - 28) / 72
  const t1 = 1.4 - 1.05 * pitchNorm // prompt sound
  const t2 = 7.0 - 5.6 * pitchNorm // aftersound
  const strings = note < 40 ? 1 : 2
  const detuneCents = [0, 0.9]
  const maxPartials = 28
  const rand = prng(note * 7919)
  // Unison strings are struck by the same hammer, so each partial starts in phase on every string.
  const phases = Array.from({ length: maxPartials + 1 }, () => rand() * 2 * Math.PI)

  for (let s = 0; s < strings; s++) {
    const detune = Math.pow(2, detuneCents[s] / 1200)
    for (let n = 1; n <= maxPartials; n++) {
      const fn = n * f0 * detune * Math.sqrt(1 + B * n * n)
      if (fn >= nyquistLimit) break
      // Hammer strike near 1/8 of the string length shapes the spectrum; the soundboard
      // response rolls the upper partials off so the fundamental carries the pitch.
      const strike = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * n * 0.121))
      const amp = strike / Math.pow(n, 1.8) / strings
      const tau1 = t1 / (1 + 0.28 * (n - 1))
      const tau2 = t2 / (1 + 0.16 * (n - 1))
      const d1 = Math.exp(-1 / (tau1 * sr))
      const d2 = Math.exp(-1 / (tau2 * sr))
      let e1 = 0.72 * amp
      let e2 = 0.28 * amp
      // Recursive sine oscillator: y[k] = 2cos(w) y[k-1] - y[k-2]
      const w = (2 * Math.PI * fn) / sr
      const phase = phases[n]
      const c = 2 * Math.cos(w)
      let y1 = Math.sin(phase - w)
      let y2 = Math.sin(phase - 2 * w)
      for (let k = 0; k < length; k++) {
        const y = c * y1 - y2
        y2 = y1
        y1 = y
        out[k] += y * (e1 + e2)
        e1 *= d1
        e2 *= d2
        if (e1 + e2 < 1e-6) break
      }
    }
  }

  // Hammer thump: short low-passed noise burst.
  const noiseLen = Math.min(length, Math.round(0.012 * sr))
  const lp = Math.exp((-2 * Math.PI * Math.min(4000, f0 * 6)) / sr)
  let z = 0
  for (let k = 0; k < noiseLen; k++) {
    const env = Math.exp(-k / (0.0035 * sr))
    z = (1 - lp) * (rand() * 2 - 1) + lp * z
    out[k] += z * env * 0.35
  }

  // 2 ms attack ramp and a 60 ms tail fade so buffers never click.
  const attack = Math.round(0.002 * sr)
  for (let k = 0; k < Math.min(attack, length); k++) out[k] *= k / attack
  const fade = Math.min(length, Math.round(0.06 * sr))
  for (let k = 0; k < fade; k++) out[length - 1 - k] *= k / fade

  let peak = 0
  for (let k = 0; k < length; k++) peak = Math.max(peak, Math.abs(out[k]))
  const gain = peak > 0 ? 0.8 / peak : 0
  const result = new Float32Array(length)
  for (let k = 0; k < length; k++) result[k] = out[k] * gain
  return result
}

/** Velocity → linear gain. Soft notes stay audible; the curve is monotonic. */
export function velocityGain(velocity: number): number {
  const v = Math.min(127, Math.max(1, velocity)) / 127
  return 0.04 + 0.96 * Math.pow(v, 1.7)
}

/** Velocity → low-pass cutoff: harder strikes are brighter, like a real hammer. */
export function velocityCutoff(velocity: number, note: number): number {
  const v = Math.min(127, Math.max(1, velocity)) / 127
  return Math.min(16000, 380 + 11500 * v * v + 2 * midiToHz(note))
}
