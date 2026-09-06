/**
 * Deterministic note lifecycle shared by every input (pointer, touch,
 * computer keyboard, MIDI). Tracks per-source refcounts per pitch so
 * overlapping presses need every source to release before note-off, and
 * retriggering a held pitch steals the previous voice first.
 */

export type NoteSource = 'pointer' | 'touch' | 'keyboard' | 'midi';

export interface LifecycleDelegate {
  /** Start engine voice; returns opaque note id (null when silent). */
  startVoice(midi: number, velocity: number, sustain: boolean): string | null;
  /** Stop an engine voice by id. */
  stopVoice(noteId: string): void;
  /** Update damper flag on an engine voice. */
  holdVoice(noteId: string, sustained: boolean): void;
}

interface HeldNote {
  midi: number;
  velocity: number;
  noteId: string | null;
  sources: Set<NoteSource>;
  sustained: boolean;
  released: boolean;
}

export class NoteManager {
  private readonly delegate: LifecycleDelegate;
  /** Pitch -> held note. At most one sounding voice per pitch per manager. */
  private readonly held = new Map<number, HeldNote>();
  private sustain = false;

  constructor(delegate: LifecycleDelegate) {
    this.delegate = delegate;
  }

  isSustained(): boolean {
    return this.sustain;
  }

  activeCount(): number {
    return this.held.size;
  }

  activeMidis(): number[] {
    return [...this.held.keys()].sort((a, b) => a - b);
  }

  /** Press a pitch from a source. Retrigger steals the previous voice. */
  press(midi: number, velocity: number, source: NoteSource): void {
    const existing = this.held.get(midi);
    if (existing && !existing.released) {
      existing.sources.add(source);
      if (velocity !== existing.velocity) {
        // Retrigger: stop the old voice, start a fresh one, keep refcounts.
        if (existing.noteId) this.delegate.stopVoice(existing.noteId);
        existing.noteId = this.delegate.startVoice(midi, velocity, this.sustain);
        existing.velocity = velocity;
        existing.sustained = this.sustain;
      } else if (this.sustain !== existing.sustained) {
        existing.sustained = this.sustain;
        if (existing.noteId) this.delegate.holdVoice(existing.noteId, this.sustain);
      }
      return;
    }
    const noteId = this.delegate.startVoice(midi, velocity, this.sustain);
    this.held.set(midi, {
      midi,
      velocity,
      noteId,
      sources: new Set([source]),
      sustained: this.sustain,
      released: false,
    });
  }

  /** Release one source's hold on a pitch. */
  release(midi: number, source: NoteSource): void {
    const existing = this.held.get(midi);
    if (!existing || existing.released) return;
    existing.sources.delete(source);
    if (existing.sources.size > 0) return;
    existing.released = true;
    if (this.sustain) {
      existing.sustained = true;
      if (existing.noteId) this.delegate.holdVoice(existing.noteId, true);
      return;
    }
    if (existing.noteId) this.delegate.stopVoice(existing.noteId);
    this.held.delete(midi);
  }

  /** Damper transitions. Releasing the pedal stops sustained notes. */
  setSustain(on: boolean): void {
    if (this.sustain === on) return;
    this.sustain = on;
    for (const [midi, note] of this.held) {
      if (on) {
        note.sustained = true;
        if (note.noteId) this.delegate.holdVoice(note.noteId, true);
      } else if (note.released) {
        if (note.noteId) this.delegate.stopVoice(note.noteId);
        this.held.delete(midi);
      } else {
        note.sustained = false;
        if (note.noteId) this.delegate.holdVoice(note.noteId, false);
      }
    }
  }

  /** Panic/blur/disconnect/unmount: stop everything, returns stopped count. */
  allNotesOff(): number {
    const count = this.held.size;
    for (const note of this.held.values()) {
      if (note.noteId) this.delegate.stopVoice(note.noteId);
    }
    this.held.clear();
    return count;
  }
}
