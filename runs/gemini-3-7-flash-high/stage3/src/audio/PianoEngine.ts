import { AudioEngineOptions, AudioStatus } from './types';
import { PianoLayer } from './PianoLayer';
import { OrganEngine } from './organ/OrganEngine';
import { SynthEngine } from './synth/SynthEngine';
import { RotaryEffect } from './effects/RotaryEffect';
import { SampleLibrary } from './SampleLibrary';
import { EffectChain } from './effects/EffectChain';
import { SplitConfig, calculateNoteZoneGains } from '../model/splits';
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
  public ctx: AudioContext | null = null;
  private status: AudioStatus = 'uninitialized';
  private isDisposed = false;

  // Master Audio Nodes
  public masterBus: GainNode | null = null;
  public masterLevelGain: GainNode | null = null;
  public masterLimiter: DynamicsCompressorNode | null = null;

  // Sound Engine Components
  public sampleLibrary: SampleLibrary | null = null;
  public layerA: PianoLayer | null = null;
  public layerB: PianoLayer | null = null;
  public organEngine: OrganEngine | null = null;
  public synthEngine: SynthEngine | null = null;
  public sharedRotary: RotaryEffect | null = null;

  // Global Engine State
  private isPianoSectionOn = true;
  private masterLevel = 7.0; // 0..10
  private isSustainActive = false;
  private isSoftPedalActive = false;
  private isSostenutoActive = false;
  private pitchBendSemitones = 0; // -2..+2
  private modWheelValue = 0; // 0..1
  private transposeSemitones = 0; // -6..+6
  private splitsConfig: SplitConfig | null = null;

  // Effects Focus & Grouping
  private focusSection: 'piano' | 'organ' | 'synth' = 'piano';
  private focusedPianoLayer: 'A' | 'B' = 'A';
  private focusedSynthLayer: 'A' | 'B' | 'C' = 'A';
  private isGroupModePiano = false;
  private isGroupModeSynth = false;
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

  public notifyVoiceCount(): void {
    const count = this.getActiveVoiceCount();
    this.voiceCountListeners.forEach((fn) => fn(count));
  }

  public getContext(): AudioContext | null {
    return this.ctx;
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

    // 3. Piano Sample Library
    this.sampleLibrary = new SampleLibrary(this.ctx);

    // 4. Piano Layers A and B (Chains 1 and 2)
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

    // 5. Organ Engine (Layer A & B sharing Chain 6)
    this.organEngine = new OrganEngine({
      ctx: this.ctx,
      masterBus: this.masterBus,
      sharedRotary: this.sharedRotary,
      maxPolyphony: this.maxPolyphony,
      onVoiceCountChange: () => this.notifyVoiceCount(),
    });

    // 6. Synth Engine (Layers A, B, C owning Chains 3, 4, 5)
    this.synthEngine = new SynthEngine({
      ctx: this.ctx,
      masterBus: this.masterBus,
      sharedRotary: this.sharedRotary,
      maxPolyphony: this.maxPolyphony,
      onVoiceCountChange: () => this.notifyVoiceCount(),
    });
  }

  public getStatus(): AudioStatus {
    return this.status;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public getActiveVoiceCount(): number {
    const pA = this.layerA?.getActiveVoiceCount() ?? 0;
    const pB = this.layerB?.getActiveVoiceCount() ?? 0;
    const org = this.organEngine?.getActiveVoiceCount() ?? 0;
    const syn = this.synthEngine?.getActiveVoiceCount() ?? 0;
    return pA + pB + org + syn;
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
      this.layerA?.allNotesOff();
      this.layerB?.allNotesOff();
      this.notifyVoiceCount();
    }
  }

  public isPianoOn(): boolean {
    return this.isPianoSectionOn;
  }

  public setOrganSectionOn(on: boolean): void {
    this.organEngine?.setSectionOn(on);
    this.notifyVoiceCount();
  }

  public setSynthSectionOn(on: boolean): void {
    this.synthEngine?.setSectionOn(on);
    this.notifyVoiceCount();
  }

  public setTempoBpm(bpm: number): void {
    this.synthEngine?.setTempoBpm(bpm);
  }

  public setTranspose(semitones: number): void {
    this.transposeSemitones = Math.max(-6, Math.min(6, semitones));
  }

  public setSplits(splits: SplitConfig): void {
    this.splitsConfig = { ...splits };
  }

  public setModWheel(val: number): void {
    this.modWheelValue = val;
    this.synthEngine?.setModWheel(val);
  }

  // --- Note Playback Routing ---
  public noteOn(midi: number, velocity: number = 0.8): void {
    if (this.isDisposed) return;

    if (!this.ctx || this.ctx.state !== 'running' || !this.sampleLibrary) {
      this.init().then(() => {
        if (!this.isDisposed) {
          this.dispatchNoteOn(midi, velocity);
        }
      });
      return;
    }

    this.dispatchNoteOn(midi, velocity);
  }

  private dispatchNoteOn(midi: number, velocity: number): void {
    const transposedMidi = midi + this.transposeSemitones;
    if (transposedMidi < 0 || transposedMidi > 127) return;

    // 1. Piano Routing
    if (this.isPianoSectionOn && this.sampleLibrary) {
      const gainA = this.splitsConfig
        ? calculateNoteZoneGains(transposedMidi, this.splitsConfig, this.layerA?.getState().zones ?? { zone1: true, zone2: true, zone3: true, zone4: true })
        : 1.0;
      const gainB = this.splitsConfig
        ? calculateNoteZoneGains(transposedMidi, this.splitsConfig, this.layerB?.getState().zones ?? { zone1: true, zone2: true, zone3: true, zone4: true })
        : 1.0;

      if (this.layerA?.getState().enabled && gainA > 0) {
        this.layerA.noteOn(
          transposedMidi,
          velocity * gainA,
          this.sampleLibrary,
          this.isSustainActive,
          this.isSoftPedalActive
        );
      }
      if (this.layerB?.getState().enabled && gainB > 0) {
        this.layerB.noteOn(
          transposedMidi,
          velocity * gainB,
          this.sampleLibrary,
          this.isSustainActive,
          this.isSoftPedalActive
        );
      }
    }

    // 2. Organ Routing
    if (this.organEngine?.isOrganOn()) {
      this.organEngine.noteOn(transposedMidi, velocity, this.splitsConfig ?? undefined);
    }

    // 3. Synth Routing
    if (this.synthEngine?.isSynthOn()) {
      this.synthEngine.noteOn(transposedMidi, velocity, this.splitsConfig ?? undefined);
    }
  }

  public noteOff(midi: number): void {
    const transposedMidi = midi + this.transposeSemitones;

    if (this.layerA) this.layerA.noteOff(transposedMidi, this.isSustainActive);
    if (this.layerB) this.layerB.noteOff(transposedMidi, this.isSustainActive);
    if (this.organEngine) this.organEngine.noteOff(transposedMidi);
    if (this.synthEngine) this.synthEngine.noteOff(transposedMidi);
  }

  // --- Pedals & Controllers ---
  public setSustain(sustain: boolean): void {
    this.isSustainActive = sustain;
    if (this.layerA) this.layerA.setSustain(sustain);
    if (this.layerB) this.layerB.setSustain(sustain);
    if (this.organEngine) this.organEngine.setSustain(sustain);
    if (this.synthEngine) this.synthEngine.setSustain(sustain);
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
    this.pitchBendSemitones = Math.max(-1, Math.min(1, val)) * 2;
    if (this.layerA) this.layerA.setPitchBend(this.pitchBendSemitones);
    if (this.layerB) this.layerB.setPitchBend(this.pitchBendSemitones);
    if (this.organEngine) this.organEngine.setPitchBend(this.pitchBendSemitones);
    if (this.synthEngine) this.synthEngine.setPitchBend(this.pitchBendSemitones);
  }

  // --- Layer Focus & Layer Properties ---
  public setLayerFocusSection(section: 'piano' | 'organ' | 'synth'): void {
    this.focusSection = section;
  }

  public getLayerFocusSection(): 'piano' | 'organ' | 'synth' {
    return this.focusSection;
  }

  public setFocusedLayer(layer: 'A' | 'B'): void {
    this.focusedPianoLayer = layer;
    if (this.layerA) this.layerA.updateState({ focused: layer === 'A' });
    if (this.layerB) this.layerB.updateState({ focused: layer === 'B' });
  }

  public getFocusedLayer(): 'A' | 'B' {
    return this.focusedPianoLayer;
  }

  public setFocusedSynthLayer(layer: 'A' | 'B' | 'C'): void {
    this.focusedSynthLayer = layer;
    if (this.synthEngine) {
      this.synthEngine.layerA.updateState({ focused: layer === 'A' });
      this.synthEngine.layerB.updateState({ focused: layer === 'B' });
      this.synthEngine.layerC.updateState({ focused: layer === 'C' });
    }
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

  public setGroupModeSynth(grouped: boolean): void {
    this.isGroupModeSynth = grouped;
  }

  public setAllEffectsBypass(bypassed: boolean): void {
    this.isAllEffectsBypassed = bypassed;
    this.getAllEffectChains().forEach((c) => c.setAllEffectsBypass(bypassed));
  }

  public isAllEffectsBypassedMode(): boolean {
    return this.isAllEffectsBypassed;
  }

  public isEffectsBypassed(): boolean {
    return this.isAllEffectsBypassed;
  }

  // --- Target Effect Chains for Focus / Group / Global ---
  public getAllEffectChains(): EffectChain[] {
    const chains: EffectChain[] = [];
    if (this.layerA) chains.push(this.layerA.effectChain);
    if (this.layerB) chains.push(this.layerB.effectChain);
    if (this.organEngine) chains.push(this.organEngine.effectChain);
    if (this.synthEngine) {
      chains.push(this.synthEngine.layerA.effectChain);
      chains.push(this.synthEngine.layerB.effectChain);
      chains.push(this.synthEngine.layerC.effectChain);
    }
    return chains;
  }

  private getTargetEffectChains(isGlobal: boolean = false): EffectChain[] {
    if (isGlobal) {
      return this.getAllEffectChains();
    }

    const chains: EffectChain[] = [];

    if (this.focusSection === 'organ' && this.organEngine) {
      chains.push(this.organEngine.effectChain);
    } else if (this.focusSection === 'synth' && this.synthEngine) {
      if (this.isGroupModeSynth) {
        chains.push(
          this.synthEngine.layerA.effectChain,
          this.synthEngine.layerB.effectChain,
          this.synthEngine.layerC.effectChain
        );
      } else {
        if (this.focusedSynthLayer === 'A') chains.push(this.synthEngine.layerA.effectChain);
        if (this.focusedSynthLayer === 'B') chains.push(this.synthEngine.layerB.effectChain);
        if (this.focusedSynthLayer === 'C') chains.push(this.synthEngine.layerC.effectChain);
      }
    } else {
      // Piano Section Focus
      if (this.isGroupModePiano) {
        if (this.layerA) chains.push(this.layerA.effectChain);
        if (this.layerB) chains.push(this.layerB.effectChain);
      } else {
        if (this.focusedPianoLayer === 'A' && this.layerA) chains.push(this.layerA.effectChain);
        if (this.focusedPianoLayer === 'B' && this.layerB) chains.push(this.layerB.effectChain);
      }
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
    if (this.organEngine) this.organEngine.allNotesOff();
    if (this.synthEngine) this.synthEngine.allNotesOff();
    this.notifyVoiceCount();
  }

  public panic(): void {
    this.isSustainActive = false;
    this.pitchBendSemitones = 0;
    this.allNotesOff();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    this.listeners.clear();
    this.voiceCountListeners.clear();

    if (this.layerA) this.layerA.dispose();
    if (this.layerB) this.layerB.dispose();
    if (this.organEngine) this.organEngine.dispose();
    if (this.synthEngine) this.synthEngine.dispose();
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

export { PianoEngine as Stage4AudioEngine };
