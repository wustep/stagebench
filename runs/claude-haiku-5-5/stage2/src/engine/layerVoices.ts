// The voice sink for one piano layer. It turns a note into the sound of the selected type: a sample
// voice from the bundled set (with unison copies), a synthesized voice for Clav, Digital, and Misc,
// or the Phase 1 live-synthesis fallback while a recorded set is loading or has failed. Every voice
// lands on this layer's input, so layer ownership is structural: a note only sounds in the layers
// whose sink started it.

import type { AudioContextLike, GainNodeLike } from '../audio/audioBoundary'
import type { LayerId } from '../audio/signalGraph'
import { startPianoVoice } from '../audio/pianoVoice'
import { KB_TOUCH_CURVES, UNISON_DETUNE_CENTS, UNISON_SPREAD, dynCompGain, type PianoType } from '../audio/pianoModels'
import { startSampleVoice } from '../audio/sampleVoice'
import { selectZone, type SampleLibrary } from '../audio/sampleLibrary'
import { startSynthVoice } from '../audio/synthVoices'
import type { VoiceHandle, VoiceSink } from '../audio/voice'
import type { VoiceSettings } from '../model/audioSettings'

const SAMPLE_PEAK = 0.55
const SYNTH_PEAK = 0.5
const SYNTH_RELEASE_SECONDS = { clav: 0.12, digital: 0.5, marimba: 0.3 } as const

/** What a layer sink needs from the instrument. It is read at each note-on, so changes apply to new notes. */
export interface LayerVoiceContext {
  context(): AudioContextLike | undefined
  input(layer: LayerId): GainNodeLike | undefined
  library: SampleLibrary
  voice(): VoiceSettings | undefined
  octave(layer: LayerId): number
}

/**
 * Applies KB Touch and Dyn Comp to a played velocity. The result is the velocity the voice uses
 * for its zone and its loudness, so both change with the touch setting.
 */
export function effectiveVelocity(velocity: number, voice: Pick<VoiceSettings, 'touch' | 'dynComp'>): number {
  const v = Math.min(127, Math.max(1, Math.round(velocity))) / 127
  const touched = KB_TOUCH_CURVES[Math.min(2, Math.max(0, voice.touch))](v)
  const lifted = dynCompGain(touched, voice.dynComp)
  return Math.round(Math.min(127, Math.max(1, lifted * 127)))
}

/** Loudness from an effective velocity, with a soft floor so pianissimo stays audible. */
function strokeGain(effective: number, peak: number): number {
  return peak * (0.08 + 0.92 * Math.pow(effective / 127, 1.3))
}

interface UnisonCopy {
  pan: number
  detune: number
  level: number
}

/** Unison: one copy at centre, or two detuned copies panned apart at levels 1 to 3 (manual p. 26). */
export function unisonCopies(unison: number): UnisonCopy[] {
  const level = Math.min(3, Math.max(0, unison))
  if (level === 0) return [{ pan: 0, detune: 0, level: 1 }]
  const spread = UNISON_SPREAD[level]
  const detune = UNISON_DETUNE_CENTS[level]
  return [
    { pan: -spread, detune: -detune, level: 0.8 },
    { pan: spread, detune, level: 0.8 },
  ]
}

/** Release length for a sampled type. Soft Release lengthens acoustic releases and dampens electric ones. */
export function sampleReleaseSeconds(type: PianoType, softRelease: boolean): number {
  const base = type.id === 'electric' ? 0.3 : 0.35
  if (!softRelease || !type.softRelease) return base
  return type.id === 'electric' ? base * 0.5 : base * 2.8
}

export class LayerVoiceSink implements VoiceSink {
  private readonly layer: LayerId
  private readonly deps: LayerVoiceContext
  /** Member voices of every note still sounding on this layer, so bend can reach them. */
  private readonly sounding = new Set<VoiceHandle[]>()
  private bend = 0

  constructor(layer: LayerId, deps: LayerVoiceContext) {
    this.layer = layer
    this.deps = deps
  }

  start(note: number, velocity: number, onEnded: () => void): VoiceHandle {
    const context = this.deps.context()
    const destination = this.deps.input(this.layer)
    const transposed = note + this.deps.octave(this.layer)
    if (!context || !destination || transposed < 0 || transposed > 127) {
      return silentHandle(onEnded)
    }

    const voice = this.deps.voice()
    if (!voice) return silentHandle(onEnded)
    const effective = effectiveVelocity(velocity, voice)
    const type = voice.type
    const members: VoiceHandle[] = []
    let remaining = 0
    const memberEnded = () => {
      remaining -= 1
      if (remaining === 0) {
        this.sounding.delete(members)
        onEnded()
      }
    }

    const set = type.sampleSet ? this.deps.library.get(type.sampleSet) : undefined
    const zone = set ? selectZone(set.zones, transposed, effective) : undefined

    if (type.source === 'synthesis' && type.synth) {
      const releaseSeconds = SYNTH_RELEASE_SECONDS[type.synth] * (voice.softRelease && type.softRelease ? 2.8 : 1)
      remaining = 1
      members.push(startSynthVoice(type.synth, context, transposed, effective, { destination, gain: strokeGain(effective, SYNTH_PEAK), releaseSeconds }, memberEnded))
    } else if (zone) {
      const copies = unisonCopies(voice.unison)
      const releaseSeconds = sampleReleaseSeconds(type, voice.softRelease)
      remaining = copies.length
      for (const copy of copies) {
        const gain = (strokeGain(effective, SAMPLE_PEAK) * copy.level) / Math.sqrt(copies.length)
        members.push(
          startSampleVoice(context, zone, transposed, { destination, gain, pan: copy.pan, detuneCents: copy.detune, releaseSeconds }, memberEnded),
        )
      }
    } else {
      // The recorded set is not ready or has failed: the labelled live-synthesis fallback plays instead.
      remaining = 1
      members.push(startPianoVoice(context, destination, transposed, effective, memberEnded))
    }

    this.sounding.add(members)
    for (const member of members) member.setBend?.(this.bend)
    return {
      release() {
        for (const member of members) member.release()
      },
      stop() {
        for (const member of members) member.stop()
      },
    }
  }

  /** Applies a pitch-stick bend to every voice this layer is playing, and to voices it starts later. */
  setBend(cents: number): void {
    this.bend = cents
    for (const members of this.sounding) {
      for (const member of members) member.setBend?.(cents)
    }
  }
}

function silentHandle(onEnded: () => void): VoiceHandle {
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    onEnded()
  }
  return { release: end, stop: end }
}
