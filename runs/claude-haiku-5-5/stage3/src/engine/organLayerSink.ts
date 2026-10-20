// The voice sink for one organ layer. Each note is built from the layer's model and drawbars. The
// layer's own level, octave, and zone reach the sound through the layer gain and the note's pitch offset.
// B3 percussion is single-triggered: it sounds only when no other note of the layer is sounding (manual p. 20).

import type { AudioContextLike, AudioNodeLike } from '../audio/audioBoundary'
import { modelPartials, normalizePartials, type OrganModel } from '../audio/organ/models'
import { startOrganVoice, type OrganPercussion, type OrganVibrato } from '../audio/organ/organVoice'
import type { VoiceHandle, VoiceSink } from '../audio/voice'

const ORGAN_PEAK = 0.5

export interface OrganLayerSettings {
  model: OrganModel
  /** Nine drawbar positions, 0..1. */
  drawbars: readonly number[]
  vibrato: OrganVibrato
  percussion: OrganPercussion
  keyClick: boolean
}

export interface OrganLayerDeps {
  context(): AudioContextLike | undefined
  /** The layer gain that carries this layer's level into the shared organ chain. */
  destination(): AudioNodeLike | undefined
  settings(): OrganLayerSettings | undefined
  /** Semitones added to the played note: octave shift plus transpose. */
  pitchOffset(): number
}

export class OrganLayerSink implements VoiceSink {
  private readonly deps: OrganLayerDeps
  private readonly sounding = new Set<VoiceHandle>()

  constructor(deps: OrganLayerDeps) {
    this.deps = deps
  }

  start(note: number, velocity: number, onEnded: () => void, gain = 1): VoiceHandle {
    const context = this.deps.context()
    const destination = this.deps.destination()
    const settings = this.deps.settings()
    const pitch = note + this.deps.pitchOffset()
    if (!context || !destination || !settings || pitch < 0 || pitch > 127) {
      return silentHandle(onEnded)
    }
    const partials = normalizePartials(modelPartials(settings.model, settings.drawbars), ORGAN_PEAK)
    const percussionTriggered = settings.model === 'b3' && this.sounding.size === 0
    const frequency = 440 * Math.pow(2, (pitch - 69) / 12)
    const handle = startOrganVoice(
      context,
      destination,
      frequency,
      gain,
      { partials, vibrato: settings.vibrato, percussion: settings.model === 'b3' ? settings.percussion : undefined, keyClick: settings.keyClick && settings.model === 'b3' },
      () => {
        this.sounding.delete(wrapped)
        onEnded()
      },
      percussionTriggered,
    )
    const wrapped: VoiceHandle = {
      release: () => handle.release(),
      stop: () => handle.stop(),
      setBend: (cents) => handle.setBend?.(cents),
    }
    this.sounding.add(wrapped)
    return wrapped
  }
}

/** A handle for a note that makes no sound, so the controller's bookkeeping still ends it. */
function silentHandle(onEnded: () => void): VoiceHandle {
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    onEnded()
  }
  return { release: end, stop: end }
}
