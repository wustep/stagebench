// Phase 2: Master piano engine managing layers, effects, and performance controls

import { PianoLayer, PianoPerformanceControls } from './piano-layer-engine';
import { EffectChain } from './effects/graph';

export class Phase2PianoEngine {
  private audioContext: AudioContext;
  private masterGain: GainNode;
  private masterLimiter: DynamicsCompressorNode;

  private layerA: PianoLayer;
  private layerB: PianoLayer;

  private effectChainA: EffectChain;
  private effectChainB: EffectChain;

  private performanceControls: PianoPerformanceControls;
  private focusedLayer: 'A' | 'B' = 'A';
  private masterLevel: number = 1.0;

  constructor(audioContext: AudioContext, masterGain: GainNode) {
    this.audioContext = audioContext;
    this.masterGain = masterGain;

    // Create master limiter (per spec)
    const masterLimiter = audioContext.createDynamicsCompressor();
    masterLimiter.threshold.value = -24;
    masterLimiter.knee.value = 30;
    masterLimiter.ratio.value = 4;
    masterLimiter.attack.value = 0.005;
    masterLimiter.release.value = 0.1;
    this.masterLimiter = masterLimiter;

    // Create master level control gain before limiter
    const masterLevelGain = audioContext.createGain();
    masterLevelGain.gain.value = 1.0;
    masterLevelGain.connect(masterLimiter);
    masterLimiter.connect(masterGain);

    // Initialize performance controls
    this.performanceControls = {
      kbTouch: 'Medium',
      dynComp: 0,
      timbre: 'Off',
      unison: 0,
      softRelease: false,
      stringRes: false,
    };

    // Create effect chains for both layers (they output to masterLimiter)
    this.effectChainA = new EffectChain(
      audioContext,
      'A',
      masterLevelGain
    );
    this.effectChainB = new EffectChain(
      audioContext,
      'B',
      masterLevelGain
    );

    // Create piano layers feeding into effect chains
    this.layerA = new PianoLayer(
      audioContext,
      'A',
      this.effectChainA.getInput() as GainNode,
      this.performanceControls
    );
    this.layerB = new PianoLayer(
      audioContext,
      'B',
      this.effectChainB.getInput() as GainNode,
      this.performanceControls
    );

    // Set initial state
    this.layerA.setFocused(true);
    this.layerB.setEnabled(false); // Start with only Layer A
  }

  // Note input (routed to focused layer)
  noteOn(note: number, velocity: number): void {
    if (this.focusedLayer === 'A') {
      this.layerA.noteOn(note, velocity);
    } else {
      this.layerB.noteOn(note, velocity);
    }
  }

  noteOff(note: number): void {
    // Release note from both layers (in case input happened on one but note is held on other)
    // Actually, we need to track which layer owns the note
    // For now, try to release from both
    this.layerA.noteOff(note);
    this.layerB.noteOff(note);
  }

  // Layer management
  setLayerEnabled(layer: 'A' | 'B', enabled: boolean): void {
    if (layer === 'A') {
      this.layerA.setEnabled(enabled);
    } else {
      this.layerB.setEnabled(enabled);
    }
  }

  setLayerFocused(layer: 'A' | 'B'): void {
    this.focusedLayer = layer;
    this.layerA.setFocused(layer === 'A');
    this.layerB.setFocused(layer === 'B');
  }

  setLayerLevel(layer: 'A' | 'B', level: number): void {
    if (layer === 'A') {
      this.layerA.setLevel(level);
    } else {
      this.layerB.setLevel(level);
    }
  }

  setLayerOctaveShift(layer: 'A' | 'B', shift: number): void {
    if (layer === 'A') {
      this.layerA.setOctaveShift(shift);
    } else {
      this.layerB.setOctaveShift(shift);
    }
  }

  // Performance controls (apply to all enabled layers)
  updatePerformanceControls(controls: Partial<PianoPerformanceControls>): void {
    this.performanceControls = { ...this.performanceControls, ...controls };
    this.layerA.updatePerformanceControls(controls);
    this.layerB.updatePerformanceControls(controls);
  }

  setMasterLevel(level: number): void {
    this.masterLevel = Math.max(0, Math.min(1, level));
    this.masterGain.gain.setTargetAtTime(this.masterLevel * 0.3, this.audioContext.currentTime, 0.01);
  }

  // Sustain pedal
  setSustainPedal(active: boolean): void {
    this.layerA.setSustainPedal(active);
    this.layerB.setSustainPedal(active);
  }

  // All notes off
  allNotesOff(): void {
    this.layerA.allNotesOff();
    this.layerB.allNotesOff();
  }

  // Effect chain control
  setEffectUnitType(layer: 'A' | 'B', unitId: string, type: string): void {
    if (layer === 'A') {
      this.effectChainA.setUnitType(unitId as any, type);
    } else {
      this.effectChainB.setUnitType(unitId as any, type);
    }
  }

  setEffectUnitParameter(layer: 'A' | 'B', unitId: string, paramName: string, value: number): void {
    if (layer === 'A') {
      this.effectChainA.setUnitParameter(unitId as any, paramName, value);
    } else {
      this.effectChainB.setUnitParameter(unitId as any, paramName, value);
    }
  }

  setEffectUnitEnabled(layer: 'A' | 'B', unitId: string, enabled: boolean): void {
    if (layer === 'A') {
      this.effectChainA.setUnitEnabled(unitId as any, enabled);
    } else {
      this.effectChainB.setUnitEnabled(unitId as any, enabled);
    }
  }

  setAllEffectsEnabled(layer: 'A' | 'B', enabled: boolean): void {
    if (layer === 'A') {
      this.effectChainA.setAllEffectsEnabled(enabled);
    } else {
      this.effectChainB.setAllEffectsEnabled(enabled);
    }
  }

  // Cleanup
  cleanup(): void {
    this.allNotesOff();
    this.layerA.cleanup();
    this.layerB.cleanup();
    this.effectChainA.cleanup();
    this.effectChainB.cleanup();
    this.masterLimiter.disconnect();
  }

  // Diagnostics
  getActiveVoiceCount(): number {
    return this.layerA.getActiveVoiceCount() + this.layerB.getActiveVoiceCount();
  }

  getAudioNodeCount(): number {
    // Rough estimate; in tests we'd check the actual graph
    return 100; // Placeholder
  }
}
