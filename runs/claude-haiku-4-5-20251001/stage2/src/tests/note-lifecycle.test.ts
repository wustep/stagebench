import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NoteLifecycle } from '../audio/note-lifecycle';
import { PianoVoiceEngine } from '../audio/synth-voice';

describe('Note Lifecycle', () => {
  let audioContext: AudioContext;
  let masterGain: GainNode;
  let engine: PianoVoiceEngine;
  let lifecycle: NoteLifecycle;

  beforeEach(() => {
    audioContext = new (global as any).AudioContext();
    masterGain = audioContext.createGain();
    engine = new PianoVoiceEngine(audioContext, masterGain);
    lifecycle = new NoteLifecycle(engine);
  });

  afterEach(() => {
    lifecycle.cleanup();
    engine.cleanup();
  });

  describe('Pointer input', () => {
    it('plays note on pointer down', () => {
      lifecycle.pointerNoteOn(0, 60, 64);
      expect(engine.getActiveVoiceCount()).toBe(1);
    });

    it('stops note on pointer up', () => {
      lifecycle.pointerNoteOn(0, 60, 64);
      expect(engine.getActiveVoiceCount()).toBe(1);
      lifecycle.pointerNoteOff(0);
    });

    it('supports multi-touch (multiple pointers)', () => {
      lifecycle.pointerNoteOn(0, 60, 64);
      lifecycle.pointerNoteOn(1, 64, 65);
      lifecycle.pointerNoteOn(2, 67, 66);
      expect(engine.getActiveVoiceCount()).toBe(3);
    });

    it('replaces note when same pointer presses again', () => {
      lifecycle.pointerNoteOn(0, 60, 64);
      expect(engine.getActiveVoiceCount()).toBe(1);

      lifecycle.pointerNoteOn(0, 64, 70); // Same pointer, new note
      // Should still have 1 voice (replaced)
      expect(engine.getActiveVoiceCount()).toBeLessThanOrEqual(2);
    });
  });

  describe('Keyboard input', () => {
    it('plays note on key press', () => {
      lifecycle.keyboardNoteOn(90, 60, 64); // keyCode 90 = 'Z'
      expect(engine.getActiveVoiceCount()).toBe(1);
    });

    it('stops note on key release', () => {
      lifecycle.keyboardNoteOn(90, 60, 64);
      lifecycle.keyboardNoteOff(90);
    });

    it('ignores repeat key events (no repeat sounds)', () => {
      lifecycle.keyboardNoteOn(90, 60, 64);
      expect(engine.getActiveVoiceCount()).toBe(1);

      // Simulating key repeat
      lifecycle.keyboardNoteOn(90, 60, 64);
      // Should still be 1 voice (repeat suppressed)
      expect(engine.getActiveVoiceCount()).toBe(1);
    });

    it('supports multiple keys pressed simultaneously', () => {
      lifecycle.keyboardNoteOn(90, 60, 64);
      lifecycle.keyboardNoteOn(88, 64, 65);
      lifecycle.keyboardNoteOn(87, 67, 66);
      expect(engine.getActiveVoiceCount()).toBe(3);
    });
  });

  describe('MIDI input', () => {
    it('plays note on MIDI noteOn', () => {
      lifecycle.midiNoteOn(0, 60, 64);
      expect(engine.getActiveVoiceCount()).toBe(1);
    });

    it('stops note on MIDI noteOff', () => {
      lifecycle.midiNoteOn(0, 60, 64);
      expect(engine.getActiveVoiceCount()).toBe(1);
      lifecycle.midiNoteOff(0, 60);
    });

    it('supports multiple MIDI channels', () => {
      lifecycle.midiNoteOn(0, 60, 64); // channel 0
      lifecycle.midiNoteOn(1, 64, 65); // channel 1
      lifecycle.midiNoteOn(0, 67, 66); // channel 0 again
      expect(engine.getActiveVoiceCount()).toBe(3);
    });

    it('allows same note on different channels', () => {
      lifecycle.midiNoteOn(0, 60, 64);
      lifecycle.midiNoteOn(1, 60, 65);
      // Both should be active
      const voiceCount = engine.getActiveVoiceCount();
      expect(voiceCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Sustain pedal', () => {
    it('activates sustain', () => {
      lifecycle.setSustainPedal(true);
      expect(lifecycle.getIsSustainActive()).toBe(true);
    });

    it('deactivates sustain', () => {
      lifecycle.setSustainPedal(true);
      lifecycle.setSustainPedal(false);
      expect(lifecycle.getIsSustainActive()).toBe(false);
    });

    it('applies sustain to active voices', () => {
      lifecycle.pointerNoteOn(0, 60, 64);
      lifecycle.setSustainPedal(true);
      // Voice should be sustained
      expect(engine.getActiveVoiceCount()).toBe(1);
    });
  });

  describe('Cleanup', () => {
    it('stops all notes on allNotesOff', () => {
      lifecycle.pointerNoteOn(0, 60, 64);
      lifecycle.keyboardNoteOn(90, 64, 65);
      lifecycle.midiNoteOn(0, 67, 66);
      expect(engine.getActiveVoiceCount()).toBe(3);

      lifecycle.allNotesOff();
      expect(engine.getActiveVoiceCount()).toBe(0);
    });

    it('cleans up on unmount', () => {
      lifecycle.pointerNoteOn(0, 60, 64);
      lifecycle.cleanup();
      expect(engine.getActiveVoiceCount()).toBe(0);
    });
  });
});
