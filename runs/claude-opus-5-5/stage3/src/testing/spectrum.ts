// Spectral measurements for rendered-audio tests (tests only): Goertzel magnitudes at chosen
// frequencies, harmonic profiles and a DFT spectral centroid. Deterministic and tolerant.

/** Magnitude of the component at `freq` (Hz) over the whole signal, normalised by length. */
export function goertzel(samples: Float32Array, freq: number, sampleRate: number, from = 0, to = samples.length): number {
  const w = (2 * Math.PI * freq) / sampleRate
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  const a = Math.max(0, from)
  const b = Math.min(samples.length, to)
  for (let i = a; i < b; i++) {
    // Hann window keeps leakage between neighbouring harmonics low.
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / Math.max(1, b - a - 1))
    const s0 = samples[i] * win + c * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2
  return Math.sqrt(Math.max(0, power)) / Math.max(1, b - a)
}

/** Relative magnitudes of harmonics (multiples of f0) listed in `ratios`, normalised to their max. */
export function harmonicProfile(samples: Float32Array, f0: number, sampleRate: number, ratios: number[], from = 0, to = samples.length): number[] {
  const m = ratios.map((r) => (f0 * r < sampleRate / 2 ? goertzel(samples, f0 * r, sampleRate, from, to) : 0))
  const max = Math.max(...m, 1e-12)
  return m.map((x) => x / max)
}

/** Spectral centroid (Hz) of a window, by a direct DFT over `bins` bins up to Nyquist. */
export function centroid(samples: Float32Array, sampleRate: number, from = 0, to = samples.length, bins = 256): number {
  let num = 0
  let den = 0
  for (let k = 1; k < bins; k++) {
    const f = (k / bins) * (sampleRate / 2)
    const m = goertzel(samples, f, sampleRate, from, to)
    num += f * m
    den += m
  }
  return den > 0 ? num / den : 0
}

/** Euclidean distance between two normalised profiles. */
export function profileDistance(a: number[], b: number[]): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += (a[i] - b[i]) ** 2
  return Math.sqrt(d)
}

/** Zero-crossing-based pitch estimate (Hz) for a simple periodic signal. */
export function zeroCrossingHz(samples: Float32Array, sampleRate: number, from = 0, to = samples.length): number {
  let crossings = 0
  for (let i = Math.max(1, from); i < Math.min(to, samples.length); i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++
  return (crossings * sampleRate) / Math.max(1, Math.min(to, samples.length) - from)
}

/** Instantaneous frequencies (Hz) from interpolated positive-going zero crossings. */
export function crossingFrequencies(samples: Float32Array, sampleRate: number, from = 0, to = samples.length): number[] {
  const times: number[] = []
  for (let i = Math.max(1, from); i < Math.min(to, samples.length); i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if (a <= 0 && b > 0) times.push(i - 1 + a / (a - b))
  }
  const out: number[] = []
  for (let i = 1; i < times.length; i++) out.push(sampleRate / (times[i] - times[i - 1]))
  return out
}

/** Standard deviation of the instantaneous frequency (vibrato depth measure). */
export function frequencyDeviation(samples: Float32Array, sampleRate: number, from = 0, to = samples.length): number {
  const f = crossingFrequencies(samples, sampleRate, from, to)
  if (f.length < 2) return 0
  const mean = f.reduce((a, b) => a + b, 0) / f.length
  return Math.sqrt(f.reduce((a, b) => a + (b - mean) ** 2, 0) / f.length)
}

/** Relative standard deviation of the short-time RMS envelope (tremolo/beating measure). */
export function envelopeVariation(samples: Float32Array, sampleRate: number, from = 0, to = samples.length, windowSeconds = 0.01): number {
  const w = Math.max(1, Math.round(windowSeconds * sampleRate))
  const env: number[] = []
  for (let i = from; i + w <= Math.min(to, samples.length); i += w) {
    let s = 0
    for (let j = i; j < i + w; j++) s += samples[j] * samples[j]
    env.push(Math.sqrt(s / w))
  }
  if (env.length < 2) return 0
  const mean = env.reduce((a, b) => a + b, 0) / env.length
  return Math.sqrt(env.reduce((a, b) => a + (b - mean) ** 2, 0) / env.length) / (mean || 1)
}
