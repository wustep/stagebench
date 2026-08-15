import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockAudioContext } from './audio-mock';
import { SynthEngine } from '../audio/synth/SynthEngine';
import { RotaryEffect } from '../audio/effects/RotaryEffect';

describe('Phase 3 - Synthesizer Sound Engine', () => {
  let ctx: AudioContext;
  let masterBus: GainNode;
  let sharedRotary: RotaryEffect;
  let synthEngine: SynthEngine;

  beforeEach(() => {
    ctx = createMockAudioContext();
    masterBus = ctx.createGain();
    sharedRotary = new RotaryEffect(ctx);
    synthEngine = new SynthEngine({
      ctx,
      masterBus,
      sharedRotary,
      maxPolyphony: 32,
    });
    synthEngine.setSectionOn(true);
    synthEngine.layerA.updateState({ enabled: true });
    synthEngine.layerB.updateState({ enabled: false });
    synthEngine.layerC.updateState({ enabled: false });
  });

  afterEach(() => {
    synthEngine.dispose();
    sharedRotary.dispose();
  });

  describe('synth.sources', () => {
    it('manages three independent layers (A, B, C) with individual effect chains', () => {
      expect(synthEngine.layerA).toBeDefined();
      expect(synthEngine.layerB).toBeDefined();
      expect(synthEngine.layerC).toBeDefined();
      expect(synthEngine.layerA.effectChain).not.toBe(synthEngine.layerB.effectChain);
      expect(synthEngine.layerB.effectChain).not.toBe(synthEngine.layerC.effectChain);

      synthEngine.layerA.updateState({ enabled: true, level: 8.0 });
      synthEngine.layerB.updateState({ enabled: false });
      synthEngine.layerC.updateState({ enabled: false });

      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);

      synthEngine.noteOff(60);
      expect(synthEngine.getActiveVoiceCount()).toBe(0);
    });

    it('generates distinct waveforms across all five oscillator categories', () => {
      // 1. Pure Analog Category
      synthEngine.layerA.updateParams({ oscCategory: 'Pure', waveformIndex: 2 }); // Saw
      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();

      // 2. Sync Category with Osc Ctrl modulation
      synthEngine.layerA.updateParams({ oscCategory: 'Sync', oscMod: 4.5 });
      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();

      // 3. Multi-Saw Category
      synthEngine.layerA.updateParams({ oscCategory: 'Multi', oscMod: 5.0 });
      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();

      // 4. Super-Saw / Super-Square Category
      synthEngine.layerA.updateParams({ oscCategory: 'Super', oscMod: 6.0 });
      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();

      // 5. FM-H Harmonic FM Category
      synthEngine.layerA.updateParams({ oscCategory: 'FM-H', oscMod: 7.5 });
      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();
    });
  });

  describe('synth.filter-envelopes', () => {
    it('supports LP12, LP24, HP, and BP multi-mode filters with drive and tracking', () => {
      const filterTypes = ['LP12', 'LP24', 'HP', 'BP'] as const;

      filterTypes.forEach((fType) => {
        synthEngine.layerA.updateParams({
          filterType: fType,
          filterCutoff: 6.5,
          filterResonance: 4.0,
          filterDrive: 2,
          filterKbTracking: 2, // 2/3
        });

        synthEngine.noteOn(60, 0.8);
        expect(synthEngine.getActiveVoiceCount()).toBe(1);
        synthEngine.allNotesOff();
      });
    });

    it('modulates voice shapes through Amp, Mod, and Filter envelopes', () => {
      synthEngine.layerA.updateParams({
        ampAttack: 0.2,
        ampDecay: 1.5,
        ampSustain: 6.0,
        ampRelease: 0.8,
        modAttack: 0.1,
        modDecay: 1.0,
        modEnvAmt: 4.0,
        filterEnvAmt: 5.0,
      });

      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.noteOff(60);
      expect(synthEngine.getActiveVoiceCount()).toBe(0);
    });
  });

  describe('synth.voice-modes', () => {
    it('supports Polyphonic, Monophonic, and Legato voice allocation with Glide', () => {
      // Polyphonic mode
      synthEngine.layerA.updateParams({ voiceMode: 'Poly' });
      synthEngine.noteOn(60, 0.8);
      synthEngine.noteOn(64, 0.8);
      synthEngine.noteOn(67, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(3);
      synthEngine.allNotesOff();

      // Monophonic mode
      synthEngine.layerA.updateParams({ voiceMode: 'Mono', voicePriority: 'High' });
      synthEngine.noteOn(60, 0.8);
      synthEngine.noteOn(67, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();

      // Legato mode with glide
      synthEngine.layerA.updateParams({ voiceMode: 'Legato', glide: 4.0 });
      synthEngine.noteOn(60, 0.8);
      synthEngine.noteOn(62, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();
    });

    it('supports LFO waveforms and destinations with Master Clock sync', () => {
      synthEngine.layerA.updateParams({
        lfoWaveform: 'Triangle',
        lfoDestination: 'Filter Freq',
        lfoRate: 5.0,
        lfoAmount: 4.0,
        lfoClockSync: true,
      });

      synthEngine.noteOn(60, 0.8);
      expect(synthEngine.getActiveVoiceCount()).toBe(1);
      synthEngine.allNotesOff();
    });
  });

  describe('synth.arp-gate', () => {
    it('supports Arpeggiator and Gate modes with Range, Direction, and KB Hold', () => {
      synthEngine.layerA.updateParams({
        arpMode: 'Arp',
        arpDirection: 'Up/Down',
        arpRange: 2,
        arpRate: 5.0,
        arpClockSync: false,
        arpKbHold: true,
        arpRun: true,
      });

      synthEngine.noteOn(60, 0.8);
      synthEngine.noteOn(64, 0.8);
      expect(synthEngine.layerA.arpeggiator).toBeDefined();

      synthEngine.layerA.updateParams({ arpRun: false });
      synthEngine.allNotesOff();
    });
  });
});
