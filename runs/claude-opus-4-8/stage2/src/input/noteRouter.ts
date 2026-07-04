/**
 * NoteRouter — the single shared note lifecycle that every input source
 * (pointer, touch, computer keyboard, MIDI) funnels through. It de-duplicates
 * ownership so that, e.g., a mouse and a computer key on the same pitch don't
 * double-trigger, and it exposes the set of currently-held pitches for UI
 * highlighting.
 *
 * Sources are identified by a string tag ("pointer:3", "kbd", "midi") so each
 * can independently release its own notes (multi-touch independence, blur
 * cleanup) without disturbing others.
 */

import type { PianoEngine } from '../audio/pianoEngine';

export interface NoteSink {
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
  setSustain(down: boolean): void;
  allNotesOff(): void;
}

interface Held {
  velocity: number;
  owners: Set<string>;
}

export class NoteRouter {
  private readonly held = new Map<number, Held>();
  private readonly listeners = new Set<(active: ReadonlySet<number>) => void>();

  constructor(private readonly engine: PianoEngine | NoteSink) {}

  /** Pitches currently sounding (for UI highlight). */
  get activeNotes(): ReadonlySet<number> {
    return new Set(this.held.keys());
  }

  subscribe(fn: (active: ReadonlySet<number>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.activeNotes;
    for (const fn of this.listeners) fn(snapshot);
  }

  noteOn(owner: string, midi: number, velocity = 100): void {
    const entry = this.held.get(midi);
    if (entry) {
      // Already sounding from another owner: register co-ownership, retrigger
      // so velocity of the newest strike wins (musically expected).
      entry.owners.add(owner);
      entry.velocity = velocity;
      this.engine.noteOn(midi, velocity);
      return;
    }
    this.held.set(midi, { velocity, owners: new Set([owner]) });
    this.engine.noteOn(midi, velocity);
    this.notify();
  }

  noteOff(owner: string, midi: number): void {
    const entry = this.held.get(midi);
    if (!entry) return;
    entry.owners.delete(owner);
    if (entry.owners.size > 0) return; // still held by another source
    this.held.delete(midi);
    this.engine.noteOff(midi);
    this.notify();
  }

  /** Release every note owned by a given source (e.g. one lifted finger, blur). */
  releaseOwner(owner: string): void {
    let changed = false;
    for (const [midi, entry] of [...this.held.entries()]) {
      if (!entry.owners.has(owner)) continue;
      entry.owners.delete(owner);
      if (entry.owners.size === 0) {
        this.held.delete(midi);
        this.engine.noteOff(midi);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  setSustain(down: boolean): void {
    this.engine.setSustain(down);
  }

  /** Hard stop everything (blur / disconnect / unmount). */
  panic(): void {
    this.held.clear();
    this.engine.allNotesOff();
    this.notify();
  }
}
