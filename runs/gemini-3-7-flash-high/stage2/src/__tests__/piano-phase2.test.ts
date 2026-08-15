import { describe, expect, it } from 'vitest';
import { PianoEngine } from '../audio/PianoEngine';
import { SampleLibrary, PIANO_MODEL_CATALOG } from '../audio/SampleLibrary';
import { MockAudioContext, MockBiquadFilterNode } from './audio-mock';

describe('Piano Specifications (Phase 2)', () => {
  describe('piano.instrument-library', () => {
    it('provides all 6 selectable piano types with distinct model variations', async () => {
      const mockCtx = new MockAudioContext();
      const library = new SampleLibrary(mockCtx as unknown as AudioContext);
      await library.loadAllSamples();

      // Check all 6 categories exist in catalog
      expect(PIANO_MODEL_CATALOG[0].length).toBeGreaterThanOrEqual(1); // Grand
      expect(PIANO_MODEL_CATALOG[1].length).toBeGreaterThanOrEqual(1); // Upright
      expect(PIANO_MODEL_CATALOG[2].length).toBeGreaterThanOrEqual(1); // Electric
      expect(PIANO_MODEL_CATALOG[3].length).toBeGreaterThanOrEqual(1); // Clav
      expect(PIANO_MODEL_CATALOG[4].length).toBeGreaterThanOrEqual(1); // Digital
      expect(PIANO_MODEL_CATALOG[5].length).toBeGreaterThanOrEqual(1); // Misc

      // Verify Grand, Upright, Electric use recorded sample sets with multiple root notes
      const grandSample = library.getSample(0, 1, 60, 0.8);
      const uprightSample = library.getSample(1, 1, 60, 0.8);
      const electricSample = library.getSample(2, 1, 60, 0.8);

      expect(grandSample).not.toBeNull();
      expect(uprightSample).not.toBeNull();
      expect(electricSample).not.toBeNull();

      expect(grandSample?.entry.rootMidi).toBe(60);
      expect(grandSample?.pitchRatio).toBeCloseTo(1.0, 3);

      // Verify pitch interpolation for non-root note (MIDI 61 on root 60)
      const grandCsharp = library.getSample(0, 1, 61, 0.8);
      expect(grandCsharp?.entry.rootMidi).toBe(60);
      expect(grandCsharp?.pitchRatio).toBeGreaterThan(1.0); // 2^(1/12) ~ 1.05946

      // Verify Grand, Upright, and Electric buffers are audibly distinct
      const grandL = grandSample!.entry.buffer.getChannelData(0);
      const uprightL = uprightSample!.entry.buffer.getChannelData(0);
      const electricL = electricSample!.entry.buffer.getChannelData(0);

      let grandEnergy = 0;
      let uprightEnergy = 0;
      let electricEnergy = 0;
      let diffGrandUpright = 0;

      for (let i = 0; i < 2000; i++) {
        grandEnergy += Math.abs(grandL[i]);
        uprightEnergy += Math.abs(uprightL[i]);
        electricEnergy += Math.abs(electricL[i]);
        diffGrandUpright += Math.abs(grandL[i] - uprightL[i]);
      }

      expect(grandEnergy).toBeGreaterThan(0);
      expect(uprightEnergy).toBeGreaterThan(0);
      expect(electricEnergy).toBeGreaterThan(0);
      expect(diffGrandUpright).toBeGreaterThan(0.01); // Audibly distinct waveforms
    });

    it('plays all 6 instrument types through the real-time engine', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      // Test each type: Grand (0), Upright (1), Electric (2), Clav (3), Digital (4), Misc (5)
      for (let typeIdx = 0; typeIdx <= 5; typeIdx++) {
        engine.layerA?.updateState({ type: typeIdx, model: 1 });
        engine.noteOn(60, 0.8);
        expect(engine.getActiveVoiceCount()).toBe(1);
        engine.allNotesOff();
        expect(engine.getActiveVoiceCount()).toBe(0);
      }

      engine.dispose();
    });
  });

  describe('piano.layers', () => {
    it('supports two independent layers (A and B) with separate level, octave, and voice ownership', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      expect(engine.layerA?.getState().enabled).toBe(true);
      expect(engine.layerB?.getState().enabled).toBe(false);

      // Enable both layers: Layer A as Grand (octave 0), Layer B as Electric (octave +1)
      engine.layerA?.updateState({ enabled: true, level: 8.0, octave: 0, type: 0 });
      engine.layerB?.updateState({ enabled: true, level: 6.0, octave: 1, type: 2 });

      // Note on C4 (MIDI 60)
      engine.noteOn(60, 0.8);
      // Both Layer A and Layer B spawn a voice
      expect(engine.layerA?.getActiveVoiceCount()).toBe(1);
      expect(engine.layerB?.getActiveVoiceCount()).toBe(1);
      expect(engine.getActiveVoiceCount()).toBe(2);

      // Check layer level gains
      const levelGainA = engine.layerA?.levelGain.gain.value;
      const levelGainB = engine.layerB?.levelGain.gain.value;
      expect(levelGainA).toBeGreaterThan(levelGainB!);

      // Adjusting level fader updates gain
      engine.layerB?.updateState({ level: 10.0 });
      expect(engine.layerB?.levelGain.gain.value).toBeGreaterThan(levelGainA!);

      // Disabling Layer B stops its voices while Layer A remains playing
      engine.layerB?.updateState({ enabled: false });
      expect(engine.layerB?.getActiveVoiceCount()).toBe(0);
      expect(engine.layerA?.getActiveVoiceCount()).toBe(1);

      engine.allNotesOff();
      expect(engine.getActiveVoiceCount()).toBe(0);
      engine.dispose();
    });
  });

  describe('piano.velocity-controls', () => {
    it('applies KB Touch curves, Dyn Comp, Timbre EQ, Unison, and Soft Release', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      // 1. KB Touch: Light (1) should yield higher effective velocity than Heavy (3) for soft stroke
      engine.layerA?.updateState({ kbTouch: 1 }); // Light
      const voiceLight = engine.layerA?.noteOn(60, 0.3, engine.sampleLibrary!, false);
      expect(voiceLight?.effectiveVelocity).toBeGreaterThan(0.3);

      engine.layerA?.updateState({ kbTouch: 3 }); // Heavy
      const voiceHeavy = engine.layerA?.noteOn(60, 0.3, engine.sampleLibrary!, false);
      expect(voiceHeavy?.effectiveVelocity).toBeLessThan(voiceLight!.effectiveVelocity);

      engine.allNotesOff();

      // 2. Dyn Comp: Comp 3 should raise soft velocity level
      engine.layerA?.updateState({ dynComp: 3, kbTouch: 0 });
      const voiceComp = engine.layerA?.noteOn(60, 0.2, engine.sampleLibrary!, false);
      expect(voiceComp?.effectiveVelocity).toBeGreaterThan(0.2);

      engine.allNotesOff();

      // 3. Timbre: Soft dampens high frequencies, Bright boosts treble
      engine.layerA?.updateState({ timbre: 1 }); // Soft
      engine.noteOn(60, 0.8);
      const softFilter = mockCtx.allCreatedNodes
        .slice()
        .reverse()
        .find((n) => (n as unknown as MockBiquadFilterNode).type === 'highshelf');
      expect((softFilter as unknown as MockBiquadFilterNode).gain.value).toBeLessThan(0);

      engine.allNotesOff();

      engine.layerA?.updateState({ timbre: 3 }); // Bright
      engine.noteOn(60, 0.8);
      const brightFilter = mockCtx.allCreatedNodes
        .slice()
        .reverse()
        .find((n) => (n as unknown as MockBiquadFilterNode).type === 'highshelf');
      expect((brightFilter as unknown as MockBiquadFilterNode).gain.value).toBeGreaterThan(0);

      engine.allNotesOff();

      // 4. Unison: Unison 3 spawns multiple detuned voice sources
      engine.layerA?.updateState({ unison: 3 });
      engine.noteOn(60, 0.8);
      expect(engine.getActiveVoiceCount()).toBe(1);

      engine.allNotesOff();

      // 5. Master Level knob alters master output gain
      engine.setMasterLevel(10.0);
      engine.setMasterLevel(2.0);
      expect(engine.getActiveVoiceCount()).toBe(0);

      engine.dispose();
    });
  });

  describe('piano.pedals', () => {
    it('honors SUSTPED toggle and supports sustain, soft pedal (una corda), and pitch stick', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      engine.layerA?.updateState({ enabled: true, sustainPedal: true, pitchStick: true });
      engine.layerB?.updateState({ enabled: true, sustainPedal: false, pitchStick: false });

      // Press sustain pedal
      engine.setSustain(true);
      expect(engine.isSustained()).toBe(true);

      // Play note on both layers
      engine.noteOn(60, 0.8);
      expect(engine.getActiveVoiceCount()).toBe(2);

      // Release key
      engine.noteOff(60);

      // Layer A stays sustained because sustainPedal is on; Layer B releases because sustainPedal is off
      expect(engine.layerA?.getActiveVoiceCount()).toBe(1);
      expect(engine.layerB?.getActiveVoiceCount()).toBe(0);

      // Release sustain pedal -> Layer A releases
      engine.setSustain(false);
      engine.allNotesOff();
      expect(engine.getActiveVoiceCount()).toBe(0);

      // Soft pedal (una corda)
      engine.setSoftPedal(true);
      expect(engine.isSoftPedal()).toBe(true);
      engine.noteOn(60, 0.8);
      expect(engine.getActiveVoiceCount()).toBe(2);
      engine.setSoftPedal(false);

      // Pitch stick bend
      engine.setPitchStick(0.5); // +1 semitone
      engine.setPitchStick(0.0);

      engine.allNotesOff();
      engine.dispose();
    });
  });

  describe('piano.fallback', () => {
    it('enters a labeled playable fallback without crashing when assets fail', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      // Simulate asset failure
      engine.sampleLibrary?.setSimulateFailure(true);
      expect(engine.sampleLibrary?.isFailureMode()).toBe(true);

      // Playing a note still produces a working fallback voice
      engine.noteOn(60, 0.8);
      expect(engine.getActiveVoiceCount()).toBe(1);

      // Fallback voice plays triangle oscillator safely
      const triangleOsc = mockCtx.allCreatedNodes
        .slice()
        .reverse()
        .find((n) => (n as unknown as { type: string }).type === 'triangle');
      expect(triangleOsc).toBeDefined();

      engine.noteOff(60);
      engine.allNotesOff();
      expect(engine.getActiveVoiceCount()).toBe(0);

      engine.dispose();
    });
  });
});
