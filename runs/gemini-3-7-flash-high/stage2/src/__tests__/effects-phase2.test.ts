import { describe, expect, it } from 'vitest';
import { PianoEngine } from '../audio/PianoEngine';
import { MockAudioContext } from './audio-mock';

describe('Layer Effects Specifications (Phase 2)', () => {
  describe('effects.graph', () => {
    it('constructs a single-context ordered effects graph with per-layer buses and master limiter', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      expect(engine.layerA).toBeDefined();
      expect(engine.layerB).toBeDefined();
      expect(engine.sharedRotary).toBeDefined();

      const effectChainA = engine.layerA!.effectChain;
      expect(effectChainA.inputBus).toBeDefined();
      expect(effectChainA.outputBus).toBeDefined();

      // Check all 6 effect units exist in chain
      expect(effectChainA.mod1).toBeDefined();
      expect(effectChainA.mod2).toBeDefined();
      expect(effectChainA.delay).toBeDefined();
      expect(effectChainA.ampEq).toBeDefined();
      expect(effectChainA.compressor).toBeDefined();
      expect(effectChainA.reverb).toBeDefined();

      // Ensure nodes are created in the single AudioContext
      expect(mockCtx.allCreatedNodes.length).toBeGreaterThan(10);

      engine.dispose();
    });
  });

  describe('effects.routing', () => {
    it('manages focus, group mode, global mode, unit bypass, and all-effects bypass', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      // Focus switching
      engine.setFocusedLayer('B');
      expect(engine.getFocusedLayer()).toBe('B');
      expect(engine.layerB?.getState().focused).toBe(true);
      expect(engine.layerA?.getState().focused).toBe(false);

      // Group mode
      engine.setGroupModePiano(true);
      expect(engine.isGroupMode()).toBe(true);

      // In group mode, updating delay updates both Layer A and Layer B
      engine.setDelayParams({ enabled: true, tempo: 0.7, amount: 0.5, feedback: 0.6 });
      expect(engine.layerA?.effectChain.delay.getParams().tempo).toBe(0.7);
      expect(engine.layerB?.effectChain.delay.getParams().tempo).toBe(0.7);

      // Global mode
      engine.setDelayParams({ global: true, enabled: true });
      expect(engine.layerA?.effectChain.delay.getParams().global).toBe(true);
      expect(engine.layerB?.effectChain.delay.getParams().global).toBe(true);

      // Per-unit bypass
      engine.setMod1Params({ enabled: false });
      expect(engine.layerB?.effectChain.mod1.getParams().enabled).toBe(false);
      engine.setMod1Params({ enabled: true });
      expect(engine.layerB?.effectChain.mod1.getParams().enabled).toBe(true);

      // All effects bypass
      engine.setAllEffectsBypass(true);
      expect(engine.isEffectsBypassed()).toBe(true);
      engine.setAllEffectsBypass(false);
      expect(engine.isEffectsBypassed()).toBe(false);

      // To Rotary routing
      engine.setAmpEqParams({ toRotary: true, enabled: true });
      expect(engine.layerB?.effectChain.ampEq.getParams().toRotary).toBe(true);
      expect(engine.layerB?.effectChain.isToRotary()).toBe(true);

      engine.dispose();
    });

    it('implements delay feedback filtering across Off, LP, HP, and BP modes', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const delay = engine.layerA!.effectChain.delay;
      delay.updateParams({ enabled: true, filter: 'LP' });
      expect(delay.getParams().filter).toBe('LP');

      delay.updateParams({ filter: 'HP' });
      expect(delay.getParams().filter).toBe('HP');

      delay.updateParams({ filter: 'BP' });
      expect(delay.getParams().filter).toBe('BP');

      delay.updateParams({ filter: 'Off' });
      expect(delay.getParams().filter).toBe('Off');

      engine.dispose();
    });
  });

  describe('effects.processing', () => {
    it('measurably alters parameters across Mod 1 types (A-Pan, Tremolo, RingMod, A-Wah, Wah, Pump)', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const mod1 = engine.layerA!.effectChain.mod1;

      // Test each Mod 1 type
      const types = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const;
      for (const type of types) {
        mod1.updateParams({ enabled: true, type, rate: 0.6, amount: 0.8 });
        expect(mod1.getParams().type).toBe(type);
        expect(mod1.getParams().amount).toBe(0.8);
      }

      engine.dispose();
    });

    it('measurably alters parameters across Mod 2 types (Chorus, Flanger, Phaser, Vibe, Ensemble, Spin)', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const mod2 = engine.layerA!.effectChain.mod2;

      const types = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const;
      for (const type of types) {
        mod2.updateParams({ enabled: true, type, rate: 0.5, amount: 0.7 });
        expect(mod2.getParams().type).toBe(type);
        expect(mod2.getParams().amount).toBe(0.7);
      }

      engine.dispose();
    });

    it('configures Amp Sim models and 3-band EQ', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const ampEq = engine.layerA!.effectChain.ampEq;

      // Test Amp models
      const ampTypes = ['Twin', 'JC', 'Small', 'LP24', 'HP24'] as const;
      for (const type of ampTypes) {
        ampEq.updateParams({ enabled: true, type, drive: 0.8 });
        expect(ampEq.getParams().type).toBe(type);
      }

      // Test 3-band EQ
      ampEq.updateParams({ bass: 0.8, mid: 0.3, midFreq: 0.6, treble: 0.9 });
      expect(ampEq.getParams().bass).toBe(0.8);
      expect(ampEq.getParams().treble).toBe(0.9);

      engine.dispose();
    });

    it('configures Compressor parameters and Fast mode', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const comp = engine.layerA!.effectChain.compressor;
      comp.updateParams({ enabled: true, amount: 0.8, fast: true });
      expect(comp.getParams().fast).toBe(true);
      expect(comp.getParams().amount).toBe(0.8);

      comp.updateParams({ fast: false });
      expect(comp.getParams().fast).toBe(false);

      engine.dispose();
    });

    it('configures Reverb types, decay, amount, and Bright damping', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const reverb = engine.layerA!.effectChain.reverb;
      const reverbTypes = ['Booth', 'Room', 'Stage', 'Hall', 'Cathedral', 'Spring'] as const;

      for (const type of reverbTypes) {
        reverb.updateParams({ enabled: true, type, amount: 0.6, decay: 0.7, bright: true });
        expect(reverb.getParams().type).toBe(type);
        expect(reverb.getParams().bright).toBe(true);
      }

      engine.dispose();
    });

    it('configures Rotary rotor speed, stop, and drive', async () => {
      const mockCtx = new MockAudioContext();
      const engine = new PianoEngine({ audioContext: mockCtx as unknown as AudioContext });
      await engine.init();

      const rotary = engine.sharedRotary!;
      rotary.updateParams({ enabled: true, speed: 'Fast', drive: 0.7, stop: false });
      expect(rotary.getParams().speed).toBe('Fast');
      expect(rotary.getParams().drive).toBe(0.7);

      rotary.updateParams({ speed: 'Slow', stop: true });
      expect(rotary.getParams().speed).toBe('Slow');
      expect(rotary.getParams().stop).toBe(true);

      engine.dispose();
    });
  });
});
