// The single note lifecycle shared by pointer, touch, computer keyboard, and MIDI.
//
// Inputs call noteOn/noteOff with a source ID (for example "pointer:3", "key:KeyA", "midi").
// The controller owns which voice belongs to which source, applies sustain, enforces polyphony
// with deterministic stealing, and releases or stops every voice it started.

import { isKeyboardNote } from '../model/keybed'
import type { VoiceHandle, VoiceSink } from '../audio/pianoVoice'

export const MAX_POLYPHONY = 16

type VoiceState = 'held' | 'sustained' | 'released'

interface VoiceEntry {
  note: number
  source: string
  seq: number
  state: VoiceState
  handle: VoiceHandle
  /** Set once the voice has finished or been stolen; later releases for it do nothing. */
  ended: boolean
}

export interface NoteControllerOptions {
  maxPolyphony?: number
  /** Called with the physically held note numbers whenever that set changes. */
  onHeldNotesChange?: (heldNotes: ReadonlySet<number>) => void
  /** Called when sustain flips between active and inactive. */
  onSustainChange?: (active: boolean) => void
}

export class NoteController {
  private readonly sink: VoiceSink
  private readonly maxPolyphony: number
  private readonly onHeldNotesChange?: (heldNotes: ReadonlySet<number>) => void
  private readonly onSustainChange?: (active: boolean) => void
  private readonly bySourceNote = new Map<string, VoiceEntry>()
  private readonly voices: VoiceEntry[] = []
  private readonly sustainSources = new Set<string>()
  private sequence = 0

  constructor(sink: VoiceSink, options: NoteControllerOptions = {}) {
    this.sink = sink
    this.maxPolyphony = options.maxPolyphony ?? MAX_POLYPHONY
    this.onHeldNotesChange = options.onHeldNotesChange
    this.onSustainChange = options.onSustainChange
  }

  /** Starts a voice for `note`. Returns false for notes outside the keybed or a repeat from the same source. */
  noteOn(source: string, note: number, velocity: number): boolean {
    if (!isKeyboardNote(note)) return false
    const key = sourceNoteKey(source, note)
    if (this.bySourceNote.has(key)) return false

    this.makeRoomForVoice()
    const entry: VoiceEntry = { note, source, seq: this.sequence, state: 'held', handle: NOOP_HANDLE, ended: false }
    this.sequence += 1
    this.bySourceNote.set(key, entry)
    this.voices.push(entry)
    entry.handle = this.sink.start(note, velocity, () => this.handleEnded(entry))
    this.notifyHeld()
    return true
  }

  /** Releases the voice started by `source` for `note`. With sustain on, the voice keeps ringing until sustain lifts. */
  noteOff(source: string, note: number): boolean {
    const key = sourceNoteKey(source, note)
    const entry = this.bySourceNote.get(key)
    if (!entry) return false
    this.bySourceNote.delete(key)
    if (this.sustainSources.size > 0) {
      entry.state = 'sustained'
    } else {
      entry.state = 'released'
      entry.handle.release()
    }
    this.notifyHeld()
    return true
  }

  /**
   * Each sustain source (the pedal UI, the Shift key, MIDI CC64) holds the damper independently.
   * Sustain is active while any source holds it. When the last source lets go, every sustained voice is released.
   */
  setSustain(source: string, on: boolean): void {
    const wasActive = this.sustainSources.size > 0
    if (on) {
      this.sustainSources.add(source)
    } else {
      this.sustainSources.delete(source)
    }
    const isActive = this.sustainSources.size > 0
    if (wasActive && !isActive) {
      for (const entry of this.voices.slice()) {
        if (entry.state === 'sustained' && !entry.ended) {
          entry.state = 'released'
          entry.handle.release()
        }
      }
    }
    if (wasActive !== isActive) {
      this.onSustainChange?.(isActive)
    }
  }

  get sustainActive(): boolean {
    return this.sustainSources.size > 0
  }

  /** Releases every voice that `source` started, held or sustained. Used when that input is cancelled or lost. */
  releaseSource(source: string): void {
    for (const [key, entry] of Array.from(this.bySourceNote.entries())) {
      if (entry.source === source) this.bySourceNote.delete(key)
    }
    for (const entry of this.voices.slice()) {
      if (entry.source === source && entry.state !== 'released' && !entry.ended) {
        entry.state = 'released'
        entry.handle.release()
      }
    }
    this.notifyHeld()
  }

  /** Releases every held and sustained voice from every source. Used on window blur. */
  allNotesOff(): void {
    this.bySourceNote.clear()
    for (const entry of this.voices.slice()) {
      if (entry.state !== 'released' && !entry.ended) {
        entry.state = 'released'
        entry.handle.release()
      }
    }
    this.notifyHeld()
  }

  /** Hard stop for every owned voice. Used on unmount and when audio is torn down. */
  stopAll(): void {
    this.bySourceNote.clear()
    this.sustainSources.clear()
    for (const entry of this.voices.slice()) {
      if (!entry.ended) {
        entry.handle.stop()
      }
    }
    this.voices.length = 0
    this.notifyHeld()
  }

  /** Voices that have started and not yet ended, including released tails. */
  get activeVoiceCount(): number {
    return this.voices.length
  }

  /** Physically held notes (pointer, keyboard, or MIDI), not counting sustained or released tails. */
  get heldNotes(): ReadonlySet<number> {
    const notes = new Set<number>()
    for (const entry of this.bySourceNote.values()) notes.add(entry.note)
    return notes
  }

  private makeRoomForVoice(): void {
    while (this.voices.length >= this.maxPolyphony) {
      const victim = this.chooseVictim()
      if (!victim) return
      this.removeVoice(victim)
      victim.ended = true
      victim.handle.stop()
      this.bySourceNote.forEach((entry, key) => {
        if (entry === victim) this.bySourceNote.delete(key)
      })
    }
  }

  /** Released tails go first, then sustained voices, then held voices; within a class the oldest goes first. */
  private chooseVictim(): VoiceEntry | undefined {
    const order: VoiceState[] = ['released', 'sustained', 'held']
    for (const state of order) {
      const candidate = this.voices
        .filter((entry) => entry.state === state)
        .sort((a, b) => a.seq - b.seq)[0]
      if (candidate) return candidate
    }
    return undefined
  }

  private handleEnded(entry: VoiceEntry): void {
    entry.ended = true
    this.removeVoice(entry)
    this.bySourceNote.forEach((candidate, key) => {
      if (candidate === entry) this.bySourceNote.delete(key)
    })
    this.notifyHeld()
  }

  private removeVoice(entry: VoiceEntry): void {
    const index = this.voices.indexOf(entry)
    if (index >= 0) this.voices.splice(index, 1)
  }

  private notifyHeld(): void {
    this.onHeldNotesChange?.(this.heldNotes)
  }
}

const NOOP_HANDLE: VoiceHandle = { release() {}, stop() {} }

function sourceNoteKey(source: string, note: number): string {
  return `${source}\u0000${note}`
}
