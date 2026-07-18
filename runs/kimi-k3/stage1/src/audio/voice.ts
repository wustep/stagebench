/**
 * The Phase 1 piano voice — honest synthesis.
 *
 * This is NOT a recording: every voice is a short additive stack of sine
 * partials whose amplitudes, detune, and per-partial exponential decay rates
 * approximate a struck piano string (bright attack, partials that decay
 * faster the higher they are). It is deterministic given (note, velocity)
 * which makes it testable, and it is declared as generated audio in
 * IMPLEMENTATION_DETAILS.json.
 */

export interface VoiceParams {
  note: number
  velocity: number
  startTime: number
  releaseTime: number | null
}

/** Frequency of a MIDI note. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export interface PartialSpec {
  /** Harmonic number (1 = fundamental). */
  harmonic: number
  /** Relative amplitude at velocity 1. */
  gain: number
  /** Exponential decay rate (1/s) at middle register; scaled per note. */
  decay: number
  /** Slight inharmonic stretch, dimensionless. */
  stretch: number
}

const PARTIALS: readonly PartialSpec[] = [
  { harmonic: 1, gain: 1.0, decay: 1.4, stretch: 0 },
  { harmonic: 2, gain: 0.52, decay: 2.1, stretch: 0.0004 },
  { harmonic: 3, gain: 0.3, decay: 3.2, stretch: 0.0009 },
  { harmonic: 4, gain: 0.18, decay: 4.6, stretch: 0.0016 },
  { harmonic: 5, gain: 0.1, decay: 6.4, stretch: 0.0025 },
  { harmonic: 6, gain: 0.05, decay: 8.6, stretch: 0.0036 },
]

/** Seconds of audible ring after release begins (damper-down decay). */
export const RELEASE_SECONDS = 0.35

/**
 * Deterministic synthesized sample of the piano voice at time `t` (seconds
 * since start). `releaseAt` is null while sustained. Pure function — used by
 * both the real-time backend (to build an AudioBuffer) and tests.
 */
export function synthSample(params: VoiceParams, t: number): number {
  const { note, velocity, releaseTime } = params
  const local = t
  if (local < 0) return 0
  const freq = midiToFreq(note)
  // Higher notes decay faster, like real strings.
  const registerScale = 1 + Math.max(0, (note - 60) / 48) * 1.6 + Math.max(0, (40 - note) / 40) * -0.25
  const velGain = 0.12 + 0.88 * velocity * velocity // perceptual-ish velocity curve
  let sample = 0
  for (const p of PARTIALS) {
    const f = freq * p.harmonic * (1 + p.stretch * p.harmonic * p.harmonic)
    const decay = p.decay * registerScale
    let env = Math.exp(-decay * local)
    if (releaseTime !== null && local >= releaseTime) {
      // Freeze the sustaining envelope at release, then decay quickly.
      const atRelease = Math.exp(-decay * releaseTime)
      const rel = local - releaseTime
      env = atRelease * Math.exp(-rel / (RELEASE_SECONDS * (0.4 + 0.6 / p.harmonic)))
    }
    // Fast hammer attack: 2 ms ramp avoids a click.
    const attack = Math.min(1, local / 0.002)
    sample += p.gain * env * attack * Math.sin(2 * Math.PI * f * local)
  }
  return sample * velGain * 0.24
}

/**
 * Render `seconds` of the voice into a mono Float32Array at `sampleRate`.
 * Deterministic — the same params always render the same buffer.
 */
export function renderVoiceBuffer(params: VoiceParams, seconds: number, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = synthSample(params, i / sampleRate)
  return out
}
