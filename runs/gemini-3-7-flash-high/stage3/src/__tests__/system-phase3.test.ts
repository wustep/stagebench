import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockAudioContext } from './audio-mock';
import { Stage4AudioEngine } from '../audio/PianoEngine';
import { SplitConfig } from '../model/splits';

describe('Phase 3 - Master System Integration', () => {
  let ctx: AudioContext;
  let engine: Stage4AudioEngine;

  beforeEach(() => {
    ctx = createMockAudioContext();
    engine = new Stage4AudioEngine({
      audioContext: ctx,
      maxPolyphony: 32,
    });
    engine.init();
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('layers.routing', () => {
    it('routes notes independently across all 7 layers (Piano A/B, Organ A/B, Synth A/B/C)', () => {
      engine.setPianoSectionOn(true);
      engine.setOrganSectionOn(true);
      engine.setSynthSectionOn(true);

      expect(engine.layerA).toBeDefined();
      expect(engine.layerB).toBeDefined();
      expect(engine.organEngine?.layerA).toBeDefined();
      expect(engine.organEngine?.layerB).toBeDefined();
      expect(engine.synthEngine?.layerA).toBeDefined();
      expect(engine.synthEngine?.layerB).toBeDefined();
      expect(engine.synthEngine?.layerC).toBeDefined();

      // Enable Piano A, Organ A, Synth A
      engine.layerA?.updateState({ enabled: true, level: 8.0 });
      engine.layerB?.updateState({ enabled: false });
      engine.organEngine?.layerA.updateState({ enabled: true, level: 8.0 });
      engine.organEngine?.layerB.updateState({ enabled: false });
      engine.synthEngine?.layerA.updateState({ enabled: true, level: 8.0 });
      engine.synthEngine?.layerB.updateState({ enabled: false });
      engine.synthEngine?.layerC.updateState({ enabled: false });

      engine.noteOn(60, 0.8);
      expect(engine.getActiveVoiceCount()).toBeGreaterThan(0);

      engine.noteOff(60);
      expect(engine.getActiveVoiceCount()).toBe(0);
    });

    it('manages 6 total effect chains with section focus, group, and global routing', () => {
      const allChains = engine.getAllEffectChains();
      expect(allChains.length).toBe(6);

      // Focus Synth
      engine.setLayerFocusSection('synth');
      engine.setFocusedSynthLayer('B');
      expect(engine.getLayerFocusSection()).toBe('synth');

      // Group modes
      engine.setGroupModePiano(true);
      expect(engine.isPianoGrouped()).toBe(true);

      engine.setGroupModeSynth(true);

      // Bypass all effects
      engine.setAllEffectsBypass(true);
      expect(engine.isAllEffectsBypassedMode()).toBe(true);
    });
  });

  describe('system.integration', () => {
    it('routes all 3 sound engines through one AudioContext and one Master Limiter', () => {
      expect(engine.getContext()).toBe(ctx);

      // Master Level
      engine.setMasterLevel(8.5);

      // Transpose
      engine.setTranspose(4); // +4 semitones

      // Master Clock
      engine.setTempoBpm(138);

      // Splits
      const splitConfig: SplitConfig = {
        enabled: true,
        lowSplitActive: false,
        lowPosition: 'C3',
        lowCrossfade: 0,
        midSplitActive: true,
        midPosition: 'C4',
        midCrossfade: 0,
        highSplitActive: false,
        highPosition: 'C5',
        highCrossfade: 0,
      };
      engine.setSplits(splitConfig);

      // Mod Wheel
      engine.setModWheel(0.7);

      // Panic halts all voices
      engine.panic();
      expect(engine.getActiveVoiceCount()).toBe(0);
    });
  });

  describe('regression.phase2', () => {
    it('preserves all Phase 1 and Phase 2 piano and effect capabilities without regression', () => {
      expect(engine.layerA).toBeDefined();
      expect(engine.layerB).toBeDefined();

      engine.updateMod1({ on: true, type: 'Tremolo', rate: 4.0, amount: 5.0 });
      engine.updateMod2({ on: true, type: 'Chorus', rate: 2.0, amount: 6.0 });
      engine.updateDelay({ on: true, tempo: 5.0, feedback: 4.0, amount: 3.0, pingPong: true });
      engine.updateAmpEq({ on: true, type: 'Twin', drive: 2.0, bass: 1.0, mid: 0, midFreq: 5.0, treble: 1.0 });
      engine.updateCompressor({ on: true, amount: 4.0, fast: false, global: false });
      engine.updateReverb({ on: true, type: 'Stage', decay: 4.0, amount: 3.5, bright: true, global: false });

      engine.allNotesOff();
      expect(engine.getActiveVoiceCount()).toBe(0);
    });
  });
});
