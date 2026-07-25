import { midiToFrequency } from '../model/keyboard'
import type { KbTouchId, PianoTypeId, TimbreId } from './settings'

/**
 * Tone shaping for the voices the engine builds.
 *
 * Two kinds of voice exist. Grand, Upright and Electric play the bundled *recordings*
 * (`sampleLibrary.ts`); everything here that produces partials is *generated* synthesis, used by
 * the Clav, Digital and Misc types and by the labelled fallback voice that keeps the keybed
 * playable when the recorded assets cannot be loaded. `IMPLEMENTATION_DETAILS.json` says exactly
 * that, and no synthesised voice is ever described as a recording.
 *
 * The functions here are pure so the numbers can be asserted directly, and they are the same
 * numbers the live engine schedules onto its AudioParams.
 */

export interface PartialSpec {
  /** Frequency multiple of the fundamental, slightly stretched to model string inharmonicity. */
  readonly ratio: number
  readonly type: 'sine' | 'triangle' | 'square' | 'sawtooth'
  /** Peak gain relative to the voice gain. */
  readonly gain: number
  /** Decay time to -60dB, in seconds. */
  readonly decay: number
}

/** Reference pitch used to scale decay length across the keybed (C4). */
const REFERENCE_HZ = 261.6255653

/** Voices that are synthesised rather than played from the recorded sets. */
export type SynthVoiceId = 'fallback' | 'clav' | 'digital' | 'misc'

export function synthVoiceFor(type: PianoTypeId): SynthVoiceId {
  switch (type) {
    case 'clav':
      return 'clav'
    case 'digital':
      return 'digital'
    case 'misc':
      return 'misc'
    default:
      return 'fallback'
  }
}

/**
 * Low notes ring far longer than high ones on a real piano. Measured against the reference
 * instrument's behaviour only qualitatively — this is an honest approximation, not a model of a
 * specific piano.
 */
export function fundamentalDecay(frequency: number): number {
  const scaled = 8.5 * Math.pow(REFERENCE_HZ / frequency, 0.55)
  return Math.min(16, Math.max(0.55, scaled))
}

export function partialsFor(
  midi: number,
  velocity: number,
  voice: SynthVoiceId = 'fallback',
): readonly PartialSpec[] {
  const frequency = midiToFrequency(midi)
  const base = fundamentalDecay(frequency)
  // Brighter strikes put more energy into the upper partials.
  const brightness = 0.25 + 0.75 * velocity

  switch (voice) {
    case 'clav':
      // Short, wiry and plucked: a fast-decaying square-ish stack with almost no tail.
      return [
        { ratio: 1, type: 'square', gain: 0.62, decay: Math.min(1.1, base * 0.16) },
        { ratio: 2.004, type: 'sawtooth', gain: 0.4 * brightness, decay: Math.min(0.8, base * 0.12) },
        { ratio: 3.01, type: 'square', gain: 0.16 * brightness, decay: Math.min(0.5, base * 0.07) },
      ]
    case 'digital':
      // FM-style bell/digital piano: strong even partials, long clean tail.
      return [
        { ratio: 1, type: 'sine', gain: 1, decay: base * 0.85 },
        { ratio: 2, type: 'sine', gain: 0.5 * brightness, decay: base * 0.5 },
        { ratio: 4.01, type: 'sine', gain: 0.26 * brightness * brightness, decay: base * 0.22 },
        { ratio: 7.02, type: 'sine', gain: 0.1 * brightness * brightness, decay: base * 0.1 },
      ]
    case 'misc':
      // Mallet character: the marimba's fourth-harmonic bar tuning, short and woody.
      return [
        { ratio: 1, type: 'sine', gain: 1, decay: Math.min(2.4, base * 0.3) },
        { ratio: 3.98, type: 'sine', gain: 0.34 * brightness, decay: Math.min(1.1, base * 0.14) },
        { ratio: 9.9, type: 'sine', gain: 0.09 * brightness, decay: Math.min(0.5, base * 0.06) },
      ]
    default:
      return [
        { ratio: 1, type: 'sine', gain: 1, decay: base },
        { ratio: 2.0027, type: 'sine', gain: 0.42 * brightness, decay: base * 0.55 },
        { ratio: 3.0142, type: 'triangle', gain: 0.13 * brightness * brightness, decay: base * 0.3 },
      ]
  }
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
/** Soft Release lengthens and softens the damper (manual p. 25). */
export const SOFT_RELEASE_MULTIPLIER = 2.6

/** Length of the ringing tail actually rendered before the voice is torn down. */
export function voiceLifetime(midi: number, velocity: number, voice: SynthVoiceId = 'fallback'): number {
  const partials = partialsFor(midi, velocity, voice)
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

/* ------------------------------------------------------------------ performance controls */

/**
 * KB Touch (manual p. 25): how hard the keybed has to be played for a given level. Heavy needs
 * a harder stroke for the same output; Light gives more level for a soft stroke.
 */
export function applyKbTouch(velocity: number, touch: KbTouchId): number {
  const clamped = Math.min(1, Math.max(0.001, velocity))
  switch (touch) {
    case 'heavy':
      return Math.pow(clamped, 1.9)
    case 'medium':
      return Math.pow(clamped, 1.35)
    case 'light':
      return Math.pow(clamped, 0.62)
    default:
      return clamped
  }
}

/**
 * Dyn Comp (manual p. 25): raises the level of softer strokes, narrowing the dynamic range
 * without changing the timbre response — so this only ever touches the voice's gain, never the
 * tone filter, which is driven by the untouched velocity.
 */
export function applyDynComp(gain: number, level: 0 | 1 | 2 | 3): number {
  if (level === 0) return gain
  const compression = [0, 0.35, 0.6, 0.82][level]
  const floor = [0, 0.12, 0.22, 0.34][level]
  const clamped = Math.min(1, Math.max(0, gain))
  return floor + (1 - floor) * Math.pow(clamped, 1 - compression * 0.75)
}

/** Unison detune in cents per voice pair (manual p. 26): 1 subtle, 3 wide. */
export function unisonDetuneCents(level: 0 | 1 | 2 | 3): number {
  return [0, 4, 9, 18][level]
}

export function unisonVoiceCount(level: 0 | 1 | 2 | 3): number {
  return level === 0 ? 1 : 3
}

export interface TimbreShape {
  readonly filter: 'none' | 'lowshelf' | 'peaking' | 'highshelf'
  readonly frequency: number
  readonly gainDb: number
  readonly q: number
  /** A second stage, used by the Dyno preamp emulations. */
  readonly second?: { filter: 'lowshelf' | 'peaking' | 'highshelf'; frequency: number; gainDb: number; q: number }
}

/**
 * Timbre (manual p. 26): Soft dampens highs, Mid emphasises midrange presence, Bright emphasises
 * treble, and the two Dyno settings are tine-piano preamp/EQ emulations (bass and treble lift
 * with a scooped midrange, more pronounced on Dyno 2).
 */
export function timbreShape(timbre: TimbreId): TimbreShape {
  switch (timbre) {
    case 'soft':
      return { filter: 'highshelf', frequency: 1800, gainDb: -12, q: 0.7 }
    case 'mid':
      return { filter: 'peaking', frequency: 1200, gainDb: 9, q: 0.9 }
    case 'bright':
      return { filter: 'highshelf', frequency: 2600, gainDb: 10, q: 0.7 }
    case 'dyno1':
      return {
        filter: 'lowshelf',
        frequency: 180,
        gainDb: 5,
        q: 0.7,
        second: { filter: 'highshelf', frequency: 3200, gainDb: 7, q: 0.7 },
      }
    case 'dyno2':
      return {
        filter: 'lowshelf',
        frequency: 220,
        gainDb: 9,
        q: 0.7,
        second: { filter: 'highshelf', frequency: 2800, gainDb: 12, q: 0.7 },
      }
    default:
      return { filter: 'none', frequency: 1000, gainDb: 0, q: 0.7 }
  }
}
