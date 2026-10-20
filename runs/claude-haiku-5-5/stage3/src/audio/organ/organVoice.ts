// One organ note: a sine per partial, optionally with vibrato or chorus, B3 percussion, and a key click.
// The partials come from models.ts, so the model decides the spectrum and this file decides the motion.
//
// Vibrato V1-V3 modulates the pitch of every partial by an LFO. Chorus C1-C3 mixes a second, detuned copy
// of the partials with the dry sound, so it adds width without changing the pitch. Every oscillator
// ends on its own `onended`, so the voice reports when its last partial has stopped.

import type { AudioContextLike, AudioNodeLike, AudioParamLike, GainNodeLike, OscillatorNodeLike } from '../audioBoundary'
import { gainNode, NodeBag, ramp } from '../effects/nodes'
import type { VoiceHandle } from '../voice'
import type { Partial } from './models'

export const VIBRATO_HZ = 6.1
/** Vibrato depth in cents at knob position 1, for V1, V2, and V3. */
const VIBRATO_CENTS = [10, 20, 35] as const
/** Chorus: the mix of the detuned copy, and its detune in cents, for C1, C2, and C3. */
const CHORUS_MIX = [0.25, 0.45, 0.65] as const
const CHORUS_CENTS = [5, 9, 14] as const
const RELEASE_SECONDS = 0.06

export interface OrganVibrato {
  on: boolean
  /** Index into the panel's vibrato types: 0 to 2 are V1 to V3, 3 to 5 are C1 to C3. */
  type: number
  /** Knob position 0..1 scaling the depth. */
  depth: number
}

export interface OrganPercussion {
  on: boolean
  /** Soft percussion is quieter. */
  soft: boolean
  /** Fast decay is short. */
  fast: boolean
  /** Harmonic third instead of second. */
  third: boolean
  /** Percussion volume knob, 0..1. */
  volume: number
}

export interface OrganVoiceSpec {
  partials: readonly Partial[]
  vibrato: OrganVibrato
  percussion?: OrganPercussion
  keyClick: boolean
}

/** Deterministic noise for key clicks, generated once per buffer. */
function noiseSamples(length: number): Float32Array {
  const out = new Float32Array(length)
  let state = 0x2545f491
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    out[i] = state / 0x80000000 - 1
  }
  return out
}

/** Percussion decay in seconds: fast is short, slow is long (manual p. 20). */
export function percussionDecay(fast: boolean): number {
  return fast ? 0.25 : 0.9
}

export function percussionLevel(percussion: OrganPercussion): number {
  return (percussion.soft ? 0.25 : 0.5) * Math.min(1, Math.max(0, percussion.volume))
}

export function startOrganVoice(
  context: AudioContextLike,
  destination: AudioNodeLike,
  frequency: number,
  gain: number,
  spec: OrganVoiceSpec,
  onEnded: () => void,
  percussionTriggered = false,
): VoiceHandle {
  const bag = new NodeBag()
  const now = context.currentTime
  const out = gainNode(context, bag, 1)
  out.connect(destination)

  const oscillators: OscillatorNodeLike[] = []
  const active = spec.vibrato.on
  const lfo = active ? startLfo(context, bag, now) : undefined
  const chorus = active && spec.vibrato.type >= 3
  const vibratoIndex = spec.vibrato.type % 3
  const vibratoCents = VIBRATO_CENTS[vibratoIndex] * Math.min(1, Math.max(0, spec.vibrato.depth))

  // One set of partials at a mix level. Only a modulated set takes the LFO, at the given depth in cents.
  const addSet = (mix: number, modulationCents: number) => {
    const setGain = gainNode(context, bag, mix)
    setGain.connect(out)
    for (const partial of spec.partials) {
      const osc = bag.add(context.createOscillator())
      osc.type = 'sine'
      osc.frequency.setValueAtTime(frequency * partial.ratio, now)
      const partialGain = gainNode(context, bag, partial.amp * gain)
      osc.connect(partialGain)
      partialGain.connect(setGain)
      if (lfo && modulationCents > 0) connectDepth(context, bag, lfo, osc.detune, modulationCents)
      osc.start(now)
      oscillators.push(osc)
    }
  }

  if (chorus) {
    // Chorus keeps the dry pitch and adds a pitch-modulated copy, so the sound widens without wobbling.
    const mix = CHORUS_MIX[spec.vibrato.type - 3]
    addSet(1 - mix, 0)
    addSet(mix, CHORUS_CENTS[spec.vibrato.type - 3] * Math.min(1, Math.max(0, spec.vibrato.depth)))
  } else {
    addSet(1, vibratoCents)
  }

  if (spec.percussion?.on && percussionTriggered) {
    const percussion = spec.percussion
    const osc = bag.add(context.createOscillator())
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency * (percussion.third ? 3 : 2), now)
    const level = percussionLevel(percussion) * gain
    const envelope = gainNode(context, bag, 0)
    envelope.gain.setValueAtTime(level, now)
    envelope.gain.linearRampToValueAtTime(0, now + percussionDecay(percussion.fast))
    osc.connect(envelope)
    envelope.connect(out)
    osc.start(now)
    osc.stop(now + percussionDecay(percussion.fast) + 0.05)
    oscillators.push(osc)
  }

  if (spec.keyClick) {
    const length = Math.max(1, Math.round(context.sampleRate * 0.006))
    const buffer = context.createBuffer(1, length, context.sampleRate)
    buffer.getChannelData(0).set(noiseSamples(length))
    const source = bag.add(context.createBufferSource())
    source.buffer = buffer
    const clickGain = gainNode(context, bag, 0.04 * gain)
    source.connect(clickGain)
    clickGain.connect(out)
    source.start(now)
    source.stop(now + 0.01)
  }

  let remaining = oscillators.length
  for (const osc of oscillators) {
    osc.onended = () => {
      remaining -= 1
      if (remaining === 0) {
        bag.dispose()
        onEnded()
      }
    }
  }

  let released = false
  return {
    release() {
      if (released) return
      released = true
      const at = context.currentTime
      out.gain.cancelScheduledValues(at)
      out.gain.setValueAtTime(out.gain.value, at)
      out.gain.linearRampToValueAtTime(0, at + RELEASE_SECONDS)
      for (const osc of oscillators) osc.stop(at + RELEASE_SECONDS + 0.02)
    },
    stop() {
      if (released) return
      released = true
      const at = context.currentTime
      ramp(context, out.gain, 0, 0.004)
      for (const osc of oscillators) osc.stop(at + 0.03)
    },
    setBend(cents: number) {
      for (const osc of oscillators) osc.detune.setTargetAtTime(cents, context.currentTime, 0.01)
    },
  }
}

function startLfo(context: AudioContextLike, bag: NodeBag, now: number): OscillatorNodeLike {
  const lfo = bag.add(context.createOscillator())
  lfo.type = 'sine'
  lfo.frequency.setValueAtTime(VIBRATO_HZ, now)
  lfo.start(now)
  return lfo
}

/** Routes an LFO into a detune parameter, scaled to `cents` of depth. */
function connectDepth(context: AudioContextLike, bag: NodeBag, lfo: OscillatorNodeLike, target: AudioParamLike, cents: number): void {
  const depth: GainNodeLike = gainNode(context, bag, cents)
  lfo.connect(depth)
  depth.connect(target)
}
