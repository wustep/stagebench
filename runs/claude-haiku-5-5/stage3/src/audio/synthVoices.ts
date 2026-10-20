// Honest live synthesis for the three types that have no recording: Clav, Digital, and Misc.
// Each voice is generated from oscillators at note-on. Nothing here is a sample, and the status
// line says so. The shapes differ from one another and from the sample sets:
//
//   clav     sawtooth + square through a decaying filter; short decay; a quick pluck-off on release
//   digital  two-operator FM whose index decays after the strike; bell-like upper partials
//   marimba  three inharmonic sine modes (1, 4, 10) with fast decay on the upper two

import type { AudioContextLike, AudioNodeLike, BiquadFilterNodeLike, GainNodeLike, OscillatorNodeLike } from './audioBoundary'
import type { SynthKind } from './pianoModels'
import type { VoiceHandle } from './voice'

const ATTACK_SECONDS = 0.003
const HARD_STOP_TIME_CONSTANT = 0.004
const MAX_SECONDS = 12

export interface SynthVoiceRoute {
  destination: AudioNodeLike
  /** Output gain for this voice, already shaped by velocity and KB Touch. */
  gain: number
  /** Release length in seconds. */
  releaseSeconds: number
}

export function synthNoteFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/** Velocity as a 0..1 stroke strength, clamped to the MIDI range. */
function strength(velocity: number): number {
  return Math.min(127, Math.max(1, Math.round(velocity))) / 127
}

export function startSynthVoice(
  kind: SynthKind,
  context: AudioContextLike,
  note: number,
  velocity: number,
  route: SynthVoiceRoute,
  onEnded: () => void,
): VoiceHandle {
  const now = context.currentTime
  const v = strength(velocity)
  const f = synthNoteFrequency(note)
  const nodes: AudioNodeLike[] = []
  const oscillators: OscillatorNodeLike[] = []

  const out: GainNodeLike = context.createGain()
  out.gain.setValueAtTime(0, now)
  out.gain.linearRampToValueAtTime(route.gain, now + ATTACK_SECONDS)
  out.connect(route.destination)
  nodes.push(out)

  const oscillator = (frequency: number, type: OscillatorNodeLike['type'], detuneCents = 0): OscillatorNodeLike => {
    const node = context.createOscillator()
    node.type = type
    node.frequency.setValueAtTime(frequency, now)
    node.detune.setValueAtTime(detuneCents, now)
    node.start(now)
    node.stop(now + MAX_SECONDS)
    oscillators.push(node)
    nodes.push(node)
    return node
  }

  /** A gain stage that strikes to `peak` and decays with time constant `seconds / 5`. */
  const decaying = (peak: number, seconds: number, into: AudioNodeLike): GainNodeLike => {
    const stage = context.createGain()
    stage.gain.setValueAtTime(0, now)
    stage.gain.linearRampToValueAtTime(peak, now + ATTACK_SECONDS)
    stage.gain.setTargetAtTime(0, now + ATTACK_SECONDS, seconds / 5)
    stage.connect(into)
    nodes.push(stage)
    return stage
  }

  if (kind === 'clav') {
    const filter: BiquadFilterNodeLike = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(900 + 4200 * v, now)
    filter.frequency.setTargetAtTime(700, now + ATTACK_SECONDS, 0.25)
    filter.Q.setValueAtTime(3, now)
    filter.connect(out)
    nodes.push(filter)
    oscillator(f, 'sawtooth').connect(decaying(0.16 + 0.12 * v, 1.2, filter))
    oscillator(f, 'square', 3).connect(decaying(0.08 + 0.08 * v, 0.9, filter))
  } else if (kind === 'digital') {
    const carrier = oscillator(f, 'sine')
    const modulator = oscillator(f, 'sine')
    const index: GainNodeLike = context.createGain()
    index.gain.setValueAtTime(0, now)
    index.gain.linearRampToValueAtTime(f * (1.2 + 2.2 * v), now + ATTACK_SECONDS)
    index.gain.setTargetAtTime(f * 0.15, now + ATTACK_SECONDS, 0.5)
    modulator.connect(index)
    index.connect(carrier.frequency)
    nodes.push(index)
    carrier.connect(decaying(0.22 + 0.1 * v, 2.2, out))
  } else {
    const modes: readonly [ratio: number, amount: number, seconds: number][] = [
      [1, 1, 1.4],
      [4, 0.25, 0.28],
      [10, 0.08, 0.09],
    ]
    for (const [ratio, amount, seconds] of modes) {
      oscillator(f * ratio, 'sine').connect(decaying(0.3 * amount * (0.4 + 0.6 * v), seconds, out))
    }
  }

  let remaining = oscillators.length
  let ended = false
  let released = false
  const finish = () => {
    if (ended) return
    ended = true
    for (const node of nodes) node.disconnect()
    onEnded()
  }
  for (const node of oscillators) {
    node.onended = () => {
      remaining -= 1
      if (remaining === 0) finish()
    }
  }

  return {
    release() {
      if (released || ended) return
      released = true
      const at = context.currentTime
      out.gain.cancelScheduledValues(at)
      out.gain.setTargetAtTime(0, at, route.releaseSeconds / 4)
      for (const node of oscillators) node.stop(at + route.releaseSeconds * 2.5)
    },
    stop() {
      if (ended) return
      released = true
      const at = context.currentTime
      out.gain.cancelScheduledValues(at)
      out.gain.setTargetAtTime(0, at, HARD_STOP_TIME_CONSTANT)
      for (const node of oscillators) node.stop(at + 0.02)
    },
    setBend(cents: number) {
      if (ended) return
      for (const node of oscillators) {
        node.detune.setTargetAtTime(cents, context.currentTime, 0.02)
      }
    },
  }
}
