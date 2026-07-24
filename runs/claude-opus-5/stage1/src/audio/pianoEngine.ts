import { midiToFrequency } from '../model/keyboard'
import type { GraphContext, GraphGain, GraphNode, Scheduler } from './graph'
import { realScheduler } from './graph'
import {
  ATTACK_SECONDS,
  PEDAL_RELEASE_SECONDS,
  RELEASE_SECONDS,
  TRANSIENT_SECONDS,
  fillHammerNoise,
  partialsFor,
  toneCutoff,
  velocityGain,
  voiceLifetime,
} from './pianoVoice'

/** A note instance is owned by the input that started it, so sources never steal each other's notes. */
export type NoteSource = 'pointer' | 'keyboard' | 'midi' | 'ui'

export function noteId(source: NoteSource, key: string | number): string {
  return `${source}:${key}`
}

interface Voice {
  readonly id: string
  readonly midi: number
  readonly velocity: number
  readonly startedAt: number
  readonly nodes: GraphNode[]
  readonly output: GraphGain
  /** True once the key is up but the sustain pedal is still holding the note. */
  sustained: boolean
  releasing: boolean
  reapHandle: number | null
}

export interface PianoEngineOptions {
  readonly maxVoices?: number
  readonly scheduler?: Scheduler
}

const NOISE_SECONDS = 0.09

/**
 * One dependable piano voice, polyphonic, with velocity, per-note release, sustain and
 * deterministic voice stealing.
 *
 * Everything audible is routed voice -> piano bus -> master gain -> destination. Nothing
 * bypasses the master path.
 */
export class PianoEngine {
  readonly context: GraphContext
  readonly master: GraphGain
  readonly pianoBus: GraphGain
  private readonly scheduler: Scheduler
  private readonly maxVoices: number
  private readonly voices = new Map<string, Voice>()
  private readonly noiseBuffer: ReturnType<GraphContext['createBuffer']>
  private sustainDown = false
  private voiceCounter = 0
  private disposed = false

  constructor(context: GraphContext, options: PianoEngineOptions = {}) {
    this.context = context
    this.scheduler = options.scheduler ?? realScheduler
    this.maxVoices = options.maxVoices ?? 32

    this.master = context.createGain()
    this.master.gain.value = 0.7
    this.master.connect(context.destination)

    this.pianoBus = context.createGain()
    this.pianoBus.gain.value = 1
    this.pianoBus.connect(this.master)

    const frames = Math.max(8, Math.floor(context.sampleRate * NOISE_SECONDS))
    this.noiseBuffer = context.createBuffer(1, frames, context.sampleRate)
    fillHammerNoise(this.noiseBuffer.getChannelData(0))
  }

  get activeVoiceCount(): number {
    return this.voices.size
  }

  get soundingVoiceCount(): number {
    let count = 0
    for (const voice of this.voices.values()) if (!voice.releasing) count += 1
    return count
  }

  get sustainedVoiceCount(): number {
    let count = 0
    for (const voice of this.voices.values()) if (voice.sustained) count += 1
    return count
  }

  get sustainEngaged(): boolean {
    return this.sustainDown
  }

  /** MIDI note numbers currently sounding, ascending — used for the on-screen key highlight. */
  soundingNotes(): number[] {
    const notes = new Set<number>()
    for (const voice of this.voices.values()) if (!voice.releasing) notes.add(voice.midi)
    return [...notes].sort((a, b) => a - b)
  }

  noteOn(id: string, midi: number, velocity = 0.8): void {
    if (this.disposed) return
    const existing = this.voices.get(id)
    if (existing) this.tearDown(existing, 0.01)

    if (this.voices.size >= this.maxVoices) this.stealVoice()

    const now = this.context.currentTime
    const clampedVelocity = Math.min(1, Math.max(0.01, velocity))
    const frequency = midiToFrequency(midi)
    const nodes: GraphNode[] = []

    const output = this.context.createGain()
    nodes.push(output)
    const filter = this.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = toneCutoff(midi, clampedVelocity)
    filter.Q.value = 0.7
    nodes.push(filter)

    output.gain.value = velocityGain(clampedVelocity)
    output.connect(this.pianoBus)
    filter.connect(output)

    for (const partial of partialsFor(midi, clampedVelocity)) {
      const oscillator = this.context.createOscillator()
      oscillator.type = partial.type
      oscillator.frequency.value = frequency * partial.ratio
      const partialGain = this.context.createGain()
      partialGain.gain.value = 0
      partialGain.gain.setValueAtTime(0, now)
      partialGain.gain.linearRampToValueAtTime(partial.gain, now + ATTACK_SECONDS)
      partialGain.gain.exponentialRampToValueAtTime(
        Math.max(1e-5, partial.gain * 0.001),
        now + ATTACK_SECONDS + partial.decay,
      )
      oscillator.connect(partialGain)
      partialGain.connect(filter)
      oscillator.start(now)
      nodes.push(oscillator, partialGain)
    }

    const hammer = this.context.createBufferSource()
    hammer.buffer = this.noiseBuffer
    const hammerGain = this.context.createGain()
    hammerGain.gain.value = 0
    hammerGain.gain.setValueAtTime(0.28 * clampedVelocity, now)
    hammerGain.gain.exponentialRampToValueAtTime(1e-4, now + TRANSIENT_SECONDS)
    hammer.connect(hammerGain)
    hammerGain.connect(filter)
    hammer.start(now)
    hammer.stop(now + NOISE_SECONDS)
    nodes.push(hammer, hammerGain)

    const voice: Voice = {
      id,
      midi,
      velocity: clampedVelocity,
      startedAt: this.voiceCounter++,
      nodes,
      output,
      sustained: false,
      releasing: false,
      reapHandle: null,
    }
    this.voices.set(id, voice)

    // A voice whose partials have fully decayed is reaped even if the key is never released,
    // so a held chord does not leak nodes.
    voice.reapHandle = this.scheduler.setTimeout(() => {
      const current = this.voices.get(id)
      if (current === voice) this.destroy(voice)
    }, (voiceLifetime(midi, clampedVelocity) + 0.2) * 1000)
  }

  noteOff(id: string): void {
    const voice = this.voices.get(id)
    if (!voice) return
    if (this.sustainDown) {
      voice.sustained = true
      return
    }
    this.release(voice, RELEASE_SECONDS)
  }

  setSustain(down: boolean): void {
    if (down === this.sustainDown) return
    this.sustainDown = down
    if (down) return
    for (const voice of Array.from(this.voices.values())) {
      if (voice.sustained) this.release(voice, PEDAL_RELEASE_SECONDS)
    }
  }

  /** Stops every voice this engine owns. Used on blur, MIDI disconnect and unmount. */
  allNotesOff(): void {
    for (const voice of Array.from(this.voices.values())) this.release(voice, RELEASE_SECONDS)
  }

  /** Immediate, unconditional teardown — no release tail. */
  panic(): void {
    for (const voice of Array.from(this.voices.values())) this.destroy(voice)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.panic()
    this.pianoBus.disconnect()
    this.master.disconnect()
  }

  private release(voice: Voice, releaseSeconds: number): void {
    if (voice.releasing) return
    voice.releasing = true
    voice.sustained = false
    const now = this.context.currentTime
    const level = voice.output.gain.value
    voice.output.gain.cancelScheduledValues(now)
    voice.output.gain.setValueAtTime(level, now)
    voice.output.gain.exponentialRampToValueAtTime(Math.max(1e-5, level * 0.0005), now + releaseSeconds)
    this.tearDown(voice, releaseSeconds + 0.02)
  }

  private tearDown(voice: Voice, afterSeconds: number): void {
    if (voice.reapHandle !== null) this.scheduler.clearTimeout(voice.reapHandle)
    voice.reapHandle = this.scheduler.setTimeout(() => this.destroy(voice), afterSeconds * 1000)
  }

  private destroy(voice: Voice): void {
    if (voice.reapHandle !== null) {
      this.scheduler.clearTimeout(voice.reapHandle)
      voice.reapHandle = null
    }
    for (const node of voice.nodes) {
      const stoppable = node as { stop?: (when: number) => void }
      if (typeof stoppable.stop === 'function') {
        try {
          stoppable.stop(this.context.currentTime)
        } catch {
          // A source that already stopped throws in some implementations; nothing to do.
        }
      }
      node.disconnect()
    }
    if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id)
  }

  /**
   * Deterministic stealing order: the longest-running releasing voice first, then the
   * longest-running sustained voice, then the longest-running sounding voice.
   */
  private stealVoice(): void {
    const ranked = [...this.voices.values()].sort((a, b) => {
      const priority = (voice: Voice) => (voice.releasing ? 0 : voice.sustained ? 1 : 2)
      const byPriority = priority(a) - priority(b)
      return byPriority !== 0 ? byPriority : a.startedAt - b.startedAt
    })
    const victim = ranked[0]
    if (victim) this.destroy(victim)
  }
}
