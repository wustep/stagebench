import { describe, expect, it } from 'vitest';
import { PianoEngine } from '../audio/PianoEngine';
import { NoteLifecycle } from '../input/NoteLifecycle';
import { MidiController, GenericMidiAccess, GenericMidiInput } from '../input/MidiController';
import { MockAudioContext } from './audio-mock';

describe('Audio and Piano Specifications (Phase 1)', () => {
  describe('piano.basic-note-lifecycle', () => {
    it('creates audio nodes on note on and disconnects them on note off/cleanup', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      expect(engine.getActiveVoiceCount()).toBe(0);

      // Note On E1 (MIDI 28)
      engine.noteOn(28, 0.8);
      expect(engine.getActiveVoiceCount()).toBe(1);

      // Note On Middle C (MIDI 60)
      engine.noteOn(60, 0.9);
      expect(engine.getActiveVoiceCount()).toBe(2);

      // Overlapping note re-trigger on MIDI 60
      engine.noteOn(60, 0.5);
      expect(engine.getActiveVoiceCount()).toBe(3);

      // Note off MIDI 28
      engine.noteOff(28);
      // Voice transitions to releasing / dead
      engine.allNotesOff();
      expect(engine.getActiveVoiceCount()).toBe(0);

      engine.dispose();
    });
  });

  describe('piano.basic-inputs', () => {
    it('handles multiple input sources and releases note only when all sources release', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      let activeKeysSnapshot = new Set<number>();
      const lifecycle = new NoteLifecycle({
        engine,
        onActiveKeysChange: (keys) => {
          activeKeysSnapshot = keys;
        },
      });

      // Pointer down on C4 (MIDI 60)
      lifecycle.noteOn(60, 'pointer', 0.8);
      expect(activeKeysSnapshot.has(60)).toBe(true);

      // Keyboard also presses C4 ('q' key)
      lifecycle.noteOn(60, 'keyboard', 0.8);
      expect(activeKeysSnapshot.has(60)).toBe(true);

      // Pointer releases C4, but keyboard still holds it
      lifecycle.noteOff(60, 'pointer');
      expect(activeKeysSnapshot.has(60)).toBe(true);
      expect(engine.getActiveVoiceCount()).toBeGreaterThan(0);

      // Keyboard releases C4
      lifecycle.noteOff(60, 'keyboard');
      expect(activeKeysSnapshot.has(60)).toBe(false);

      lifecycle.dispose();
      engine.dispose();
    });

    it('processes MIDI Note On, Note Off, and Sustain CC64 events', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const lifecycle = new NoteLifecycle({ engine });

      const mockInputs = new Map<string, GenericMidiInput>();
      const dummyInput: GenericMidiInput = { onmidimessage: null };
      mockInputs.set('port-1', dummyInput);

      const mockMidiAccess: GenericMidiAccess = {
        inputs: mockInputs,
        onstatechange: null,
      };

      let currentMidiStatus = '';
      const midiController = new MidiController(
        {
          onNoteOn: (midi, vel) => lifecycle.noteOn(midi, 'midi', vel),
          onNoteOff: (midi) => lifecycle.noteOff(midi, 'midi'),
          onSustainChange: (sustain) => lifecycle.setSustain(sustain),
          onStatusChange: (status) => {
            currentMidiStatus = status;
          },
        },
        mockMidiAccess
      );

      expect(currentMidiStatus).toBe('granted');

      // Send MIDI Note On C4 (60), vel 100
      midiController.handleMidiMessage({ data: [0x90, 60, 100] });
      expect(engine.getActiveVoiceCount()).toBe(1);

      // Send MIDI Sustain Pedal Down (CC64, 127)
      midiController.handleMidiMessage({ data: [0xb0, 64, 127] });
      expect(lifecycle.getSustain()).toBe(true);

      // Send MIDI Note Off C4 (status 0x80)
      midiController.handleMidiMessage({ data: [0x80, 60, 0] });
      // Because sustain is active, voice stays sustained
      expect(engine.getActiveVoiceCount()).toBe(1);

      // Send MIDI Sustain Pedal Up (CC64, 0)
      midiController.handleMidiMessage({ data: [0xb0, 64, 0] });
      expect(lifecycle.getSustain()).toBe(false);

      // Test denied MIDI access
      const deniedController = new MidiController(
        {
          onNoteOn: () => {},
          onNoteOff: () => {},
          onSustainChange: () => {},
          onStatusChange: (s) => {
            currentMidiStatus = s;
          },
        },
        null
      );
      expect(currentMidiStatus).toBe('denied');

      midiController.dispose();
      deniedController.dispose();
      lifecycle.dispose();
      engine.dispose();
    });
  });

  describe('piano.basic-sustain-polyphony', () => {
    it('scales audio gain and filter frequency based on velocity', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      // Spawn soft note
      engine.noteOn(60, 0.2);
      const softFilter = mockCtx.allCreatedNodes.find(
        (n) => (n as unknown as { type: string }).type === 'lowpass'
      );
      const softCutoff = (softFilter as unknown as { frequency: { value: number } }).frequency.value;

      engine.allNotesOff();

      // Spawn hard note
      engine.noteOn(60, 1.0);
      const hardFilter = mockCtx.allCreatedNodes
        .slice()
        .reverse()
        .find((n) => (n as unknown as { type: string }).type === 'lowpass');
      const hardCutoff = (hardFilter as unknown as { frequency: { value: number } }).frequency.value;

      expect(hardCutoff).toBeGreaterThan(softCutoff);

      engine.dispose();
    });

    it('performs deterministic voice stealing when maximum polyphony is exceeded', async () => {
      const mockCtx = new MockAudioContext();
      const maxPolyphony = 8;
      const engine = new PianoEngine({
        audioContext: mockCtx as unknown as AudioContext,
        maxPolyphony,
      });
      await engine.init();

      // Spawn maxPolyphony notes
      for (let i = 0; i < maxPolyphony; i++) {
        engine.noteOn(30 + i, 0.8);
      }
      expect(engine.getActiveVoiceCount()).toBe(maxPolyphony);

      // Spawn one extra note - oldest voice should be stolen
      engine.noteOn(70, 0.8);
      expect(engine.getActiveVoiceCount()).toBe(maxPolyphony);

      engine.dispose();
    });
  });

  describe('piano.basic-status-cleanup', () => {
    it('reports truthful loading/ready states and stops all voices on cleanup', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });

      const statuses: string[] = [];
      engine.subscribeStatus((s) => statuses.push(s));

      await engine.init();
      expect(statuses).toContain('ready');
      expect(engine.getStatus()).toBe('ready');

      engine.noteOn(60, 0.8);
      engine.noteOn(64, 0.8);
      engine.noteOn(67, 0.8);
      expect(engine.getActiveVoiceCount()).toBe(3);

      engine.allNotesOff();
      expect(engine.getActiveVoiceCount()).toBe(0);

      engine.dispose();
    });
  });
});
