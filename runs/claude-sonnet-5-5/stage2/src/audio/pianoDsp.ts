/**
 * Deterministic, dependency-free piano-like additive synthesis.
 *
 * Every buffer this module produces is GENERATED (inharmonic partials with per-partial decay, two-string
 * detune beating and a filtered hammer-noise burst). They are NOT recordings of an instrument.
 */

export const RENDER_SAMPLE_RATE = 32000
export const MIN_NOTE = 21
export const MAX_NOTE = 108

/** velocity layers rendered as separate buffers (brighter for harder strikes) */
export const VELOCITY_LAYERS = [24, 56, 88, 116] as const

export const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12)

export const clampVelocity = (velocity: number): number => Math.min(127, Math.max(1, Math.round(velocity)))

export const velocityLayer = (velocity: number): number => {
  const v = clampVelocity(velocity)
  return v <= 32 ? 0 : v <= 64 ? 1 : v <= 96 ? 2 : 3
}

/** loudness curve: monotonic, ~30 dB between velocity 1 and 127 */
export const velocityGain = (velocity: number): number => {
  const v = clampVelocity(velocity) / 127
  return 0.03 + 0.97 * Math.pow(v, 1.6)
}

/** main amplitude decay constant of the fundamental, seconds */
export const decayTau = (note: number): number => 0.35 + 4.5 * Math.exp(-(note - 21) / 40)

/** damper release time, seconds */
export const releaseSeconds = (note: number): number => 0.16 + 0.5 * Math.exp(-(note - 21) / 30)

export const bufferSeconds = (note: number): number => Math.min(5, Math.max(1.4, decayTau(note) * 2.2))

/** small deterministic PRNG (mulberry32) */
const prng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function renderPianoNote(note: number, velocity: number, sampleRate = RENDER_SAMPLE_RATE): Float32Array {
  const layerVelocity = VELOCITY_LAYERS[velocityLayer(velocity)]
  const bright = 0.12 + 0.88 * Math.pow(layerVelocity / 127, 1.15)
  const f0 = midiToHz(note)
  const tau0 = decayTau(note)
  const seconds = bufferSeconds(note)
  const length = Math.floor(seconds * sampleRate)
  const out = new Float32Array(length)
  const inharmonicity = 0.00012 * Math.pow(2, (note - 21) / 13)
  const maxPartials = Math.min(18, Math.floor((0.45 * sampleRate) / f0))

  for (let k = 1; k <= maxPartials; k++) {
    const fk = k * f0 * Math.sqrt(1 + inharmonicity * k * k)
    if (fk > 0.45 * sampleRate) break
    // spectral shape: 1/k roll-off tilted by strike hardness, hammer-position comb
    const comb = Math.abs(Math.sin(Math.PI * k * 0.118)) + 0.12
    const amp = (Math.pow(k, -0.85) * Math.exp(-(k - 1) * (1 - bright) * 0.32) * comb) / (1 + 0.02 * k)
    const tau = tau0 / (1 + 0.5 * Math.pow(k - 1, 0.9))
    // two strings per note for the lower partials: slightly detuned, beating
    const strings = k <= 6 ? 2 : 1
    for (let s = 0; s < strings; s++) {
      const detune = strings === 2 ? (s === 0 ? -1 : 1) * (0.00035 + 0.00005 * k) : 0
      const freq = fk * (1 + detune)
      const theta = (2 * Math.PI * freq) / sampleRate
      const r = Math.exp(-1 / (tau * (s === 1 ? 1.25 : 1) * sampleRate))
      const a = r * Math.cos(theta)
      const b = r * Math.sin(theta)
      // z0 = amplitude on the real axis: the audible imaginary part starts at the sine zero-crossing
      let re = (amp / strings) * (s === 0 ? 1 : 0.9)
      let im = 0
      for (let n = 0; n < length; n++) {
        // z <- z * r * e^{i theta}; the audible signal is the imaginary part
        const nr = re * a - im * b
        const ni = re * b + im * a
        re = nr
        im = ni
        out[n] += im
      }
    }
  }

  // hammer thud: short band-limited noise burst
  const rand = prng(note * 7919 + layerVelocity)
  const thudLength = Math.min(length, Math.floor(0.014 * sampleRate))
  let lp = 0
  const lpCoef = 0.25 + 0.5 * bright
  for (let n = 0; n < thudLength; n++) {
    lp += lpCoef * (rand() * 2 - 1 - lp)
    const env = Math.pow(1 - n / thudLength, 2)
    out[n] += lp * env * 0.35 * bright
  }

  // 1 ms onset ramp, tail fade over the last 30 %, then peak-normalize
  const onset = Math.max(1, Math.floor(0.001 * sampleRate))
  for (let n = 0; n < onset; n++) out[n] *= n / onset
  const fadeStart = Math.floor(length * 0.7)
  for (let n = fadeStart; n < length; n++) out[n] *= 0.5 * (1 + Math.cos((Math.PI * (n - fadeStart)) / (length - fadeStart)))
  let peak = 0
  for (let n = 0; n < length; n++) peak = Math.max(peak, Math.abs(out[n]))
  if (peak > 0) for (let n = 0; n < length; n++) out[n] /= peak
  return out
}

export const rms = (samples: ArrayLike<number>, from = 0, to = samples.length): number => {
  let sum = 0
  const end = Math.min(to, samples.length)
  for (let i = from; i < end; i++) sum += samples[i] * samples[i]
  return end > from ? Math.sqrt(sum / (end - from)) : 0
}
