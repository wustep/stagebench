// The Phase 1 piano voice: LIVE SYNTHESIS, not recordings.
//
// Each note is a small additive model: six sine partials with piano-like inharmonic stretch,
// partial amplitudes that fall with harmonic number and rise with velocity, a per-note
// low-pass whose cutoff follows velocity, and exponential decay per partial. Nothing is loaded
// from disk or network. Phase 2 will add recorded sample sets; this voice stays the fallback.

import type { AudioContextLike, AudioNodeLike, GainNodeLike, OscillatorNodeLike } from './audioBoundary'

export const PIANO_VOICE_SOURCE = 'live-synthesis' as const

export interface VoiceHandle {
  /** Begins the release tail. Calling it again, or after the voice has ended, does nothing. */
  release(): void
  /** Cuts the voice immediately (a few milliseconds of fade to avoid clicks). */
  stop(): void
}

export interface VoiceSink {
  start(note: number, velocity: number, onEnded: () => void): VoiceHandle
}

export const PARTIAL_COUNT = 6
const INHARMONICITY = 0.0004
const ATTACK_SECONDS = 0.004
const RELEASE_TIME_CONSTANT = 0.09
const RELEASE_STOP_SECONDS = 0.5
const HARD_STOP_TIME_CONSTANT = 0.002
const HARD_STOP_SECONDS = 0.02
/** Hard upper bound on a voice's life if it is never released. */
export const PIANO_VOICE_MAX_SECONDS = 10
const PEAK_LEVEL = 0.2

export function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/** Lower notes ring longer; the factor stays within a musical range. */
function decayScale(note: number): number {
  return Math.min(1.6, Math.max(0.6, 1 + (60 - note) / 80))
}

function normalizedVelocity(velocity: number): number {
  return Math.min(127, Math.max(1, Math.round(velocity))) / 127
}

export function startPianoVoice(
  context: AudioContextLike,
  destination: AudioNodeLike,
  note: number,
  velocity: number,
  onEnded: () => void,
): VoiceHandle {
  const now = context.currentTime
  const v = normalizedVelocity(velocity)
  const scale = decayScale(note)
  const f0 = midiToFrequency(note)

  const voiceGain: GainNodeLike = context.createGain()
  voiceGain.gain.setValueAtTime(0, now)
  voiceGain.gain.linearRampToValueAtTime(PEAK_LEVEL * (0.08 + 0.92 * Math.pow(v, 1.4)), now + ATTACK_SECONDS)

  const tone = context.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.setValueAtTime(1200 + 9000 * Math.pow(v, 1.5), now)
  tone.Q.setValueAtTime(0.5, now)

  voiceGain.connect(tone)
  tone.connect(destination)

  let partialSum = 0
  for (let k = 1; k <= PARTIAL_COUNT; k += 1) {
    partialSum += Math.pow(k, -1.1)
  }

  const oscillators: OscillatorNodeLike[] = []
  const partialGains: GainNodeLike[] = []
  for (let k = 1; k <= PARTIAL_COUNT; k += 1) {
    const frequency = f0 * k * Math.sqrt(1 + INHARMONICITY * k * k)
    const amplitude = (Math.pow(k, -1.1) / partialSum) * Math.pow(v, (k - 1) * 0.5)
    const timeConstant = (1.4 / Math.pow(k, 0.7)) * scale

    const partialGain = context.createGain()
    partialGain.gain.setValueAtTime(0, now)
    partialGain.gain.linearRampToValueAtTime(amplitude, now + ATTACK_SECONDS)
    partialGain.gain.setTargetAtTime(0, now + ATTACK_SECONDS, timeConstant)

    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, now)
    oscillator.connect(partialGain)
    partialGain.connect(voiceGain)
    oscillator.start(now)
    oscillator.stop(now + PIANO_VOICE_MAX_SECONDS)

    oscillators.push(oscillator)
    partialGains.push(partialGain)
  }

  let remaining = oscillators.length
  let ended = false
  let released = false

  const finish = () => {
    if (ended) return
    ended = true
    for (const node of [...oscillators, ...partialGains, voiceGain, tone]) {
      node.disconnect()
    }
    onEnded()
  }

  for (const oscillator of oscillators) {
    oscillator.onended = () => {
      remaining -= 1
      if (remaining === 0) finish()
    }
  }

  const stopAt = (time: number) => {
    for (const oscillator of oscillators) {
      oscillator.stop(time)
    }
  }

  return {
    release() {
      if (released || ended) return
      released = true
      const at = context.currentTime
      voiceGain.gain.cancelScheduledValues(at)
      voiceGain.gain.setTargetAtTime(0, at, RELEASE_TIME_CONSTANT)
      stopAt(at + RELEASE_STOP_SECONDS)
    },
    stop() {
      if (ended) return
      const at = context.currentTime
      released = true
      for (const partialGain of partialGains) {
        partialGain.gain.cancelScheduledValues(at)
        partialGain.gain.setTargetAtTime(0, at, HARD_STOP_TIME_CONSTANT)
      }
      voiceGain.gain.cancelScheduledValues(at)
      voiceGain.gain.setTargetAtTime(0, at, HARD_STOP_TIME_CONSTANT)
      stopAt(at + HARD_STOP_SECONDS)
    },
  }
}
