// Phase 2: Effect signal chain and routing

import { EffectUnitType, EffectProcessing } from './types';
import { createMod1Effect } from './mod1';
import { createMod2Effect } from './mod2';
import { createDelayEffect } from './delay';
import { createAmpEqEffect } from './amp-eq';
import { createCompressorEffect } from './compressor';
import { createReverbEffect } from './reverb';

export class EffectChain {
  private audioContext: AudioContext;
  private layerId: 'A' | 'B';
  private enabled: boolean = true;

  // Signal path nodes
  private input: GainNode;
  private mod1: EffectProcessing | null = null;
  private mod2: EffectProcessing | null = null;
  private delay: EffectProcessing | null = null;
  private ampEq: EffectProcessing | null = null;
  private compressor: EffectProcessing | null = null;
  private reverb: EffectProcessing | null = null;
  private bypassGain: GainNode;
  private output: GainNode;

  // Routing nodes for effects order
  private nodes: EffectProcessing[] = [];

  private rotaryRoutingActive: boolean = false;

  constructor(
    audioContext: AudioContext,
    layerId: 'A' | 'B',
    masterOutput: GainNode
  ) {
    this.audioContext = audioContext;
    this.layerId = layerId;

    // Create input node
    this.input = audioContext.createGain();

    // Create bypass path
    this.bypassGain = audioContext.createGain();
    this.bypassGain.gain.value = 0; // Start with effects enabled
    this.input.connect(this.bypassGain);

    // Create output mixer (mixes processed + bypass)
    this.output = audioContext.createGain();
    this.bypassGain.connect(this.output);
    this.output.connect(masterOutput);

    // Create all effect units (initially bypassed)
    this.createEffectChain();
  }

  private createEffectChain(): void {
    try {
      // Create each effect unit
      this.mod1 = createMod1Effect(this.audioContext, 'Tremolo');
      this.mod2 = createMod2Effect(this.audioContext, 'Chorus');
      this.delay = createDelayEffect(this.audioContext);
      this.ampEq = createAmpEqEffect(this.audioContext, 'EQ only');
      this.compressor = createCompressorEffect(this.audioContext);
      this.reverb = createReverbEffect(this.audioContext, 'Room');

      // Build signal chain: input → mod1 → mod2 → delay → ampEq → compressor → reverb → output
      this.nodes = [this.mod1, this.mod2, this.delay, this.ampEq, this.compressor, this.reverb];

      let currentNode: AudioNode = this.input;
      for (const effect of this.nodes) {
        currentNode.connect(effect.input);
        currentNode = effect.output;
      }

      // Connect final effect output to output mixer
      currentNode.connect(this.output);
    } catch (error) {
      console.error('Failed to create effect chain:', error);
    }
  }

  setUnitType(unitId: EffectUnitType, type: string): void {
    switch (unitId) {
      case 'mod1':
        if (this.mod1) this.mod1.setType(type);
        break;
      case 'mod2':
        if (this.mod2) this.mod2.setType(type);
        break;
      case 'delay':
        if (this.delay) this.delay.setType(type);
        break;
      case 'ampEq':
        if (this.ampEq) {
          this.ampEq.setType(type);
          this.rotaryRoutingActive = type === 'To Rotary';
        }
        break;
      case 'compressor':
        if (this.compressor) this.compressor.setType(type);
        break;
      case 'reverb':
        if (this.reverb) this.reverb.setType(type);
        break;
    }
  }

  setUnitParameter(unitId: EffectUnitType, paramName: string, value: number): void {
    const unit = this.getUnit(unitId);
    if (unit) {
      unit.setParameter(paramName, value);
    }
  }

  setUnitEnabled(unitId: EffectUnitType, enabled: boolean): void {
    const unit = this.getUnit(unitId);
    if (unit) {
      unit.setEnabled(enabled);
    }
  }

  setUnitDryWet(unitId: EffectUnitType, dryWet: number): void {
    const unit = this.getUnit(unitId);
    if (unit) {
      unit.setDryWet(Math.max(0, Math.min(1, dryWet)));
    }
  }

  setAllEffectsEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // When all effects are off, route directly through bypass
    this.bypassGain.gain.setTargetAtTime(enabled ? 0 : 1, this.audioContext.currentTime, 0.01);
    this.nodes.forEach((unit) => {
      unit.setEnabled(enabled);
    });
  }

  getRotaryRoutingActive(): boolean {
    return this.rotaryRoutingActive;
  }

  getInput(): AudioNode {
    return this.input;
  }

  getOutput(): AudioNode {
    return this.output;
  }

  cleanup(): void {
    this.nodes.forEach((unit) => {
      unit.cleanup();
    });
    this.input.disconnect();
    this.bypassGain.disconnect();
    this.output.disconnect();
  }

  private getUnit(unitId: EffectUnitType): EffectProcessing | null {
    switch (unitId) {
      case 'mod1': return this.mod1;
      case 'mod2': return this.mod2;
      case 'delay': return this.delay;
      case 'ampEq': return this.ampEq;
      case 'compressor': return this.compressor;
      case 'reverb': return this.reverb;
      default: return null;
    }
  }
}
