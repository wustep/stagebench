/**
 * Deterministic, honest piano-like voice: additive synthesis of a struck string with
 * inharmonic partials, hammer-position comb filtering, velocity-dependent brightness, two-stage
 * decay and a short seeded-noise hammer thump. Output is a generated buffer; it is NOT a recording.
 */
export const PIANO_VOICE_NAME = 'Generated additive piano voice'
export const PIANO_VOICE_DESCRIPTION =
  'Additive synthesis (up to 28 inharmonic partials, hammer comb filter, velocity-dependent brightness, ' +
  'two-stage exponential decay, seeded noise thump) rendered into Float32 buffers at runtime. Generated, not recorded.'

export interface PianoRenderParams {
  midi: number
  /** MIDI velocity 1..127 */
  velocity: number
  sampleRate: number
  /** Cap on the rendered length in seconds. */
  maxSeconds?: number
}

export const VELOCITY_LAYERS = 3

export function velocityLayer(velocity: number): number {
  if (velocity < 48) return 0
  if (velocity < 96) return 1
  return 2
}

/** Loudness curve applied per note (in addition to the timbre change baked into the buffer). */
export function velocityGain(velocity: number): number {
  const v = Math.min(127, Math.max(1, velocity)) / 127
  return 0.12 + 0.88 * Math.pow(v, 1.4)
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Natural (undamped) decay length in seconds for a note: long in the bass, short in the treble. */
export function naturalDecaySeconds(midi: number): number {
  const t = Math.min(1, Math.max(0, (midi - 21) / 87))
  return 6.5 - 5.0 * t
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function renderPianoNote(params: PianoRenderParams): Float32Array {
  const { midi, sampleRate } = params
  const velocity = Math.min(127, Math.max(1, Math.round(params.velocity)))
  const vel = velocity / 127
  const f0 = midiToFrequency(midi)
  const natural = naturalDecaySeconds(midi)
  const seconds = Math.min(params.maxSeconds ?? natural, natural)
  const length = Math.max(1, Math.round(seconds * sampleRate))
  const out = new Float32Array(length)

  // Spectral shape
  const brightness = 0.45 + 0.55 * vel // hard strokes excite more upper partials
  const rolloff = 1.9 - 0.9 * brightness // exponent of 1/n^rolloff
  const hammerPos = 0.118 // strike point as a fraction of string length
  const inharmonicity = 0.00018 + 0.0009 * Math.pow(f0 / 2000, 1.6)
  const nyquist = sampleRate * 0.45
  const maxPartials = 28

  // Two-stage decay: prompt sound decays quickly, the aftersound rings
  const promptRate = 1.6 / natural + 1.2 // 1/s
  const ringRate = 4.0 / natural // 1/s

  const twoPi = Math.PI * 2
  let partials = 0
  for (let n = 1; n <= maxPartials; n++) {
    const fn = n * f0 * Math.sqrt(1 + inharmonicity * n * n)
    if (fn >= nyquist) break
    partials++
    const comb = Math.abs(Math.sin(Math.PI * n * hammerPos))
    const amp = (comb / Math.pow(n, rolloff)) * (n === 1 ? 1 : 0.9)
    const partialDamping = 1 + 0.035 * n * n * (0.4 + 0.6 * (fn / 4000)) // upper partials die faster
    const kPrompt = promptRate * partialDamping
    const kRing = ringRate * (1 + 0.08 * n)
    const promptWeight = 0.55
    // Recursive oscillator (phasor rotation) keeps this cheap and deterministic.
    const w = (twoPi * fn) / sampleRate
    const cosW = Math.cos(w)
    const sinW = Math.sin(w)
    let re = 1
    let im = 0
    const dtPrompt = Math.exp(-kPrompt / sampleRate)
    const dtRing = Math.exp(-kRing / sampleRate)
    let envPrompt = promptWeight
    let envRing = 1 - promptWeight
    for (let i = 0; i < length; i++) {
      out[i] += amp * im * (envPrompt + envRing)
      const nre = re * cosW - im * sinW
      im = re * sinW + im * cosW
      re = nre
      envPrompt *= dtPrompt
      envRing *= dtRing
    }
  }

  // Attack shaping: 2 ms ramp so the onset is a strike, not a click.
  const attackSamples = Math.max(1, Math.round(sampleRate * 0.002))
  for (let i = 0; i < attackSamples && i < length; i++) out[i] *= i / attackSamples

  // Hammer thump: short seeded noise burst, louder for hard strokes.
  const rand = seeded(midi * 7919 + velocity * 104729)
  const thumpSamples = Math.min(length, Math.round(sampleRate * 0.009))
  let lp = 0
  for (let i = 0; i < thumpSamples; i++) {
    lp += ((rand() * 2 - 1) - lp) * 0.25
    const env = 1 - i / thumpSamples
    out[i] += lp * env * env * 0.6 * vel
  }

  // Normalize peak, then apply the velocity loudness curve.
  let peak = 0
  for (let i = 0; i < length; i++) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  const target = 0.72 * velocityGain(velocity)
  const scale = peak > 0 ? target / peak : 0
  for (let i = 0; i < length; i++) out[i] *= scale
  if (partials === 0) out.fill(0)
  return out
}

export function rms(buffer: ArrayLike<number>, from = 0, to = buffer.length): number {
  let sum = 0
  const n = Math.max(0, to - from)
  for (let i = from; i < to; i++) sum += buffer[i] * buffer[i]
  return n ? Math.sqrt(sum / n) : 0
}
