// One sample-playback voice: a looped or one-shot buffer, pitched to the note from its zone root,
// shaped by a short attack and a release that Soft Release can lengthen. Playback position and
// pitch are sample-accurate; the voice owns every node it creates and disconnects them at the end.

import type { AudioBufferSourceNodeLike, AudioContextLike, AudioNodeLike, GainNodeLike, StereoPannerNodeLike } from './audioBoundary'
import type { LoadedZone } from './sampleLibrary'
import { zonePitchDistance } from './sampleLibrary'
import type { VoiceHandle } from './voice'

const ATTACK_SECONDS = 0.003
const STOP_TIME_CONSTANT = 0.004

/** What a sample voice needs beyond its zone: where it goes, how loud, where in the stereo field, and how it ends. */
export interface SampleVoiceRoute {
  destination: AudioNodeLike
  /** Output gain for this voice, already shaped by velocity, KB Touch, and Dyn Comp. */
  gain: number
  /** Stereo position, -1 (left) to 1 (right). Unison copies sit off centre. */
  pan: number
  /** Detune in cents: unison offset. Pitch-stick bend is added through setBend. */
  detuneCents: number
  /** Release length in seconds, already adjusted for Soft Release and the type. */
  releaseSeconds: number
}

export function startSampleVoice(
  context: AudioContextLike,
  zone: LoadedZone,
  note: number,
  route: SampleVoiceRoute,
  onEnded: () => void,
): VoiceHandle {
  const now = context.currentTime
  const buffer = zone.buffer
  const source: AudioBufferSourceNodeLike = context.createBufferSource()
  source.buffer = buffer
  if (zone.loopStart !== null && zone.loopEnd !== null) {
    source.loop = true
    source.loopStart = zone.loopStart / buffer.sampleRate
    source.loopEnd = zone.loopEnd / buffer.sampleRate
  }
  const semitones = zonePitchDistance(zone, note)
  source.playbackRate.setValueAtTime(Math.pow(2, semitones / 12), now)
  source.detune.setValueAtTime(route.detuneCents, now)

  const envelope: GainNodeLike = context.createGain()
  envelope.gain.setValueAtTime(0, now)
  envelope.gain.linearRampToValueAtTime(route.gain, now + ATTACK_SECONDS)

  const panner: StereoPannerNodeLike = context.createStereoPanner()
  panner.pan.setValueAtTime(route.pan, now)

  source.connect(envelope)
  envelope.connect(panner)
  panner.connect(route.destination)

  const nodes: AudioNodeLike[] = [source, envelope, panner]
  let ended = false
  let released = false
  const finish = () => {
    if (ended) return
    ended = true
    for (const node of nodes) node.disconnect()
    onEnded()
  }
  source.onended = finish
  source.start(now)

  return {
    release() {
      if (released || ended) return
      released = true
      const at = context.currentTime
      envelope.gain.cancelScheduledValues(at)
      envelope.gain.setTargetAtTime(0, at, route.releaseSeconds / 4)
      source.stop(at + route.releaseSeconds * 2.5)
    },
    stop() {
      if (ended) return
      released = true
      const at = context.currentTime
      envelope.gain.cancelScheduledValues(at)
      envelope.gain.setTargetAtTime(0, at, STOP_TIME_CONSTANT)
      source.stop(at + 0.02)
    },
    setBend(cents: number) {
      if (ended) return
      source.detune.setTargetAtTime(route.detuneCents + cents, context.currentTime, 0.02)
    },
  }
}
