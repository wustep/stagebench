// The voice sink for one synth layer. Poly gives every note its own voice, up to eight, and steals the
// oldest when full. Mono and Legato play one voice for the whole layer: a new note glides to its pitch
// (Glide), and Mono retriggers the envelope while Legato keeps it running. When the sounding note lets go,
// the note priority (Off: the most recent held note, Low: the lowest, High: the highest) picks the next.

import type { AudioContextLike, AudioNodeLike } from '../audio/audioBoundary'
import type { VoiceHandle, VoiceSink } from '../audio/voice'
import { startSynthVoice, type SynthVoiceHandle, type SynthVoiceSettings } from '../audio/synth/synthVoice'

export const MAX_SYNTH_VOICES = 8
const SYNTH_PEAK = 0.5
/** Glide in seconds at the knob's top. */
const MAX_GLIDE_SECONDS = 0.5

export type VoiceMode = 'poly' | 'mono' | 'legato'
export type NotePriority = 'off' | 'low' | 'high'

export interface SynthLayerSettings {
  voice: SynthVoiceSettings
  mode: VoiceMode
  priority: NotePriority
  /** Glide knob 0..1. */
  glide: number
  /** Semitones added to every note: octave shift plus transpose. */
  pitchOffset: number
}

export interface SynthLayerDeps {
  context(): AudioContextLike | undefined
  destination(): AudioNodeLike | undefined
  settings(): SynthLayerSettings | undefined
}

interface Held {
  note: number
  /** Order of arrival, so Priority Off can pick the most recent note. */
  seq: number
  velocity: number
}

/** Pick the note that sounds next from the held notes, under a note priority. */
export function nextNote(held: readonly Held[], priority: NotePriority): Held | undefined {
  if (held.length === 0) return undefined
  if (priority === 'low') return held.reduce((lowest, entry) => (entry.note < lowest.note ? entry : lowest))
  if (priority === 'high') return held.reduce((highest, entry) => (entry.note > highest.note ? entry : highest))
  return held.reduce((latest, entry) => (entry.seq > latest.seq ? entry : latest))
}

export class SynthLayerSink implements VoiceSink {
  private readonly deps: SynthLayerDeps
  private seq = 0
  /** Poly voices in the order they started, for stealing. */
  private readonly polyVoices: { handle: SynthVoiceHandle; ended: boolean }[] = []
  /** Mono and legato: the one voice, the note it is sounding, and the notes held on this layer. */
  private monoVoice: SynthVoiceHandle | undefined
  private sounding: Held | undefined
  private readonly held: Held[] = []

  /** Voices this layer is sounding right now: poly voices still running, or the one mono voice. */
  get voiceCount(): number {
    return this.polyVoices.filter((voice) => !voice.ended).length + (this.monoVoice ? 1 : 0)
  }

  constructor(deps: SynthLayerDeps) {
    this.deps = deps
  }

  start(note: number, velocity: number, onEnded: () => void, gain = 1): VoiceHandle {
    const settings = this.deps.settings()
    const context = this.deps.context()
    const destination = this.deps.destination()
    const pitch = note + (settings?.pitchOffset ?? 0)
    if (!settings || !context || !destination || pitch < 0 || pitch > 127) {
      return silentHandle(onEnded)
    }
    const level = SYNTH_PEAK * gain
    if (settings.mode === 'poly') return this.startPoly(context, destination, settings, pitch, velocity, level, onEnded)
    return this.startMono(context, destination, settings, note, pitch, velocity, level, onEnded)
  }

  private startPoly(
    context: AudioContextLike,
    destination: AudioNodeLike,
    settings: SynthLayerSettings,
    pitch: number,
    velocity: number,
    level: number,
    onEnded: () => void,
  ): VoiceHandle {
    while (this.polyVoices.filter((voice) => !voice.ended).length >= MAX_SYNTH_VOICES) {
      const oldest = this.polyVoices.find((voice) => !voice.ended)
      if (!oldest) break
      oldest.handle.stop()
      oldest.ended = true
    }
    const entry = { handle: undefined as unknown as SynthVoiceHandle, ended: false }
    entry.handle = startSynthVoice(context, destination, settings.voice, pitch, velocity, level, () => {
      entry.ended = true
      onEnded()
    })
    this.polyVoices.push(entry)
    return {
      release: () => entry.handle.release(),
      stop: () => entry.handle.stop(),
      setBend: (cents) => entry.handle.setBend?.(cents),
    }
  }

  private startMono(
    context: AudioContextLike,
    destination: AudioNodeLike,
    settings: SynthLayerSettings,
    note: number,
    pitch: number,
    velocity: number,
    level: number,
    onEnded: () => void,
  ): VoiceHandle {
    const entry: Held = { note, seq: this.seq, velocity }
    this.seq += 1
    this.held.push(entry)
    const glide = settings.glide * MAX_GLIDE_SECONDS
    if (!this.monoVoice) {
      this.monoVoice = startSynthVoice(context, destination, settings.voice, pitch, velocity, level, () => undefined)
    } else if (settings.mode === 'legato') {
      // Legato keeps the envelope running: the new note only moves the pitch.
      this.monoVoice.retune(pitch, glide)
    } else {
      this.monoVoice.retune(pitch, glide)
      this.monoVoice.retrigger()
    }
    this.sounding = entry
    // A mono note has no separate voice to end, so it reports its end when its key is lifted.
    let ended = false
    const handle: VoiceHandle = {
      release: () => {
        if (!ended) {
          ended = true
          onEnded()
        }
        this.releaseMono(entry, settings, glide)
      },
      stop: () => {
        this.releaseMono(entry, settings, glide)
        handle.release()
      },
    }
    return handle
  }

  /**
   * Lifts one held note. Only the sounding note matters: if it is the one lifted, the note priority picks
   * the next held note and the voice glides to it. Other lifts just leave the stack.
   */
  private releaseMono(entry: Held, settings: SynthLayerSettings, glide: number): void {
    const index = this.held.indexOf(entry)
    if (index < 0) return
    this.held.splice(index, 1)
    if (!this.monoVoice || this.sounding !== entry) return
    const next = nextNote(this.held, settings.priority)
    if (next) {
      this.sounding = next
      this.monoVoice.retune(next.note + settings.pitchOffset, glide)
    } else {
      this.sounding = undefined
      this.monoVoice.release()
      this.monoVoice = undefined
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
