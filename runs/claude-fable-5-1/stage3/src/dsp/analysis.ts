/**
 * Measurement helpers for rendered-audio tests: level, steps, audible length, stereo correlation and FFT-based
 * band energy / spectral centroid. Pure functions over Float32Arrays.
 */

export function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  const a = Math.max(0, from)
  const b = Math.min(x.length, to)
  if (b <= a) return 0
  let sum = 0
  for (let i = a; i < b; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / (b - a))
}

export function peak(x: ArrayLike<number>): number {
  let p = 0
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i])
    if (a > p) p = a
  }
  return p
}

/** Largest sample-to-sample jump (click detector). */
export function maxStep(x: ArrayLike<number>): number {
  let m = 0
  for (let i = 1; i < x.length; i++) {
    const d = Math.abs(x[i] - x[i - 1])
    if (d > m) m = d
  }
  return m
}

/** Length (seconds) up to the last sample above `threshold`. */
export function audibleSeconds(x: ArrayLike<number>, sr: number, threshold = 0.002): number {
  let last = -1
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > threshold) last = i
  return last < 0 ? 0 : (last + 1) / sr
}

/** Pearson correlation between two channels (1 = identical shape, 0 = unrelated). */
export function stereoCorrelation(l: ArrayLike<number>, r: ArrayLike<number>): number {
  const n = Math.min(l.length, r.length)
  if (n === 0) return 1
  let ml = 0
  let mr = 0
  for (let i = 0; i < n; i++) {
    ml += l[i]
    mr += r[i]
  }
  ml /= n
  mr /= n
  let num = 0
  let dl = 0
  let dr = 0
  for (let i = 0; i < n; i++) {
    const a = l[i] - ml
    const b = r[i] - mr
    num += a * b
    dl += a * a
    dr += b * b
  }
  const den = Math.sqrt(dl * dr)
  return den > 0 ? num / den : 1
}

/** mean |a − b| / mean |a| (0 = identical). */
export function normalizedDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let diff = 0
  let ref = 0
  for (let i = 0; i < n; i++) {
    diff += Math.abs(a[i] - b[i])
    ref += Math.abs(a[i])
  }
  return ref > 0 ? diff / ref : diff > 0 ? Infinity : 0
}

export function maxAbsDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.max(a.length, b.length)
  let m = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    if (d > m) m = d
  }
  return m
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let j = 0; j < half; j++) {
        const a = i + j
        const b = a + half
        const vr = re[b] * cr - im[b] * ci
        const vi = re[b] * ci + im[b] * cr
        re[b] = re[a] - vr
        im[b] = im[a] - vi
        re[a] += vr
        im[a] += vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

export interface Spectrum {
  /** Magnitude of bins 0..N/2 (N = padded FFT length). */
  mags: Float64Array
  /** Hz per bin. */
  binHz: number
}

/** Magnitude spectrum of the whole buffer (zero-padded radix-2 FFT, Hann window). */
export function magnitudeSpectrum(x: ArrayLike<number>, sr: number): Spectrum {
  let n = 2048
  while (n < x.length) n <<= 1
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const len = x.length
  for (let i = 0; i < len; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, len - 1)))
  fft(re, im)
  const half = n >> 1
  const mags = new Float64Array(half + 1)
  for (let i = 0; i <= half; i++) mags[i] = Math.hypot(re[i], im[i])
  return { mags, binHz: sr / n }
}

/** Energy (sum of squared magnitudes) between f0 and f1 Hz. */
export function bandEnergy(x: ArrayLike<number>, sr: number, f0: number, f1: number, spectrum?: Spectrum): number {
  const s = spectrum ?? magnitudeSpectrum(x, sr)
  const lo = Math.max(0, Math.floor(f0 / s.binHz))
  const hi = Math.min(s.mags.length - 1, Math.ceil(f1 / s.binHz))
  let e = 0
  for (let i = lo; i <= hi; i++) e += s.mags[i] * s.mags[i]
  return e
}

/** Power-weighted mean frequency in Hz (0 for silence). */
export function spectralCentroid(x: ArrayLike<number>, sr: number, spectrum?: Spectrum): number {
  const s = spectrum ?? magnitudeSpectrum(x, sr)
  let num = 0
  let den = 0
  for (let i = 1; i < s.mags.length; i++) {
    const p = s.mags[i] * s.mags[i]
    num += p * i * s.binHz
    den += p
  }
  return den > 0 ? num / den : 0
}

/** Fraction of the total energy that lies between f0 and f1 Hz. */
export function bandFraction(x: ArrayLike<number>, sr: number, f0: number, f1: number): number {
  const s = magnitudeSpectrum(x, sr)
  const total = bandEnergy(x, sr, 0, sr / 2, s)
  return total > 0 ? bandEnergy(x, sr, f0, f1, s) / total : 0
}
