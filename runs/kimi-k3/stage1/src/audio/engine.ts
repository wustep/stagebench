/**
 * Injectable audio boundary.
 *
 * `AudioBackend` is the narrow seam between the note lifecycle and whatever
 * renders sound. The app uses `WebAudioBackend`; tests use `FakeAudioBackend`,
 * which renders voices into deterministic in-memory signal buffers so
 * behavior (not exact cross-browser waveforms) can be asserted.
 */

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Voice {
  id: number
  note: number
  velocity: number
  startedAt: number
  releasedAt: number | null
  stopped: boolean
}

export interface AudioBackend {
  /** Current time in seconds (monotonic, arbitrary origin). */
  now(): number
  /** Start a voice. Returns a backend handle used to track the voice. */
  startVoice(note: number, velocity: number): number
  /** Begin the release phase of a voice (damper down). */
  releaseVoice(handle: number): void
  /** Stop a voice immediately (steal / all-notes-off). */
  stopVoice(handle: number): void
  /** Number of voices the backend still owns (sounding or releasing). */
  activeVoiceCount(): number
  /** Tear everything down. */
  dispose(): void
}

export interface EngineEvents {
  onStatus?: (status: EngineStatus, detail?: string) => void
  onVoicesChanged?: (voices: readonly Voice[]) => void
}

/** Deterministic voice-stealing polyphony limit for the Phase 1 piano. */
export const MAX_VOICES = 16

/**
 * The shared note lifecycle. All input sources (pointer, touch, computer
 * keyboard, MIDI) funnel through here, so every source gets identical
 * velocity/release/sustain/polyphony/stealing semantics.
 */
export class PianoEngine {
  private backend: AudioBackend
  private events: EngineEvents
  private status: EngineStatus = 'idle'
  private statusDetail = ''
  private voices: Voice[] = []
  private nextVoiceId = 1
  private sustainDown = false
  /** Notes physically held (finger/key down) per MIDI note. */
  private held = new Map<number, number>()

  constructor(backend: AudioBackend, events: EngineEvents = {}) {
    this.backend = backend
    this.events = events
  }

  getStatus(): { status: EngineStatus; detail: string } {
    return { status: this.status, detail: this.statusDetail }
  }

  getVoices(): readonly Voice[] {
    return this.voices
  }

  isSustainDown(): boolean {
    return this.sustainDown
  }

  /** Initialize the backend and mark ready. Kept async for real backends that decode. */
  async init(): Promise<void> {
    this.setStatus('loading')
    try {
      this.setStatus('ready')
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : String(err))
    }
  }

  /** Enter an error state with an honest message (e.g. Web Audio unavailable). */
  fail(detail: string) {
    this.setStatus('error', detail)
  }

  noteOn(note: number, velocity: number) {
    if (this.status === 'error') return
    const vel = clamp01(velocity)
    // Deterministic stealing: steal the oldest released voice first, else the oldest voice.
    if (this.voices.filter((v) => !v.stopped).length >= MAX_VOICES) {
      const victim = pickStealVictim(this.voices)
      if (victim) {
        this.backend.stopVoice(victim.id)
        victim.stopped = true
      }
    }
    this.voices = this.voices.filter((v) => !v.stopped)
    const handle = this.backend.startVoice(note, vel)
    const voice: Voice = { id: handle, note, velocity: vel, startedAt: this.backend.now(), releasedAt: null, stopped: false }
    this.voices.push(voice)
    this.held.set(note, (this.held.get(note) ?? 0) + 1)
    this.events.onVoicesChanged?.(this.voices)
  }

  noteOff(note: number) {
    const count = this.held.get(note) ?? 0
    if (count > 1) {
      this.held.set(note, count - 1)
      return // overlapping note-ons: only release when the last hold lifts
    }
    this.held.delete(note)
    let changed = false
    for (const v of this.voices) {
      if (v.note === note && !v.stopped && v.releasedAt === null) {
        if (this.sustainDown) {
          // Damper up: voice keeps sounding until sustain lifts.
          continue
        }
        v.releasedAt = this.backend.now()
        this.backend.releaseVoice(v.id)
        changed = true
      }
    }
    if (changed) this.events.onVoicesChanged?.(this.voices)
  }

  setSustain(down: boolean) {
    if (this.sustainDown === down) return
    this.sustainDown = down
    if (!down) {
      // Damper down: every note whose keys are no longer held releases now.
      for (const v of this.voices) {
        if (v.note != null && !v.stopped && v.releasedAt === null && !this.held.has(v.note)) {
          v.releasedAt = this.backend.now()
          this.backend.releaseVoice(v.id)
        }
      }
    }
    this.events.onVoicesChanged?.(this.voices)
  }

  /** All notes off: stop every owned voice immediately and forget holds. */
  allNotesOff() {
    for (const v of this.voices) {
      if (!v.stopped) {
        this.backend.stopVoice(v.id)
        v.stopped = true
      }
    }
    this.voices = []
    this.held.clear()
    this.events.onVoicesChanged?.(this.voices)
  }

  dispose() {
    this.allNotesOff()
    this.backend.dispose()
  }

  private setStatus(status: EngineStatus, detail = '') {
    this.status = status
    this.statusDetail = detail
    this.events.onStatus?.(status, detail)
  }
}

function pickStealVictim(voices: Voice[]): Voice | undefined {
  const live = voices.filter((v) => !v.stopped)
  if (live.length === 0) return undefined
  const released = live.filter((v) => v.releasedAt !== null)
  const pool = released.length > 0 ? released : live
  // Oldest by start time; ties broken by voice id (allocation order) — deterministic.
  return pool.reduce((a, b) => (a.startedAt !== b.startedAt ? (a.startedAt < b.startedAt ? a : b) : a.id < b.id ? a : b))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
