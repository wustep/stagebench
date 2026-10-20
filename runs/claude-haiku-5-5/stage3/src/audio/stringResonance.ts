// Simulated sympathetic String Resonance. When a note is struck while other strings are held, those
// strings ring sympathetically at their fundamentals. Each held note gets a quiet sine that decays over
// a few seconds. This is a simulation (manual p. 25 describes the real acoustic effect); it is not a
// recording of pedal-down samples, which Phase 2 does not bundle.

import type { AudioContextLike, AudioNodeLike } from './audioBoundary'
import { midiToFrequency } from './pianoVoice'

const ATTACK_SECONDS = 0.01
const DECAY_SECONDS = 3

/** Starts one sympathetic sine per frequency, feeding every destination, and cleans itself up when silent. */
export function spawnSympatheticResonance(
  context: AudioContextLike,
  destinations: readonly AudioNodeLike[],
  notes: readonly number[],
  level: number,
): void {
  const now = context.currentTime
  for (const note of notes) {
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(midiToFrequency(note), now)
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0, now)
    envelope.gain.linearRampToValueAtTime(level, now + ATTACK_SECONDS)
    envelope.gain.setTargetAtTime(0, now + ATTACK_SECONDS, DECAY_SECONDS / 5)
    oscillator.connect(envelope)
    for (const destination of destinations) {
      envelope.connect(destination)
    }
    oscillator.start(now)
    oscillator.stop(now + DECAY_SECONDS * 2)
    oscillator.onended = () => {
      oscillator.disconnect()
      envelope.disconnect()
    }
  }
}
