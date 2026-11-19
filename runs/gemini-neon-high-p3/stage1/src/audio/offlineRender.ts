import { midiToFrequency } from './pianoVoice'

export interface ScheduledPcmNote {
  readonly midi: number
  readonly velocity: number
  readonly startSec: number
  readonly releaseSec: number
  readonly sustainHeldUntilSec?: number
}

export interface PcmRenderMetrics {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly peak: number
  readonly rms: number
  readonly clippedSamples: number
}

/**
 * Deterministic PCM renderer for the Phase 1 piano voice model (velocity scaling,
 * harmonic overtones, damper release vs sustain tail, master gain + soft-knee limiter).
 * Enables automated audible-signal verification in headless test environments.
 */
export function renderPianoSequencePcm(
  notes: readonly ScheduledPcmNote[],
  durationSec: number,
  sampleRate = 22050,
): PcmRenderMetrics {
  const length = Math.max(1, Math.floor(durationSec * sampleRate))
  const buffer = new Float32Array(length)
  const masterGain = 0.56

  for (const note of notes) {
    const freq = midiToFrequency(note.midi)
    const velNorm = Math.max(1, Math.min(127, note.velocity)) / 127
    const peakGain = 0.06 + 0.54 * Math.pow(velNorm, 1.55)
    const decayTime = Math.max(1.2, 4.2 - ((note.midi - 28) / 72) * 2.6)
    const effectiveReleaseSec = Math.max(note.releaseSec, note.sustainHeldUntilSec ?? note.releaseSec)
    const releaseDuration = note.midi >= 90 ? 0.48 : 0.24

    const startIdx = Math.max(0, Math.floor(note.startSec * sampleRate))
    const endIdx = Math.min(
      length,
      Math.ceil((effectiveReleaseSec + releaseDuration + 0.02) * sampleRate),
    )

    for (let i = startIdx; i < endIdx; i++) {
      const t = i / sampleRate
      const localT = t - note.startSec
      if (localT < 0) continue

      // 4 ms anti-click attack
      const attackEnv = localT < 0.004 ? localT / 0.004 : 1
      // Exponential natural piano decay
      const decayEnv = Math.exp((-localT * 6.5) / decayTime)
      // Damper release envelope after key/pedal release
      let relEnv = 1
      if (t > effectiveReleaseSec) {
        const relT = t - effectiveReleaseSec
        if (relT >= releaseDuration) {
          relEnv = 0
        } else {
          relEnv = Math.exp((-relT * 4.5) / releaseDuration) * (1 - relT / releaseDuration)
        }
      }

      const env = peakGain * attackEnv * decayEnv * relEnv
      if (env <= 1e-6) continue

      // Harmonic piano timbre with velocity-dependent upper partial energy
      const p1 = Math.sin(2 * Math.PI * freq * localT)
      const p2 = Math.sin(2 * Math.PI * freq * 2.0008 * localT) * (0.28 * (0.5 + 0.5 * velNorm))
      const p3 = Math.sin(2 * Math.PI * freq * 3.0018 * localT) * (0.14 * velNorm) * Math.exp(-localT * 3.5)
      buffer[i] += (p1 * 0.68 + p2 + p3) * env * masterGain
    }
  }

  // Master soft-knee limiter matching WebAudioPianoEngine master bus
  let peak = 0
  let sumSq = 0
  let clippedSamples = 0
  const threshold = 0.56 // ~ -5 dBFS
  for (let i = 0; i < length; i++) {
    let x = buffer[i]
    const ax = Math.abs(x)
    if (ax > threshold) {
      const excess = ax - threshold
      const limited = threshold + (0.94 - threshold) * Math.tanh(excess / (0.94 - threshold))
      x = Math.sign(x) * limited
      buffer[i] = x
    }
    const outAbs = Math.abs(x)
    if (outAbs > peak) peak = outAbs
    if (outAbs > 0.999) clippedSamples++
    sumSq += x * x
  }

  return {
    samples: buffer,
    sampleRate,
    peak,
    rms: Math.sqrt(sumSq / length),
    clippedSamples,
  }
}

export function measureWindowRms(
  samples: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number,
): number {
  const s = Math.max(0, Math.floor(startSec * sampleRate))
  const e = Math.min(samples.length, Math.floor(endSec * sampleRate))
  if (e <= s) return 0
  let sumSq = 0
  for (let i = s; i < e; i++) {
    sumSq += samples[i] * samples[i]
  }
  return Math.sqrt(sumSq / (e - s))
}
