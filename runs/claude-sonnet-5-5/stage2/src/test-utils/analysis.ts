/** Small signal-analysis helpers for the rendered-audio tests. Relationships, not exact waveforms. */

export const rms = (x: ArrayLike<number>, from = 0, to = x.length): number => {
  let sum = 0
  const end = Math.min(to, x.length)
  for (let i = Math.max(0, from); i < end; i++) sum += x[i] * x[i]
  return end > from ? Math.sqrt(sum / (end - from)) : 0
}

export const peak = (x: ArrayLike<number>): number => {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

/** RMS of the difference relative to the louder signal: 0 = identical, ~1.4 = unrelated */
export const difference = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  const n = Math.min(a.length, b.length)
  let d = 0
  for (let i = 0; i < n; i++) d += (a[i] - b[i]) * (a[i] - b[i])
  const scale = Math.max(rms(a, 0, n), rms(b, 0, n), 1e-9)
  return Math.sqrt(d / n) / scale
}

const isPow2 = (n: number) => (n & (n - 1)) === 0

/** in-place radix-2 FFT; returns magnitudes of the first n/2 bins */
export function spectrum(x: ArrayLike<number>, from: number, size = 8192): Float64Array {
  if (!isPow2(size)) throw new Error('size must be a power of two')
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < size; i++) re[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)))
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < size; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
  const mags = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) mags[i] = Math.hypot(re[i], im[i])
  return mags
}

/** energy (sum of squared magnitudes) between two frequencies */
export function bandEnergy(x: ArrayLike<number>, sampleRate: number, lo: number, hi: number, from = 0, size = 8192): number {
  const mags = spectrum(x, from, size)
  const hz = sampleRate / size
  let e = 0
  for (let i = Math.floor(lo / hz); i <= Math.min(mags.length - 1, Math.ceil(hi / hz)); i++) e += mags[i] * mags[i]
  return e
}

export function spectralCentroid(x: ArrayLike<number>, sampleRate: number, from = 0, size = 8192): number {
  const mags = spectrum(x, from, size)
  const hz = sampleRate / size
  let num = 0
  let den = 0
  for (let i = 1; i < mags.length; i++) {
    num += i * hz * mags[i] * mags[i]
    den += mags[i] * mags[i]
  }
  return den > 0 ? num / den : 0
}

/** dominant frequency by spectral peak with parabolic interpolation */
export function dominantHz(x: ArrayLike<number>, sampleRate: number, from = 0, size = 16384, lo = 40, hi = 2000): number {
  const mags = spectrum(x, from, size)
  const hz = sampleRate / size
  let best = Math.floor(lo / hz)
  for (let i = Math.floor(lo / hz); i <= Math.min(mags.length - 2, Math.ceil(hi / hz)); i++) if (mags[i] > mags[best]) best = i
  const a = mags[best - 1]
  const b = mags[best]
  const c = mags[best + 1]
  const shift = (0.5 * (a - c)) / (a - 2 * b + c || 1)
  return (best + shift) * hz
}

/** normalized correlation of two equal-length signals (−1..1) */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    ab += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return ab / Math.sqrt((aa || 1e-12) * (bb || 1e-12))
}

/** seconds during which a windowed RMS stays above `threshold` starting from `from` */
export function audibleSeconds(x: ArrayLike<number>, sampleRate: number, threshold: number, from = 0, window = 512): number {
  let last = from
  for (let i = from; i + window <= x.length; i += window) if (rms(x, i, i + window) > threshold) last = i + window
  return (last - from) / sampleRate
}

/** modulation depth of the short-time RMS envelope: (max − min) / (max + min) */
export function envelopeModulation(x: ArrayLike<number>, sampleRate: number, from: number, to: number, window = 1024): number {
  let lo = Infinity
  let hi = 0
  for (let i = from; i + window <= to; i += window) {
    const v = rms(x, i, i + window)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return (hi - lo) / (hi + lo || 1)
}

/** frequencies (Hz) of the strongest local spectral peaks, strongest first */
export function peakFrequencies(x: ArrayLike<number>, sampleRate: number, from: number, count = 3, size = 16384, lo = 40, hi = 4000): number[] {
  const mags = spectrum(x, from, size)
  const hz = sampleRate / size
  const peaks: Array<{ f: number; m: number }> = []
  for (let i = Math.max(2, Math.floor(lo / hz)); i < Math.min(mags.length - 2, Math.ceil(hi / hz)); i++) {
    if (mags[i] > mags[i - 1] && mags[i] >= mags[i + 1] && mags[i] > mags[i - 2] && mags[i] >= mags[i + 2]) {
      const a = mags[i - 1]
      const b = mags[i]
      const c = mags[i + 1]
      peaks.push({ f: (i + (0.5 * (a - c)) / (a - 2 * b + c || 1)) * hz, m: b })
    }
  }
  return peaks.sort((p, q) => q.m - p.m).slice(0, count).map((p) => p.f)
}

/**
 * True when the strongest spectral peaks sit on integer multiples of `f0` (allowing slight piano inharmonicity).
 * A sample pitched a semitone away from the intended note fails this.
 */
export function isHarmonicSeries(x: ArrayLike<number>, sampleRate: number, from: number, f0: number, tolerance = 0.015): boolean {
  return peakFrequencies(x, sampleRate, from, 3, 16384, f0 * 0.8, Math.min(4500, f0 * 8)).every((f) => {
    const k = Math.max(1, Math.round(f / f0))
    return Math.abs(f / (k * f0) - 1) < tolerance * (1 + k * 0.15)
  })
}

/**
 * Harmonic-comb energy at f0 beats the combs one semitone above and below: a recording pitched a semitone away from
 * the requested note would fail. Works for notes whose fundamental is weak (low upright strings) because it sums the
 * first eight partials.
 */
export function fundamentalAt(x: ArrayLike<number>, sampleRate: number, from: number, f0: number, size = 32768): boolean {
  const comb = (f: number) => {
    let e = 0
    for (let k = 1; k <= 8 && k * f < 5000; k++) e += bandEnergy(x, sampleRate, k * f * 0.985, k * f * 1.015, from, size)
    return e
  }
  const semitone = Math.pow(2, 1 / 12)
  return comb(f0) > 1.5 * Math.max(comb(f0 * semitone), comb(f0 / semitone))
}

/** (max − min)/(max + min) of the per-window level ratio x/ref: modulation with the natural decay divided out */
export function relativeModulation(x: ArrayLike<number>, ref: ArrayLike<number>, from: number, to: number, window = 2048): number {
  let lo = Infinity
  let hi = 0
  for (let i = from; i + window <= to; i += window) {
    const r = rms(x, i, i + window) / (rms(ref, i, i + window) + 1e-9)
    lo = Math.min(lo, r)
    hi = Math.max(hi, r)
  }
  return (hi - lo) / (hi + lo || 1)
}

/** largest swing (dB) of the left/right level difference across windows: how far the image moves */
export function panSwingDb(left: ArrayLike<number>, right: ArrayLike<number>, from: number, to: number, window = 2048): number {
  let lo = Infinity
  let hi = -Infinity
  for (let i = from; i + window <= to; i += window) {
    const d = 20 * Math.log10((rms(left, i, i + window) + 1e-9) / (rms(right, i, i + window) + 1e-9))
    lo = Math.min(lo, d)
    hi = Math.max(hi, d)
  }
  return hi - lo
}

/** mean |log ratio| between a short-window and a long-window level: how much fast texture the envelope has */
export function roughness(x: ArrayLike<number>, from: number, to: number, short = 256, long = 4096): number {
  let sum = 0
  let n = 0
  for (let i = from; i + long <= to; i += short) {
    const mid = i + long / 2
    const s = rms(x, mid - short / 2, mid + short / 2) + 1e-9
    const l = rms(x, i, i + long) + 1e-9
    sum += Math.abs(Math.log(s / l))
    n++
  }
  return sum / n
}

/** strongest normalized autocorrelation of the (smoothed, rectified) envelope for lags between `minLag` and `maxLag` seconds */
export function envelopePeriodicity(x: ArrayLike<number>, sampleRate: number, from: number, to: number, minLag: number, maxLag: number): number {
  const hop = Math.floor(sampleRate * 0.001)
  const env: number[] = []
  for (let i = from; i + hop <= to; i += hop) env.push(rms(x, i, i + hop))
  // divide out the slow decay: subtract a 120 ms moving average so only the fast periodic texture is left
  const half = 60
  const c = env.map((v, i) => {
    let sum = 0
    let n = 0
    for (let k = Math.max(0, i - half); k <= Math.min(env.length - 1, i + half); k++) {
      sum += env[k]
      n++
    }
    return v - sum / n
  })
  const energy = c.reduce((a, b) => a + b * b, 0) || 1e-12
  let best = -1
  for (let lag = Math.floor(minLag * 1000); lag <= Math.ceil(maxLag * 1000); lag++) {
    let acc = 0
    for (let i = 0; i + lag < c.length; i++) acc += c[i] * c[i + lag]
    best = Math.max(best, acc / energy)
  }
  return best
}
