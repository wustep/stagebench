import { midiToFrequency } from '../model/keyboard'

/**
 * Tone shaping for the Phase 1 piano voice.
 *
 * This is *generated* synthesis, not a recorded sample set: three inharmonic partials with
 * independent exponential decays, a velocity-tracking lowpass, and a short generated noise
 * transient standing in for the hammer strike. `IMPLEMENTATION_DETAILS.json` says exactly that.
 *
 * The functions here are pure so the numbers can be asserted directly, and they are the same
 * numbers the live engine schedules onto its AudioParams.
 */

export interface PartialSpec {
  /** Frequency multiple of the fundamental, slightly stretched to model string inharmonicity. */
  readonly ratio: number
  readonly type: 'sine' | 'triangle'
  /** Peak gain relative to the voice gain. */
  readonly gain: number
  /** Decay time to -60dB, in seconds. */
  readonly decay: number
}

/** Reference pitch used to scale decay length across the keybed (C4). */
const REFERENCE_HZ = 261.6255653

/**
 * Low notes ring far longer than high ones on a real piano. Measured against the reference
 * instrument's behaviour only qualitatively — this is an honest approximation, not a model of a
 * specific piano.
 */
export function fundamentalDecay(frequency: number): number {
  const scaled = 8.5 * Math.pow(REFERENCE_HZ / frequency, 0.55)
  return Math.min(16, Math.max(0.55, scaled))
}

export function partialsFor(midi: number, velocity: number): readonly PartialSpec[] {
  const frequency = midiToFrequency(midi)
  const base = fundamentalDecay(frequency)
  // Brighter strikes put more energy into the upper partials.
  const brightness = 0.25 + 0.75 * velocity
  return [
    { ratio: 1, type: 'sine', gain: 1, decay: base },
    { ratio: 2.0027, type: 'sine', gain: 0.42 * brightness, decay: base * 0.55 },
    { ratio: 3.0142, type: 'triangle', gain: 0.13 * brightness * brightness, decay: base * 0.3 },
  ]
}

/** Velocity curve: perceptually closer to a hammer action than a linear map. */
export function velocityGain(velocity: number): number {
  const clamped = Math.min(1, Math.max(0, velocity))
  return 0.02 + 0.98 * Math.pow(clamped, 1.6)
}

/** Tone filter cutoff in Hz. Harder strikes open the filter, as on a struck string. */
export function toneCutoff(midi: number, velocity: number): number {
  const frequency = midiToFrequency(midi)
  const clamped = Math.min(1, Math.max(0, velocity))
  return Math.min(15000, Math.max(600, frequency * (3 + 9 * clamped) + 500))
}

export const ATTACK_SECONDS = 0.004
export const TRANSIENT_SECONDS = 0.07
/** Damper-up release when the key is let go and the sustain pedal is up. */
export const RELEASE_SECONDS = 0.14
/** Slower release once a note has been ringing under the pedal. */
export const PEDAL_RELEASE_SECONDS = 0.32

/** Length of the ringing tail actually rendered before the voice is torn down. */
export function voiceLifetime(midi: number, velocity: number): number {
  const partials = partialsFor(midi, velocity)
  return ATTACK_SECONDS + Math.max(...partials.map((partial) => partial.decay))
}

/**
 * Deterministic pseudo-random noise for the hammer transient. Seeded so every build renders the
 * identical buffer — no `Math.random`, so tests and captures are reproducible.
 */
export function fillHammerNoise(target: Float32Array, seed = 0x5eed1234): void {
  let state = seed >>> 0
  for (let i = 0; i < target.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const white = (state / 0xffffffff) * 2 - 1
    // Short percussive envelope so the buffer is a strike, not a noise bed.
    const envelope = Math.pow(1 - i / target.length, 3)
    target[i] = white * envelope
  }
}
