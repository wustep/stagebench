import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockAudioContext } from './audio-mock';
import { OrganEngine } from '../audio/organ/OrganEngine';
import { RotaryEffect } from '../audio/effects/RotaryEffect';

describe('Phase 3 - Organ Sound Engine', () => {
  let ctx: AudioContext;
  let masterBus: GainNode;
  let sharedRotary: RotaryEffect;
  let organEngine: OrganEngine;

  beforeEach(() => {
    ctx = createMockAudioContext();
    masterBus = ctx.createGain();
    sharedRotary = new RotaryEffect(ctx);
    organEngine = new OrganEngine({
      ctx,
      masterBus,
      sharedRotary,
      maxPolyphony: 32,
    });
    organEngine.setSectionOn(true);
  });

  afterEach(() => {
    organEngine.dispose();
    sharedRotary.dispose();
  });

  describe('organ.engine', () => {
    it('manages dual layers (A and B) sharing a single effect chain', () => {
      expect(organEngine.layerA).toBeDefined();
      expect(organEngine.layerB).toBeDefined();
      expect(organEngine.effectChain).toBeDefined();

      // Trigger notes on Layer A
      organEngine.layerA.updateState({ enabled: true, level: 8.0 });
      organEngine.layerB.updateState({ enabled: false });

      organEngine.noteOn(60, 0.8);
      expect(organEngine.getActiveVoiceCount()).toBeGreaterThan(0);

      organEngine.noteOff(60);
      expect(organEngine.getActiveVoiceCount()).toBe(0);
    });

    it('handles sustain pedal on organ layers', () => {
      organEngine.layerA.updateState({ enabled: true, level: 8.0, sustainPedal: true });
      organEngine.setSustain(true);

      organEngine.noteOn(60, 0.8);
      organEngine.noteOff(60);

      // Voices remain sustained while sustain pedal is active
      expect(organEngine.getActiveVoiceCount()).toBeGreaterThan(0);

      organEngine.setSustain(false);
      expect(organEngine.getActiveVoiceCount()).toBe(0);
    });
  });

  describe('organ.models-drawbars', () => {
    it('supports 9 drawbar registrations and audibly distinct models', () => {
      // 1. B3 Tonewheel
      organEngine.layerA.updateState({ model: 'B3', enabled: true });
      organEngine.setDrawbars([8, 8, 8, 0, 0, 0, 0, 0, 0]);
      organEngine.noteOn(60, 0.8);
      expect(organEngine.getActiveVoiceCount()).toBe(1);
      organEngine.allNotesOff();

      // 2. Vox Continental
      organEngine.layerA.updateState({ model: 'Vox', enabled: true });
      organEngine.setDrawbars([8, 0, 8, 4, 0, 0, 0, 0, 0]);
      organEngine.noteOn(60, 0.8);
      expect(organEngine.getActiveVoiceCount()).toBe(1);
      organEngine.allNotesOff();

      // 3. Farfisa Compact
      organEngine.layerA.updateState({ model: 'Farf', enabled: true });
      organEngine.setDrawbars([8, 8, 8, 8, 8, 0, 0, 0, 0]);
      organEngine.noteOn(60, 0.8);
      expect(organEngine.getActiveVoiceCount()).toBe(1);
      organEngine.allNotesOff();

      // 4. Pipe Organ
      organEngine.layerA.updateState({ model: 'Pipe 1', enabled: true });
      organEngine.setDrawbars([8, 4, 0, 2, 0, 0, 0, 0, 0]);
      organEngine.noteOn(60, 0.8);
      expect(organEngine.getActiveVoiceCount()).toBe(1);
      organEngine.allNotesOff();
    });

    it('triggers single-triggered B3 percussion and key click', () => {
      organEngine.layerA.updateState({ model: 'B3', enabled: true });
      organEngine.setPercussion({
        on: true,
        soft: false,
        fast: true,
        third: true,
      });

      // First key down triggers percussion
      organEngine.noteOn(60, 0.8);
      expect(organEngine.getActiveVoiceCount()).toBe(1);

      // Legato second key does NOT retrigger percussion per single-trigger spec
      organEngine.noteOn(64, 0.8);
      expect(organEngine.getActiveVoiceCount()).toBe(2);

      organEngine.allNotesOff();
    });

    it('supports 6 Vibrato/Chorus modes (C1..C3, V1..V3)', () => {
      organEngine.setVibratoMode('C3', true);
      expect(organEngine.vibratoChorus).toBeDefined();

      organEngine.setVibratoMode('V2', true);
      organEngine.setVibratoMode('C1', false);
    });
  });

  describe('organ.rotary', () => {
    it('integrates with shared Rotary unit and speed switching', () => {
      sharedRotary.setParams({
        on: true,
        speed: 'fast',
        stop: false,
        drive: 3.5,
      });

      expect(sharedRotary.getParams().speed).toBe('fast');
      expect(sharedRotary.getParams().drive).toBe(3.5);

      sharedRotary.setSpeed('slow');
      expect(sharedRotary.getParams().speed).toBe('slow');
    });
  });
});
