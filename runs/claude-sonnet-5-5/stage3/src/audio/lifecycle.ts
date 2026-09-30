import { clampVelocity, MAX_NOTE, MIN_NOTE } from './pianoDsp'
import type { LayerRouter, VoiceSink } from './types'

export const DEFAULT_MAX_VOICES = 24

export type VoiceState = 'held' | 'sustained' | 'releasing'

export interface VoiceInfo {
  id: number
  note: number
  velocity: number
  state: VoiceState
  /** monotonically increasing start order; used for deterministic stealing */
  seq: number
  /** piano layer that owns the voice */
  layer: string
}

export interface LifecycleSnapshot {
  /** notes currently held down by any source */
  pressed: ReadonlySet<number>
  sustain: boolean
  voices: number
  maxVoices: number
}

/** Phase 1 behaviour: one layer, always honouring the pedal */
const SINGLE_LAYER: LayerRouter = { targets: () => [{ layer: 'A', transpose: 0 }], sustPed: () => true }

const STEAL_PRIORITY: Record<VoiceState, number> = { releasing: 0, sustained: 1, held: 2 }

/**
 * One deterministic note lifecycle shared by pointer, computer-keyboard and MIDI input.
 *
 * Inputs are identified by a `source` string (`pointer:3`, `key:KeyA`, `midi:port:60`). A source holds at
 * most one note. A note is "pressed" while at least one source holds it. There is at most one non-releasing
 * voice per note: a re-strike releases the previous voice.
 */
export class NoteLifecycle {
  private readonly sink: VoiceSink
  private readonly router: LayerRouter
  private readonly maxVoices: number
  private readonly voices = new Map<number, VoiceInfo>()
  private readonly holders = new Map<string, number>()
  private readonly sustainSources = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly noteObservers = new Set<(note: number) => void>()
  private nextId = 1
  private seq = 0
  private snapshot: LifecycleSnapshot
  private disposed = false

  constructor(sink: VoiceSink, maxVoices = DEFAULT_MAX_VOICES, router: LayerRouter = SINGLE_LAYER) {
    this.sink = sink
    this.router = router
    this.maxVoices = maxVoices
    this.sink.onVoiceEnded = (id) => this.handleEnded(id)
    this.snapshot = this.computeSnapshot()
  }

  noteOn(source: string, note: number, velocity: number): number | null {
    if (this.disposed) return null
    if (!Number.isInteger(note) || note < MIN_NOTE || note > MAX_NOTE) return null
    if (this.holders.has(source)) this.noteOff(source)
    const vel = clampVelocity(velocity)
    for (const observer of Array.from(this.noteObservers)) observer(note)
    const targets = this.router.targets(note)
    const pedal = this.sustainSources.size > 0

    // re-strike: previous voice for this note on the layers being struck goes into its natural release
    for (const voice of this.orderedVoices()) {
      if (voice.note === note && voice.state !== 'releasing' && targets.some((t) => t.layer === voice.layer)) this.beginRelease(voice)
    }

    this.holders.set(source, note)
    let first: number | null = null
    for (const target of targets) {
      while (this.voices.size >= this.maxVoices) {
        const victim = this.pickVictim()
        if (!victim) break
        this.voices.delete(victim.id)
        this.sink.steal(victim.id)
      }
      const voice: VoiceInfo = { id: this.nextId++, note, velocity: vel, state: 'held', seq: this.seq++, layer: target.layer }
      this.voices.set(voice.id, voice)
      this.sink.start(voice.id, note, vel, { ...target, pedal })
      if (first === null) first = voice.id
    }
    this.emit()
    return first
  }

  noteOff(source: string): void {
    const note = this.holders.get(source)
    if (note === undefined) return
    this.holders.delete(source)
    if (!this.isPressed(note)) {
      for (const voice of this.orderedVoices()) {
        if (voice.note === note && voice.state === 'held') {
          if (this.sustainSources.size > 0 && this.router.sustPed(voice.layer)) voice.state = 'sustained'
          else this.beginRelease(voice)
        }
      }
    }
    this.emit()
  }

  sustain(source: string, down: boolean): void {
    if (this.disposed) return
    const was = this.sustainSources.size > 0
    if (down) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    const now = this.sustainSources.size > 0
    if (was && !now) {
      for (const voice of this.orderedVoices()) {
        if (voice.state === 'sustained') this.beginRelease(voice)
      }
    }
    if (was !== now) this.emit()
  }

  /** the routing changed (SUSTPED toggled, layer or section switched off): apply it to voices that are already sounding */
  refreshRouting(): void {
    const pedal = this.sustainSources.size > 0
    const active = new Set(this.router.active ? this.router.active() : this.router.targets(60).map((t) => t.layer))
    let changed = false
    for (const voice of this.orderedVoices()) {
      if (voice.state === 'releasing') continue
      // a layer that was switched off lets its notes go (naturally); a layer that dropped SUSTPED lets sustained notes go
      const layerOff = !active.has(voice.layer)
      const pedalOff = voice.state === 'sustained' && (!pedal || !this.router.sustPed(voice.layer))
      if (layerOff || pedalOff) {
        this.beginRelease(voice)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  /** release every note and pedal held by sources whose key starts with `prefix` (device disconnect, blur) */
  releaseSource(prefix: string): void {
    for (const source of Array.from(this.holders.keys())) {
      if (source.startsWith(prefix)) this.noteOff(source)
    }
    for (const source of Array.from(this.sustainSources)) {
      if (source.startsWith(prefix)) this.sustain(source, false)
    }
  }

  /** stop everything now (fast fade). Used for blur, hidden page, MIDI panic. */
  allNotesOff(): void {
    this.holders.clear()
    this.sustainSources.clear()
    for (const voice of this.orderedVoices()) {
      this.voices.delete(voice.id)
      this.sink.steal(voice.id)
    }
    this.sink.panic?.()
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.holders.clear()
    this.sustainSources.clear()
    this.voices.clear()
    this.sink.onVoiceEnded = null
    this.sink.dispose()
    this.listeners.clear()
    this.snapshot = this.computeSnapshot()
  }

  isPressed(note: number): boolean {
    for (const n of this.holders.values()) if (n === note) return true
    return false
  }

  getVoices(): VoiceInfo[] {
    return this.orderedVoices()
  }

  getSnapshot(): LifecycleSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  listenerCount(): number {
    return this.listeners.size + this.noteObservers.size
  }

  /** be told about every key press (used by SET KEY when editing a split point); returns the unsubscribe */
  observeNotes(observer: (note: number) => void): () => void {
    this.noteObservers.add(observer)
    return () => {
      this.noteObservers.delete(observer)
    }
  }

  private orderedVoices(): VoiceInfo[] {
    return [...this.voices.values()].sort((a, b) => a.seq - b.seq)
  }

  private beginRelease(voice: VoiceInfo) {
    voice.state = 'releasing'
    this.sink.release(voice.id)
  }

  private pickVictim(): VoiceInfo | undefined {
    let best: VoiceInfo | undefined
    for (const voice of this.voices.values()) {
      if (
        !best ||
        STEAL_PRIORITY[voice.state] < STEAL_PRIORITY[best.state] ||
        (STEAL_PRIORITY[voice.state] === STEAL_PRIORITY[best.state] && voice.seq < best.seq)
      ) {
        best = voice
      }
    }
    return best
  }

  private handleEnded(id: number) {
    if (this.voices.delete(id)) this.emit()
  }

  private computeSnapshot(): LifecycleSnapshot {
    return {
      pressed: new Set(this.holders.values()),
      sustain: this.sustainSources.size > 0,
      voices: this.voices.size,
      maxVoices: this.maxVoices,
    }
  }

  private emit() {
    this.snapshot = this.computeSnapshot()
    for (const l of Array.from(this.listeners)) l()
  }
}
