/**
 * The Phase 1 piano voice.
 *
 * This is a *modelled* (synthesised) piano: a deterministic additive partial bank with
 * per-partial inharmonicity and decay, a hammer transient, and a release curve. No
 * recorded samples are used anywhere in this project — `IMPLEMENTATION_DETAILS.json`
 * declares the strategy as synthesis and lists no sample sources.
 *
 * The same functions run in three places so the tested signal and the audible signal
 * cannot drift apart:
 *
 *  1. the Web Audio backend, which fills an `AudioBuffer` with `renderPianoBody`;
 *  2. the release ramp, built from `releasePoints`;
 *  3. the offline renderer used by tests, which applies `applyRelease` to the body and
 *     the fixed master gain, i.e. exactly what the graph does.
 */

/** Fixed instrument output stage. Every voice passes through it; nothing bypasses it. */
export const MASTER_GAIN = 0.72

/** Longest body a single note can ring for, in seconds. */
export const MAX_BODY_SECONDS = 3

/** Velocity is expressed as 0..1 everywhere below. */
export function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Deterministic PRNG so the hammer transient is identical across renders and platforms. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export interface PartialSpec {
  /** Harmonic number, 1-based. */
  n: number
  /** Actual frequency in Hz after inharmonicity. */
  frequency: number
  /** Linear amplitude at attack. */
  amplitude: number
  /** Seconds for the partial to fall to 1/e of its attack amplitude. */
  decay: number
}

/**
 * The partial bank for one note. Velocity changes brightness (how fast the upper
 * partials fall away) and overall level, which is what makes velocity audible rather
 * than merely louder.
 */
export function partialsFor(midi: number, velocity: number): PartialSpec[] {
  const vel = clampVelocity(velocity)
  const f0 = midiToFrequency(midi)
  // Low strings are longer and more flexible, so their partials are closer to harmonic.
  const inharmonicity = 0.00022 + 0.00085 * ((midi - 28) / 72)
  const baseDecay = Math.min(5.2, Math.max(0.55, 3.4 * Math.pow(110 / f0, 0.55)))
  // A soft stroke keeps only the lower partials; a hard stroke keeps the upper ones.
  // `damping` is a per-partial low-pass: 0.95 per step when soft, 0.10 when hard.
  const damping = 1.05 - 0.98 * vel
  const limit = Math.floor(8000 / f0)
  const count = Math.max(3, Math.min(24, limit))
  const out: PartialSpec[] = []
  for (let n = 1; n <= count; n += 1) {
    const frequency = n * f0 * Math.sqrt(1 + inharmonicity * n * n)
    if (frequency > 20000) break
    const tilt = 1 / Math.pow(n, 0.95)
    const rolloff = Math.exp(-(n - 1) * damping)
    out.push({
      n,
      frequency,
      amplitude: tilt * rolloff,
      decay: baseDecay / (1 + 0.42 * (n - 1)),
    })
  }
  const norm = out.reduce((sum, p) => sum + p.amplitude, 0) || 1
  return out.map((p) => ({ ...p, amplitude: p.amplitude / norm }))
}

export interface RenderBodyOptions {
  midi: number
  velocity: number
  sampleRate: number
  seconds?: number
  seed?: number
}

/**
 * Renders the sounding body of one note (attack plus free decay). Velocity is baked into
 * both level and spectrum, so two different velocities produce different samples rather
 * than the same samples at different gains.
 */
export function renderPianoBody(options: RenderBodyOptions): Float32Array {
  const { midi, sampleRate } = options
  const velocity = clampVelocity(options.velocity)
  const seconds = options.seconds ?? MAX_BODY_SECONDS
  const seed = options.seed ?? (midi * 7919 + Math.round(velocity * 127))
  const frames = Math.max(1, Math.round(seconds * sampleRate))
  const out = new Float32Array(frames)

  const partials = partialsFor(midi, velocity)
  const nyquist = sampleRate * 0.45
  const attackSeconds = 0.0022 + 0.011 * (1 - velocity)
  const attackCoef = Math.exp(-1 / (attackSeconds * sampleRate))
  // Hammer knock: a very short deterministic noise burst, brighter at higher velocity.
  const noiseSeconds = 0.014
  const noiseFrames = Math.min(frames, Math.round(noiseSeconds * sampleRate))
  const noiseAmp = 0.05 + 0.12 * velocity
  const rand = lcg(seed)
  const noise = new Float32Array(noiseFrames)
  let smoothed = 0
  const noiseCoef = 0.32 + 0.5 * velocity
  for (let i = 0; i < noiseFrames; i += 1) {
    const white = rand() * 2 - 1
    smoothed = smoothed * (1 - noiseCoef) + white * noiseCoef
    const env = Math.pow(1 - i / noiseFrames, 2)
    noise[i] = smoothed * env
  }

  // Recursive complex oscillators, one per partial.
  const active = partials.filter((p) => p.frequency < nyquist)
  const cosW = active.map((p) => Math.cos((2 * Math.PI * p.frequency) / sampleRate))
  const sinW = active.map((p) => Math.sin((2 * Math.PI * p.frequency) / sampleRate))
  const cosP = new Float64Array(active.length)
  const sinP = new Float64Array(active.length)
  const amp = new Float64Array(active.length)
  const ampDecay = new Float64Array(active.length)
  for (let k = 0; k < active.length; k += 1) {
    // Slight phase offset per partial keeps the attack from summing into one click.
    const phase = (k * 0.6180339887) % 1
    cosP[k] = Math.cos(2 * Math.PI * phase)
    sinP[k] = Math.sin(2 * Math.PI * phase)
    amp[k] = active[k].amplitude
    ampDecay[k] = Math.exp(-1 / (active[k].decay * sampleRate))
  }

  let attack = 1
  // Velocity maps to level with no offset at zero: a velocity-0 strike is silence, and
  // the curve is continuous so a very soft strike is still quiet rather than jumping.
  const level = 0.84 * Math.pow(velocity, 1.25)
  // A second, faster decay term gives the note its initial "bloom".
  const bloomCoef = Math.exp(-1 / (0.38 * sampleRate))
  let bloom = 1

  for (let i = 0; i < frames; i += 1) {
    attack = 1 - (1 - attack) * attackCoef
    bloom = bloom * bloomCoef
    let sample = 0
    for (let k = 0; k < active.length; k += 1) {
      sample += amp[k] * cosP[k]
      const nextCos = cosP[k] * cosW[k] - sinP[k] * sinW[k]
      const nextSin = cosP[k] * sinW[k] + sinP[k] * cosW[k]
      cosP[k] = nextCos
      sinP[k] = nextSin
      amp[k] *= ampDecay[k]
    }
    const body = 0.72 + 0.28 * bloom
    out[i] = sample * attack * body * level
    if (i < noiseFrames) out[i] += noise[i] * noiseAmp * attack
  }

  // Keep headroom; the master stage is the only later gain.
  let peak = 0
  for (let i = 0; i < frames; i += 1) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0.95) {
    const scale = 0.95 / peak
    for (let i = 0; i < frames; i += 1) out[i] *= scale
  }
  return out
}

/** Release length in seconds for a note: low strings damp more slowly than high ones. */
export function releaseSecondsFor(midi: number): number {
  const t = Math.min(1, Math.max(0, (midi - 28) / 72))
  return 0.46 - 0.28 * t
}

/**
 * The release envelope, sampled. `points` is 1 → 0 over `releaseSeconds`, with a
 * slightly convex shape (dampers close quickly, then settle).
 */
export function releasePoints(releaseSeconds: number, sampleRate: number): Float32Array {
  const frames = Math.max(2, Math.round(releaseSeconds * sampleRate))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    const x = i / (frames - 1)
    out[i] = Math.pow(1 - x, 1.7)
  }
  out[frames - 1] = 0
  return out
}

/**
 * Applies a release to a rendered body, returning the audible signal. This is the
 * offline counterpart of the gain ramp the graph schedules at note-off.
 */
export function applyRelease(
  body: Float32Array,
  releaseAtFrame: number,
  release: Float32Array,
  tailFrames = release.length,
): Float32Array {
  const hold = Math.max(0, Math.min(body.length, Math.round(releaseAtFrame)))
  const total = hold + Math.max(0, Math.round(tailFrames))
  const out = new Float32Array(total)
  out.set(body.subarray(0, Math.min(hold, body.length)), 0)
  for (let i = 0; i < total - hold; i += 1) {
    const source = hold + i
    if (source >= body.length) break
    const g = i < release.length ? release[i] : 0
    out[hold + i] = body[source] * g
  }
  return out
}

/** RMS level, the measure the audio tests use for "is anything coming out". */
export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  const start = Math.max(0, Math.min(samples.length, from))
  const end = Math.max(start, Math.min(samples.length, to))
  if (end === start) return 0
  let sum = 0
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (end - start))
}

export interface RenderVoiceOptions {
  midi: number
  velocity: number
  sampleRate: number
  /** Seconds the key is held. */
  holdSeconds: number
  /** Seconds the sustain pedal is held *after* key release (0 = pedal up on release). */
  sustainTailSeconds?: number
  /** Length of the release ramp. Defaults to the note's physical release. */
  releaseSeconds?: number
  /** Body length to render. Defaults to MAX_BODY_SECONDS. */
  bodySeconds?: number
}

/**
 * A complete note as it reaches the instrument output: body, release and the fixed
 * master gain. Used by tests to make audible claims about the real model.
 */
export function renderVoiceThroughMaster(options: RenderVoiceOptions): Float32Array {
  const { midi, velocity, sampleRate, holdSeconds } = options
  const body = renderPianoBody({
    midi,
    velocity,
    sampleRate,
    seconds: options.bodySeconds ?? MAX_BODY_SECONDS,
  })
  const releaseSeconds = options.releaseSeconds ?? releaseSecondsFor(midi)
  const release = releasePoints(releaseSeconds, sampleRate)
  const releaseAtFrame = Math.round((holdSeconds + (options.sustainTailSeconds ?? 0)) * sampleRate)
  const rendered = applyRelease(body, releaseAtFrame, release)
  const out = new Float32Array(rendered.length)
  for (let i = 0; i < rendered.length; i += 1) out[i] = rendered[i] * MASTER_GAIN
  return out
}
