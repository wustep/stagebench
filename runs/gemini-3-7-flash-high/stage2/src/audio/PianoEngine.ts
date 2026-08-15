import { AudioEngineOptions, AudioStatus } from './types';
import { PianoLayer } from './PianoLayer';
import { RotaryEffect } from './effects/RotaryEffect';
import { SampleLibrary } from './SampleLibrary';
import {
  Mod1Params,
  Mod2Params,
  DelayParams,
  AmpEqParams,
  CompressorParams,
  ReverbParams,
  RotaryParams,
} from './effects/types';

export class PianoEngine {
  private ctx: AudioContext | null = null;
  private status: AudioStatus = 'uninitialized';
  private isDisposed = false;

  // Master Audio Nodes
  private masterBus: GainNode | null = null;
  private masterLevelGain: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;

  // Sound Engine Components
  public sampleLibrary: SampleLibrary | null = null;
  public layerA: PianoLayer | null = null;
  public layerB: PianoLayer | null = null;
  public sharedRotary: RotaryEffect | null = null;

  // Global Engine State
  private isPianoSectionOn = true;
  private masterLevel = 7.0; // 0..10
  private isSustainActive = false;
  private isSoftPedalActive = false;
  private isSostenutoActive = false;
  private pitchBendSemitones = 0; // -2..+2

  // Effects Focus & Grouping
  private focusedLayer: 'A' | 'B' = 'A';
  private isGroupModePiano = false;
  private isAllEffectsBypassed = false;
  private maxPolyphony: number = 32;

  // Event Listeners
  private listeners: Set<(status: AudioStatus) => void> = new Set();
  private voiceCountListeners: Set<(count: number) => void> = new Set();

  constructor(options: AudioEngineOptions = {}) {
    this.maxPolyphony = options.maxPolyphony ?? 32;
    if (options.audioContext) {
      this.ctx = options.audioContext;
      this.setupEngineGraph();
      this.status = this.ctx.state === 'running' ? 'ready' : 'suspended';
    }
  }

  public subscribeStatus(fn: (status: AudioStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  public subscribeVoiceCount(fn: (count: number) => void): () => void {
    this.voiceCountListeners.add(fn);
    fn(this.getActiveVoiceCount());
    return () => this.voiceCountListeners.delete(fn);
  }

  private notifyStatus(newStatus: AudioStatus): void {
    this.status = newStatus;
    this.listeners.forEach((fn) => fn(newStatus));
  }

  private notifyVoiceCount(): void {
    const count = this.getActiveVoiceCount();
    this.voiceCountListeners.forEach((fn) => fn(count));
  }

  public async init(): Promise<void> {
    if (this.isDisposed) return;
    if (this.status === 'ready' && this.ctx?.state === 'running') return;

    this.notifyStatus('loading');

    try {
      if (!this.ctx) {
        const AudioCtxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxClass) {
          this.notifyStatus('error');
          return;
        }
        this.ctx = new AudioCtxClass();
      }

      this.setupEngineGraph();

      if (this.sampleLibrary) {
        await this.sampleLibrary.loadAllSamples();
      }

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      this.notifyStatus('ready');
    } catch {
      this.notifyStatus('error');
    }
  }

  private setupEngineGraph(): void {
    if (!this.ctx || this.masterBus) return;
    const now = this.ctx.currentTime;

    // 1. Master Signal Path:
    // masterBus -> masterLevelGain -> masterLimiter -> destination
    this.masterBus = this.ctx.createGain();
    this.masterLevelGain = this.ctx.createGain();
    this.masterLimiter = this.ctx.createDynamicsCompressor();

    const masterGainValue = Math.pow(this.masterLevel / 10, 1.5) * 0.9;
    this.masterLevelGain.gain.setValueAtTime(masterGainValue, now);

    // Brickwall Master Limiter parameters (prevents digital clipping)
    this.masterLimiter.threshold.setValueAtTime(-0.5, now);
    this.masterLimiter.ratio.setValueAtTime(20.0, now);
    this.masterLimiter.knee.setValueAtTime(0.0, now);
    this.masterLimiter.attack.setValueAtTime(0.001, now);
    this.masterLimiter.release.setValueAtTime(0.05, now);

    this.masterBus.connect(this.masterLevelGain);
    this.masterLevelGain.connect(this.masterLimiter);
    this.masterLimiter.connect(this.ctx.destination);

    // 2. Shared Rotary Effect
    this.sharedRotary = new RotaryEffect(this.ctx);
    this.sharedRotary.output.connect(this.masterBus);

    // 3. Sample Library
    this.sampleLibrary = new SampleLibrary(this.ctx);

    // 4. Piano Layers A and B
    this.layerA = new PianoLayer(
      this.ctx,
      'A',
      this.sharedRotary,
      this.masterBus,
      this.maxPolyphony,
      () => this.notifyVoiceCount()
    );
    this.layerB = new PianoLayer(
      this.ctx,
      'B',
      this.sharedRotary,
      this.masterBus,
      this.maxPolyphony,
      () => this.notifyVoiceCount()
    );
  }

  public getStatus(): AudioStatus {
    return this.status;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public getActiveVoiceCount(): number {
    const a = this.layerA?.getActiveVoiceCount() ?? 0;
    const b = this.layerB?.getActiveVoiceCount() ?? 0;
    return a + b;
  }

  public setMasterLevel(level: number): void {
    this.masterLevel = Math.max(0, Math.min(10, level));
    if (this.ctx && this.masterLevelGain) {
      const now = this.ctx.currentTime;
      const gainVal = Math.pow(this.masterLevel / 10, 1.5) * 0.9;
      this.masterLevelGain.gain.setTargetAtTime(gainVal, now, 0.015);
    }
  }

  public setPianoSectionOn(on: boolean): void {
    this.isPianoSectionOn = on;
    if (!on) {
      this.allNotesOff();
    }
  }

  public isPianoOn(): boolean {
    return this.isPianoSectionOn;
  }

  // --- Piano Note Playback ---
  public noteOn(midi: number, velocity: number = 0.8): void {
    if (this.isDisposed || !this.isPianoSectionOn) return;

    if (!this.ctx || this.ctx.state !== 'running' || !this.sampleLibrary) {
      this.init().then(() => {
        if (!this.isDisposed && this.isPianoSectionOn && this.sampleLibrary) {
          this.spawnNoteVoices(midi, velocity);
        }
      });
      return;
    }

    this.spawnNoteVoices(midi, velocity);
  }

  private spawnNoteVoices(midi: number, velocity: number): void {
    if (!this.sampleLibrary) return;

    if (this.layerA?.getState().enabled) {
      this.layerA.noteOn(midi, velocity, this.sampleLibrary, this.isSustainActive, this.isSoftPedalActive);
    }
    if (this.layerB?.getState().enabled) {
      this.layerB.noteOn(midi, velocity, this.sampleLibrary, this.isSustainActive, this.isSoftPedalActive);
    }
  }

  public noteOff(midi: number): void {
    if (this.layerA) this.layerA.noteOff(midi, this.isSustainActive);
    if (this.layerB) this.layerB.noteOff(midi, this.isSustainActive);
  }

  // --- Pedals & Controllers ---
  public setSustain(sustain: boolean): void {
    this.isSustainActive = sustain;
    if (this.layerA) this.layerA.setSustain(sustain);
    if (this.layerB) this.layerB.setSustain(sustain);
  }

  public isSustained(): boolean {
    return this.isSustainActive;
  }

  public setSoftPedal(active: boolean): void {
    this.isSoftPedalActive = active;
  }

  public isSoftPedal(): boolean {
    return this.isSoftPedalActive;
  }

  public setSostenuto(active: boolean): void {
    this.isSostenutoActive = active;
  }

  public setPitchStick(val: number): void {
    // val is -1..+1, pitch stick bends ±2 semitones
    this.pitchBendSemitones = Math.max(-1, Math.min(1, val)) * 2;
    if (this.layerA) this.layerA.setPitchBend(this.pitchBendSemitones);
    if (this.layerB) this.layerB.setPitchBend(this.pitchBendSemitones);
  }

  // --- Layer Focus & Layer Properties ---
  public setFocusedLayer(layer: 'A' | 'B'): void {
    this.focusedLayer = layer;
    if (this.layerA) this.layerA.updateState({ focused: layer === 'A' });
    if (this.layerB) this.layerB.updateState({ focused: layer === 'B' });
  }

  public getFocusedLayer(): 'A' | 'B' {
    return this.focusedLayer;
  }

  public setGroupModePiano(grouped: boolean): void {
    this.isGroupModePiano = grouped;
  }

  public isPianoGrouped(): boolean {
    return this.isGroupModePiano;
  }

  public isGroupMode(): boolean {
    return this.isGroupModePiano;
  }

  public setAllEffectsBypass(bypassed: boolean): void {
    this.isAllEffectsBypassed = bypassed;
    if (this.layerA) this.layerA.effectChain.setAllEffectsBypass(bypassed);
    if (this.layerB) this.layerB.effectChain.setAllEffectsBypass(bypassed);
  }

  public isAllEffectsBypassedMode(): boolean {
    return this.isAllEffectsBypassed;
  }

  public isEffectsBypassed(): boolean {
    return this.isAllEffectsBypassed;
  }

  // --- Target Effect Chains for Focus / Group / Global ---
  private getTargetEffectChains(isGlobal: boolean = false): Array<import('./effects/EffectChain').EffectChain> {
    const chains: Array<import('./effects/EffectChain').EffectChain> = [];
    if (isGlobal || this.isGroupModePiano) {
      if (this.layerA) chains.push(this.layerA.effectChain);
      if (this.layerB) chains.push(this.layerB.effectChain);
    } else {
      if (this.focusedLayer === 'A' && this.layerA) chains.push(this.layerA.effectChain);
      if (this.focusedLayer === 'B' && this.layerB) chains.push(this.layerB.effectChain);
    }
    return chains;
  }

  public updateMod1(params: Partial<Mod1Params>): void {
    this.getTargetEffectChains().forEach((c) => c.updateMod1(params));
  }

  public setMod1Params(params: Partial<Mod1Params>): void {
    this.updateMod1(params);
  }

  public updateMod2(params: Partial<Mod2Params>): void {
    this.getTargetEffectChains().forEach((c) => c.updateMod2(params));
  }

  public setMod2Params(params: Partial<Mod2Params>): void {
    this.updateMod2(params);
  }

  public updateDelay(params: Partial<DelayParams>): void {
    this.getTargetEffectChains(params.global).forEach((c) => c.updateDelay(params));
  }

  public setDelayParams(params: Partial<DelayParams>): void {
    this.updateDelay(params);
  }

  public updateAmpEq(params: Partial<AmpEqParams>): void {
    this.getTargetEffectChains().forEach((c) => c.updateAmpEq(params));
  }

  public setAmpEqParams(params: Partial<AmpEqParams>): void {
    this.updateAmpEq(params);
  }

  public updateCompressor(params: Partial<CompressorParams>): void {
    this.getTargetEffectChains(params.global).forEach((c) => c.updateCompressor(params));
  }

  public setCompressorParams(params: Partial<CompressorParams>): void {
    this.updateCompressor(params);
  }

  public updateReverb(params: Partial<ReverbParams>): void {
    this.getTargetEffectChains(params.global).forEach((c) => c.updateReverb(params));
  }

  public setReverbParams(params: Partial<ReverbParams>): void {
    this.updateReverb(params);
  }

  public updateRotary(params: Partial<RotaryParams>): void {
    if (this.sharedRotary) {
      this.sharedRotary.setParams(params);
    }
  }

  public setRotaryParams(params: Partial<RotaryParams>): void {
    this.updateRotary(params);
  }

  // --- Cleanup / Panic ---
  public allNotesOff(): void {
    if (this.layerA) this.layerA.allNotesOff();
    if (this.layerB) this.layerB.allNotesOff();
    this.notifyVoiceCount();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    this.listeners.clear();
    this.voiceCountListeners.clear();

    if (this.layerA) this.layerA.dispose();
    if (this.layerB) this.layerB.dispose();
    if (this.sharedRotary) this.sharedRotary.dispose();

    try {
      if (this.masterBus) this.masterBus.disconnect();
      if (this.masterLevelGain) this.masterLevelGain.disconnect();
      if (this.masterLimiter) this.masterLimiter.disconnect();
    } catch {}

    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        this.ctx.close();
      } catch {}
    }
  }
}
