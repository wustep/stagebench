// Note lifecycle: manages pointer, keyboard, and MIDI inputs
// All inputs feed into a single deterministic note playback system

import { PianoVoiceEngine } from './synth-voice';

export interface NoteInput {
  note: number;
  velocity: number;
  source: 'pointer' | 'keyboard' | 'midi';
  sustainActive: boolean;
}

export class NoteLifecycle {
  private engine: PianoVoiceEngine;
  private activeNotes: Map<string, { note: number; velocity: number }> = new Map(); // sourceId -> note info
  private sustainActive: boolean = false;
  private pressedKeys: Set<number> = new Set(); // keyboard key codes

  constructor(engine: PianoVoiceEngine) {
    this.engine = engine;
  }

  // Pointer/touch input
  pointerNoteOn(pointerId: number, note: number, velocity: number = 64): void {
    const key = `ptr-${pointerId}`;

    // If same pointer already has a note, release it first
    if (this.activeNotes.has(key)) {
      const oldNote = this.activeNotes.get(key)!.note;
      this.engine.noteOff(oldNote);
    }

    this.activeNotes.set(key, { note, velocity });
    this.engine.noteOn(note, velocity);
  }

  pointerNoteOff(pointerId: number): void {
    const key = `ptr-${pointerId}`;
    const info = this.activeNotes.get(key);
    if (info) {
      this.engine.noteOff(info.note);
      this.activeNotes.delete(key);
    }
  }

  pointerNoteCancel(pointerId: number): void {
    this.pointerNoteOff(pointerId);
  }

  // Keyboard input with repeat suppression
  keyboardNoteOn(keyCode: number, note: number, velocity: number = 64): void {
    // Ignore repeat events
    if (this.pressedKeys.has(keyCode)) {
      return;
    }

    this.pressedKeys.add(keyCode);
    const key = `kbd-${keyCode}`;

    this.activeNotes.set(key, { note, velocity });
    this.engine.noteOn(note, velocity);
  }

  keyboardNoteOff(keyCode: number): void {
    this.pressedKeys.delete(keyCode);
    const key = `kbd-${keyCode}`;
    const info = this.activeNotes.get(key);
    if (info) {
      this.engine.noteOff(info.note);
      this.activeNotes.delete(key);
    }
  }

  // MIDI input
  midiNoteOn(midiChannel: number, note: number, velocity: number): void {
    const key = `midi-${midiChannel}-${note}`;

    // MIDI allows overlapping notes on same channel
    if (!this.activeNotes.has(key)) {
      this.activeNotes.set(key, { note, velocity });
      this.engine.noteOn(note, velocity);
    }
  }

  midiNoteOff(midiChannel: number, note: number): void {
    const key = `midi-${midiChannel}-${note}`;
    const info = this.activeNotes.get(key);
    if (info) {
      this.engine.noteOff(info.note);
      this.activeNotes.delete(key);
    }
  }

  // Sustain pedal (CC64)
  setSustainPedal(active: boolean): void {
    this.sustainActive = active;
    this.engine.setSustainPedal(active);
  }

  // All notes off (for cleanup)
  allNotesOff(): void {
    this.activeNotes.forEach(({ note }) => {
      this.engine.noteOff(note);
    });
    this.activeNotes.clear();
    this.pressedKeys.clear();
    this.engine.allNotesOff();
  }

  // Cleanup on unmount
  cleanup(): void {
    this.allNotesOff();
  }

  getActiveNoteCount(): number {
    return this.activeNotes.size;
  }

  getIsSustainActive(): boolean {
    return this.sustainActive;
  }
}
